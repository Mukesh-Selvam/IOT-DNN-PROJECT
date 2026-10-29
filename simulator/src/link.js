// simulator/src/link.js
// MQTT Client connection manager with QoS, Last-Will, and dry-run fallback

import mqtt from 'mqtt';
import logger from './logger.js';

export class MQTTLink {
  /**
   * @param {Object} options
   * @param {string} options.deviceId Vehicle ID (e.g. ESP32-SIM-001)
   * @param {string} options.brokerUrl MQTT Broker URL (e.g. mqtt://localhost:1883)
   * @param {boolean} options.dryRun If true, network traffic is bypassed
   * @param {Function} options.onCommand Callback when a command message is received
   */
  constructor({ deviceId, brokerUrl, dryRun = false, onCommand = null }) {
    this.deviceId = deviceId;
    this.brokerUrl = brokerUrl;
    this.dryRun = dryRun;
    this.onCommand = onCommand;
    this.client = null;
    this.connected = false;

    this.telemetryTopic = `vehicle/${deviceId}/telemetry`;
    this.eventTopic = `vehicle/${deviceId}/event`;
    this.statusTopic = `vehicle/${deviceId}/status`;
    this.commandTopic = `vehicle/${deviceId}/command`;
  }

  async connect(vehicleMetadata = {}) {
    if (this.dryRun) {
      this.connected = true;
      logger.info(`[MQTT] [${this.deviceId}] Running in DRY-RUN mode (no broker required).`);
      return;
    }

    const clientId = `sim-${this.deviceId}-${Math.random().toString(16).substring(2, 8)}`;

    const lastWillPayload = JSON.stringify({
      deviceId: this.deviceId,
      online: false,
      ts: Date.now(),
    });

    return new Promise((resolve) => {
      this.client = mqtt.connect(this.brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000,
        will: {
          topic: this.statusTopic,
          payload: lastWillPayload,
          qos: 1,
          retain: true,
        },
      });

      this.client.on('connect', () => {
        this.connected = true;
        logger.success(`[MQTT] [${this.deviceId}] Connected to broker (${this.brokerUrl})`);

        // 1. Publish retained online status message
        const onlinePayload = JSON.stringify({
          deviceId: this.deviceId,
          online: true,
          plate: vehicleMetadata.plate || 'UNKNOWN',
          route: vehicleMetadata.routeName || 'UNKNOWN',
          sampleRateHz: vehicleMetadata.sampleRateHz || 50,
          ts: Date.now(),
        });
        this.client.publish(this.statusTopic, onlinePayload, { qos: 1, retain: true });

        // 2. Subscribe to incoming commands
        this.client.subscribe(this.commandTopic, { qos: 1 }, (err) => {
          if (err) {
            logger.error(`[MQTT] [${this.deviceId}] Failed to subscribe to ${this.commandTopic}: ${err.message}`);
          } else {
            logger.debug(`[MQTT] [${this.deviceId}] Subscribed to ${this.commandTopic}`);
          }
        });

        resolve();
      });

      this.client.on('message', (topic, payload) => {
        if (topic === this.commandTopic && this.onCommand) {
          try {
            const command = JSON.parse(payload.toString());
            this.onCommand(command);
          } catch (err) {
            logger.warn(`[MQTT] [${this.deviceId}] Malformed command payload: ${payload.toString()}`);
          }
        }
      });

      this.client.on('error', (err) => {
        logger.warn(`[MQTT] [${this.deviceId}] Connection warning: ${err.message}`);
        // Do not reject promise on temporary broker offline so simulator can continue starting
        resolve();
      });

      this.client.on('reconnect', () => {
        logger.debug(`[MQTT] [${this.deviceId}] Reconnecting to broker...`);
      });

      this.client.on('close', () => {
        this.connected = false;
      });
    });
  }

  /**
   * Publishes high-frequency telemetry at QoS 0
   * @param {Object} telemetry Telemetry data payload
   */
  publishTelemetry(telemetry) {
    if (this.dryRun || !this.client || !this.connected) return;
    this.client.publish(this.telemetryTopic, JSON.stringify(telemetry), { qos: 0 });
  }

  /**
   * Publishes critical event at QoS 1
   * @param {Object} event Event payload (e.g. IMPACT_DETECTED, ALERT_CONFIRMED)
   */
  publishEvent(event) {
    if (this.dryRun || !this.client || !this.connected) {
      logger.event(event.type, this.deviceId, JSON.stringify(event));
      return;
    }
    this.client.publish(this.eventTopic, JSON.stringify(event), { qos: 1 });
  }

  disconnect() {
    if (this.client) {
      // Publish offline status before closing
      const offlinePayload = JSON.stringify({
        deviceId: this.deviceId,
        online: false,
        ts: Date.now(),
      });
      this.client.publish(this.statusTopic, offlinePayload, { qos: 1, retain: true }, () => {
        this.client.end(true);
      });
    }
  }
}

export default MQTTLink;
