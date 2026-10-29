// server/src/services/deviceService.js
import { Device } from '../models/Device.js';
import { ApiError } from '../utils/apiResponse.js';

export async function getDevices(filter = {}) {
  return Device.find(filter).populate('owner', 'name email').sort({ createdAt: -1 });
}

export async function getDeviceById(id) {
  const device = await Device.findOne({
    $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { deviceId: id }],
  }).populate('owner', 'name email');

  if (!device) {
    throw new ApiError(`Device "${id}" not found`, 404, null, 'DEVICE_NOT_FOUND');
  }
  return device;
}

export async function createDevice(data, userId = null) {
  const existing = await Device.findOne({ deviceId: data.deviceId });
  if (existing) {
    throw new ApiError(`Device with ID "${data.deviceId}" already exists`, 409, null, 'DEVICE_EXISTS');
  }

  return Device.create({
    ...data,
    owner: userId || data.owner || null,
  });
}

export async function updateDevice(id, updateData) {
  const device = await Device.findOneAndUpdate(
    { $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { deviceId: id }] },
    updateData,
    { new: true, runValidators: true }
  );

  if (!device) {
    throw new ApiError(`Device "${id}" not found`, 404, null, 'DEVICE_NOT_FOUND');
  }
  return device;
}

export async function deleteDevice(id) {
  const device = await Device.findOneAndDelete({
    $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { deviceId: id }],
  });

  if (!device) {
    throw new ApiError(`Device "${id}" not found`, 404, null, 'DEVICE_NOT_FOUND');
  }
  return { success: true, message: `Device ${device.deviceId} deleted successfully` };
}

export async function upsertDeviceStatus(deviceId, statusUpdate = {}) {
  return Device.findOneAndUpdate(
    { deviceId },
    {
      $set: {
        ...statusUpdate,
        lastSeen: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

export default {
  getDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
  upsertDeviceStatus,
};
