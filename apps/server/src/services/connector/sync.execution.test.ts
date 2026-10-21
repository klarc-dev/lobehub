import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { mcpService } from '@/server/services/mcp';
import { after } from '@/server/utils/scheduleAfterResponse';

import { scheduleStaleConnectorToolsRefresh } from './refresh';
import type { ConnectorToolSyncContext } from './sync';
import { syncConnectorToolsById } from './sync';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));
vi.mock('@/server/services/mcp', () => ({ mcpService: { listRawTools: vi.fn() } }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { isConfigured: false } }));
vi.mock('./tokens', () => ({ ensureFreshConnectorToken: vi.fn(async (connector) => connector) }));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const connector = {
  credentials: null,
  id: 'shared-sync',
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  name: 'Shared',
  workspaceId: 'workspace',
};
const makeContext = (personal = false) => ({
  connectorModel: {
    findById: vi
      .fn()
      .mockResolvedValue({ ...connector, workspaceId: personal ? null : 'workspace' }),
    updateStatus: vi.fn(),
  },
  connectorToolModel: { upsertMany: vi.fn() },
  serverDB: {},
  userId: 'calling-member',
  workspaceId: personal ? undefined : 'workspace',
});
const sync = (ctx: ReturnType<typeof makeContext>) =>
  syncConnectorToolsById(connector.id, ctx as unknown as ConnectorToolSyncContext);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('member');
  vi.mocked(mcpService.listRawTools).mockResolvedValue([]);
  vi.mocked(ensureFreshConnectorToken).mockImplementation(async (value) => value);
});

describe('connector sync execution authorization', () => {
  it.each([null, 'viewer', 'guest'])(
    'denies live role %s before token refresh or remote discovery',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      const ctx = makeContext();
      await expect(sync(ctx)).rejects.toHaveProperty('code', 'WORKSPACE_EXECUTION_FORBIDDEN');
      expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
      expect(mcpService.listRawTools).not.toHaveBeenCalled();
      expect(ctx.connectorToolModel.upsertMany).not.toHaveBeenCalled();
    },
  );

  it('blocks remote discovery when membership is revoked during token refresh', async () => {
    vi.mocked(ensureFreshConnectorToken).mockImplementationOnce(async (value) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
      return value;
    });
    await expect(sync(makeContext())).rejects.toHaveProperty(
      'code',
      'WORKSPACE_EXECUTION_FORBIDDEN',
    );
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
  });

  it('does not persist remote tools after membership is revoked during discovery', async () => {
    const ctx = makeContext();
    vi.mocked(mcpService.listRawTools).mockImplementationOnce(async () => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
      return [];
    });
    await expect(sync(ctx)).rejects.toHaveProperty('code', 'WORKSPACE_EXECUTION_FORBIDDEN');
    expect(ctx.connectorToolModel.upsertMany).not.toHaveBeenCalled();
  });

  it('rechecks membership when deferred refresh actually starts', async () => {
    const ctx = makeContext();
    scheduleStaleConnectorToolsRefresh(
      [connector],
      new Map(),
      ctx as unknown as ConnectorToolSyncContext,
    );
    const deferred = vi.mocked(after).mock.calls[0][0];
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
    if (typeof deferred !== 'function') throw new Error('Expected deferred refresh callback');
    await deferred();
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves legitimate sync, personal=%s', async (personal) => {
    const ctx = makeContext(personal);
    await expect(sync(ctx)).resolves.toEqual({ toolCount: 0 });
    expect(mcpService.listRawTools).toHaveBeenCalledTimes(1);
    expect(ctx.connectorToolModel.upsertMany).toHaveBeenCalledTimes(1);
    if (personal) expect(getActiveWorkspaceMembershipRole).not.toHaveBeenCalled();
  });
});
