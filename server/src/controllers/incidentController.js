// server/src/controllers/incidentController.js
import Joi from 'joi';
import incidentService from '../services/incidentService.js';
import ApiResponse from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const queryIncidentsSchema = {
  query: Joi.object({
    status: Joi.string().optional(),
    deviceId: Joi.string().optional(),
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().optional(),
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(100).default(20),
  }),
};

export const updateStatusSchema = {
  body: Joi.object({
    status: Joi.string().valid('DETECTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FALSE_ALARM', 'RESOLVED').required(),
    reason: Joi.string().allow('').optional(),
  }),
};

export const cancelIncidentSchema = {
  body: Joi.object({
    reason: Joi.string().allow('').default('Driver false alarm cancel button pressed'),
  }),
};

export const getIncidents = asyncHandler(async (req, res) => {
  const result = await incidentService.getIncidents(req.query);
  return ApiResponse.success(res, result);
});

export const getIncidentStats = asyncHandler(async (req, res) => {
  const stats = await incidentService.getIncidentStats();
  return ApiResponse.success(res, stats);
});

export const getIncidentById = asyncHandler(async (req, res) => {
  const incident = await incidentService.getIncidentById(req.params.id);
  return ApiResponse.success(res, incident);
});

export const updateIncidentStatus = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const changedBy = req.user?.email || 'USER';
  const updated = await incidentService.updateIncidentStatus(req.params.id, status, reason, changedBy);
  return ApiResponse.success(res, updated, `Incident status updated to ${status}`);
});

export const cancelIncident = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const cancelledBy = req.user?.email || 'USER';
  const cancelled = await incidentService.cancelIncident(req.params.id, reason, cancelledBy);
  return ApiResponse.success(res, cancelled, 'Incident marked as false alarm and alert aborted');
});

export default {
  getIncidents,
  getIncidentStats,
  getIncidentById,
  updateIncidentStatus,
  cancelIncident,
  queryIncidentsSchema,
  updateStatusSchema,
  cancelIncidentSchema,
};
