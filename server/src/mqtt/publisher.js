// server/src/mqtt/publisher.js
import logger from '../utils/logger.js';
import { getMqttClient } from './client.js';

/**
 * Generic MQTT publish helper
 * @param {string} topic MQTT topic
 * @param {Object|string} payload Message payload
 * @param {Object} options Publish options
 */
export function publish(topic, payload, options = { qos: 1 }) {
  const client = getMqttClient();
  if (!client || !client.connected) {
    logger.debug(`[MQTT Publisher] Cannot publish to ${topic}: broker client not connected`);
    return;
  }

  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  client.publish(topic, message, options, (err) => {
    if (err) {
      logger.error(`[MQTT Publisher] Error publishing to ${topic}: ${err.message}`);
    } else {
      logger.debug(`[MQTT Publisher] Published to [${topic}]`);
    }
  });
}

/**
 * Publishes actuator command to a specific device
 * @param {string} deviceId Target vehicle device ID
 * @param {Object} command Command payload (e.g. { buzzer: "ON"|"OFF" }, { cmd: "CANCEL"|"RESET" })
 */
export function publishDeviceCommand(deviceId, command = {}) {
  const topic = `vehicle/${deviceId}/command`;
  const payload = {
    ...command,
    ts: Date.now(),
  };
  publish(topic, payload);
}

export default {
  publish,
  publishDeviceCommand,
};
