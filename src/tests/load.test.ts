import { toggleWidgetState, getWidgetStateCache } from '../services/redisService';
import redisClient from '../config/redis';

describe('Phase 6: Load & Concurrency Testing (Multi-User Active Set)', () => {
  const testWidgetId = `load_widget_${Date.now()}`;

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

  it('should handle 100 unique users toggling ON simultaneously (all succeed)', async () => {
    const users = Array.from({ length: 100 }, (_, i) => `concurrent_user_${i}`);

    const promises = users.map(userId =>
      toggleWidgetState(testWidgetId, 'ON', userId)
    );
    const results = await Promise.all(promises);

    // Every unique user should succeed
    const successCount = results.filter(res => res === 'SUCCESS').length;
    expect(successCount).toBe(100);

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.activeUsers.length).toBe(100);
  });

  it('should handle 100 duplicate ON toggles from the same user (only 1 succeeds)', async () => {
    const singleUser = 'duplicate_user';

    const promises = Array.from({ length: 100 }, () =>
      toggleWidgetState(testWidgetId, 'ON', singleUser)
    );
    const results = await Promise.all(promises);

    const successCount = results.filter(res => res === 'SUCCESS').length;
    const alreadyActiveCount = results.filter(res => res === 'ALREADY_ACTIVE').length;

    expect(successCount).toBe(1);
    expect(alreadyActiveCount).toBe(99);

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('ON');
    expect(cache.activeUsers.length).toBe(1);
  });

  it('should handle mass OFF toggles leaving only the last user to actually turn it OFF', async () => {
    // Setup: 50 users all turn ON
    const users = Array.from({ length: 50 }, (_, i) => `mass_user_${i}`);
    await Promise.all(users.map(u => toggleWidgetState(testWidgetId, 'ON', u)));

    // All 50 toggle OFF simultaneously
    const results = await Promise.all(
      users.map(u => toggleWidgetState(testWidgetId, 'OFF', u))
    );

    const successCount = results.filter(res => res === 'SUCCESS').length;
    const stillOnCount = results.filter(res => res === 'STILL_ON').length;

    // Exactly 1 user is the last one out → SUCCESS (widget turns OFF)
    // The other 49 leave while others are still active → STILL_ON
    expect(successCount).toBe(1);
    expect(stillOnCount).toBe(49);

    const cache = await getWidgetStateCache(testWidgetId);
    expect(cache.state).toBe('OFF');
    expect(cache.activeUsers.length).toBe(0);
  });
});
