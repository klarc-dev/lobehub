import { beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeConnectorOAuthState, saveConnectorOAuthState } from './stateStore';

const { values, redis, getClient } = vi.hoisted(() => {
  const values = new Map<string, string>();
  const redis = {
    eval: vi.fn(async (_script: string, _count: number, key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    }),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return { getClient: vi.fn(async () => redis as typeof redis | null), redis, values };
});
vi.mock('../redis/client', () => ({ getRedisServiceClient: getClient }));

const payload = {
  authorizationServerUrl: 'https://as.example',
  codeVerifier: 'verifier',
  connectorId: 'connector',
  lobeUserId: 'user',
  workspaceId: 'workspace',
};

describe('connector OAuth state domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    getClient.mockResolvedValue(redis);
  });

  it('saves expiring state and consumes it only once under concurrent callbacks', async () => {
    await saveConnectorOAuthState('state', payload);
    expect(redis.set).toHaveBeenCalledWith('connector:oauth-state:state', expect.any(String), {
      ex: 600,
    });
    const results = await Promise.all([
      consumeConnectorOAuthState('state'),
      consumeConnectorOAuthState('state'),
    ]);
    expect(results.filter(Boolean)).toEqual([{ ...payload, ts: expect.any(Number) }]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      'connector:oauth-state:state',
    );
    expect(getClient).toHaveBeenCalledWith('lobechat');
  });

  it('fails closed without Redis and refuses to start a flow', async () => {
    getClient.mockResolvedValue(null);
    expect(await consumeConnectorOAuthState('missing')).toBeNull();
    await expect(saveConnectorOAuthState('state', payload)).rejects.toThrow('Redis is required');
  });

  it('returns null for missing or malformed consumed state', async () => {
    expect(await consumeConnectorOAuthState('missing')).toBeNull();
    values.set('connector:oauth-state:bad', '{invalid');
    expect(await consumeConnectorOAuthState('bad')).toBeNull();
    expect(values.size).toBe(0);
  });
});
