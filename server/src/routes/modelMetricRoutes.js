// server/src/routes/modelMetricRoutes.js
import { Router } from 'express';
import ModelMetric from '../models/ModelMetric.js';
import logger from '../utils/logger.js';

const router = Router();

// GET /api/models/metrics - return latest metrics per model
router.get('/metrics', async (req, res, next) => {
  try {
    const { modelName } = req.query;
    const query = modelName ? { modelName } : {};
    
    // Return latest entry per model or list sorted by newest
    const metrics = await ModelMetric.find(query).sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, count: metrics.length, data: metrics });
  } catch (err) {
    next(err);
  }
});

// POST /api/models/metrics - ingest model metrics from ML service / training runs
router.post('/metrics', async (req, res, next) => {
  try {
    const { modelName, metrics, confusionMatrix, rocData, trainingSamples } = req.body;
    if (!modelName || !metrics) {
      return res.status(400).json({
        success: false,
        error: { message: 'modelName and metrics object are required', statusCode: 400 },
      });
    }

    const record = await ModelMetric.create({
      modelName,
      metrics,
      confusionMatrix: confusionMatrix || [[0, 0], [0, 0]],
      rocData: rocData || { fpr: [], tpr: [] },
      trainingSamples: trainingSamples || 0,
    });

    logger.info(`[ModelMetric] Stored metric for model '${modelName}': accuracy=${metrics.accuracy}, recall=${metrics.recall}`);
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

export default router;
