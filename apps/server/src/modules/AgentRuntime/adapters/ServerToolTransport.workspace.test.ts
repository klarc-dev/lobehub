// @vitest-environment node
import type { ToolRunContext } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { dispatchClientTool } from '@/server/modules/AgentRuntime/dispatchClientTool';
import { ToolExecutionService } from '@/server/services/toolExecution';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));
vi.mock('@/libs/mcp/connectorPermissionCheck', () => ({
  getConnectorToolPermission: vi.fn(),
  buildBlockedToolResponse: vi.fn(),
}));
vi.mock('@/server/modules/AgentRuntime/dispatchClientTool', () => ({
  dispatchClientTool: vi.fn(),
}));
const payload: ChatToolPayload = {
  id: 'call',
  identifier: 'test',
  apiName: 'execute',
  arguments: '{}',
  type: 'builtin',
};
let role: string | null;
beforeEach(() => {
  vi.clearAllMocks();
  role = 'member';
  vi.mocked(getActiveWorkspaceMembershipRole).mockImplementation(async () => role);
});
const createTransport = (executeTool = vi.fn()) => {
  const ctx = {
    operationId: 'operation',
    stepIndex: 1,
    userId: 'user',
    workspaceId: 'workspace',
    serverDB: {},
    streamManager: { sendToolExecute: vi.fn() },
    toolExecutionService: { executeTool },
  } as unknown as RuntimeExecutorContext;
  const transport = new ServerToolTransport(ctx);
  Object.assign(transport, {
    dispatchBeforeToolCall: vi.fn().mockResolvedValue(undefined),
    resolveAgentVisibility: vi.fn().mockResolvedValue(undefined),
  });
  const context = {
    state: { origin: { workspaceId: 'workspace' }, toolSet: { enabledToolIds: [] } },
    toolName: 'test.execute',
    effectiveManifestMap: {},
    parsedArgs: {},
  } as unknown as ToolRunContext;
  return { transport, context, executeTool };
};

describe('workspace tool launch revocation boundaries', () => {
  it('blocks client dispatch when before-tool hook revokes membership', async () => {
    const { transport, context } = createTransport();
    Object.assign(transport, {
      dispatchBeforeToolCall: async () => {
        role = null;
      },
    });
    await expect(transport.run({ ...payload, executor: 'client' }, context)).rejects.toThrow(
      'membership required',
    );
    expect(dispatchClientTool).not.toHaveBeenCalled();
  });
  it('revalidates after a failed attempt before any server retry launch', async () => {
    const execute = vi.fn(async () => {
      role = null;
      return { content: 'retry', success: false, error: { kind: 'retry' } };
    });
    const { transport, context } = createTransport(execute);
    Object.assign(transport, {
      ctx: {
        operationId: 'operation',
        stepIndex: 1,
        userId: 'user',
        workspaceId: 'workspace',
        serverDB: {},
        streamManager: {},
        toolExecutionService: { executeTool: execute },
        coordinator: { isInterrupted: vi.fn().mockResolvedValue(false) },
      },
    });
    await expect(transport.run(payload, context)).rejects.toThrow('membership required');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('blocks a workspace agent when the tool context lost workspaceId', async () => {
    role = null;
    const execute = vi.fn();
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute } as never,
      mcpService: {} as never,
    });
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ workspaceId: 'workspace' }] }) }),
      }),
    };
    await expect(
      service.executeTool(payload, {
        serverDB: db as never,
        userId: 'user',
        agentId: 'agent',
        toolManifestMap: {},
      }),
    ).rejects.toThrow('membership required');
    expect(execute).not.toHaveBeenCalled();
  });
  it('blocks a task-only workspace invocation when context lost workspaceId', async () => {
    role = null;
    const execute = vi.fn();
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute } as never,
      mcpService: {} as never,
    });
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ workspaceId: 'workspace' }] }) }),
      }),
    };
    await expect(
      service.executeTool(payload, {
        serverDB: db as never,
        userId: 'user',
        taskId: 'task',
        toolManifestMap: {},
      }),
    ).rejects.toThrow('membership required');
    expect(execute).not.toHaveBeenCalled();
  });
  it('blocks direct tool service calls for revoked users before any builtin or MCP calls', async () => {
    role = null;
    const execute = vi.fn();
    const callTool = vi.fn();
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute } as never,
      mcpService: { callTool } as never,
    });
    await expect(
      service.executeTool(payload, {
        serverDB: {} as never,
        userId: 'user',
        workspaceId: 'workspace',
        toolManifestMap: {},
      }),
    ).rejects.toThrow('membership required');
    expect(execute).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });
});
