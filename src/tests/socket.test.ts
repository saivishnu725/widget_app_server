import { createServer } from 'http';
import { Server } from 'socket.io';
import Client, { Socket as ClientSocket } from 'socket.io-client';
import app from '../app';
import { setupSockets } from '../sockets/socketManager';
import prisma from '../config/db';
import redisClient from '../config/redis';
import request from 'supertest';

describe('WebSocket Implementation (Phase 4)', () => {
  let io: Server;
  let httpServer: any;
  let clientSocketOwner: ClientSocket;
  let clientSocketOther: ClientSocket;
  let port: number;

  let ownerToken: string;
  let otherUserToken: string;
  let ownerId: string;
  let otherUserId: string;
  let testWidgetId: string;

  const owner = {
    email: `socket_owner_${Date.now()}@example.com`,
    password: 'password123',
    name: 'Socket Owner User'
  };

  const otherUser = {
    email: `socket_other_${Date.now()}@example.com`,
    password: 'password123',
    name: 'Socket Other User'
  };

  beforeAll(async () => {
    // Register users
    const ownerRes = await request(app).post('/auth/register').send(owner);
    ownerToken = ownerRes.body.token;
    ownerId = ownerRes.body.user.id;

    const otherRes = await request(app).post('/auth/register').send(otherUser);
    otherUserToken = otherRes.body.token;
    otherUserId = otherRes.body.user.id;

    // Create a widget as owner
    const widgetRes = await request(app)
      .post('/api/widgets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Socket Widget', emoji: '🔌' });
    
    testWidgetId = widgetRes.body.widget.id;

    // Set up a local HTTP server + Socket.IO
    httpServer = createServer(app);
    io = setupSockets(httpServer);
    
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        port = (httpServer.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Disconnect clients
    if (clientSocketOwner?.connected) clientSocketOwner.disconnect();
    if (clientSocketOther?.connected) clientSocketOther.disconnect();

    // Close Socket.io server
    io.close();
    if (httpServer) {
        httpServer.close();
    }

    // Clean up DB
    await prisma.widget.deleteMany({
      where: { owner_id: { in: [ownerId, otherUserId] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherUserId] } }
    });

    await prisma.$disconnect();
    await redisClient.quit();
  });

  it('should allow owner to connect with valid token', async () => {
    clientSocketOwner = Client(`http://localhost:${port}`, {
      auth: { token: ownerToken }
    });

    await new Promise<void>((resolve) => {
      clientSocketOwner.on('connect', () => resolve());
    });
    expect(clientSocketOwner.connected).toBe(true);
  });

  it('should allow other user to connect with valid token', async () => {
    clientSocketOther = Client(`http://localhost:${port}`, {
      auth: { token: otherUserToken }
    });

    await new Promise<void>((resolve) => {
      clientSocketOther.on('connect', () => resolve());
    });
    expect(clientSocketOther.connected).toBe(true);
  });

  it('should fail to connect without a token', async () => {
    const invalidSocket = Client(`http://localhost:${port}`);
    
    await new Promise<void>((resolve) => {
      invalidSocket.on('connect_error', (err) => {
        expect(err.message).toMatch(/Authentication error/);
        invalidSocket.disconnect();
        resolve();
      });
    });
  });

  it('should allow owner to subscribe to their widget and receive initial state', async () => {
    clientSocketOwner.emit('subscribe_widgets', [testWidgetId]);

    const data = await new Promise<any>((resolve) => {
      clientSocketOwner.on('state_changed', (data) => resolve(data));
    });
    
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.state).toBe('OFF'); // Default state
    expect(data.lastModifiedBy).toBeNull();
  });

  it('should allow owner to toggle widget ON', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOwner.once('state_changed', resolve);
    });

    clientSocketOwner.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'ON'
    });

    const data = await dataPromise;
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.state).toBe('ON');
    expect(data.lastModifiedBy).toBe(ownerId);
  });

  it('should reject other user from toggling OFF because it is not shared yet', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOther.once('toggle_error', resolve);
    });

    clientSocketOther.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'OFF'
    });

    const data = await dataPromise;
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.message).toBe('Forbidden'); // Express access check
  });

  it('should share widget with other user, then allow other user to subscribe', async () => {
    // Share widget via REST API
    const shareRes = await request(app)
      .put(`/api/widgets/${testWidgetId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'add', targetUserId: otherUserId });
    
    expect(shareRes.status).toBe(200);

    // Now other user subscribes
    clientSocketOther.emit('subscribe_widgets', [testWidgetId]);

    const data = await new Promise<any>((resolve) => {
      clientSocketOther.once('state_changed', resolve);
    });
    
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.state).toBe('ON');
  });

  it('should STILL reject other user from toggling OFF (Initiator-Only-Off) after sharing', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOther.once('toggle_error', resolve);
    });

    clientSocketOther.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'OFF'
    });

    const data = await dataPromise;
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.message).toBe('FORBIDDEN'); // From Redis Lua script
  });

  it('should allow owner (initiator) to toggle widget OFF', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOwner.once('state_changed', resolve);
    });

    clientSocketOwner.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'OFF'
    });

    const data = await dataPromise;
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.state).toBe('OFF');
    expect(data.lastModifiedBy).toBe(ownerId);
  });
});
