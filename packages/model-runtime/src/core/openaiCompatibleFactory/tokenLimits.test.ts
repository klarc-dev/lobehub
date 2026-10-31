// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleRuntime } from './index';

const createRuntime = () => {
  const Runtime = createOpenAICompatibleRuntime({
    baseURL: 'https://example.invalid/v1',
    chatCompletion: {
      contextPreFlight: {
        models: [{ contextWindowTokens: 2000, id: 'known', type: 'chat' }],
      },
    },
    provider: 'test',
  });
  const runtime = new Runtime({ apiKey: 'test' });
  const create = vi
    .spyOn(runtime['client'].chat.completions, 'create')
    .mockResolvedValue(new ReadableStream() as any);
  return { create, runtime };
};

const payload = (model: string) => ({
  messages: [{ content: 'a'.repeat(20_000), role: 'user' as const }],
  model,
});

describe('provider preflight resolved model limits', () => {
  it.each(['known', 'custom-alias'])(
    'honors a larger scoped window for %s without leaking it upstream',
    async (model) => {
      const { create, runtime } = createRuntime();
      await runtime.chat(payload(model), {
        resolvedModelTokenLimits: { contextWindowTokens: 1_000_000, maxOutput: 4096 },
      });
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0][0]).not.toHaveProperty('resolvedModelTokenLimits');
      expect(create.mock.calls[0][0]).not.toHaveProperty('contextWindowTokens');
      expect(create.mock.calls[0][1]).not.toHaveProperty('resolvedModelTokenLimits');
    },
  );

  it.each(['known', 'custom-alias'])('enforces a smaller scoped window for %s', async (model) => {
    const { create, runtime } = createRuntime();
    await expect(
      runtime.chat(payload(model), {
        resolvedModelTokenLimits: { contextWindowTokens: 1000 },
      }),
    ).rejects.toMatchObject({ errorType: 'ExceededContextWindow' });
    expect(create).not.toHaveBeenCalled();
  });

  it('retains bundled fallback when resolved context metadata is absent', async () => {
    const { create, runtime } = createRuntime();
    await expect(
      runtime.chat(payload('known'), { resolvedModelTokenLimits: {} }),
    ).rejects.toMatchObject({ errorType: 'ExceededContextWindow' });
    expect(create).not.toHaveBeenCalled();
  });
});
