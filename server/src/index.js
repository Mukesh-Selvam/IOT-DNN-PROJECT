// server/src/index.js
// Main entry point — wires HTTP, Socket.IO, MongoDB, MQTT, and background services

import dotenv from 'dotenv';
import http from 'http';
import mongoose from 'mongoose';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import app from './app.js';
import config from './config/index.js';
import { getMqttClient } from './mqtt/client.js';
import { publishDeviceCommand } from './mqtt/publisher.js';
import { initMqttSubscriber } from './mqtt/subscriber.js';
import { resumePendingIncidents, setCommandPublisher } from './services/incidentService.js';
import { initSettings } from './services/settingsService.js';
import { initTelemetryBatcher } from './services/telemetryService.js';
import { initSockets } from './sockets/index.js';
import logger from './utils/logger.js';

const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new SocketIOServer(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  },
  pingTimeout: 30000,
  pingInterval: 10000,
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function startServer() {
  // 1. MongoDB
  try {
    logger.info(`[DB] Connecting to MongoDB…`);
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    logger.info(`[DB] ✅ Connected to MongoDB`);
  } catch (err) {
    logger.warn(`[DB] ⚠️ MongoDB connection failed: ${err.message}`);
    logger.warn(`[DB] Ensure MongoDB is running or set MONGODB_URI in .env`);
  }

  // 2. Load runtime settings from DB (or seed defaults)
  try {
    await initSettings();
    logger.info('[Settings] ✅ Pipeline settings loaded');
  } catch (err) {
    logger.warn(`[Settings] Could not load settings: ${err.message}`);
  }

  // 3. Telemetry batch flusher
  initTelemetryBatcher();
  logger.info('[Telemetry] ✅ Batch flusher started (1s interval, 500pt max)');

  // 4. MQTT
  try {
    getMqttClient(); // lazy init — triggers connection
    initMqttSubscriber();
    logger.info('[MQTT] ✅ MQTT client initialised');
  } catch (err) {
    logger.warn(`[MQTT] ⚠️ MQTT init failed: ${err.message}`);
  }

  // 5. Socket.IO
  initSockets(io);
  logger.info('[Socket.IO] ✅ WebSocket gateway ready');

  // 6. Wire command publisher into incident service (buzzer commands)
  setCommandPublisher((deviceId, payload) => {
    try {
      publishDeviceCommand(deviceId, payload);
    } catch (err) {
      logger.warn(`[CommandPublisher] Could not publish buzzer command: ${err.message}`);
    }
  });

  // 7. Resume any pending incidents that survived restart (gap 3.17 / 3.25)
  if (mongoose.connection.readyState === 1) {
    try {
      await resumePendingIncidents();
      logger.info('[Incident] ✅ Pending incident countdowns resumed');
    } catch (err) {
      logger.warn(`[Incident] Could not resume pending incidents: ${err.message}`);
    }
  }

  // 8. Start HTTP server
  server.listen(config.port, () => {
    logger.info(`🚀 [Server] Backend API running at http://localhost:${config.port}`);
    logger.info(`[Server] Environment: ${config.env}`);
    logger.info(`[Server] CORS origin: ${config.corsOrigin}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, io, server, startServer };
