// server/src/controllers/settingController.js
import Joi from 'joi';
import settingsService from '../services/settingsService.js';
import ApiResponse from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const updateSettingsSchema = {
  body: Joi.object({
    impactThresholdG: Joi.number().min(1.0).max(16.0).optional(),
    screeningThresholdG: Joi.number().min(1.0).max(10.0).optional(),
    mlConfidenceThreshold: Joi.number().min(0.1).max(1.0).optional(),
    windowSeconds: Joi.number().min(1).max(10).optional(),
    overlapRatio: Joi.number().min(0.0).max(0.9).optional(),
    cancelCountdownSeconds: Joi.number().min(5).max(60).optional(),
    debounceSeconds: Joi.number().min(10).max(300).optional(),
    enabledAlertChannels: Joi.array().items(Joi.string().valid('in_app', 'sms', 'email', 'telegram')).optional(),
  }),
};

export const getSettings = asyncHandler(async (req, res) => {
  const settings = settingsService.getCachedSettings();
  return ApiResponse.success(res, settings);
});

export const updateSettings = asyncHandler(async (req, res) => {
  const updated = await settingsService.updateSystemSettings(req.body);
  return ApiResponse.success(res, updated, 'System thresholds updated successfully');
});

export default {
  getSettings,
  updateSettings,
  updateSettingsSchema,
};
