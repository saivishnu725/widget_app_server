import redisClient from '../config/redis';
import prisma from '../config/db';

/**
 * Periodically synchronizes the Redis widget state to PostgreSQL.
 * Since PostgreSQL widget_state_log is updated asynchronously during toggles, 
 * this cron job acts as a durability fallback.
 */
export const syncRedisToPostgres = async () => {
  try {
    let cursor = '0';
    do {
      // Find all widget state keys
      const [newCursor, keys] = await redisClient.scan(cursor, 'MATCH', 'widget:*:state', 'COUNT', 100);
      cursor = newCursor;

      for (const key of keys) {
        const widgetId = key.split(':')[1];
        const state = await redisClient.get(key);
        const lastModifiedBy = await redisClient.get(`widget:${widgetId}:lastModifiedBy`);
        const lastModifiedAtStr = await redisClient.get(`widget:${widgetId}:lastModifiedAt`);

        if (state && lastModifiedBy && lastModifiedAtStr) {
          const lastModifiedAt = new Date(lastModifiedAtStr);
          
          // Verify if this state is newer than the last recorded state log
          const latestLog = await prisma.widgetStateLog.findFirst({
            where: { widget_id: widgetId },
            orderBy: { changed_at: 'desc' }
          });

          // Only sync if redis state is newer
          if (!latestLog || lastModifiedAt > latestLog.changed_at) {
            await prisma.widgetStateLog.create({
              data: {
                widget_id: widgetId,
                new_state: state,
                changed_by: lastModifiedBy,
                changed_at: lastModifiedAt
              }
            });
            console.log(`[Sync] Restored state for widget ${widgetId} from Redis`);
          }
        }
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('Error synchronizing Redis to Postgres:', err);
  }
};
