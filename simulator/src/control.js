// simulator/src/control.js
// Dual HTTP (port 5055) and MQTT (simulator/control) remote control server

import http from 'http';
import mqtt from 'mqtt';
import config from './config.js';
import logger from './logger.js';
import { getScenariosList } from './scenarios.js';

export class ControlServer {
  /**
   * @param {Object} options
   * @param {import('./fleet.js').Fleet} options.fleet Fleet coordinator instance
   * @param {number} options.port HTTP port (default 5055)
   * @param {string} options.apiKey Optional API Key protection
   * @param {boolean} options.dryRun Whether running in dry-run mode
   */
  constructor({ fleet, port = config.controlPort, apiKey = config.controlApiKey, dryRun = false }) {
    this.fleet = fleet;
    this.port = port;
    this.apiKey = apiKey;
    this.dryRun = dryRun;

    this.httpServer = null;
    this.mqttClient = null;
    this.startTime = Date.now();
  }

  start() {
    this._startHttp();
    if (!this.dryRun) {
      this._startMqtt();
    }
  }

  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    if (this.mqttClient) {
      this.mqttClient.end(true);
      this.mqttClient = null;
    }
  }

  _sendJson(res, statusCode, data) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    });
    res.end(json);
  }

  _parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
        if (body.length > 1e6) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  _checkAuth(req) {
    if (!this.apiKey) return true;
    const key = req.headers['x-api-key'];
    return key === this.apiKey;
  }

  _startHttp() {
    this.httpServer = http.createServer(async (req, res) => {
      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        });
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // API Key check
      if (!this._checkAuth(req)) {
        this._sendJson(res, 401, { error: 'Unauthorized: Invalid or missing X-API-Key header' });
        return;
      }

      try {
        // --- GET Endpoints ---
        if (req.method === 'GET') {
          if (pathname === '/health' || pathname === '/') {
            this._sendJson(res, 200, {
              status: 'ok',
              service: 'iot-simulator',
              running: this.fleet.running,
              paused: this.fleet.paused,
              vehicleCount: this.fleet.vehicles.length,
              sampleRateHz: this.fleet.sampleRateHz,
              uptimeSec: Math.floor((Date.now() - this.startTime) / 1000),
            });
            return;
          }

          if (pathname === '/scenarios') {
            this._sendJson(res, 200, {
              scenarios: getScenariosList(),
            });
            return;
          }

          if (pathname === '/vehicles') {
            this._sendJson(res, 200, {
              vehicles: this.fleet.getVehiclesStatus(),
            });
            return;
          }
        }

        // --- POST Endpoints ---
        if (req.method === 'POST') {
          const body = await this._parseBody(req);

          if (pathname === '/trigger') {
            const { deviceId = '1', scenario, cancelAfterSec } = body;
            if (!scenario) {
              this._sendJson(res, 400, { error: 'Missing "scenario" parameter in request body' });
              return;
            }
            const result = this.fleet.triggerScenario(deviceId, scenario, cancelAfterSec);
            this._sendJson(res, 200, result);
            return;
          }

          if (pathname === '/cancel') {
            const { deviceId = 'all', reason = 'API_CANCEL' } = body;
            const result = this.fleet.cancelAlert(deviceId, reason);
            this._sendJson(res, 200, result);
            return;
          }

          if (pathname === '/reset') {
            const { deviceId = 'all' } = body;
            const result = this.fleet.reset(deviceId);
            this._sendJson(res, 200, result);
            return;
          }

          if (pathname === '/settings') {
            const updated = this.fleet.updateFleetSettings(body);
            this._sendJson(res, 200, { success: true, settings: updated });
            return;
          }

          if (pathname === '/pause') {
            this.fleet.pause();
            this._sendJson(res, 200, { success: true, paused: true });
            return;
          }

          if (pathname === '/resume') {
            this.fleet.resume();
            this._sendJson(res, 200, { success: true, paused: false });
            return;
          }
        }

        // Not Found
        this._sendJson(res, 404, { error: `Endpoint "${pathname}" not found` });
      } catch (err) {
        logger.error('[Control API] Request error:', err.message);
        this._sendJson(res, 500, { error: err.message });
      }
    });

    this.httpServer.listen(this.port, () => {
      logger.success(`[Control API] HTTP control server listening on port ${this.port}`);
    });

    this.httpServer.on('error', (err) => {
      logger.error(`[Control API] Failed to bind HTTP server to port ${this.port}: ${err.message}`);
    });
  }

  _startMqtt() {
    const controlTopic = 'simulator/control';
    const responseTopic = 'simulator/control/response';

    const clientId = `sim-control-${Math.random().toString(16).substring(2, 8)}`;
    this.mqttClient = mqtt.connect(config.mqttUrl, {
      clientId,
      connectTimeout: 5000,
      reconnectPeriod: 3000,
    });

    this.mqttClient.on('connect', () => {
      logger.success(`[MQTT Control] Connected to broker and subscribed to "${controlTopic}"`);
      this.mqttClient.subscribe(controlTopic, { qos: 1 });
    });

    this.mqttClient.on('message', (topic, message) => {
      if (topic !== controlTopic) return;
      try {
        const payload = JSON.parse(message.toString());
        const { id, action, deviceId = '1', scenario, cancelAfterSec, settings } = payload;
        let response = { id, success: false };

        switch (action) {
          case 'trigger':
            response = { ...response, ...this.fleet.triggerScenario(deviceId, scenario, cancelAfterSec) };
            break;
          case 'cancel':
            response = { ...response, ...this.fleet.cancelAlert(deviceId, 'MQTT_CONTROL') };
            break;
          case 'reset':
            response = { ...response, ...this.fleet.reset(deviceId) };
            break;
          case 'settings':
            response = { ...response, success: true, settings: this.fleet.updateFleetSettings(settings) };
            break;
          case 'pause':
            this.fleet.pause();
            response = { ...response, success: true, paused: true };
            break;
          case 'resume':
            this.fleet.resume();
            response = { ...response, success: true, paused: false };
            break;
          case 'status':
            response = { ...response, success: true, vehicles: this.fleet.getVehiclesStatus() };
            break;
          default:
            response.error = `Unknown action: "${action}"`;
        }

        this.mqttClient.publish(responseTopic, JSON.stringify(response), { qos: 1 });
      } catch (err) {
        logger.error('[MQTT Control] Processing error:', err.message);
      }
    });

    this.mqttClient.on('error', (err) => {
      logger.debug('[MQTT Control] Broker connection warning:', err.message);
    });
  }
}

export default ControlServer;
