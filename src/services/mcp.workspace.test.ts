import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient, toolsClient } from '@/libs/trpc/client';

import { mcpService } from './mcp';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ getActiveWorkspaceId: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { plugin: { callTool: { mutate: vi.fn() } } },
  toolsClient: { mcp: { callTool: { mutate: vi.fn() } } },
}));
vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: vi.fn() }));
vi.mock('./discover', () => ({ discoverService: { safeInjectMPToken: vi.fn() } }));
const state = vi.hoisted(() => ({ plugin: {} }));
vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => ({}) }));
vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: () => () => state.plugin,
  },
}));
vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: { connectorByIdentifier: () => () => undefined },
}));

const payload: ChatToolPayload = {
  apiName: 'search',
  arguments: '{"q":"test"}',
  id: 'call',
  identifier: 'legacy',
  type: 'mcp',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.plugin = { customParams: { mcp: { type: 'http' } }, identifier: 'legacy' };
});

describe('workspace legacy MCP client', () => {
  it('calls by identity and arguments only, never constructs a connection from inventory', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue('team');
    vi.mocked(lambdaClient.plugin.callTool.mutate).mockResolvedValue({
      content: 'ok',
      state: { content: [] },
      success: true,
    });
    const result = await mcpService.invokeMcpToolCall(payload, {});
    expect(result).toMatchObject({ content: 'ok', success: true });
    expect(lambdaClient.plugin.callTool.mutate).toHaveBeenCalledWith(
      { args: payload.arguments, identifier: 'legacy', toolName: 'search' },
      { signal: undefined },
    );
    expect(toolsClient.mcp.callTool.mutate).not.toHaveBeenCalled();
  });

  it('keeps personal legacy connection behavior unchanged', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);
    state.plugin = {
      customParams: {
        mcp: {
          type: 'http',
          url: 'https://safe.test',
          auth: { type: 'bearer', token: 'PERSONAL_SENTINEL' },
        },
      },
    };
    await mcpService.invokeMcpToolCall(payload, {});
    expect(lambdaClient.plugin.callTool.mutate).not.toHaveBeenCalled();
    expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ auth: { token: 'PERSONAL_SENTINEL', type: 'bearer' } }),
      }),
      expect.anything(),
    );
  });

  it.each([true, false])(
    'normalizes missing MCP state without losing success=%s',
    async (success) => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('team');
      vi.mocked(lambdaClient.plugin.callTool.mutate).mockResolvedValue({
        content: 'server result',
        executionTime: 1,
        success,
      });
      const result = await mcpService.invokeMcpToolCall(payload, {});
      expect(result).toEqual({
        content: 'server result',
        error: undefined,
        state: { content: [{ text: 'server result', type: 'text' }], isError: !success },
        success,
      });
    },
  );
});
