// server/src/app.js
// Express application setup — middleware, routes, and error handling

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import config from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';

// Route modules
import authRoutes from './routes/authRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import modelMetricRoutes from './routes/modelMetricRoutes.js';
import telemetryRoutes from './routes/telemetryRoutes.js';

// 404 handler
const notFound = (req, res) =>
  res.status(404).json({
    success: false,
    error: { message: `Route not found: ${req.method} ${req.originalUrl}`, statusCode: 404 },
  });

const app = express();

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(apiRateLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'iot-accident-detection-backend',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: config.env,
    version: '3.1.0',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/models', modelMetricRoutes);

// Settings — GET + PUT
app.get('/api/settings', async (req, res) => {
  try {
    const { getCachedSettings } = await import('./services/settingsService.js');
    res.json({ success: true, data: getCachedSettings() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { updateSystemSettings } = await import('./services/settingsService.js');
    const updated = await updateSystemSettings(req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Simulator control proxy info
app.use('/api/simulator', async (req, res) => {
  res.json({
    status: 'ok',
    message: 'Use the simulator REST API directly at http://localhost:5055',
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
export { app };
