// server/src/services/incidentService.js
// Incident lifecycle manager, debounce engine, cancellation countdowns, and recovery

import { ALLOWED_STATUS_TRANSITIONS, INCIDENT_STATUS, Incident } from '../models/Incident.js';
import { ApiError } from '../utils/apiResponse.js';
import logger from '../utils/logger.js';
import { dispatchAlerts } from './alertService.js';
import { getCachedSettings } from './settingsService.js';

// Map of active countdown timers: incidentId -> timeoutId
const activeCountdowns = new Map();

// Map of last incident creation timestamp: deviceId -> timestamp
const lastIncidentAtByDevice = new Map();

let socketEmitter = null;
let commandPublisher = null;

export function setSocketEmitter(emitter) {
  socketEmitter = emitter;
}

export function setCommandPublisher(publisher) {
  commandPublisher = publisher;
}

/**
 * Handles newly detected accident candidate from ML or Rule engine
 */
export async function handleAccidentCandidate({
  deviceId,
  peakG,
  speedAtImpact = 0,
  confidence = 0.9,
  detectionSource = 'ML',
  predictedLabel = 'ACCIDENT',
  location = { lat: 10.998, lng: 76.966 },
  sensorSnapshot = [],
  detectionLatencyMs = 0,
}) {
  const settings = getCachedSettings();
  const debounceMs = (settings.debounceSeconds || 60) * 1000;
  const now = Date.now();

  // 1. Debounce check: Prevent duplicate incident creation for the same crash
  const lastAt = lastIncidentAtByDevice.get(deviceId);
  if (lastAt && now - lastAt < debounceMs) {
    logger.debug(`[Incident] Debounced duplicate crash for ${deviceId} (within ${settings.debounceSeconds}s)`);
    return null;
  }

  // Check if an open/pending incident already exists in DB
  const activeIncident = await Incident.findOne({
    deviceId,
    status: { $in: [INCIDENT_STATUS.DETECTED, INCIDENT_STATUS.PENDING_CONFIRMATION] },
  });
  if (activeIncident) {
    logger.debug(`[Incident] Incident already active for ${deviceId} (${activeIncident._id})`);
    return null;
  }

  // 2. Compute cancellation window deadline
  const countdownSec = settings.cancelCountdownSeconds || 15;
  const cancelDeadline = new Date(now + countdownSec * 1000);

  // 3. Create incident record in PENDING_CONFIRMATION state
  const incident = await Incident.create({
    deviceId,
    detectedAt: new Date(now),
    location: {
      lat: location.lat || 10.998,
      lng: location.lng || 76.966,
    },
    speedAtImpact,
    peakG,
    confidence,
    detectionSource,
    predictedLabel,
    status: INCIDENT_STATUS.PENDING_CONFIRMATION,
    cancelDeadline,
    statusHistory: [
      {
        status: INCIDENT_STATUS.PENDING_CONFIRMATION,
        changedAt: new Date(now),
        reason: `Crash detected via ${detectionSource} (Peak: ${peakG}g, Confidence: ${(confidence * 100).toFixed(0)}%)`,
        changedBy: 'SYSTEM',
      },
    ],
    sensorSnapshot: sensorSnapshot.slice(-100), // Store up to 100 points around impact
    detectionLatencyMs,
  });

  lastIncidentAtByDevice.set(deviceId, now);
  logger.incident('PENDING_CONFIRMATION', deviceId, `Incident created: ${incident._id} (Peak: ${peakG}g, ${countdownSec}s countdown)`);

  // 4. Command IoT device: Sound Virtual Buzzer
  if (commandPublisher) {
    commandPublisher(deviceId, { buzzer: 'ON', reason: 'CRASH_DETECTED' });
  }

  // 5. Broadcast Socket.IO event
  if (socketEmitter) {
    socketEmitter.emit('incident:new', incident);
    socketEmitter.emit('incident:pending', {
      incidentId: incident._id,
      deviceId,
      peakG,
      cancelDeadline,
      remainingSec: countdownSec,
    });
  }

  // 6. Schedule confirmation countdown timer
  _scheduleCountdown(incident._id.toString(), deviceId, countdownSec * 1000);

  return incident;
}

