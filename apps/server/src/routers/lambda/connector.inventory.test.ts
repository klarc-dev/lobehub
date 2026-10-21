// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { UserModel } from '@/database/models/user';
import { getActiveWorkspaceMembershipRole, WorkspaceModel } from '@/database/models/workspace';
import type { LambdaContext } from '@/libs/trpc/lambda/context';

import { connectorRouter } from './connector';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: { getDisplayInfoByIds: vi.fn() } }));
vi.mock('@/database/models/workspace', () => ({
  getActiveWorkspaceMembershipRole: vi.fn(),
  WorkspaceModel: vi.fn(),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));

const ID = '9f1f6f30-0000-4000-8000-000000000001';
const secrets = [
  'BEARER_SENTINEL',
  'HEADER_SENTINEL',
  'ENV_SENTINEL',
  'OIDC_SENTINEL',
  'ARGS_SENTINEL',
  'METADATA_SENTINEL',
];
const makeConnector = () => ({
  agentId: 'agent-1',
  credentials: { token: secrets[0], type: 'bearer' as const },
  id: ID,
  identifier: 'shared-connector',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  mcpServerUrl: 'https://safe.test/mcp',
  mcpStdioConfig: {
    args: ['--token', secrets[4]],
    command: 'mcp-server',
    env: { API_KEY: secrets[2] },
  },
  metadata: {
    avatar: 'https://safe.test/avatar.png',
    composio: {
      appSlug: 'github',
      authConfigId: 'auth-config',
      connectedAccountId: 'account-1',
      linkedByUserId: 'creator',
      status: 'ACTIVE',
      customHeaders: { Authorization: secrets[1] },
    },
    customHeaders: { Authorization: secrets[1] },
    description: 'Shared tools',
    env: { SECRET: secrets[2] },
    migratedFromCustomPlugin: true,
    mountedByAgentId: 'agent-1',
    unknownConfig: { token: secrets[5] },
  },
  name: 'Shared connector',
  oidcConfig: { clientId: 'public-client-id', clientSecret: secrets[3], scheme: 'dcr' as const },
  sourceType: 'custom',
  status: 'connected',
  userId: 'creator',
  workspaceId: 'workspace-1',
});

let connector: ReturnType<typeof makeConnector>;
const tools = [{ id: 'tool-1', permission: 'auto', toolName: 'list_things' }];
const caller = (userId = 'teammate') =>
  connectorRouter.createCaller({
    serverDB: {},
    userId,
    workspaceId: 'workspace-1',
  } as LambdaContext);

beforeEach(() => {
  vi.resetAllMocks();
  connector = makeConnector();
  vi.mocked(getServerDB).mockResolvedValue({} as Awaited<ReturnType<typeof getServerDB>>);
  vi.mocked(WorkspaceModel).mockImplementation(function () {
    return {
      findById: vi.fn().mockResolvedValue({ id: 'workspace-1', slug: 'team' }),
    } as unknown as WorkspaceModel;
  });
  vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('member');
  vi.mocked(ConnectorModel).mockImplementation(function () {
    return {
      findById: vi.fn().mockImplementation(async () => connector),
      query: vi.fn().mockImplementation(async () => [connector]),
      queryAllAgentScoped: vi.fn().mockImplementation(async () => [connector]),
      queryByAgent: vi.fn().mockImplementation(async () => [connector]),
    } as unknown as ConnectorModel;
  });
  vi.mocked(ConnectorToolModel).mockImplementation(function () {
    return { queryByConnector: vi.fn().mockResolvedValue(tools) } as unknown as ConnectorToolModel;
  });
  vi.mocked(AgentModel).mockImplementation(function () {
    return {
      getAgentAvatarsByIds: vi.fn().mockResolvedValue([{ id: 'agent-1', title: 'Agent' }]),
    } as unknown as AgentModel;
  });
  vi.mocked(UserModel.getDisplayInfoByIds).mockResolvedValue([]);
});

describe('connector inventory security', () => {
  it.each(['viewer', 'member', 'owner'] as const)(
    "never returns secrets in %s inventory, including the creator's",
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      for (const userId of ['teammate', 'creator']) {
        const api = caller(userId);
        const inventories = [
          await api.list(),
          await api.listByAgent({ agentId: 'agent-1' }),
          await api.listAgentBound(),
        ];
        for (const inventory of inventories) {
          expect(inventory).toHaveLength(1);
          const serialized = JSON.stringify(inventory);
          for (const secret of secrets) expect(serialized).not.toContain(secret);
          expect(inventory[0]).not.toHaveProperty('credentials');
          expect(inventory[0].oidcConfig).not.toHaveProperty('clientSecret');
          expect(inventory[0]).toMatchObject({
            id: ID,
            identifier: 'shared-connector',
            tools,
            metadata: {
              avatar: connector.metadata.avatar,
              description: 'Shared tools',
              mountedByAgentId: 'agent-1',
              migratedFromCustomPlugin: true,
              composio: {
                appSlug: 'github',
                connectedAccountId: 'account-1',
                linkedByUserId: 'creator',
                status: 'ACTIVE',
              },
            },
            oidcConfig: { clientId: 'public-client-id', scheme: 'dcr' },
          });
        }
      }
      // The projection must never mutate the runtime/edit source object.
      expect(connector).toEqual(makeConnector());
    },
  );

  it('sanitizes personal inventory and retains authorized personal edit data', async () => {
    const api = connectorRouter.createCaller({ serverDB: {}, userId: 'creator' } as LambdaContext);
    const inventory = await api.list();
    for (const secret of secrets) expect(JSON.stringify(inventory)).not.toContain(secret);
    expect(await api.getForEdit({ id: ID })).toMatchObject({
      credentials: connector.credentials,
      metadata: connector.metadata,
      mcpStdioConfig: connector.mcpStdioConfig,
    });
  });

  it('accepts null optional config without changing inventory identity', async () => {
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return {
        query: vi
          .fn()
          .mockResolvedValue([
            { ...connector, metadata: null, oidcConfig: null, mcpStdioConfig: null },
          ]),
      } as unknown as ConnectorModel;
    });
    expect(await caller().list()).toMatchObject([
      { id: ID, metadata: null, oidcConfig: null, mcpStdioConfig: null, tools },
    ]);
  });

  it('does not copy secret-bearing objects in allowlisted metadata fields', async () => {
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return {
        query: vi.fn().mockResolvedValue([
          {
            ...connector,
            metadata: {
              description: { token: secrets[5] },
              composio: { ...connector.metadata.composio, authConfigId: { headers: secrets[1] } },
            },
          },
        ]),
      } as unknown as ConnectorModel;
    });
    const inventory = await caller().list();
    expect(inventory[0].metadata).toEqual({});
    for (const secret of secrets) expect(JSON.stringify(inventory)).not.toContain(secret);
  });

  it.each(['creator', 'teammate'])('denies viewer edit-secret access for %s', async (userId) => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('viewer');
    await expect(caller(userId).getForEdit({ id: ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('denies another member edit-secret access', async () => {
    await expect(caller().getForEdit({ id: ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['member', 'owner'] as const)(
    'retains protected user-set secrets for an authorized %s edit',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      const result = await caller(role === 'owner' ? 'teammate' : 'creator').getForEdit({ id: ID });
      expect(result).toMatchObject({
        credentials: connector.credentials,
        mcpStdioConfig: connector.mcpStdioConfig,
        metadata: connector.metadata,
      });
      expect(JSON.stringify(result)).not.toContain(secrets[3]);
    },
  );

  it('never returns machine-managed OAuth tokens even for an authorized edit', async () => {
    const oauthConnector = {
      ...connector,
      credentials: { accessToken: secrets[0], refreshToken: secrets[1], type: 'oauth2' },
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { findById: vi.fn().mockResolvedValue(oauthConnector) } as unknown as ConnectorModel;
    });
    expect((await caller('creator').getForEdit({ id: ID })).credentials).toBeNull();
  });
});
