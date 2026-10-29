// server/src/models/EmergencyContact.js
import mongoose from 'mongoose';

const emergencyContactSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    telegramChatId: {
      type: String,
      default: '',
      trim: true,
    },
    priority: {
      type: Number,
      default: 1, // 1 = highest priority
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Order contacts by priority ascending
emergencyContactSchema.index({ owner: 1, priority: 1 });

export const EmergencyContact = mongoose.model('EmergencyContact', emergencyContactSchema);
export default EmergencyContact;
