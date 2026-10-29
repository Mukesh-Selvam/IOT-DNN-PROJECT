// server/src/routes/deviceRoutes.js
import { Router } from 'express';
import deviceController, { createDeviceSchema, updateDeviceSchema } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authenticate);

router.get('/', deviceController.getDevices);
router.post('/', validate(createDeviceSchema), deviceController.createDevice);
router.get('/:id', deviceController.getDeviceById);
router.get('/:id/status', deviceController.getDeviceStatus);
router.put('/:id', validate(updateDeviceSchema), deviceController.updateDevice);
router.delete('/:id', deviceController.deleteDevice);

export default router;
