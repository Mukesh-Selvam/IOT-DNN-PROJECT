// server/src/services/slidingWindowService.js
// Per-device sliding window ring buffer, feature extraction, ML evaluation pipeline, and throttled socket emission

import { extractWindowFeatures } from '../utils/features.js';
import logger from '../utils/logger.js';
import { handleAccidentCandidate } from './incidentService.js';
import { predict } from './mlClientService.js';
import { getCachedSettings } from './settingsService.js';

// Per-device buffer: deviceId -> Array<SensorPoint>
const deviceBuffers = new Map();

// Per-device evaluation tracker: deviceId -> lastEvaluatedTs
const lastEvaluatedAt = new Map();

// Per-device socket throttle tracker: deviceId -> lastEmittedTs
const lastSocketEmittedAt = new Map();

let socketEmitter = null;

export function setSlidingWindowSocketEmitter(emitter) {
  socketEmitter = emitter;
}

/**
 * Ingest single high-frequency telemetry sample from device
 * @param {Object} sample Telemetry payload from MQTT or HTTP
 */
export async function pushTelemetrySample(sample) {
  const { deviceId } = sample;
  if (!deviceId) return;

  const now = Date.now();
  const settings = getCachedSettings();

  const windowSec = settings.windowSeconds || 2;
  const sampleRate = sample.sampleRateHz || 50;
  const maxBufferSize = Math.ceil(windowSec * sampleRate * 1.5); // Buffer up to 1.5x window size

  // 1. Append normalized point to device ring buffer
  if (!deviceBuffers.has(deviceId)) {
    deviceBuffers.set(deviceId, []);
  }
  const buffer = deviceBuffers.get(deviceId);

  const pt = {
    ts: sample.ts || now,
    ax: sample.accel?.x ?? 0,
    ay: sample.accel?.y ?? 0,
    az: sample.accel?.z ?? 0,
    gx: sample.gyro?.x ?? 0,
    gy: sample.gyro?.y ?? 0,
    gz: sample.gyro?.z ?? 0,
    speed: sample.gps?.speed ?? sample.speed ?? 0,
    lat: sample.gps?.lat,
    lng: sample.gps?.lng,
  };

  buffer.push(pt);

  // Maintain window capacity
  if (buffer.length > maxBufferSize) {
    buffer.splice(0, buffer.length - maxBufferSize);
  }

  // 2. Throttled real-time telemetry emission for frontend charts (8 Hz)
  const lastEmit = lastSocketEmittedAt.get(deviceId) || 0;
  if (socketEmitter && now - lastEmit >= 125) {
    lastSocketEmittedAt.set(deviceId, now);
    socketEmitter.emit('telemetry', sample);
  }

  const currentTs = sample.ts
    ? (typeof sample.ts === 'number' ? sample.ts : new Date(sample.ts).getTime())
    : now;

  // 3. Sliding window evaluation step
  // Evaluates every (windowSec * (1 - overlapRatio)) seconds (e.g. 2s * 0.5 = 1.0s)
  const overlapRatio = settings.overlapRatio ?? 0.5;
  const evalIntervalMs = Math.max(500, Math.round(windowSec * (1 - overlapRatio) * 1000));
  const minSamplesRequired = Math.floor(windowSec * sampleRate * 0.75); // At least 75% full window

  const lastEval = lastEvaluatedAt.get(deviceId) || 0;
  if (buffer.length >= minSamplesRequired && (lastEval === 0 || currentTs - lastEval >= evalIntervalMs)) {
    lastEvaluatedAt.set(deviceId, currentTs);
    return _evaluateWindow(deviceId, [...buffer], settings);
  }
}

async function _evaluateWindow(deviceId, windowSlice, settings) {
  try {
    const windowPoints = windowSlice.slice(-Math.ceil((settings.windowSeconds || 2) * 50));
    const features = extractWindowFeatures(windowPoints);

    const screeningThreshold = settings.screeningThresholdG || 2.5;

    // Screening pre-filter: Skip ML inference if vehicle motion is entirely quiescent
    const hasScreeningTrigger =
      features.peakG >= screeningThreshold ||
      features.speedDropRatio >= 0.35 ||
      features.maxGyroDps >= 50;

    if (!hasScreeningTrigger) {
      return; // Quiescent normal driving, skip ML call
    }

    logger.debug(
      `[Pipeline] [${deviceId}] Screening passed! (Peak: ${features.peakG}g >= ${screeningThreshold}g, SpeedDrop: ${(
        features.speedDropRatio * 100
      ).toFixed(0)}%). Invoking prediction...`
    );

    // Call ML service (or fallback to rule engine)
    const result = await predict(deviceId, windowPoints, features);

    const confidenceThreshold = settings.mlConfidenceThreshold || 0.75;
    if (result.label === 'ACCIDENT' && result.confidence >= confidenceThreshold) {
      logger.incident(
        'ACCIDENT_CLASSIFIED',
        deviceId,
        `Confidence: ${(result.confidence * 100).toFixed(0)}%, Source: ${result.detectionSource}, Peak: ${result.peakG}g`
      );

      const latestPt = windowPoints[windowPoints.length - 1] || {};
      await handleAccidentCandidate({
        deviceId,
        peakG: result.peakG,
        speedAtImpact: features.speedInitial,
        confidence: result.confidence,
        detectionSource: result.detectionSource,
        predictedLabel: result.label,
        location: {
          lat: latestPt.lat || 10.998,
          lng: latestPt.lng || 76.966,
        },
        sensorSnapshot: windowPoints,
        detectionLatencyMs: result.latencyMs || 0,
      });
    }
  } catch (err) {
    logger.error(`[Pipeline] [${deviceId}] Evaluation error:`, err.message);
  }
}

export function clearDeviceWindow(deviceId) {
  deviceBuffers.delete(deviceId);
  lastEvaluatedAt.delete(deviceId);
}

export default {
  setSlidingWindowSocketEmitter,
  pushTelemetrySample,
  clearDeviceWindow,
};
