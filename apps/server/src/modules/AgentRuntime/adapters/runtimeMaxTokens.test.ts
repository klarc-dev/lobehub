// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { resolveRuntimeMaxTokens } from './runtimeMaxTokens';

vi.mock('@/server/modules/Mecha/ModelParams/runtimeTokenLimits', () => ({
  resolveRuntimeModelTokenLimits: vi.fn(),
}));

const payload = { messages: [{ content: 'hello', role: 'user' as const }], model: 'alias' };

describe('resolveRuntimeMaxTokens', () => {
  it('uses the configured model output limit, not its context window', () => {
    expect(
      resolveRuntimeMaxTokens(payload, { contextWindowTokens: 1_000_000, maxOutput: 32_000 }),
    ).toBe(32_000);
  });
  it('does not invent an output limit from a large context window', () => {
    expect(resolveRuntimeMaxTokens(payload, { contextWindowTokens: 1_000_000 })).toBeUndefined();
  });
  it('keeps a smaller requested completion and caps an oversized one', () => {
    const limits = { contextWindowTokens: 128_000, maxOutput: 8192 };
    expect(resolveRuntimeMaxTokens({ ...payload, max_tokens: 1024 }, limits)).toBe(1024);
    expect(resolveRuntimeMaxTokens({ ...payload, max_tokens: 64_000 }, limits)).toBe(8192);
  });
  it('reserves only remaining context, including input and safety buffer', () => {
    const result = resolveRuntimeMaxTokens(payload, { contextWindowTokens: 4096, maxOutput: 8192 });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(4096 - 1024);
  });
  it('leaves unknown-model provider defaults and explicit budgets unchanged', () => {
    expect(resolveRuntimeMaxTokens(payload, {})).toBeUndefined();
    expect(resolveRuntimeMaxTokens({ ...payload, max_tokens: 2048 }, {})).toBe(2048);
  });
});
