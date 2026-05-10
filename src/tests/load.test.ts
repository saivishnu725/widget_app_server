import { toggleWidgetState, getWidgetStateCache } from '../services/redisService';
import redisClient from '../config/redis';

describe('Phase 6: Load & Concurrency Testing', () => {
  const testWidgetId = `load_widget_${Date.now()}`;
  const ownerUser = `owner_${Date.now()}`;

  beforeEach(async () => {
    await redisClient.del(`widget:${testWidgetId}:state`);
    await redisClient.del(`widget:${testWidgetId}:lastModifiedBy`);
    await redisClient.del(`widget:${testWidgetId}:lastModifiedAt`);
    await redisClient.set(`widget:${testWidgetId}:state`, 'OFF');
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('should handle 100 simultaneous ON toggles and guarantee atomicity', async () => {
    // We simulate 100 different users trying to turn the widget ON at the exact same millisecond.
    // The Lua script should allow exactly ONE to succeed or they might all succeed if we changed the logic,
    // but in our Lua script: if currentState == 'ON' return 'ALREADY_ON'.
    // Therefore, EXACTLY ONE should be SUCCESS, and 99 should be ALREADY_ON.

    const users = Array.from({ length: 100 }, (_, i) => `concurrent_user_${i}`);

    const promises = users.map(userId => 
      toggleWidgetState(testWidgetId, 'ON', userId)
    );

    const results = await Promise.all(promises);

    const successCount = results.filter(res => res === 'SUCCESS').length;
    const alreadyOnCount = results.filter(res => res === 'ALREADY_ON').length;

    expect(successCount).toBe(1);
    expect(alreadyOnCount).toBe(99);

    // Verify the cache has exactly one initiator
    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    // The initiator should be the one that got SUCCESS
    const successfulUserIndex = results.indexOf('SUCCESS');
    expect(cache.lastModifiedBy).toBe(users[successfulUserIndex]);
  });
});
