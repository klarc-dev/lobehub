// @vitest-environment node
import type { LobeTool } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { PluginModel } from '@/database/models/plugin';
import { getActiveWorkspaceMembershipRole, WorkspaceModel } from '@/database/models/workspace';

import { pluginRouter } from './plugin';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({
  getActiveWorkspaceMembershipRole: vi.fn(),
  WorkspaceModel: vi.fn(),
}));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: { next: (value: unknown) => unknown }) =>
    opts.next({ ctx: { serverDB: {} } }),
}));

const secretPlugin = {
  customParams: {
    manifestUrl: 'https://example.test/?key=MANIFEST_URL_SENTINEL',
    mcp: {
      args: ['ARGS_SENTINEL'],
      auth: { token: 'TOKEN_SENTINEL', type: 'bearer' },
      command: 'COMMAND_SENTINEL',
      env: { KEY: 'ENV_SENTINEL' },
      headers: { Innocent: 'HEADER_SENTINEL' },
      type: 'http',
      url: 'https://example.test/?key=URL_SENTINEL',
    },
  },
  identifier: 'legacy-sentinel',
  manifest: {
    api: [{ description: 'Search', name: 'search', parameters: { type: 'object' } }],
    gateway: 'https://example.test/?key=GATEWAY_SENTINEL',
    identifier: 'legacy-sentinel',
    meta: { title: 'Legacy MCP' },
    settings: { properties: { key: { default: 'DEFAULT_SENTINEL' } }, type: 'object' },
    type: 'mcp',
  },
  runtimeType: 'mcp',
  settings: { innocent: 'SETTINGS_SENTINEL' },
  type: 'customPlugin',
} satisfies LobeTool;
const findById = vi.fn();
const query = vi.fn();
const caller = (userId = 'other', workspaceId: string | null = 'workspace-a') =>
  pluginRouter.createCaller({ userId, workspaceId });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getServerDB).mockResolvedValue({} as Awaited<ReturnType<typeof getServerDB>>);
  vi.mocked(WorkspaceModel).mockImplementation(function () {
    return { findById: vi.fn().mockResolvedValue({ slug: 'team' }) } as unknown as WorkspaceModel;
  });
  vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('member');
  vi.mocked(PluginModel).mockImplementation(function () {
    return { findById, query } as unknown as PluginModel;
  });
  query.mockResolvedValue([secretPlugin]);
  findById.mockResolvedValue({ ...secretPlugin, userId: 'creator' });
});

describe('plugin inventory credentials', () => {
  it('blocks direct tool execution for a viewer before reading stored credentials', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('viewer');
    await expect(
      caller().callTool({ identifier: 'legacy-sentinel', toolName: 'search' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(findById).not.toHaveBeenCalled();
  });

  it('does not allow create upsert to replace another creator connection', async () => {
    await expect(
      caller().createPlugin({
        identifier: 'legacy-sentinel',
        type: 'customPlugin',
        customParams: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each([
    ['creator', 'member'],
    ['creator', 'admin'],
    ['other', 'owner'],
  ] as const)('allows %s with current %s role to edit credentials', async (userId, role) => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
    expect(await caller(userId).getPluginForEdit({ id: 'legacy-sentinel' })).toMatchObject({
      customParams: secretPlugin.customParams,
      settings: secretPlugin.settings,
    });
  });

  it.each([
    ['creator', 'viewer'],
    ['other', 'viewer'],
    ['other', 'member'],
    ['other', 'admin'],
    ['other', null],
  ] as const)('denies %s with current %s role credential reads', async (userId, role) => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
    await expect(caller(userId).getPluginForEdit({ id: 'legacy-sentinel' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('preserves personal credential editing', async () => {
    expect(await caller('creator', null).getPluginForEdit({ id: 'legacy-sentinel' })).toMatchObject(
      {
        settings: secretPlugin.settings,
      },
    );
  });

  it('does not return a credential record outside the scoped model', async () => {
    findById.mockResolvedValue(undefined);
    await expect(caller().getPluginForEdit({ id: 'foreign-plugin' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each(['viewer', 'member', 'admin', 'owner'] as const)(
    'keeps tools discoverable without disclosing credentials to a workspace %s',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      const result = await caller().getPlugins();
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
      expect(result[0]).toMatchObject({
        customParams: { mcp: { type: 'http' } },
        identifier: secretPlugin.identifier,
        manifest: { api: secretPlugin.manifest.api, meta: { title: 'Legacy MCP' } },
        runtimeType: 'mcp',
        type: 'customPlugin',
      });
      expect(result[0].settings).toBeUndefined();
      // Projection must never mutate the raw object the native runtime consumes.
      expect(secretPlugin.customParams.mcp.auth.token).toBe('TOKEN_SENTINEL');
      expect(secretPlugin.settings.innocent).toBe('SETTINGS_SENTINEL');
    },
  );

  it('preserves personal inventory including legacy runtime and editing configuration', async () => {
    expect(await caller('creator', null).getPlugins()).toEqual([secretPlugin]);
    expect(getActiveWorkspaceMembershipRole).not.toHaveBeenCalled();
  });

  it('rejects inventory after membership removal', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
    await expect(caller().getPlugins()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(query).not.toHaveBeenCalled();
  });
});
