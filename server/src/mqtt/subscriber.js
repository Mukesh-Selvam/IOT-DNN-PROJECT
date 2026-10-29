// server/src/mqtt/subscriber.js
// MQTT Ingestion Subscriber: vehicle/+/telemetry, vehicle/+/status, vehicle/+/event

import { upsertDeviceStatus } from '../services/deviceService.js';
import { cancelIncident } from '../services/incidentService.js';
import { pushTelemetrySample } from '../services/slidingWindowService.js';
import { queueTelemetryPoint } from '../services/telemetryService.js';
import logger from '../utils/logger.js';
import { getMqttClient } from './client.js';

let socketEmitter = null;

export function setMqttSocketEmitter(emitter) {
  socketEmitter = emitter;
}

export function initMqttSubscriber() {
  const client = getMqttClient();

  client.on('connect', () => {
    const topics = ['vehicle/+/telemetry', 'vehicle/+/status', 'vehicle/+/event'];
    for (const t of topics) {
      client.subscribe(t, { qos: 1 }, (err) => {
        if (err) {
          logger.error(`[MQTT Subscriber] Failed to subscribe to ${t}:`, err.message);
        } else {
          logger.info(`[MQTT Subscriber] Subscribed to topic pattern: ${t}`);
        }
      });
    }
  });

  client.on('message', async (topic, payload) => {
    try {
      const parts = topic.split('/');
      if (parts.length < 3 || parts[0] !== 'vehicle') return;

      const deviceId = parts[1];
      const messageType = parts[2];

      const data = JSON.parse(payload.toString());

      switch (messageType) {
        case 'telemetry':
          await handleTelemetryMessage(deviceId, data);
          break;
        case 'status':
          await handleStatusMessage(deviceId, data);
          break;
        case 'event':
          await handleEventMessage(deviceId, data);
          break;
        default:
          logger.debug(`[MQTT] Unhandled topic: ${topic}`);
      }
    } catch (err) {
      logger.warn(`[MQTT] Malformed message on ${topic}:`, err.message);
    }
  });
}

/**
 * High-frequency telemetry handler
 */
async function handleTelemetryMessage(deviceId, data) {
  // 1. Basic validation of critical fields
  if (!data.accel || data.accel.x === undefined) {
    return;
  }

  // 2. Update device cached status & GPS in DB
  if (data.gps && data.gps.lat) {
    upsertDeviceStatus(deviceId, {
      online: true,
      lastGps: {
        lat: data.gps.lat,
        lng: data.gps.lng,
        speed: data.gps.speed || 0,
        heading: data.gps.heading || 0,
        ts: data.gps.ts,
      },
      lastBuzzer: data.buzzer || 'OFF',
    }).catch(() => {});
  }

  // 3. Queue into batch database inserter
  queueTelemetryPoint({ ...data, deviceId });

  // 4. Push into sliding-window ML buffer (and throttled socket live chart)
  pushTelemetrySample({ ...data, deviceId }).catch((err) => {
    logger.error(`[Sliding Window] Ingestion error for ${deviceId}:`, err.message);
  });
}

/**
 * Retained Status / Last-Will handler
 */
async function handleStatusMessage(deviceId, data) {
  const isOnline = Boolean(data.online);
  logger.info(`[Device Status] [${deviceId}] Device reported ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

  const update = {
    online: isOnline,
    ...(data.plate && { plate: data.plate }),
    ...(data.route && { routeName: data.route }),
  };

  await upsertDeviceStatus(deviceId, update);

  if (socketEmitter) {
    socketEmitter.emit('device:status', {
      deviceId,
      online: isOnline,
      plate: data.plate,
      route: data.route,
      ts: data.ts || Date.now(),
    });
  }
}

/**
 * Firmware event handler (IMPACT_DETECTED, ALERT_CONFIRMED, ALERT_CANCELLED, BUZZER_ON, BUZZER_OFF)
 */
async function handleEventMessage(deviceId, data) {
  logger.incident(`FIRMWARE_${data.type}`, deviceId, JSON.stringify(data));

  // If driver cancelled via hardware button, cancel any pending backend incident
  if (data.type === 'ALERT_CANCELLED') {
    cancelIncident(deviceId, 'Hardware cancel button pressed on device', 'DRIVER').catch(() => {});
  }

  // Forward event to UI over Socket.IO
  if (socketEmitter) {
    socketEmitter.emit('device:event', {
      deviceId,
      ...data,
    });
  }
}

export default {
  setMqttSocketEmitter,
  initMqttSubscriber,
};
