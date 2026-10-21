import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const STATE_TTL_SECONDS = 600;
// One Redis command executes the read and delete without an interleaving consumer.
const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`;

export const connectorOAuthState = {
  async save(state: string, value: string) {
    const redis = await getRedisServiceClient('lobechat');
    if (!redis) throw new Error('Redis is required for connector OAuth state storage');
    await redis.set(RedisKeys.lobechat.connectorOAuthState(state), value, {
      ex: STATE_TTL_SECONDS,
    });
  },

  async consume(state: string): Promise<string | null> {
    const redis = await getRedisServiceClient('lobechat');
    if (!redis) return null;
    return redis.eval<string | null>(
      CONSUME_SCRIPT,
      1,
      RedisKeys.lobechat.connectorOAuthState(state),
    );
  },
};
