// server/src/models/ModelMetric.js
import mongoose from 'mongoose';

const modelMetricSchema = new mongoose.Schema(
  {
    modelName: {
      type: String,
      required: true,
      index: true,
    },
    metrics: {
      accuracy: { type: Number, required: true },
      precision: { type: Number, required: true },
      recall: { type: Number, required: true },
      f1: { type: Number, required: true },
      roc_auc: { type: Number, required: true },
      false_alarm_rate: { type: Number, default: 0 },
      latency_ms: { type: Number, default: 0 },
    },
    confusionMatrix: {
      type: [[Number]],
      default: [
        [0, 0],
        [0, 0],
      ],
    },
    rocData: {
      fpr: [Number],
      tpr: [Number],
    },
    trainingSamples: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const ModelMetric = mongoose.model('ModelMetric', modelMetricSchema);
export default ModelMetric;
