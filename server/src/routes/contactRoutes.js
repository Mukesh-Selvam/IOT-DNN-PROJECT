// server/src/routes/contactRoutes.js
import { Router } from 'express';
import contactController, { createContactSchema, updateContactSchema } from '../controllers/contactController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authenticate);

router.get('/', contactController.getContacts);
router.post('/', validate(createContactSchema), contactController.createContact);
router.put('/:id', validate(updateContactSchema), contactController.updateContact);
router.delete('/:id', contactController.deleteContact);

export default router;
