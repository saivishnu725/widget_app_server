import redisClient from '../config/redis';

// Lua script for atomic state toggling with "Multi-User Active Set" logic.
// Uses a Redis SET to track all users who have turned the widget ON.
// Widget stays ON as long as at least one user is in the set.
// Widget turns OFF only when the last active user leaves the set.
const toggleWidgetScript = `
  local stateKey = KEYS[1]
  local activeUsersKey = KEYS[2]
  local lastModifiedByKey = KEYS[3]
  local lastModifiedAtKey = KEYS[4]

  local targetState = ARGV[1]
  local userId = ARGV[2]
  local timestamp = ARGV[3]

  if targetState == 'ON' then
    local isMember = redis.call('SISMEMBER', activeUsersKey, userId)
    if isMember == 1 then
      return 'ALREADY_ACTIVE'
    end
    redis.call('SADD', activeUsersKey, userId)
    redis.call('SET', stateKey, 'ON')
    redis.call('SET', lastModifiedByKey, userId)
    redis.call('SET', lastModifiedAtKey, timestamp)
    return 'SUCCESS'
  elseif targetState == 'OFF' then
    local isMember = redis.call('SISMEMBER', activeUsersKey, userId)
    if isMember == 0 then
      return 'NOT_ACTIVE'
    end
    redis.call('SREM', activeUsersKey, userId)
    local remaining = redis.call('SCARD', activeUsersKey)
    redis.call('SET', lastModifiedByKey, userId)
    redis.call('SET', lastModifiedAtKey, timestamp)
    if remaining == 0 then
      redis.call('SET', stateKey, 'OFF')
      return 'SUCCESS'
    else
      return 'STILL_ON'
    end
  else
    return 'INVALID_STATE'
  end
`;

/**
 * Executes the atomic Lua script to toggle a widget's state.
 * Uses a Redis SET to track active users. Multiple users can turn a widget ON.
 * The widget only turns OFF when the last active user turns it OFF.
 *
 * @param widgetId The ID of the widget
 * @param targetState The desired state ('ON' or 'OFF')
 * @param userId The ID of the user requesting the change
 * @returns Result string: 'SUCCESS', 'STILL_ON', 'ALREADY_ACTIVE', 'NOT_ACTIVE', 'INVALID_STATE'
 */
export const toggleWidgetState = async (widgetId: string, targetState: 'ON' | 'OFF', userId: string): Promise<string> => {
  const stateKey = `widget:${widgetId}:state`;
  const activeUsersKey = `widget:${widgetId}:activeUsers`;
  const lastModifiedByKey = `widget:${widgetId}:lastModifiedBy`;
  const lastModifiedAtKey = `widget:${widgetId}:lastModifiedAt`;
  const timestamp = new Date().toISOString();

  const result = await redisClient.eval(
    toggleWidgetScript,
    4,
    stateKey,
    activeUsersKey,
    lastModifiedByKey,
    lastModifiedAtKey,
    targetState,
    userId,
    timestamp
  );

  return result as string;
};

/**
 * Helper to fetch the current state of a widget from Redis,
 * including the list of active users.
 */
export const getWidgetStateCache = async (widgetId: string) => {
  const state = await redisClient.get(`widget:${widgetId}:state`);
  const lastModifiedBy = await redisClient.get(`widget:${widgetId}:lastModifiedBy`);
  const lastModifiedAt = await redisClient.get(`widget:${widgetId}:lastModifiedAt`);
  const activeUsers = await redisClient.smembers(`widget:${widgetId}:activeUsers`);

  return {
    state: state || 'OFF',
    lastModifiedBy,
    lastModifiedAt,
    activeUsers
  };
};
