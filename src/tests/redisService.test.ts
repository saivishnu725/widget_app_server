import { toggleWidgetState, getWidgetStateCache } from '../services/redisService';
import redisClient from '../config/redis';

describe('Redis Service - Lua Script Atomic Toggle', () => {
  const testWidgetId = `test_widget_${Date.now()}`;
  const userA = `user_a_${Date.now()}`;
  const userB = `user_b_${Date.now()}`;

  beforeEach(async () => {
    // Reset state before each test
    await redisClient.del(`widget:${testWidgetId}:state`);
    await redisClient.del(`widget:${testWidgetId}:lastModifiedBy`);
    await redisClient.del(`widget:${testWidgetId}:lastModifiedAt`);
    await redisClient.set(`widget:${testWidgetId}:state`, 'OFF');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('should successfully turn ON and set user A as initiator', async () => {
    const result = await toggleWidgetState(testWidgetId, 'ON', userA);
    expect(result).toBe('SUCCESS');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.lastModifiedBy).toBe(userA);
  });

  it('should return ALREADY_ON if user tries to turn ON an already ON widget', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    const result = await toggleWidgetState(testWidgetId, 'ON', userB);
    
    expect(result).toBe('ALREADY_ON');

    // State should still point to userA as initiator
    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.lastModifiedBy).toBe(userA);
  });

  it('should allow initiator (user A) to turn OFF the widget', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);
    
    const result = await toggleWidgetState(testWidgetId, 'OFF', userA);
    expect(result).toBe('SUCCESS');

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('OFF');
    // It's acceptable for lastModifiedBy to stay as userA, tracking who turned it OFF
    expect(cache.lastModifiedBy).toBe(userA); 
  });

  it('should FORBID user B from turning OFF a widget initiated by user A', async () => {
    await toggleWidgetState(testWidgetId, 'ON', userA);

    const result = await toggleWidgetState(testWidgetId, 'OFF', userB);
    expect(result).toBe('FORBIDDEN');

    // State should still be ON, with userA as initiator
    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.lastModifiedBy).toBe(userA);
  });

  it('should return ALREADY_OFF if widget is already OFF', async () => {
    const result = await toggleWidgetState(testWidgetId, 'OFF', userA);
    expect(result).toBe('ALREADY_OFF');
  });
});
