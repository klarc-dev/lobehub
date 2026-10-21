import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';

import { callConnectorToolById } from './exec';
import { scheduleStaleConnectorToolsRefresh } from './refresh';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));
vi.mock('@/server/services/mcp', () => ({ mcpService: { callTool: vi.fn() } }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { isConfigured: false } }));
vi.mock('./tokens', () => ({ ensureFreshConnectorToken: vi.fn(async (c) => c) }));
// The background tool-list refresh is exercised in refresh.test.ts. Here we only
// verify the call site wires it up and stays isolated from it.
vi.mock('./refresh', () => ({
  buildLastSyncedAtMap: vi.fn(() => new Map()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));

const connector = {
  credentials: { accessToken: 'tok', type: 'oauth2' },
  id: 'c1',
  identifier: 'my-conn',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  mcpStdioConfig: null,
  name: 'My Connector',
  oidcConfig: null,
} as any;

const tool = (over: Record<string, unknown> = {}) => ({
  permission: ConnectorToolPermission.auto,
  toolName: 'do_thing',
  ...over,
});

const makeCtx = (connectors: any[], tools: any[]) =>
  ({
    connectorModel: { queryByIdentifiers: vi.fn().mockResolvedValue(connectors) },
    connectorToolModel: { queryByConnector: vi.fn().mockResolvedValue(tools) },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('member');
  vi.mocked(ensureFreshConnectorToken).mockImplementation(async (c: any) => c);
  (deviceGateway as any).isConfigured = false;
});

describe('callConnectorToolById', () => {
  it('rejects when the connector is not found', async () => {
    await expect(
      callConnectorToolById({ identifier: 'x', toolName: 'do_thing' }, makeCtx([], [])),
    ).rejects.toHaveProperty('code', 'NOT_FOUND');
  });

  it('rejects when the connector is disabled', async () => {
    const ctx = makeCtx([{ ...connector, isEnabled: false }], [tool()]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool name not in the synced list', async () => {
    const ctx = makeCtx([connector], [tool({ toolName: 'other' })]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'BAD_REQUEST');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('rejects a disabled tool', async () => {
    const ctx = makeCtx([connector], [tool({ permission: ConnectorToolPermission.disabled })]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it.each([
    { caller: 'owner', scope: 'personal', userId: 'owner', workspaceId: null },
    { caller: 'member', scope: 'shared', userId: 'owner', workspaceId: 'workspace' },
  ])(
    'rejects $scope approval-required tools for the $caller before any upstream work',
    async (scope) => {
      const ctx = makeCtx(
        [{ ...connector, userId: scope.userId, workspaceId: scope.workspaceId }],
        [tool({ permission: ConnectorToolPermission.needs_approval })],
      );

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('approval') });
      expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
      expect(scheduleStaleConnectorToolsRefresh).not.toHaveBeenCalled();
      expect(mcpService.callTool).not.toHaveBeenCalled();
    },
  );

  it.each([
    { approved: true },
    { approval: { operationId: 'forged-operation', status: 'approved' } },
    { humanIntervention: 'never', permission: 'auto', skipApproval: true },
  ])('does not treat caller-supplied approval claims as permission: %j', async (claims) => {
    const ctx = makeCtx(
      [connector],
      [tool({ permission: ConnectorToolPermission.needs_approval })],
    );
    // Extra wire fields and tool arguments are untrusted, even if a caller
    // bypasses the router schema and reaches this service directly.
    const params = {
      ...claims,
      args: JSON.stringify(claims),
      identifier: 'my-conn',
      toolName: 'do_thing',
    };

    await expect(callConnectorToolById(params, ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(scheduleStaleConnectorToolsRefresh).not.toHaveBeenCalled();
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('calls the remote MCP with the connector auth for an allowed tool', async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    const res = await callConnectorToolById(
      { args: '{"a":1}', identifier: 'my-conn', toolName: 'do_thing' },
      ctx,
    );

    expect(res).toEqual({ success: true });
    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        argsStr: '{"a":1}',
        clientParams: expect.objectContaining({
          auth: expect.objectContaining({ accessToken: 'tok', type: 'oauth2' }),
          type: 'http',
          url: 'https://mcp.example.com',
        }),
        toolName: 'do_thing',
      }),
    );
  });

  it.each([null, 'guest', 'viewer'])(
    'rejects workspace execution for current role %s before upstream work',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      const ctx = {
        ...makeCtx([{ ...connector, workspaceId: 'workspace' }], [tool()]),
        serverDB: {},
        userId: 'member',
        workspaceId: 'workspace',
      };

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toHaveProperty('code', 'FORBIDDEN');
      expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
      expect(scheduleStaleConnectorToolsRefresh).not.toHaveBeenCalled();
      expect(mcpService.callTool).not.toHaveBeenCalled();
    },
  );

  it.each(['member', 'admin', 'owner'])(
    'allows current workspace %s to execute auto tools',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
      const db = {};
      const ctx = {
        ...makeCtx([{ ...connector, userId: 'creator', workspaceId: 'workspace' }], [tool()]),
        serverDB: db,
        userId: 'calling-member',
        workspaceId: 'workspace',
      };

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).resolves.toEqual({ success: true });
      expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledTimes(2);
      expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledWith(db, {
        userId: 'calling-member',
        workspaceId: 'workspace',
      });
    },
  );

  it('rejects shared execution when trusted auth context is absent', async () => {
    const ctx = makeCtx([{ ...connector, workspaceId: 'workspace' }], [tool()]);
    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('rechecks membership after OAuth refresh before launching the MCP tool', async () => {
    const ctx = {
      ...makeCtx([{ ...connector, workspaceId: 'workspace' }], [tool()]),
      serverDB: {},
      userId: 'member',
      workspaceId: 'workspace',
    };
    vi.mocked(ensureFreshConnectorToken).mockImplementationOnce(async (c) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
      return c;
    });

    await expect(
      callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');
    expect(ensureFreshConnectorToken).toHaveBeenCalledTimes(1);
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it('uses the refreshed token when the connector token was refreshed', async () => {
    vi.mocked(ensureFreshConnectorToken).mockResolvedValueOnce({
      ...connector,
      credentials: { accessToken: 'refreshed', type: 'oauth2' },
    } as any);
    vi.mocked(mcpService.callTool).mockResolvedValue({ ok: true });
    const ctx = makeCtx([connector], [tool()]);

    await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        clientParams: expect.objectContaining({
          auth: expect.objectContaining({ accessToken: 'refreshed' }),
        }),
      }),
    );
  });

  it('schedules a background tool-list refresh for the connector', async () => {
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(scheduleStaleConnectorToolsRefresh).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'c1',
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://mcp.example.com',
        }),
      ],
      expect.anything(),
      ctx,
    );
  });

  // On a cloud deployment (device gateway configured) the server can never
  // reach a stdio binary or a localhost/LAN endpoint — those calls must fail
  // fast with an actionable message instead of a cryptic spawn/fetch error
  // (#16533). Self-hosted servers (no gateway) may share a LAN with the
  // endpoint, so the guard must NOT fire there.
  describe('device-only endpoints on a cloud deployment', () => {
    it('rejects a stdio connector when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      const stdioConnector = {
        ...connector,
        mcpConnectionType: 'stdio',
        mcpServerUrl: null,
        mcpStdioConfig: { args: [], command: 'npx' },
      };
      const ctx = makeCtx([stdioConnector], [tool()]);

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toHaveProperty('code', 'BAD_REQUEST');
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('rejects a local/private-network HTTP connector when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      const localConnector = { ...connector, mcpServerUrl: 'http://192.168.1.10:8080/mcp' };
      const ctx = makeCtx([localConnector], [tool()]);

      await expect(
        callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx),
      ).rejects.toHaveProperty('code', 'BAD_REQUEST');
      expect(mcpService.callTool).not.toHaveBeenCalled();
    });

    it('still calls a local endpoint when no device gateway is configured (self-host)', async () => {
      vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
      const localConnector = { ...connector, mcpServerUrl: 'http://192.168.1.10:8080/mcp' };
      const ctx = makeCtx([localConnector], [tool()]);

      const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

      expect(res).toEqual({ success: true });
      expect(mcpService.callTool).toHaveBeenCalledTimes(1);
    });

    it('keeps calling public endpoints when the device gateway is configured', async () => {
      (deviceGateway as any).isConfigured = true;
      vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
      const ctx = makeCtx([connector], [tool()]);

      const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

      expect(res).toEqual({ success: true });
    });
  });

  it('still returns the tool result when the background refresh scheduler throws', async () => {
    // The refresh is a pure optimization; a failure in it must never break the
    // tool call the user actually asked for.
    vi.mocked(scheduleStaleConnectorToolsRefresh).mockImplementationOnce(() => {
      throw new Error('scheduler exploded');
    });
    vi.mocked(mcpService.callTool).mockResolvedValue({ success: true });
    const ctx = makeCtx([connector], [tool()]);

    const res = await callConnectorToolById({ identifier: 'my-conn', toolName: 'do_thing' }, ctx);

    expect(res).toEqual({ success: true });
    expect(mcpService.callTool).toHaveBeenCalledTimes(1);
  });
});
