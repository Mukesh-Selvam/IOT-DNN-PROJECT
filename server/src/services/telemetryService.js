// server/src/services/telemetryService.js
// High-throughput telemetry batch ingestion and query service

import config from '../config/index.js';
import { Telemetry } from '../models/Telemetry.js';
import logger from '../utils/logger.js';

let telemetryBuffer = [];
let batchFlushTimer = null;
const BATCH_INTERVAL_MS = 1000;
const MAX_BATCH_SIZE = 500;

// Flush buffer to MongoDB
export async function flushTelemetryBuffer() {
  if (telemetryBuffer.length === 0) return;

  const toInsert = telemetryBuffer;
  telemetryBuffer = [];

  try {
    await Telemetry.insertMany(toInsert, { ordered: false });
    logger.debug(`[Telemetry] Flushed ${toInsert.length} telemetry points to MongoDB`);
  } catch (err) {
    logger.warn(`[Telemetry] Error batch inserting telemetry (${toInsert.length} points):`, err.message);
  }
}

// Start periodic flush
export function initTelemetryBatcher() {
  if (batchFlushTimer) return;
  batchFlushTimer = setInterval(() => {
    flushTelemetryBuffer();
  }, BATCH_INTERVAL_MS);
}

// Queue telemetry point from MQTT ingestion
export function queueTelemetryPoint(point) {
  // Respect STORE_GROUND_TRUTH policy
  const cleanedPoint = {
    deviceId: point.deviceId,
    ts: new Date(point.ts || Date.now()),
    seq: point.seq || 0,
    sampleRateHz: point.sampleRateHz || 50,
    accel: point.accel,
    gyro: point.gyro,
    gps: point.gps,
    speed: point.gps ? point.gps.speed : 0,
    buzzer: point.buzzer || 'OFF',
    ...(config.storeGroundTruth && point.meta ? { meta: point.meta } : {}),
  };

  telemetryBuffer.push(cleanedPoint);

  if (telemetryBuffer.length >= MAX_BATCH_SIZE) {
    flushTelemetryBuffer();
  }
}

// Query telemetry history
export async function getTelemetryHistory(deviceId, { from, to, limit = 100, downsample = 1 } = {}) {
  const query = { deviceId };

  if (from || to) {
    query.ts = {};
    if (from) query.ts.$gte = new Date(from);
    if (to) query.ts.$lte = new Date(to);
  }

  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), 2000);
  const sampleStep = Math.max(1, parseInt(downsample, 10) || 1);

  const points = await Telemetry.find(query)
    .sort({ ts: -1 })
    .limit(parsedLimit * sampleStep)
    .lean();

  if (sampleStep > 1) {
    return points.filter((_, idx) => idx % sampleStep === 0).reverse();
  }

  return points.reverse();
}

// Query latest telemetry point
export async function getLatestTelemetry(deviceId) {
  return Telemetry.findOne({ deviceId }).sort({ ts: -1 }).lean();
}

export default {
  initTelemetryBatcher,
  queueTelemetryPoint,
  flushTelemetryBuffer,
  getTelemetryHistory,
  getLatestTelemetry,
};
