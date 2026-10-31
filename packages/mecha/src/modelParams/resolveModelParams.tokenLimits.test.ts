import { describe, expect, it, vi } from 'vitest';

import {
  createFrozenModelParamsProviders,
  readFrozenModelFacts,
  resolveModelParams,
  resolveModelTokenLimits,
} from './resolveModelParams';
import type { ModelCardFacts, ModelParamsProviders, ModelParamsRequest } from './types';

const request: ModelParamsRequest = { agent: {}, model: 'configured', provider: 'gateway' };
const cards: ModelCardFacts[] = [
  { contextWindowTokens: 200_000, id: 'configured', maxOutput: 32_000, providerId: 'gateway' },
  { contextWindowTokens: 128_000, id: 'configured', maxOutput: 16_000, providerId: 'origin' },
];
const providers = (overrides: Partial<ModelParamsProviders> = {}): ModelParamsProviders => ({
  listModelCards: () => cards,
  ...overrides,
});

describe('model token limits', () => {
  it('resolves each field independently with a persisted context override', async () => {
    const getUserModelRow = vi.fn(async () => ({ contextWindowTokens: 64_000 }));
    const live = providers({ getUserModelRow });
    await expect(resolveModelTokenLimits(request, live)).resolves.toEqual({
      contextWindowTokens: 64_000,
      maxOutput: 32_000,
    });
    expect(getUserModelRow).toHaveBeenCalledTimes(1);
    const resolved = await resolveModelParams(request, live);
    expect(resolved).toMatchObject({ contextWindowTokens: 64_000, maxOutput: 32_000 });
    expect(getUserModelRow).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'rejects invalid limits %s per field',
    async (invalid) => {
      await expect(
        resolveModelTokenLimits(
          request,
          providers({
            getUserModelRow: async () => ({ contextWindowTokens: invalid }),
            listModelCards: () => [{ ...cards[0], maxOutput: invalid }, cards[1]],
          }),
        ),
      ).resolves.toEqual({ contextWindowTokens: 200_000, maxOutput: 16_000 });
    },
  );

  it('keeps valid output when context falls through to the canonical card', async () => {
    await expect(
      resolveModelTokenLimits(
        request,
        providers({
          listModelCards: () => [{ ...cards[0], contextWindowTokens: undefined }, cards[1]],
        }),
      ),
    ).resolves.toEqual({ contextWindowTokens: 128_000, maxOutput: 32_000 });
  });

  it('falls through an incomplete enabled card to its same-provider catalog', async () => {
    await expect(
      resolveModelTokenLimits(
        request,
        providers({
          listModelCards: () => [
            { ...cards[0], contextWindowTokens: NaN, maxOutput: undefined },
            ...cards,
          ],
        }),
      ),
    ).resolves.toEqual({ contextWindowTokens: 200_000, maxOutput: 32_000 });
  });

  it('matches deployment aliases without borrowing unrelated model budgets', async () => {
    const live = providers({
      listModelCards: () => [{ ...cards[0], deploymentName: 'deployment' }],
    });
    await expect(
      resolveModelTokenLimits({ ...request, model: 'deployment' }, live),
    ).resolves.toEqual({ contextWindowTokens: 200_000, maxOutput: 32_000 });
    await expect(resolveModelTokenLimits({ ...request, model: 'unknown' }, live)).resolves.toEqual(
      {},
    );
  });

  it('freezes per-field limits through JSON round trips without rereading live rows', async () => {
    let contextWindowTokens = 64_000;
    const getUserModelRow = vi.fn(async () => ({ contextWindowTokens }));
    const live = providers({ getUserModelRow });
    // Exercise persisted operation JSON, not an in-memory clone.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    const facts = JSON.parse(JSON.stringify(await readFrozenModelFacts(request, live)));
    expect(facts.tokenLimits).toEqual({ contextWindowTokens: 64_000, maxOutput: 32_000 });
    contextWindowTokens = 1_000_000;
    const frozen = createFrozenModelParamsProviders(facts);
    await expect(resolveModelTokenLimits(request, frozen)).resolves.toEqual(facts.tokenLimits);
    expect(await resolveModelParams(request, frozen)).toMatchObject(facts.tokenLimits);
    expect(getUserModelRow).toHaveBeenCalledTimes(1);
  });

  it('marks frozen unknown limits separately from legacy snapshots', async () => {
    const facts = await readFrozenModelFacts(request, providers({ listModelCards: () => [] }));
    expect(facts.tokenLimits).toEqual({});
    // The empty marker must survive persisted operation JSON.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    expect(JSON.parse(JSON.stringify(facts))).toHaveProperty('tokenLimits', {});
  });

  it('freezes the valid same-provider fallback, even when the first card is incomplete', async () => {
    const facts = await readFrozenModelFacts(
      request,
      providers({
        listModelCards: () => [
          { ...cards[0], contextWindowTokens: undefined, maxOutput: undefined },
          ...cards,
        ],
      }),
    );
    await expect(
      resolveModelTokenLimits(request, createFrozenModelParamsProviders(facts)),
    ).resolves.toEqual({ contextWindowTokens: 200_000, maxOutput: 32_000 });
  });
});
