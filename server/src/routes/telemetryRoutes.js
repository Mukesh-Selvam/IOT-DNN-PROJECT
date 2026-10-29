// server/src/routes/telemetryRoutes.js
import { Router } from 'express';
import telemetryController, { ingestTelemetrySchema, queryTelemetrySchema } from '../controllers/telemetryController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// HTTP Fallback ingestion (unauthenticated or device API key for embedded hardware)
router.post('/', validate(ingestTelemetrySchema), telemetryController.ingestTelemetry);

// Query routes (JWT authenticated)
router.get('/:deviceId', authenticate, validate(queryTelemetrySchema), telemetryController.getTelemetryHistory);
router.get('/:deviceId/latest', authenticate, telemetryController.getLatestTelemetry);

export default router;
