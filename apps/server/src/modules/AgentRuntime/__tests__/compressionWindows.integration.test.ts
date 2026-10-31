// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import type { ChatMethodOptions, ChatStreamPayload } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRuntime } from '@/server/services/agentRuntime/AgentRuntimeService/runtimeFactory';

const fixtures = vi.hoisted(() => ({
  chat: vi.fn(),
  createGroup: vi.fn(),
  finalizeGroup: vi.fn(),
  lookup: vi.fn(),
  scopes: vi.fn(),
}));

// Only persistence, catalog loading and the provider boundary are synthetic.
// The runtime factory, agent, executor, prompt builder, transports and token
// resolvers all remain native implementations in this continuous workflow.
vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    constructor(...scope: unknown[]) {
      fixtures.scopes(...scope);
    }
    findByIdAndProvider = fixtures.lookup;
  },
}));
vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: async () => [
    { abilities: {}, id: 'fixture-parent', maxOutput: 512, providerId: 'fixture-custom' },
    { abilities: {}, id: 'fixture-summary', maxOutput: 256, providerId: 'fixture-custom' },
  ],
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({ chat: fixtures.chat }),
  resolveProviderResponseApiMode: async () => undefined,
}));
vi.mock('../llmRelay/resolveLlmExecutionSite', () => ({
  resolveLlmExecutionSite: async () => ({ site: 'server' }),
}));
vi.mock('@/server/services/message', () => ({
  MessageService: class {
    createCompressionGroup = fixtures.createGroup;
    finalizeCompression = fixtures.finalizeGroup;
    cancelCompression = vi.fn();
  },
}));

describe('native runtime compression with distinct scoped model windows (synthetic)', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('derives the parent threshold, summarizes through the distinct compressor and resumes', async () => {
    const now = new Date().toISOString();
    const history = {
      content: 'Earlier conversation to summarize.',
      id: 'history',
      metadata: { usage: { totalOutputTokens: 3000 } },
      role: 'assistant' as const,
    };
    const followUp = { content: 'Reply exactly OK.', id: 'follow-up', role: 'user' as const };
    const summary = {
      content: 'Earlier context summarized.',
      id: 'summary',
      role: 'compressedGroup',
    };
    const state: AgentState = {
      cost: {
        calculatedAt: now,
        currency: 'USD',
        llm: { byModel: [], currency: 'USD', total: 0 },
        tools: { byTool: [], currency: 'USD', total: 0 },
        total: 0,
      },
      createdAt: now,
      lastModified: now,
      maxSteps: 10,
      messages: [history, followUp],
      modelRuntimeConfig: {
        compressionModel: { model: 'fixture-summary', provider: 'fixture-custom' },
        model: 'fixture-parent',
        provider: 'fixture-custom',
      },
      operationId: 'synthetic-compression',
      origin: {
        agentId: 'fixture-agent',
        topicId: 'fixture-topic',
        userId: 'fixture-user',
        workspaceId: 'fixture-workspace',
      },
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: {
        humanInteraction: {
          approvalRequests: 0,
          promptRequests: 0,
          selectRequests: 0,
          totalWaitingTimeMs: 0,
        },
        llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
        tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
      },
    };
    const serverDB = {};
    fixtures.lookup.mockImplementation(async (model: string, provider: string) => {
      expect(provider).toBe('fixture-custom');
      return { contextWindowTokens: model === 'fixture-parent' ? 4096 : 16_384 };
    });
    fixtures.createGroup.mockResolvedValue({
      messageGroupId: 'summary',
      messagesToSummarize: [history],
      success: true,
    });
    fixtures.finalizeGroup.mockResolvedValue({ messages: [summary], success: true });
    fixtures.chat.mockImplementation(
      async (payload: ChatStreamPayload, options: ChatMethodOptions) => {
        expect(payload.model).toBe('fixture-summary');
        expect(payload.max_tokens).toBe(256);
        expect(payload).not.toHaveProperty('resolvedModelTokenLimits');
        expect(options.resolvedModelTokenLimits).toEqual({
          contextWindowTokens: 16_384,
          maxOutput: 256,
        });
        expect(JSON.stringify(payload.messages)).toContain(history.content);
        expect(payload.messages).not.toEqual([history]);
        await options.callback?.onText?.('Earlier context summarized.');
        await options.callback?.onCompletion?.({
          usage: { totalInputTokens: 100, totalOutputTokens: 5, totalTokens: 105 },
        });
        return new Response('done');
      },
    );
    const deps = {
      coordinator: {
        isInterrupted: vi.fn(async () => false),
        loadAgentState: vi.fn(async () => state),
      },
      delegate: {},
      messageModel: { query: vi.fn(async () => state.messages) },
      serverDB,
      streamManager: {
        publishStreamChunk: vi.fn(),
        publishStreamEvent: vi.fn(),
      },
      userId: 'fixture-user',
      workspaceId: 'fixture-workspace',
    } as unknown as Parameters<typeof createAgentRuntime>[0];
    const { agent, runtime } = await createAgentRuntime(deps, {
      agentState: state,
      operationId: state.operationId,
      stepIndex: 0,
    });
    const context = {
      payload: { model: 'fixture-parent', provider: 'fixture-custom' },
      phase: 'init' as const,
      session: {
        messageCount: 2,
        sessionId: state.operationId,
        status: 'running' as const,
        stepCount: 0,
      },
    };

    // Below half of the scoped parent window: the very same native agent does
    // not compact. Above half: runtime.step must select and execute compaction.
    const below = structuredClone(state);
    below.messages = [{ ...history, metadata: { usage: { totalOutputTokens: 1000 } } }, followUp];
    expect(await agent.runner(context, below)).toMatchObject({ type: 'call_llm' });
    const instruction = await agent.runner(context, state);
    expect(instruction).toMatchObject({ type: 'compress_context' });
    if (!instruction || Array.isArray(instruction) || instruction.type !== 'compress_context') {
      throw new Error('Expected native compression instruction');
    }
    // Native accounting crosses the parent's 2048-token half-window but not
    // the compressor's 8192-token half-window. The windows cannot be swapped.
    expect(instruction.payload.currentTokenCount).toBeGreaterThan(2048);
    expect(instruction.payload.currentTokenCount).toBeLessThan(8192);
    const result = await runtime.step(state, context);

    expect(result.newState.error).toBeUndefined();
    expect(result.nextContext?.phase).toBe('compression_result');
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'compression_complete' }));
    expect(result.newState.messages).toEqual([summary, followUp]);
    expect(result.newState.usage.llm.tokens.total).toBe(105);
    expect(fixtures.chat).toHaveBeenCalledTimes(1);
    expect(fixtures.createGroup).toHaveBeenCalledTimes(1);
    expect(fixtures.finalizeGroup).toHaveBeenCalledWith(
      'summary',
      summary.content,
      expect.objectContaining({ agentId: 'fixture-agent', topicId: 'fixture-topic' }),
    );
    expect(fixtures.lookup).toHaveBeenCalledWith('fixture-parent', 'fixture-custom');
    expect(fixtures.lookup).toHaveBeenCalledWith('fixture-summary', 'fixture-custom');
    expect(
      fixtures.scopes.mock.calls.every(
        ([, userId, workspaceId]) =>
          userId === 'fixture-user' && workspaceId === 'fixture-workspace',
      ),
    ).toBe(true);
    expect(await agent.runner(result.nextContext!, result.newState)).toMatchObject({
      payload: { model: 'fixture-parent', provider: 'fixture-custom' },
      type: 'call_llm',
    });
  });
});
