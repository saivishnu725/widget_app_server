import { Router } from 'express';
import {
  getWidgets,
  createWidget,
  updateWidget,
  deleteWidget,
  shareWidget,
  getWidgetState
} from '../controllers/widgetController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Require authentication for all widget routes
router.use(authenticate);

// CRUD
router.get('/', getWidgets);
router.post('/', createWidget);
router.put('/:id', updateWidget);
router.delete('/:id', deleteWidget);

// Sharing
router.put('/:id/share', shareWidget);

// State Fallback
router.get('/:id/state', getWidgetState);

export default router;
