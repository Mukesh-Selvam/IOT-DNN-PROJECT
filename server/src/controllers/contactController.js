// server/src/controllers/contactController.js
import Joi from 'joi';
import { EmergencyContact } from '../models/EmergencyContact.js';
import ApiResponse, { ApiError } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createContactSchema = {
  body: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    phone: Joi.string().min(8).max(20).required(),
    email: Joi.string().email().required(),
    telegramChatId: Joi.string().allow('').optional(),
    priority: Joi.number().min(1).max(10).default(1),
    active: Joi.boolean().default(true),
  }),
};

export const updateContactSchema = {
  body: Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    phone: Joi.string().min(8).max(20).optional(),
    email: Joi.string().email().optional(),
    telegramChatId: Joi.string().allow('').optional(),
    priority: Joi.number().min(1).max(10).optional(),
    active: Joi.boolean().optional(),
  }),
};

export const getContacts = asyncHandler(async (req, res) => {
  const contacts = await EmergencyContact.find({ owner: req.user.id }).sort({ priority: 1 });
  return ApiResponse.success(res, contacts);
});

export const createContact = asyncHandler(async (req, res) => {
  const contact = await EmergencyContact.create({
    ...req.body,
    owner: req.user.id,
  });
  return ApiResponse.created(res, contact, 'Emergency contact added successfully');
});

export const updateContact = asyncHandler(async (req, res) => {
  const contact = await EmergencyContact.findOneAndUpdate(
    { _id: req.params.id, owner: req.user.id },
    req.body,
    { new: true, runValidators: true }
  );

  if (!contact) {
    throw new ApiError('Emergency contact not found', 404, null, 'CONTACT_NOT_FOUND');
  }
  return ApiResponse.success(res, contact, 'Emergency contact updated');
});

export const deleteContact = asyncHandler(async (req, res) => {
  const contact = await EmergencyContact.findOneAndDelete({
    _id: req.params.id,
    owner: req.user.id,
  });

  if (!contact) {
    throw new ApiError('Emergency contact not found', 404, null, 'CONTACT_NOT_FOUND');
  }
  return ApiResponse.success(res, { success: true, message: 'Contact deleted successfully' });
});

export default {
  getContacts,
  createContact,
  updateContact,
  deleteContact,
  createContactSchema,
  updateContactSchema,
};
