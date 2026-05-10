"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const widgetController_1 = require("../controllers/widgetController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Require authentication for all widget routes
router.use(authMiddleware_1.authenticate);
// CRUD
router.get('/', widgetController_1.getWidgets);
router.post('/', widgetController_1.createWidget);
router.put('/:id', widgetController_1.updateWidget);
router.delete('/:id', widgetController_1.deleteWidget);
// Sharing
router.put('/:id/share', widgetController_1.shareWidget);
// State Fallback
router.get('/:id/state', widgetController_1.getWidgetState);
exports.default = router;
