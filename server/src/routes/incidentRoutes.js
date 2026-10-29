// server/src/routes/incidentRoutes.js
import { Router } from 'express';
import incidentController, {
  cancelIncidentSchema,
  queryIncidentsSchema,
  updateStatusSchema,
} from '../controllers/incidentController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(queryIncidentsSchema), incidentController.getIncidents);
router.get('/stats', incidentController.getIncidentStats);
router.get('/:id', incidentController.getIncidentById);
router.patch('/:id/status', validate(updateStatusSchema), incidentController.updateIncidentStatus);
router.post('/:id/cancel', validate(cancelIncidentSchema), incidentController.cancelIncident);

export default router;
