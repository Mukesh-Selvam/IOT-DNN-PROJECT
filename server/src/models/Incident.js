// server/src/models/Incident.js
import mongoose from 'mongoose';

export const INCIDENT_STATUS = {
  DETECTED: 'DETECTED',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  FALSE_ALARM: 'FALSE_ALARM',
  RESOLVED: 'RESOLVED',
};

export const ALLOWED_STATUS_TRANSITIONS = {
  DETECTED: ['PENDING_CONFIRMATION', 'CONFIRMED', 'FALSE_ALARM'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'FALSE_ALARM'],
  CONFIRMED: ['RESOLVED', 'FALSE_ALARM'],
  FALSE_ALARM: ['RESOLVED'],
  RESOLVED: [],
};

const incidentSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    detectedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    speedAtImpact: {
      type: Number,
      default: 0,
    },
    peakG: {
      type: Number,
      required: true,
    },
    confidence: {
      type: Number,
      required: true,
    },
    detectionSource: {
      type: String,
      enum: ['ML', 'RULE_BASED', 'DEVICE_EVENT'],
      default: 'ML',
    },
    predictedLabel: {
      type: String,
      enum: ['ACCIDENT', 'NON_ACCIDENT'],
      default: 'ACCIDENT',
    },
    status: {
      type: String,
      enum: Object.values(INCIDENT_STATUS),
      default: INCIDENT_STATUS.PENDING_CONFIRMATION,
      index: true,
    },
    cancelDeadline: {
      type: Date,
      default: null,
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        reason: { type: String, default: '' },
        changedBy: { type: String, default: 'SYSTEM' },
      },
    ],
    sensorSnapshot: [
      {
        ts: Number,
        ax: Number,
        ay: Number,
        az: Number,
        gx: Number,
        gy: Number,
        gz: Number,
        speed: Number,
      },
    ],
    alertsSent: [
      {
        channel: { type: String, required: true }, // 'in_app', 'sms', 'email', 'telegram'
        recipient: { type: String, default: '' },
        sentAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['SENT', 'FAILED'], default: 'SENT' },
        details: { type: String, default: '' },
      },
    ],
    detectionLatencyMs: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying device incident history
incidentSchema.index({ deviceId: 1, detectedAt: -1 });

export const Incident = mongoose.model('Incident', incidentSchema);
export default Incident;
