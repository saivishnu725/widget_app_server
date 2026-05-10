import { createServer } from 'http';
import { Server } from 'socket.io';
import Client, { Socket as ClientSocket } from 'socket.io-client';
import app from '../app';
import { setupSockets } from '../sockets/socketManager';
import prisma from '../config/db';
import redisClient from '../config/redis';
import request from 'supertest';

describe('WebSocket - Multi-User Active Set Toggle', () => {
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
    const ownerRes = await request(app).post('/auth/register').send(owner);
    ownerToken = ownerRes.body.token;
    ownerId = ownerRes.body.user.id;

    const otherRes = await request(app).post('/auth/register').send(otherUser);
    otherUserToken = otherRes.body.token;
    otherUserId = otherRes.body.user.id;

    const widgetRes = await request(app)
      .post('/api/widgets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Socket Widget', emoji: '🔌' });
    testWidgetId = widgetRes.body.widget.id;

    // Share widget with other user upfront for multi-user tests
    await request(app)
      .put(`/api/widgets/${testWidgetId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'add', targetUserId: otherUserId });

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
    if (clientSocketOwner?.connected) clientSocketOwner.disconnect();
    if (clientSocketOther?.connected) clientSocketOther.disconnect();
    io.close();
    if (httpServer) httpServer.close();

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

  it('should allow owner to subscribe and receive initial OFF state', async () => {
    clientSocketOwner.emit('subscribe_widgets', [testWidgetId]);
    const data = await new Promise<any>((resolve) => {
      clientSocketOwner.on('state_changed', (data) => resolve(data));
    });
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.state).toBe('OFF');
    expect(data.activeUsers).toEqual([]);
  });

  it('should allow other user to subscribe', async () => {
    clientSocketOther.emit('subscribe_widgets', [testWidgetId]);
    const data = await new Promise<any>((resolve) => {
      clientSocketOther.once('state_changed', (data) => resolve(data));
    });
    expect(data.widgetId).toBe(testWidgetId);
    expect(data.state).toBe('OFF');
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
    expect(data.state).toBe('ON');
    expect(data.activeUsers).toContain(ownerId);
    expect(data.activeUsers.length).toBe(1);
  });

  it('should return NOT_ACTIVE when other user tries to turn OFF without having turned ON', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOther.once('toggle_error', resolve);
    });
    clientSocketOther.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'OFF'
    });
    const data = await dataPromise;
    expect(data.message).toBe('NOT_ACTIVE');
  });

  it('should allow other user to also turn ON (multi-user active)', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOther.once('state_changed', resolve);
    });
    clientSocketOther.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'ON'
    });
    const data = await dataPromise;
    expect(data.state).toBe('ON');
    expect(data.activeUsers).toContain(ownerId);
    expect(data.activeUsers).toContain(otherUserId);
    expect(data.activeUsers.length).toBe(2);
  });

  it('should keep widget ON when owner turns OFF (STILL_ON, other user still active)', async () => {
    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOwner.once('state_changed', resolve);
    });
    clientSocketOwner.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'OFF'
    });
    const data = await dataPromise;
    expect(data.state).toBe('ON'); // STILL ON because other user is active
    expect(data.activeUsers).not.toContain(ownerId);
    expect(data.activeUsers).toContain(otherUserId);
    expect(data.activeUsers.length).toBe(1);
  });

  it('should turn widget OFF when the last active user (other user) turns OFF', async () => {
    // The previous test's STILL_ON broadcast was sent to the room,
    // so clientSocketOther may have a queued state_changed event. Drain it first.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 100);
      clientSocketOther.once('state_changed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const dataPromise = new Promise<any>((resolve) => {
      clientSocketOther.once('state_changed', resolve);
    });
    clientSocketOther.emit('toggle_widget', {
      widgetId: testWidgetId,
      targetState: 'OFF'
    });
    const data = await dataPromise;
    expect(data.state).toBe('OFF');
    expect(data.activeUsers.length).toBe(0);
  });
});
