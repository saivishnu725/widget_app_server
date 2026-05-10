"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSockets = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../config/db"));
const redisService_1 = require("../services/redisService");
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const setupSockets = (server) => {
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: '*', // Adjust this for production security
            methods: ['GET', 'POST']
        }
    });
    // Phase 4.2: Socket.io Authentication & Connection
    io.use((socket, next) => {
        // Client can pass token in auth object or headers
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }
        try {
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            socket.userId = decoded.userId;
            next();
        }
        catch (err) {
            return next(new Error('Authentication error: Invalid or expired token'));
        }
    });
    io.on('connection', (socket) => {
        console.log(`User connected via WebSocket: ${socket.userId} (Socket ID: ${socket.id})`);
        // Phase 4.3: Room Subscription (subscribe_widgets)
        socket.on('subscribe_widgets', async (widgetIds) => {
            if (!socket.userId || !Array.isArray(widgetIds))
                return;
            try {
                // Validate user has access (either owns or is shared)
                const widgets = await db_1.default.widget.findMany({
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
                    const stateCache = await (0, redisService_1.getWidgetStateCache)(widget.id);
                    socket.emit('state_changed', {
                        widgetId: widget.id,
                        ...stateCache
                    });
                }
            }
            catch (error) {
                console.error('Error in subscribe_widgets:', error);
            }
        });
        // Phase 4.4: Core Logic (toggle_widget)
        socket.on('toggle_widget', async (data) => {
            if (!socket.userId)
                return;
            const { widgetId, targetState } = data;
            if (!widgetId || !['ON', 'OFF'].includes(targetState)) {
                socket.emit('toggle_error', { widgetId, message: 'Invalid payload' });
                return;
            }
            try {
                // 1. Validation: Ensure user has access
                const widget = await db_1.default.widget.findUnique({ where: { id: widgetId } });
                if (!widget)
                    return;
                const hasAccess = widget.owner_id === socket.userId || widget.shared_user_ids.includes(socket.userId);
                if (!hasAccess) {
                    socket.emit('toggle_error', { widgetId, message: 'Forbidden' });
                    return;
                }
                // 2. State check (Atomic via Redis Lua Script)
                const result = await (0, redisService_1.toggleWidgetState)(widgetId, targetState, socket.userId);
                if (result === 'SUCCESS') {
                    // 3. Broadcasting
                    const stateCache = await (0, redisService_1.getWidgetStateCache)(widgetId);
                    io.to(`widget_room:${widgetId}`).emit('state_changed', {
                        widgetId,
                        ...stateCache
                    });
                    // 4. Audit Logging (Asynchronous)
                    db_1.default.widgetStateLog.create({
                        data: {
                            widget_id: widgetId,
                            new_state: targetState,
                            changed_by: socket.userId
                        }
                    }).catch(err => console.error('Error logging state to DB:', err));
                }
                else {
                    // Failed to toggle based on logic (ALREADY_ON, ALREADY_OFF, FORBIDDEN)
                    socket.emit('toggle_error', { widgetId, message: result });
                }
            }
            catch (error) {
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
exports.setupSockets = setupSockets;
