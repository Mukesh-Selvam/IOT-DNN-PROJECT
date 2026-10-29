// server/src/controllers/deviceController.js
import Joi from 'joi';
import deviceService from '../services/deviceService.js';
import ApiResponse from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createDeviceSchema = {
  body: Joi.object({
    deviceId: Joi.string().min(3).max(30).required(),
    plate: Joi.string().min(3).max(20).required(),
    routeName: Joi.string().optional(),
    owner: Joi.string().hex().length(24).optional(),
    settings: Joi.object({
      impactThresholdG: Joi.number().min(1.0).max(16.0).optional(),
      cancelCountdownSeconds: Joi.number().min(5).max(60).optional(),
    }).optional(),
  }),
};

export const updateDeviceSchema = {
  body: Joi.object({
    plate: Joi.string().min(3).max(20).optional(),
    routeName: Joi.string().optional(),
    owner: Joi.string().hex().length(24).allow(null).optional(),
    settings: Joi.object({
      impactThresholdG: Joi.number().min(1.0).max(16.0).allow(null).optional(),
      cancelCountdownSeconds: Joi.number().min(5).max(60).allow(null).optional(),
    }).optional(),
  }),
};

export const getDevices = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user && req.user.role !== 'admin') {
    filter.owner = req.user.id;
  }
  const devices = await deviceService.getDevices(filter);
  return ApiResponse.success(res, devices);
});

export const getDeviceById = asyncHandler(async (req, res) => {
  const device = await deviceService.getDeviceById(req.params.id);
  return ApiResponse.success(res, device);
});

export const getDeviceStatus = asyncHandler(async (req, res) => {
  const device = await deviceService.getDeviceById(req.params.id);
  return ApiResponse.success(res, {
    deviceId: device.deviceId,
    online: device.online,
    lastSeen: device.lastSeen,
    lastGps: device.lastGps,
    lastBuzzer: device.lastBuzzer,
  });
});

export const createDevice = asyncHandler(async (req, res) => {
  const device = await deviceService.createDevice(req.body, req.user?.id);
  return ApiResponse.created(res, device, 'Device registered successfully');
});

export const updateDevice = asyncHandler(async (req, res) => {
  const device = await deviceService.updateDevice(req.params.id, req.body);
  return ApiResponse.success(res, device, 'Device updated successfully');
});

export const deleteDevice = asyncHandler(async (req, res) => {
  const result = await deviceService.deleteDevice(req.params.id);
  return ApiResponse.success(res, result);
});

export default {
  getDevices,
  getDeviceById,
  getDeviceStatus,
  createDevice,
  updateDevice,
  deleteDevice,
  createDeviceSchema,
  updateDeviceSchema,
};
