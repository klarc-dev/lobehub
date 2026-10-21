// @vitest-environment node
import type { LobeTool } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ToolExecutionService } from '@/server/services/toolExecution';

import { callLegacyPluginTool } from './callTool';

vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/server/services/toolExecution', () => ({ ToolExecutionService: vi.fn() }));
vi.mock('@/server/services/toolExecution/builtin', () => ({ BuiltinToolsExecutor: vi.fn() }));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));

const executeTool = vi.fn();
const queryByIdentifiers = vi.fn();
const plugin = (transport: 'http' | 'stdio' | 'cloud' = 'http'): LobeTool => ({
  customParams: {
    mcp: {
      args: ['--secret=ARGS_SENTINEL'],
      auth: { token: 'OWNER_SENTINEL', type: 'bearer' },
      command: 'mcp',
      env: { KEY: 'ENV_SENTINEL' },
      headers: { Key: 'HEADER_SENTINEL' },
      type: transport,
      url: 'https://safe.test/mcp',
    },
  },
  identifier: 'legacy',
  manifest: {
    api: [{ description: '', name: 'search', parameters: {} }],
    identifier: 'legacy',
    meta: { title: 'Legacy' },
    type: 'mcp',
  },
  settings: { SETTING: 'SETTINGS_SENTINEL' },
  type: 'customPlugin',
});
const ctx = { serverDB: {} as never, userId: 'member', workspaceId: 'team' };
const input = { args: '{"q":"query"}', identifier: 'legacy', toolName: 'search' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ConnectorModel).mockImplementation(function () {
    return { queryByIdentifiers } as unknown as ConnectorModel;
  });
  vi.mocked(ToolExecutionService).mockImplementation(function () {
    return { executeTool } as unknown as ToolExecutionService;
  });
  queryByIdentifiers.mockResolvedValue([]);
  executeTool.mockResolvedValue({ content: 'result', state: { content: [] }, success: true });
});

describe('legacy plugin server bridge', () => {
  it.each(['http', 'stdio', 'cloud'] as const)(
    'keeps %s credentials server-side and delegates native runtime routing',
    async (transport) => {
      const result = await callLegacyPluginTool(input, plugin(transport), ctx);
      expect(result).toMatchObject({ content: 'result', success: true });
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
      const [payload, context] = executeTool.mock.calls[0];
      expect(payload).toMatchObject({ apiName: 'search', identifier: 'legacy', type: 'mcp' });
      expect(context).toMatchObject({ userId: 'member', workspaceId: 'team' });
      expect(context.toolManifestMap.legacy.mcpParams.auth.token).toBe('OWNER_SENTINEL');
      if (transport === 'http')
        expect(context.toolManifestMap.legacy.mcpParams.headers).toEqual({
          Key: 'HEADER_SENTINEL',
          SETTING: 'SETTINGS_SENTINEL',
        });
      if (transport === 'stdio')
        expect(context.toolManifestMap.legacy.mcpParams.env).toEqual({
          KEY: 'ENV_SENTINEL',
          SETTING: 'SETTINGS_SENTINEL',
        });
    },
  );

  it('refuses forged tool names before execution', async () => {
    await expect(
      callLegacyPluginTool({ ...input, toolName: 'forged' }, plugin(), ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it.each(['required', 'always', [{ policy: 'required' }]] as const)(
    'keeps approval-required calls on the durable runtime path',
    async (policy) => {
      const row = plugin();
      row.manifest!.api[0].humanIntervention = policy as never;
      await expect(callLegacyPluginTool(input, row, ctx)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(executeTool).not.toHaveBeenCalled();
    },
  );

  it('does not bypass migrated connector permissions with a stale legacy row', async () => {
    queryByIdentifiers.mockResolvedValue([{ id: 'connector', isEnabled: false }]);
    await expect(callLegacyPluginTool(input, plugin(), ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(executeTool).not.toHaveBeenCalled();
  });
});
