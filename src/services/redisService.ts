import redisClient from '../config/redis';

// Lua script for atomic state toggling with "Initiator-Only-Off" logic.
const toggleWidgetScript = `
  local currentState = redis.call('GET', KEYS[1])
  local lastModifiedBy = redis.call('GET', KEYS[2])
  
  if ARGV[1] == 'ON' then
    if currentState == 'ON' then
      return 'ALREADY_ON'
    end
    redis.call('SET', KEYS[1], 'ON')
    redis.call('SET', KEYS[2], ARGV[2])
    redis.call('SET', KEYS[3], ARGV[3])
    return 'SUCCESS'
  elseif ARGV[1] == 'OFF' then
    if currentState == 'OFF' then
      return 'ALREADY_OFF'
    end
    -- "Initiator-Only-Off" rule
    if lastModifiedBy == ARGV[2] then
      redis.call('SET', KEYS[1], 'OFF')
      redis.call('SET', KEYS[2], ARGV[2])
      redis.call('SET', KEYS[3], ARGV[3])
      return 'SUCCESS'
    else
      return 'FORBIDDEN'
    end
  else
    return 'INVALID_STATE'
  end
`;

/**
 * Executes the atomic Lua script to toggle a widget's state.
 * @param widgetId The ID of the widget
 * @param targetState The desired state ('ON' or 'OFF')
 * @param userId The ID of the user requesting the change
 * @returns The result string from the Lua script ('SUCCESS', 'ALREADY_ON', 'ALREADY_OFF', 'FORBIDDEN', 'INVALID_STATE')
 */
export const toggleWidgetState = async (widgetId: string, targetState: 'ON' | 'OFF', userId: string): Promise<string> => {
  const stateKey = `widget:${widgetId}:state`;
  const lastModifiedByKey = `widget:${widgetId}:lastModifiedBy`;
  const lastModifiedAtKey = `widget:${widgetId}:lastModifiedAt`;
  const timestamp = new Date().toISOString();

  // ioredis allows evaluating Lua scripts via eval
  // eval(script, numkeys, key1, key2, ..., arg1, arg2, ...)
  const result = await redisClient.eval(
    toggleWidgetScript,
    3,
    stateKey,
    lastModifiedByKey,
    lastModifiedAtKey,
    targetState,
    userId,
    timestamp
  );

  return result as string;
};

/**
 * Helper to fetch the current state of a widget from Redis
 */
export const getWidgetStateCache = async (widgetId: string) => {
  const state = await redisClient.get(`widget:${widgetId}:state`);
  const lastModifiedBy = await redisClient.get(`widget:${widgetId}:lastModifiedBy`);
  const lastModifiedAt = await redisClient.get(`widget:${widgetId}:lastModifiedAt`);

  return {
    state: state || 'OFF',
    lastModifiedBy,
    lastModifiedAt
  };
};