function _scheduleCountdown(incidentId, deviceId, delayMs) {
  if (activeCountdowns.has(incidentId)) {
    clearTimeout(activeCountdowns.get(incidentId));
  }

  const timer = setTimeout(async () => {
    activeCountdowns.delete(incidentId);
    try {
      await confirmIncident(incidentId, 'Countdown expired without cancellation');
    } catch (err) {
      logger.error(`[Incident] Error confirming incident ${incidentId}:`, err.message);
    }
  }, Math.max(100, delayMs));

  if (timer.unref) timer.unref();
  activeCountdowns.set(incidentId, timer);
}

/**
 * Driver / Operator false alarm cancellation
 */
export async function cancelIncident(idOrDeviceId, reason = 'False alarm cancelled by driver', cancelledBy = 'DRIVER') {
  const query = idOrDeviceId.match(/^[0-9a-fA-F]{24}$/)
    ? { _id: idOrDeviceId }
    : { deviceId: idOrDeviceId, status: INCIDENT_STATUS.PENDING_CONFIRMATION };

  const incident = await Incident.findOne(query);
  if (!incident) {
    throw new ApiError(`Active pending incident not found for "${idOrDeviceId}"`, 404, null, 'INCIDENT_NOT_FOUND');
  }

  // Clear countdown timer
  const incIdStr = incident._id.toString();
  if (activeCountdowns.has(incIdStr)) {
    clearTimeout(activeCountdowns.get(incIdStr));
    activeCountdowns.delete(incIdStr);
  }

  incident.status = INCIDENT_STATUS.FALSE_ALARM;
  incident.statusHistory.push({
    status: INCIDENT_STATUS.FALSE_ALARM,
    changedAt: new Date(),
    reason,
    changedBy: cancelledBy,
  });

  await incident.save();
  logger.incident('FALSE_ALARM', incident.deviceId, `Incident ${incident._id} cancelled: ${reason}`);

  // Turn off buzzer on device
  if (commandPublisher) {
    commandPublisher(incident.deviceId, { buzzer: 'OFF', cmd: 'CANCEL', reason });
  }

  // Broadcast Socket.IO event
  if (socketEmitter) {
    socketEmitter.emit('incident:cancelled', {
      incidentId: incident._id,
      deviceId: incident.deviceId,
      reason,
      status: INCIDENT_STATUS.FALSE_ALARM,
    });
  }

  return incident;
}

/**
 * Confirms accident and dispatches multi-channel alerts
 */
export async function confirmIncident(incidentId, reason = 'Confirmed after cancellation window') {
  const incident = await Incident.findById(incidentId);
  if (!incident) return null;

  if (incident.status !== INCIDENT_STATUS.PENDING_CONFIRMATION) {
    return incident; // Already resolved or cancelled
  }

  incident.status = INCIDENT_STATUS.CONFIRMED;
  incident.statusHistory.push({
    status: INCIDENT_STATUS.CONFIRMED,
    changedAt: new Date(),
    reason,
    changedBy: 'SYSTEM',
  });

  await incident.save();
  logger.incident('CONFIRMED', incident.deviceId, `Incident ${incident._id} officially confirmed.`);

  // Broadcast confirmation over Socket.IO
  if (socketEmitter) {
    socketEmitter.emit('incident:confirmed', incident);
  }

  // Dispatch emergency notifications (SMS, Email, Telegram)
  await dispatchAlerts(incident._id, socketEmitter);

  return incident;
}

/**
 * Transitions incident status (e.g. to RESOLVED) with state-machine validation
 */
