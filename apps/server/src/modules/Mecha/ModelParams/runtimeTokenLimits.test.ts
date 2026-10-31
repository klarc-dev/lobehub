// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import type { FrozenModelFacts } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { getServerAiProviderConfig } from '@/server/globalConfig';

import { resolveRuntimeModelTokenLimits } from './runtimeTokenLimits';

const { lookup, scopes } = vi.hoisted(() => ({ lookup: vi.fn(), scopes: vi.fn() }));
vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    constructor(...args: unknown[]) {
      scopes(...args);
    }
    findByIdAndProvider = lookup;
  },
}));
vi.mock('@/business/client/model-bank/loadModels', () => ({ loadModels: vi.fn() }));
vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));

const db = {} as LobeChatDatabase;
const input = {
  model: 'ultra',
  provider: 'openai',
  serverDB: db,
  userId: 'owner',
  workspaceId: 'workspace',
};

describe('resolveRuntimeModelTokenLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockResolvedValue(undefined);
    vi.mocked(loadModels).mockResolvedValue([
      {
        abilities: {},
        contextWindowTokens: 128_000,
        id: 'known',
        maxOutput: 8192,
        providerId: 'openai',
        type: 'chat',
      },
    ]);
    vi.mocked(getServerAiProviderConfig).mockResolvedValue({
      serverModelLists: [
        { abilities: {}, contextWindowTokens: 128_000, id: 'known', maxOutput: 8192, type: 'chat' },
      ],
    });
  });

  it.each([
    ['ultra', 1_000_000],
    ['small-alias', 32_768],
    ['medium-alias', 262_144],
  ])(
    'uses persisted window for %s without assuming a universal size',
    async (model, contextWindowTokens) => {
      lookup.mockResolvedValue({ contextWindowTokens });
      await expect(resolveRuntimeModelTokenLimits({ ...input, model })).resolves.toEqual({
        contextWindowTokens,
        maxOutput: undefined,
      });
      expect(scopes).toHaveBeenCalledWith(db, 'owner', 'workspace');
      expect(lookup).toHaveBeenCalledWith(model, 'openai');
    },
  );

  it('overrides a known model window while retaining its catalog output limit', async () => {
    lookup.mockResolvedValue({ contextWindowTokens: 16_384 });
    await expect(resolveRuntimeModelTokenLimits({ ...input, model: 'known' })).resolves.toEqual({
      contextWindowTokens: 16_384,
      maxOutput: 8192,
    });
  });

  it('uses deployment env model lists rather than the unmodified static catalog', async () => {
    vi.mocked(getServerAiProviderConfig).mockResolvedValue({
      serverModelLists: [
        {
          abilities: {},
          contextWindowTokens: 200_000,
          id: 'ultra',
          maxOutput: 16_000,
          type: 'chat',
        },
      ],
    });
    await expect(resolveRuntimeModelTokenLimits(input)).resolves.toEqual({
      contextWindowTokens: 200_000,
      maxOutput: 16_000,
    });
  });

  it('handles a custom provider without asking for a nonexistent env provider', async () => {
    lookup.mockResolvedValue({ contextWindowTokens: 64_000 });
    await expect(
      resolveRuntimeModelTokenLimits({ ...input, provider: 'custom-endpoint' }),
    ).resolves.toEqual({ contextWindowTokens: 64_000, maxOutput: undefined });
    expect(getServerAiProviderConfig).not.toHaveBeenCalled();
  });

  it('keeps unknown metadata absent so compression retains its safe 128k fallback', async () => {
    await expect(resolveRuntimeModelTokenLimits(input)).resolves.toEqual({
      contextWindowTokens: undefined,
      maxOutput: undefined,
    });
  });

  it('uses new frozen facts without DB or catalog reads, including frozen unknown metadata', async () => {
    for (const tokenLimits of [{ contextWindowTokens: 1_000_000, maxOutput: 32_000 }, {}]) {
      const modelFacts: FrozenModelFacts = {
        cards: [],
        model: 'ultra',
        provider: 'openai',
        tokenLimits,
      };
      await expect(resolveRuntimeModelTokenLimits({ ...input, modelFacts })).resolves.toEqual(
        tokenLimits,
      );
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(loadModels).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'different-model', 'different-provider'])(
    'resolves live for %s snapshots (compression and subagent overrides)',
    async (kind) => {
      const modelFacts: FrozenModelFacts = {
        cards: [],
        model: 'ultra',
        provider: 'openai',
        ...(kind === 'legacy' ? {} : { tokenLimits: { contextWindowTokens: 1_000_000 } }),
      };
      lookup.mockResolvedValue({ contextWindowTokens: 48_000 });
      await expect(
        resolveRuntimeModelTokenLimits({
          ...input,
          model: kind === 'different-model' ? 'child' : input.model,
          provider: kind === 'different-provider' ? 'custom' : input.provider,
          modelFacts,
        }),
      ).resolves.toMatchObject({ contextWindowTokens: 48_000 });
      expect(lookup).toHaveBeenCalledTimes(1);
    },
  );
});
