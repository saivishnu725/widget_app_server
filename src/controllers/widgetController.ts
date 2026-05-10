import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../config/db';
import redisClient from '../config/redis';

// GET /api/widgets
export const getWidgets = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const widgets = await prisma.widget.findMany({
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
  } catch (error) {
    console.error('Error fetching widgets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /api/widgets
export const createWidget = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const newWidget = await prisma.widget.create({
      data: {
        owner_id: userId,
        name,
        emoji,
        shared_user_ids: []
      }
    });

    // Initialize state in Redis (default OFF)
    await redisClient.set(`widget:${newWidget.id}:state`, 'OFF');

    res.status(201).json({ widget: newWidget });
  } catch (error) {
    console.error('Error creating widget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PUT /api/widgets/:id
export const updateWidget = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const id = req.params.id as string;
    const { name, emoji } = req.body;

    const widget = await prisma.widget.findUnique({ where: { id } });
    if (!widget) {
      res.status(404).json({ error: 'Widget not found' });
      return;
    }

    if (widget.owner_id !== userId) {
      res.status(403).json({ error: 'Forbidden: You are not the owner of this widget' });
      return;
    }

    const updatedWidget = await prisma.widget.update({
      where: { id },
      data: {
        name: name !== undefined ? name : widget.name,
        emoji: emoji !== undefined ? emoji : widget.emoji
      }
    });

    res.json({ widget: updatedWidget });
  } catch (error) {
    console.error('Error updating widget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE /api/widgets/:id
export const deleteWidget = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const id = req.params.id as string;

    const widget = await prisma.widget.findUnique({ where: { id } });
    if (!widget) {
      res.status(404).json({ error: 'Widget not found' });
      return;
    }

    if (widget.owner_id !== userId) {
      res.status(403).json({ error: 'Forbidden: You are not the owner of this widget' });
      return;
    }

    await prisma.widget.delete({ where: { id } });

    // Clean up Redis keys
    await redisClient.del(`widget:${id}:state`);
    await redisClient.del(`widget:${id}:activeUsers`);
    await redisClient.del(`widget:${id}:lastModifiedBy`);
    await redisClient.del(`widget:${id}:lastModifiedAt`);

    res.json({ message: 'Widget deleted successfully' });
  } catch (error) {
    console.error('Error deleting widget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PUT /api/widgets/:id/share
export const shareWidget = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const id = req.params.id as string;
    const { action, targetUserId } = req.body;

    if (!action || !['add', 'remove'].includes(action) || !targetUserId) {
      res.status(400).json({ error: 'Invalid request body. Expected action (add/remove) and targetUserId' });
      return;
    }

    const widget = await prisma.widget.findUnique({ where: { id } });
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
    } else if (action === 'remove') {
      updatedSharedUserIds = updatedSharedUserIds.filter(uid => uid !== targetUserId);
    }

    const updatedWidget = await prisma.widget.update({
      where: { id },
      data: { shared_user_ids: updatedSharedUserIds }
    });

    res.json({ widget: updatedWidget });
  } catch (error) {
    console.error('Error sharing widget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/widgets/:id/state
export const getWidgetState = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const id = req.params.id as string;

    const widget = await prisma.widget.findUnique({ where: { id } });
    if (!widget) {
      res.status(404).json({ error: 'Widget not found' });
      return;
    }

    const hasAccess = widget.owner_id === userId || widget.shared_user_ids.includes(userId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: You do not have access to this widget' });
      return;
    }

    const state = await redisClient.get(`widget:${id}:state`);
    const lastModifiedBy = await redisClient.get(`widget:${id}:lastModifiedBy`);
    const lastModifiedAt = await redisClient.get(`widget:${id}:lastModifiedAt`);
    const activeUsers = await redisClient.smembers(`widget:${id}:activeUsers`);

    res.json({
      widgetId: id,
      state: state || 'OFF', // Default to OFF if not set
      lastModifiedBy: lastModifiedBy || null,
      lastModifiedAt: lastModifiedAt || null,
      activeUsers
    });
  } catch (error) {
    console.error('Error fetching widget state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
