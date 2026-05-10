import { Server, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { toggleWidgetState, getWidgetStateCache } from '../services/redisService';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

interface AuthSocket extends Socket {
  userId?: string;
}

export const setupSockets = (server: http.Server) => {
  const io = new Server(server, {
    cors: {
      origin: '*', // Adjust this for production security
      methods: ['GET', 'POST']
    }
  });

  // Phase 4.2: Socket.io Authentication & Connection
  io.use((socket: AuthSocket, next) => {
    // Client can pass token in auth object or headers
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    console.log(`User connected via WebSocket: ${socket.userId} (Socket ID: ${socket.id})`);

    // Phase 4.3: Room Subscription (subscribe_widgets)
    socket.on('subscribe_widgets', async (widgetIds: string[]) => {
      if (!socket.userId || !Array.isArray(widgetIds)) return;

      try {
        // Validate user has access (either owns or is shared)
        const widgets = await prisma.widget.findMany({
          where: {
            id: { in: widgetIds },
            OR: [
              { owner_id: socket.userId },
              { shared_user_ids: { has: socket.userId } }
            ]
          }
        });

        for (const widget of widgets) {
          const roomName = `widget_room:${widget.id}`;
          socket.join(roomName);
          console.log(`Socket ${socket.id} joined room ${roomName}`);
          
          // Emit initial state back to the connecting client immediately
          const stateCache = await getWidgetStateCache(widget.id);
          socket.emit('state_changed', {
            widgetId: widget.id,
            ...stateCache
          });
        }
      } catch (error) {
        console.error('Error in subscribe_widgets:', error);
      }
    });

    // Phase 4.4: Core Logic (toggle_widget)
    socket.on('toggle_widget', async (data: { widgetId: string, targetState: 'ON' | 'OFF' }) => {
      if (!socket.userId) return;
      const { widgetId, targetState } = data;

      if (!widgetId || !['ON', 'OFF'].includes(targetState)) {
        socket.emit('toggle_error', { widgetId, message: 'Invalid payload' });
        return;
      }

      try {
        // 1. Validation: Ensure user has access
        const widget = await prisma.widget.findUnique({ where: { id: widgetId } });
        if (!widget) return;

        const hasAccess = widget.owner_id === socket.userId || widget.shared_user_ids.includes(socket.userId);
        if (!hasAccess) {
          socket.emit('toggle_error', { widgetId, message: 'Forbidden' });
          return;
        }

        // 2. State check (Atomic via Redis Lua Script)
        const result = await toggleWidgetState(widgetId, targetState, socket.userId);

        if (result === 'SUCCESS') {
          // 3. Broadcasting
          const stateCache = await getWidgetStateCache(widgetId);
          io.to(`widget_room:${widgetId}`).emit('state_changed', {
            widgetId,
            ...stateCache
          });

          // 4. Audit Logging (Asynchronous)
          prisma.widgetStateLog.create({
            data: {
              widget_id: widgetId,
              new_state: targetState,
              changed_by: socket.userId
            }
          }).catch(err => console.error('Error logging state to DB:', err));

        } else {
          // Failed to toggle based on logic (ALREADY_ON, ALREADY_OFF, FORBIDDEN)
          socket.emit('toggle_error', { widgetId, message: result });
        }
      } catch (error) {
        console.error('Error in toggle_widget:', error);
        socket.emit('toggle_error', { widgetId, message: 'Internal server error' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId} (Socket ID: ${socket.id})`);
    });
  });

  return io;
};
