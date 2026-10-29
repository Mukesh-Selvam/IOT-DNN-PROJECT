// server/src/controllers/telemetryController.js
import Joi from 'joi';
import { pushTelemetrySample } from '../services/slidingWindowService.js';
import telemetryService from '../services/telemetryService.js';
import ApiResponse, { ApiError } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const ingestTelemetrySchema = {
  body: Joi.object({
    deviceId: Joi.string().required(),
    ts: Joi.number().optional(),
    seq: Joi.number().optional(),
    sampleRateHz: Joi.number().optional(),
    accel: Joi.object({
      x: Joi.number().required(),
      y: Joi.number().required(),
      z: Joi.number().required(),
    }).required(),
    gyro: Joi.object({
      x: Joi.number().required(),
      y: Joi.number().required(),
      z: Joi.number().required(),
    }).required(),
    gps: Joi.object({
      lat: Joi.number().allow(null).optional(),
      lng: Joi.number().allow(null).optional(),
      speed: Joi.number().allow(null).optional(),
      heading: Joi.number().allow(null).optional(),
      satellites: Joi.number().optional(),
      hdop: Joi.number().optional(),
      fix: Joi.number().optional(),
      ts: Joi.number().optional(),
    }).optional(),
    buzzer: Joi.string().valid('ON', 'OFF').optional(),
    meta: Joi.object().optional(),
  }),
};

export const queryTelemetrySchema = {
  query: Joi.object({
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().optional(),
    limit: Joi.number().min(1).max(2000).default(100),
    downsample: Joi.number().min(1).max(50).default(1),
  }),
};

export const ingestTelemetry = asyncHandler(async (req, res) => {
  const sample = req.body;
  // Queue to batch database insert
  telemetryService.queueTelemetryPoint(sample);
  // Feed sliding-window evaluation
  await pushTelemetrySample(sample);

  return ApiResponse.success(res, { status: 'queued' }, 'Telemetry accepted', 202);
});

export const getTelemetryHistory = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const history = await telemetryService.getTelemetryHistory(deviceId, req.query);
  return ApiResponse.success(res, history);
});

export const getLatestTelemetry = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const point = await telemetryService.getLatestTelemetry(deviceId);
  if (!point) {
    throw new ApiError(`No telemetry recorded yet for device "${deviceId}"`, 404, null, 'NO_TELEMETRY');
  }
  return ApiResponse.success(res, point);
});

export default {
  ingestTelemetry,
  getTelemetryHistory,
  getLatestTelemetry,
  ingestTelemetrySchema,
  queryTelemetrySchema,
};
