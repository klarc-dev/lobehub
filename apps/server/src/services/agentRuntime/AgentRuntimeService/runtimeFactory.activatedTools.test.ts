// @vitest-environment node
import { type AgentState, GeneralChatAgent } from '@lobechat/agent-runtime';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { assertScopedContextWithinWindow } from '@lobechat/model-runtime/utils/resolveSafeMaxTokens';
import { describe, expect, it, vi } from 'vitest';

import { resolveServerCallLlmTooling } from '@/server/modules/AgentRuntime/adapters/serverCallLlmTooling';

import { createAgentRuntime } from './runtimeFactory';

vi.mock('@/server/modules/Mecha/ModelParams/runtimeTokenLimits', () => ({
  resolveRuntimeModelTokenLimits: async () => ({ contextWindowTokens: 4096, maxOutput: 256 }),
}));

const manifest: LobeToolManifest = {
  api: [
    {
      description: 'Drive schema instructions and field documentation. '.repeat(1600),
      name: 'search',
      parameters: { properties: { query: { type: 'string' } }, type: 'object' },
    },
    { description: 'Read a document', name: 'read', parameters: { type: 'object' } },
  ],
  identifier: 'fixture-drive',
  meta: { title: 'Drive' },
  type: 'builtin',
};
const initialTool = {
  function: {
    description: 'Activate tools',
    name: 'activator____activate',
    parameters: { type: 'object' },
  },
  type: 'function' as const,
};

const makeState = (activated: boolean): AgentState =>
  ({
    activatedStepTools: activated
      ? [{ activatedAtStep: 1, id: manifest.identifier, manifest, source: 'discovery' }]
      : [],
    messages: [{ content: 'Find my document.', id: 'user', role: 'user' }],
    modelRuntimeConfig: { model: 'fixture-parent', provider: 'fixture-custom' },
    operationId: 'fixture-op',
    operationToolSet: {
      enabledToolIds: ['activator'],
      executorMap: {},
      manifestMap: { [manifest.identifier]: manifest },
      sourceMap: {},
      tools: [initialTool],
    },
    status: 'running',
    stepCount: 1,
  }) as AgentState;

const context = {
  payload: { model: 'fixture-parent', provider: 'fixture-custom' },
  phase: 'init' as const,
  session: { messageCount: 1, sessionId: 'fixture-op', status: 'running' as const, stepCount: 1 },
};
const create = async (state: AgentState, allowedToolNames?: string[]) => {
  const deps = {
    ...(allowedToolNames && {
      agentFactory: (config: ConstructorParameters<typeof GeneralChatAgent>[0]) =>
        new GeneralChatAgent({ ...config, allowedToolNames }),
    }),
    coordinator: { isInterrupted: vi.fn(), loadAgentState: vi.fn() },
    delegate: {},
    serverDB: {},
    userId: 'fixture-user',
  } as unknown as Parameters<typeof createAgentRuntime>[0];
  return createAgentRuntime(deps, {
    agentState: state,
    operationId: state.operationId,
    stepIndex: 1,
  });
};

describe('native factory activated schema accounting (synthetic)', () => {
  it('compresses newly activated schemas that the static operation inventory omits', async () => {
    const state = makeState(true);
    const { agent } = await create(state);
    expect(await agent.runner(context, makeState(false))).toMatchObject({ type: 'call_llm' });
    const result = await agent.runner(context, state);
    expect(result).toMatchObject({
      payload: { currentTokenCount: expect.any(Number) },
      type: 'compress_context',
    });
    if (!result || Array.isArray(result) || result.type !== 'compress_context') {
      throw new Error('Expected compression for the full activated schema inventory');
    }
    expect(result.payload.currentTokenCount).toBeGreaterThan(4096);
  });

  it('retains exactly the send inventory after compression without recompressing tools forever', async () => {
    const state = makeState(true);
    // A duplicate activation must not double-count or double-send the connector.
    state.activatedStepTools!.push(state.activatedStepTools![0]);
    const { agent } = await create(state);
    const sendTools = resolveServerCallLlmTooling(
      { operationId: state.operationId, stepIndex: 1 },
      state,
    ).tools;
    expect(sendTools).toHaveLength(3);
    const result = await agent.runner(
      { ...context, phase: 'compression_result', payload: { compressedMessages: state.messages } },
      state,
    );
    expect(result).toMatchObject({ payload: { tools: sendTools }, type: 'call_llm' });
    // Compression cannot shrink schemas. The existing final request gate remains
    // actionable and fail-closed, rather than scheduling another compression.
    expect(() =>
      assertScopedContextWithinWindow(
        {
          messages: [{ role: 'user', content: 'Summary.' }],
          model: 'fixture-parent',
          tools: sendTools,
        },
        { models: [] },
        { contextWindowTokens: 4096 },
      ),
    ).toThrow(/Reduce input or attached tools, or pick a model with a larger context window/);
    expect(state.operationToolSet!.tools).toEqual([initialTool]);
    expect(state.activatedStepTools![0].manifest).toBe(manifest);
  });

  it('applies the existing allowlist before budgeting without narrowing execution manifests', async () => {
    const state = makeState(true);
    const allowedToolNames = ['fixture-drive____read'];
    const { agent } = await create(state, allowedToolNames);
    const resolved = resolveServerCallLlmTooling(
      { operationId: state.operationId, stepIndex: 1 },
      state,
      allowedToolNames,
    ).resolved;
    const result = await agent.runner(context, state);
    expect(result).toMatchObject({
      payload: { allowedToolNames, tools: resolved.tools },
      type: 'call_llm',
    });
    expect(resolved.tools).toHaveLength(1);
    expect(resolved.promptManifestMap[manifest.identifier].api.map((api) => api.name)).toEqual([
      'read',
    ]);
    expect(resolved.manifestMap[manifest.identifier]).toBe(manifest);
    expect(resolved.manifestMap[manifest.identifier].api).toHaveLength(2);
  });

  it('preserves explicit phase tool overrides, including an empty set', async () => {
    for (const tools of [[], [initialTool]]) {
      const resolveTools = vi.fn(() => []);
      const agent = new GeneralChatAgent({ operationId: 'fixture-op', tools, resolveTools });
      expect(await agent.runner(context, makeState(true))).toMatchObject({
        type: 'call_llm',
        payload: { tools },
      });
      expect(resolveTools).not.toHaveBeenCalled();
    }
  });

  it('preserves legacy state and payload fallback without a host resolver', async () => {
    const agent = new GeneralChatAgent({ operationId: 'fixture-op' });
    const state = makeState(false);
    expect(await agent.runner(context, state)).toMatchObject({ payload: { tools: [initialTool] } });
    delete state.operationToolSet;
    expect(
      await agent.runner(
        { ...context, payload: { ...context.payload, tools: [initialTool] } },
        state,
      ),
    ).toMatchObject({ payload: { tools: [initialTool] } });
  });

  it('preserves force-finish removal when budgeting and sending', async () => {
    const state = { ...makeState(true), forceFinish: true };
    const { agent } = await create(state);
    const result = await agent.runner(context, state);
    expect(result).toMatchObject({ type: 'call_llm' });
    expect(
      resolveServerCallLlmTooling({ operationId: state.operationId, stepIndex: 1 }, state).tools,
    ).toBeUndefined();
  });
});
