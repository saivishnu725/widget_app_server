import { toggleWidgetState, getWidgetStateCache } from '../services/redisService';
import redisClient from '../config/redis';

describe('Redis Service - Multi-User Active Set Toggle', () => {
  const testWidgetId = `test_widget_${Date.now()}`;
  const userA = `user_a_${Date.now()}`;
  const userB = `user_b_${Date.now()}`;

  beforeEach(async () => {
    await redisClient.del(`widget:${testWidgetId}:state`);
    await redisClient.del(`widget:${testWidgetId}:activeUsers`);
    await redisClient.del(`widget:${testWidgetId}:lastModifiedBy`);
    await redisClient.del(`widget:${testWidgetId}:lastModifiedAt`);
    await redisClient.set(`widget:${testWidgetId}:state`, 'OFF');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('should turn ON and add user A to the active set', async () => {
    const result = await toggleWidgetState(testWidgetId, 'ON', userA);
    expect(result).toBe('SUCCESS');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.activeUsers).toContain(userA);
    expect(cache.activeUsers.length).toBe(1);
  });

  it('should return ALREADY_ACTIVE if the same user tries to turn ON twice', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    const result = await toggleWidgetState(testWidgetId, 'ON', userA);
    expect(result).toBe('ALREADY_ACTIVE');
  });

  it('should allow user B to also turn ON (multi-user active)', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    const result = await toggleWidgetState(testWidgetId, 'ON', userB);
    expect(result).toBe('SUCCESS');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.activeUsers).toContain(userA);
    expect(cache.activeUsers).toContain(userB);
    expect(cache.activeUsers.length).toBe(2);
  });

  it('should keep widget ON when user A turns OFF but user B is still active (STILL_ON)', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    await toggleWidgetState(testWidgetId, 'ON', userB);

    const result = await toggleWidgetState(testWidgetId, 'OFF', userA);
    expect(result).toBe('STILL_ON');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.activeUsers).not.toContain(userA);
    expect(cache.activeUsers).toContain(userB);
    expect(cache.activeUsers.length).toBe(1);
  });

  it('should turn OFF when the last active user leaves', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    await toggleWidgetState(testWidgetId, 'ON', userB);
    await toggleWidgetState(testWidgetId, 'OFF', userA); // STILL_ON

    const result = await toggleWidgetState(testWidgetId, 'OFF', userB);
    expect(result).toBe('SUCCESS');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('OFF');
    expect(cache.activeUsers.length).toBe(0);
  });

  it('should allow single user to turn ON and OFF', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    const result = await toggleWidgetState(testWidgetId, 'OFF', userA);
    expect(result).toBe('SUCCESS');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('OFF');
    expect(cache.activeUsers.length).toBe(0);
  });

  it('should return NOT_ACTIVE if user tries to turn OFF without being active', async () => {
    const result = await toggleWidgetState(testWidgetId, 'OFF', userA);
    expect(result).toBe('NOT_ACTIVE');
  });

  it('should return NOT_ACTIVE if non-active user tries to turn OFF an ON widget', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    const result = await toggleWidgetState(testWidgetId, 'OFF', userB);
    expect(result).toBe('NOT_ACTIVE');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.activeUsers).toContain(userA);
  });
});
