"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWidgetState = exports.shareWidget = exports.deleteWidget = exports.updateWidget = exports.createWidget = exports.getWidgets = void 0;
const db_1 = __importDefault(require("../config/db"));
const redis_1 = __importDefault(require("../config/redis"));
// GET /api/widgets
const getWidgets = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const widgets = await db_1.default.widget.findMany({
            where: {
                OR: [
                    { owner_id: userId },
                    { shared_user_ids: { has: userId } }
                ]
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });
        res.json({ widgets });
    }
    catch (error) {
        console.error('Error fetching widgets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getWidgets = getWidgets;
// POST /api/widgets
const createWidget = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { name, emoji } = req.body;
        if (!name || !emoji) {
            res.status(400).json({ error: 'Name and emoji are required' });
            return;
        }
        const newWidget = await db_1.default.widget.create({
            data: {
                owner_id: userId,
                name,
                emoji,
                shared_user_ids: []
            }
        });
        // Initialize state in Redis (default OFF)
        await redis_1.default.set(`widget:${newWidget.id}:state`, 'OFF');
        res.status(201).json({ widget: newWidget });
    }
    catch (error) {
        console.error('Error creating widget:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.createWidget = createWidget;
// PUT /api/widgets/:id
const updateWidget = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const id = req.params.id;
        const { name, emoji } = req.body;
        const widget = await db_1.default.widget.findUnique({ where: { id } });
        if (!widget) {
            res.status(404).json({ error: 'Widget not found' });
            return;
        }
        if (widget.owner_id !== userId) {
            res.status(403).json({ error: 'Forbidden: You are not the owner of this widget' });
            return;
        }
        const updatedWidget = await db_1.default.widget.update({
            where: { id },
            data: {
                name: name !== undefined ? name : widget.name,
                emoji: emoji !== undefined ? emoji : widget.emoji
            }
        });
        res.json({ widget: updatedWidget });
    }
    catch (error) {
        console.error('Error updating widget:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.updateWidget = updateWidget;
// DELETE /api/widgets/:id
const deleteWidget = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const id = req.params.id;
        const widget = await db_1.default.widget.findUnique({ where: { id } });
        if (!widget) {
            res.status(404).json({ error: 'Widget not found' });
            return;
        }
        if (widget.owner_id !== userId) {
            res.status(403).json({ error: 'Forbidden: You are not the owner of this widget' });
            return;
        }
        await db_1.default.widget.delete({ where: { id } });
        // Clean up Redis keys
        await redis_1.default.del(`widget:${id}:state`);
        await redis_1.default.del(`widget:${id}:lastModifiedBy`);
        await redis_1.default.del(`widget:${id}:lastModifiedAt`);
        res.json({ message: 'Widget deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting widget:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.deleteWidget = deleteWidget;
// PUT /api/widgets/:id/share
const shareWidget = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const id = req.params.id;
        const { action, targetUserId } = req.body;
        if (!action || !['add', 'remove'].includes(action) || !targetUserId) {
            res.status(400).json({ error: 'Invalid request body. Expected action (add/remove) and targetUserId' });
            return;
        }
        const widget = await db_1.default.widget.findUnique({ where: { id } });
        if (!widget) {
            res.status(404).json({ error: 'Widget not found' });
            return;
        }
        if (widget.owner_id !== userId) {
            res.status(403).json({ error: 'Forbidden: You are not the owner of this widget' });
            return;
        }
        let updatedSharedUserIds = [...widget.shared_user_ids];
        if (action === 'add') {
            if (!updatedSharedUserIds.includes(targetUserId)) {
                updatedSharedUserIds.push(targetUserId);
            }
        }
        else if (action === 'remove') {
            updatedSharedUserIds = updatedSharedUserIds.filter(uid => uid !== targetUserId);
        }
        const updatedWidget = await db_1.default.widget.update({
            where: { id },
            data: { shared_user_ids: updatedSharedUserIds }
        });
        res.json({ widget: updatedWidget });
    }
    catch (error) {
        console.error('Error sharing widget:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.shareWidget = shareWidget;
// GET /api/widgets/:id/state
const getWidgetState = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const id = req.params.id;
        const widget = await db_1.default.widget.findUnique({ where: { id } });
        if (!widget) {
            res.status(404).json({ error: 'Widget not found' });
            return;
        }
        const hasAccess = widget.owner_id === userId || widget.shared_user_ids.includes(userId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden: You do not have access to this widget' });
            return;
        }
        const state = await redis_1.default.get(`widget:${id}:state`);
        const lastModifiedBy = await redis_1.default.get(`widget:${id}:lastModifiedBy`);
        const lastModifiedAt = await redis_1.default.get(`widget:${id}:lastModifiedAt`);
        res.json({
            widgetId: id,
            state: state || 'OFF', // Default to OFF if not set
            lastModifiedBy: lastModifiedBy || null,
            lastModifiedAt: lastModifiedAt || null
        });
    }
    catch (error) {
        console.error('Error fetching widget state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getWidgetState = getWidgetState;
