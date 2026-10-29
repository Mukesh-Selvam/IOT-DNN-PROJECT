// server/src/models/Device.js
import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    plate: {
      type: String,
      required: true,
      trim: true,
    },
    routeName: {
      type: String,
      default: 'Coimbatore - Pollachi Corridor',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    online: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    lastGps: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      speed: { type: Number, default: 0 },
      heading: { type: Number, default: 0 },
      ts: { type: Number, default: null },
    },
    lastBuzzer: {
      type: String,
      enum: ['ON', 'OFF'],
      default: 'OFF',
    },
    settings: {
      impactThresholdG: { type: Number, default: null },
      cancelCountdownSeconds: { type: Number, default: null },
    },
  },
  {
    timestamps: true,
  }
);

export const Device = mongoose.model('Device', deviceSchema);
export default Device;
