// server/src/mqtt/client.js
import mqtt from 'mqtt';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let mqttClient = null;

export function getMqttClient() {
  if (mqttClient) return mqttClient;

  const clientId = `backend-server-${Math.random().toString(16).substring(2, 8)}`;

  mqttClient = mqtt.connect(config.mqttBrokerUrl, {
    clientId,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 3000,
  });

  mqttClient.on('connect', () => {
    logger.info(`[MQTT Backend] Connected to broker at ${config.mqttBrokerUrl}`);
  });

  mqttClient.on('error', (err) => {
    logger.warn(`[MQTT Backend] Broker connection warning: ${err.message}`);
  });

  mqttClient.on('reconnect', () => {
    logger.debug('[MQTT Backend] Reconnecting to broker...');
  });

  mqttClient.on('close', () => {
    logger.debug('[MQTT Backend] Connection closed');
  });

  return mqttClient;
}

export function closeMqttClient() {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
}

export default {
  getMqttClient,
  closeMqttClient,
};
