import request from 'supertest';
import app from '../app';
import prisma from '../config/db';
import redisClient from '../config/redis';

describe('Widget Routes', () => {
  let ownerToken: string;
  let otherUserToken: string;
  let ownerId: string;
  let otherUserId: string;
  let testWidgetId: string;

  const owner = {
    email: `owner_${Date.now()}@example.com`,
    password: 'password123',
    name: 'Owner User'
  };

  const otherUser = {
    email: `other_${Date.now()}@example.com`,
    password: 'password123',
    name: 'Other User'
  };

  beforeAll(async () => {
    // Register owner
    const ownerRes = await request(app).post('/auth/register').send(owner);
    ownerToken = ownerRes.body.token;
    ownerId = ownerRes.body.user.id;

    // Register other user
    const otherRes = await request(app).post('/auth/register').send(otherUser);
    otherUserToken = otherRes.body.token;
    otherUserId = otherRes.body.user.id;
  });

  afterAll(async () => {
    // Clean up widgets
    await prisma.widget.deleteMany({
      where: { owner_id: { in: [ownerId, otherUserId] } }
    });
    // Clean up users
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherUserId] } }
    });

    // Disconnect prisma and redis
    await prisma.$disconnect();
    await redisClient.quit();
  });

  describe('POST /api/widgets', () => {
    it('should create a new widget successfully', async () => {
      const response = await request(app)
        .post('/api/widgets')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'My Test Widget',
          emoji: '🚀'
        });

      expect(response.status).toBe(201);
      expect(response.body.widget).toBeDefined();
      expect(response.body.widget.name).toBe('My Test Widget');
      expect(response.body.widget.emoji).toBe('🚀');
      expect(response.body.widget.owner_id).toBe(ownerId);
      testWidgetId = response.body.widget.id;

      // Verify Redis state is initialized
      const redisState = await redisClient.get(`widget:${testWidgetId}:state`);
      expect(redisState).toBe('OFF');
    });

    it('should fail if unauthenticated', async () => {
      const response = await request(app)
        .post('/api/widgets')
        .send({
          name: 'Anonymous Widget',
          emoji: '❓'
        });

      expect(response.status).toBe(401);
    });

    it('should fail if missing name or emoji', async () => {
      const response = await request(app)
        .post('/api/widgets')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Only Name'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Name and emoji are required');
    });
  });

  describe('GET /api/widgets', () => {
    it('should fetch widgets for the owner', async () => {
      const response = await request(app)
        .get('/api/widgets')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.widgets)).toBe(true);
      expect(response.body.widgets.length).toBeGreaterThanOrEqual(1);
      expect(response.body.widgets[0].id).toBe(testWidgetId);
    });

    it('should return empty list for other user initially', async () => {
      const response = await request(app)
        .get('/api/widgets')
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.widgets.length).toBe(0);
    });
  });

  describe('PUT /api/widgets/:id', () => {
    it('should allow owner to update widget', async () => {
      const response = await request(app)
        .put(`/api/widgets/${testWidgetId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Updated Widget',
          emoji: '✨'
        });

      expect(response.status).toBe(200);
      expect(response.body.widget.name).toBe('Updated Widget');
      expect(response.body.widget.emoji).toBe('✨');
    });

    it('should not allow other user to update widget', async () => {
      const response = await request(app)
        .put(`/api/widgets/${testWidgetId}`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          name: 'Hacked Widget'
        });

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/widgets/:id/share', () => {
    it('should allow owner to share widget with other user', async () => {
      const response = await request(app)
        .put(`/api/widgets/${testWidgetId}/share`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          action: 'add',
          targetUserId: otherUserId
        });

      expect(response.status).toBe(200);
      expect(response.body.widget.shared_user_ids).toContain(otherUserId);
    });

    it('should now allow other user to fetch the shared widget', async () => {
      const response = await request(app)
        .get('/api/widgets')
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.widgets.length).toBeGreaterThanOrEqual(1);
      expect(response.body.widgets[0].id).toBe(testWidgetId);
    });

    it('should not allow other user to share widget', async () => {
      const response = await request(app)
        .put(`/api/widgets/${testWidgetId}/share`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          action: 'remove',
          targetUserId: otherUserId
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/widgets/:id/state', () => {
    it('should allow owner to fetch widget state', async () => {
      const response = await request(app)
        .get(`/api/widgets/${testWidgetId}/state`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('OFF');
      expect(response.body.widgetId).toBe(testWidgetId);
    });

    it('should allow shared user to fetch widget state', async () => {
      const response = await request(app)
        .get(`/api/widgets/${testWidgetId}/state`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('OFF');
    });

    it('should not allow unauthenticated access to state', async () => {
      const response = await request(app)
        .get(`/api/widgets/${testWidgetId}/state`);

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/widgets/:id', () => {
    it('should not allow other user to delete widget', async () => {
      const response = await request(app)
        .delete(`/api/widgets/${testWidgetId}`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(response.status).toBe(403);
    });

    it('should allow owner to delete widget', async () => {
      const response = await request(app)
        .delete(`/api/widgets/${testWidgetId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Widget deleted successfully');

      // Verify Redis state is cleaned up
      const redisState = await redisClient.get(`widget:${testWidgetId}:state`);
      expect(redisState).toBeNull();
    });

    it('should return 404 for deleted widget', async () => {
      const response = await request(app)
        .get(`/api/widgets/${testWidgetId}/state`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(404);
    });
  });
});
