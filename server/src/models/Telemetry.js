// server/src/models/Telemetry.js
import mongoose from 'mongoose';
import config from '../config/index.js';

const telemetrySchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    ts: {
      type: Date,
      required: true,
    },
    seq: {
      type: Number,
      default: 0,
    },
    sampleRateHz: {
      type: Number,
      default: 50,
    },
    accel: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      z: { type: Number, required: true },
    },
    gyro: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      z: { type: Number, required: true },
    },
    gps: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      speed: { type: Number, default: 0 },
      heading: { type: Number, default: 0 },
      satellites: { type: Number, default: 0 },
      hdop: { type: Number, default: 0 },
      fix: { type: Number, default: 1 },
      ts: { type: Number, default: null },
    },
    speed: {
      type: Number,
      default: 0,
    },
    buzzer: {
      type: String,
      enum: ['ON', 'OFF'],
      default: 'OFF',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound index for fast time-series queries
telemetrySchema.index({ deviceId: 1, ts: -1 });

// TTL index to automatically purge historical telemetry after retention window
telemetrySchema.index(
  { ts: 1 },
  { expireAfterSeconds: config.telemetryTtlHours * 3600 }
);

export const Telemetry = mongoose.model('Telemetry', telemetrySchema);
export default Telemetry;
