// server/src/sockets/index.js
// WebSocket gateway with JWT authentication and room management

import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { setMqttSocketEmitter } from '../mqtt/subscriber.js';
import { setSocketEmitter as setIncidentSocketEmitter } from '../services/incidentService.js';
import { setSlidingWindowSocketEmitter } from '../services/slidingWindowService.js';
import logger from '../utils/logger.js';

let ioInstance = null;

export function initSockets(io) {
  ioInstance = io;

  // Wire socket emitter into services
  setIncidentSocketEmitter(io);
  setSlidingWindowSocketEmitter(io);
  setMqttSocketEmitter(io);

  // JWT Authentication middleware for Socket.IO
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
      socket.handshake.query?.token;

    if (!token) {
      // Allow anonymous connection for dashboard viewing or restrict if preferred
      socket.user = { id: 'anonymous', role: 'guest' };
      return next();
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      socket.user = decoded;
      next();
    } catch (err) {
      logger.warn('[Socket.IO] Auth failed for socket:', err.message);
      // Fallback to guest
      socket.user = { id: 'anonymous', role: 'guest' };
      next();
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`[Socket.IO] Client connected: ${socket.id} (User: ${socket.user?.id})`);

    // Join user-specific room
    if (socket.user?.id && socket.user.id !== 'anonymous') {
      socket.join(`user:${socket.user.id}`);
    }

    // Join general fleet channel
    socket.join('fleet');

    // Subscribe to specific device channel
    socket.on('subscribe:device', (deviceId) => {
      socket.join(`device:${deviceId}`);
      logger.debug(`[Socket.IO] Socket ${socket.id} subscribed to device:${deviceId}`);
    });

    socket.on('unsubscribe:device', (deviceId) => {
      socket.leave(`device:${deviceId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  return ioInstance;
}

export default {
  initSockets,
  getIO,
};