export async function updateIncidentStatus(incidentId, newStatus, reason = '', changedBy = 'USER') {
  const incident = await Incident.findById(incidentId);
  if (!incident) {
    throw new ApiError(`Incident "${incidentId}" not found`, 404, null, 'INCIDENT_NOT_FOUND');
  }

  const allowed = ALLOWED_STATUS_TRANSITIONS[incident.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new ApiError(
      `Transition from "${incident.status}" to "${newStatus}" is not permitted. Allowed: [${allowed.join(', ')}]`,
      400,
      null,
      'INVALID_STATUS_TRANSITION'
    );
  }

  // If transitioning away from pending, clear countdown
  const incIdStr = incident._id.toString();
  if (activeCountdowns.has(incIdStr)) {
    clearTimeout(activeCountdowns.get(incIdStr));
    activeCountdowns.delete(incIdStr);
  }

  incident.status = newStatus;
  incident.statusHistory.push({
    status: newStatus,
    changedAt: new Date(),
    reason,
    changedBy,
  });

  await incident.save();

  if (newStatus === INCIDENT_STATUS.RESOLVED || newStatus === INCIDENT_STATUS.FALSE_ALARM) {
    if (commandPublisher) {
      commandPublisher(incident.deviceId, { buzzer: 'OFF', cmd: 'RESET', reason: `Status changed to ${newStatus}` });
    }
  }

  if (socketEmitter) {
    socketEmitter.emit('incident:updated', incident);
  }

  return incident;
}

/**
 * Query incidents with filters and pagination
 */
export async function getIncidents({
  status,
  deviceId,
  from,
  to,
  page = 1,
  limit = 20,
} = {}) {
  const query = {};

  if (status) {
    const statuses = status.split(',').map((s) => s.trim().toUpperCase());
    query.status = { $in: statuses };
  }

  if (deviceId) {
    query.deviceId = deviceId;
  }

  if (from || to) {
    query.detectedAt = {};
    if (from) query.detectedAt.$gte = new Date(from);
    if (to) query.detectedAt.$lte = new Date(to);
  }

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const skip = (p - 1) * l;

  const [total, incidents] = await Promise.all([
    Incident.countDocuments(query),
    Incident.find(query).sort({ detectedAt: -1 }).skip(skip).limit(l).lean(),
  ]);

  return {
    incidents,
    pagination: {
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l),
    },
  };
}

export async function getIncidentById(incidentId) {
  const incident = await Incident.findById(incidentId).lean();
  if (!incident) {
    throw new ApiError(`Incident "${incidentId}" not found`, 404, null, 'INCIDENT_NOT_FOUND');
  }
  return incident;
}

export async function getIncidentStats() {
  const [total, pending, confirmed, falseAlarms, resolved] = await Promise.all([
    Incident.countDocuments(),
    Incident.countDocuments({ status: INCIDENT_STATUS.PENDING_CONFIRMATION }),
    Incident.countDocuments({ status: INCIDENT_STATUS.CONFIRMED }),
    Incident.countDocuments({ status: INCIDENT_STATUS.FALSE_ALARM }),
    Incident.countDocuments({ status: INCIDENT_STATUS.RESOLVED }),
  ]);

  return {
    total,
    pending,
    confirmed,
    falseAlarms,
    resolved,
    falseAlarmRate: total > 0 ? Math.round((falseAlarms / total) * 100) / 100 : 0,
  };
}

/**
 * Server startup recovery: resume or expire pending incidents
 */
export async function resumePendingIncidents() {
  const pendingList = await Incident.find({
    status: INCIDENT_STATUS.PENDING_CONFIRMATION,
  });

  const now = Date.now();
  for (const inc of pendingList) {
    const deadlineMs = new Date(inc.cancelDeadline).getTime();
    const remainingMs = deadlineMs - now;

    if (remainingMs <= 0) {
      logger.info(`[Incident] Expired pending incident ${inc._id} on server startup. Confirming...`);
      await confirmIncident(inc._id, 'Confirmed on server startup (deadline already passed)');
    } else {
      logger.info(`[Incident] Resuming countdown for pending incident ${inc._id} (${Math.round(remainingMs / 1000)}s left)`);
      _scheduleCountdown(inc._id.toString(), inc.deviceId, remainingMs);
    }
  }
}

export default {
  setSocketEmitter,
  setCommandPublisher,
  handleAccidentCandidate,
  cancelIncident,
  confirmIncident,
  updateIncidentStatus,
  getIncidents,
  getIncidentById,
  getIncidentStats,
  resumePendingIncidents,
};
