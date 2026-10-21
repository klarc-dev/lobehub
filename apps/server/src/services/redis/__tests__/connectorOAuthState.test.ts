import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { IoRedisRedisProvider } from '@/server/modules/Redis/redis';

import { connectorOAuthState } from '../connectorOAuthState';

const { connection } = vi.hoisted(() => ({
  connection: { client: null as IoRedisRedisProvider | null },
}));
vi.mock('../client', () => ({ getRedisServiceClient: async () => connection.client }));

const url = process.env.CONNECTOR_OAUTH_TEST_REDIS_URL;

describe.skipIf(!url)('connector OAuth state with isolated Redis', () => {
  beforeAll(async () => {
    connection.client = new IoRedisRedisProvider({
      enabled: true,
      prefix: `connector-oauth-test:${randomUUID()}`,
      url: url!,
    });
    await connection.client.initialize();
  });

  afterAll(async () => {
    await connection.client?.disconnect();
  });

  it('gives exactly one of 100 concurrent consumers the state and preserves expiry', async () => {
    const state = randomUUID();
    await connectorOAuthState.save(state, 'payload');
    expect(await connection.client!.ttl(`connector:oauth-state:${state}`)).toBeGreaterThan(590);
    const results = await Promise.all(
      Array.from({ length: 100 }, () => connectorOAuthState.consume(state)),
    );
    expect(results.filter((value) => value === 'payload')).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(99);
    expect(await connectorOAuthState.consume(state)).toBeNull();
  });
});
