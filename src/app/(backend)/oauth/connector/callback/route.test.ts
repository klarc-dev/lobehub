import { runInNewContext } from 'node:vm';

import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { GET } from './route';

const { mockConsume, mockExchange, mockFindById, mockRole, mockSync, mockUpdate } = vi.hoisted(
  () => ({
    mockConsume: vi.fn(),
    mockExchange: vi.fn(),
    mockFindById: vi.fn(),
    mockRole: vi.fn(),
    mockSync: vi.fn(),
    mockUpdate: vi.fn(),
  }),
);

vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: mockRole }));
vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: vi
    .fn()
    .mockResolvedValue({ token_endpoint: 'https://as/token' }),
}));
vi.mock('@/server/services/connector/oauth', () => ({
  exchangeConnectorCode: mockExchange,
  toClientInformation: (oidc: { clientId: string; clientSecret?: string }) => ({
    client_id: oidc.clientId,
    client_secret: oidc.clientSecret,
  }),
}));
vi.mock('@/server/services/connector/tokens', () => ({
  tokensToCredentials: vi
    .fn()
    .mockReturnValue({ credentials: { accessToken: 'tok', type: 'oauth2' }, tokenExpiresAt: null }),
}));
vi.mock('@/server/services/connector/stateStore', () => ({
  consumeConnectorOAuthState: mockConsume,
}));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return { findById: mockFindById, update: mockUpdate };
  }),
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn(function () {}),
}));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: mockSync }));

const makeReq = (query = 'code=abc&state=xyz') =>
  ({ nextUrl: { searchParams: new URLSearchParams(query) } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConsume.mockResolvedValue({
    authorizationServerUrl: 'https://as',
    codeVerifier: 'v',
    connectorId: 'c1',
    lobeUserId: 'u1',
  });
  mockFindById.mockResolvedValue({
    id: 'c1',
    userId: 'u1',
    mcpServerUrl: 'https://mcp.example.com',
    oidcConfig: {
      clientId: 'cid',
      redirectUri: 'https://app.example.com/oauth/connector/callback',
    },
  });
  mockRole.mockResolvedValue('member');
  mockUpdate.mockResolvedValue(undefined);
  mockExchange.mockResolvedValue({ tokens: { access_token: 'tok' } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('connector OAuth callback', () => {
  it.each([true, false])(
    'delivers status with or without an opener (opener=%s)',
    async (hasOpener) => {
      mockSync.mockResolvedValue({ toolCount: 5 });
      const body = await (await GET(makeReq())).text();
      const postMessage = vi.fn();
      const openerPostMessage = vi.fn();
      const script = new DOMParser().parseFromString(body, 'text/html').querySelector('script');
      if (!script?.textContent) throw new Error('Missing callback status script');

      runInNewContext(script.textContent, {
        setTimeout: vi.fn(),
        window: {
          location: { origin: 'https://app.example.com' },
          opener: hasOpener ? { postMessage: openerPostMessage } : null,
          postMessage,
        },
      });

      const expected = {
        connectorId: 'c1',
        success: true,
        synced: true,
        type: 'lobe-connector-oauth',
      };
      expect(postMessage.mock.calls).toEqual([[expected, 'https://app.example.com']]);
      expect(openerPostMessage.mock.calls).toEqual(
        hasOpener ? [[expected, 'https://app.example.com']] : [],
      );
    },
  );

  it('reports synced:false when auth succeeds but tool sync fails', async () => {
    mockSync.mockRejectedValue(new Error('mcp down'));

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('"success":true');
    expect(body).toContain('"synced":false');
  });

  it('reports synced:true when auth and tool sync both succeed', async () => {
    mockSync.mockResolvedValue({ toolCount: 5 });

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('"success":true');
    expect(body).toContain('"synced":true');
  });

  it('looks the connector up in the workspace it was started from', async () => {
    mockSync.mockResolvedValue({ toolCount: 5 });
    mockConsume.mockResolvedValue({
      authorizationServerUrl: 'https://as',
      codeVerifier: 'v',
      connectorId: 'c1',
      lobeUserId: 'u1',
      workspaceId: 'ws1',
    });

    mockFindById.mockResolvedValue({ ...(await mockFindById()), workspaceId: 'ws1' });
    const body = await (await GET(makeReq())).text();

    expect(body).toContain('"success":true');
    expect(ConnectorModel).toHaveBeenCalledWith({}, 'u1', 'ws1', {});
    expect(ConnectorToolModel).toHaveBeenCalledWith({}, 'u1', 'ws1');
  });

  describe('live workspace authority', () => {
    beforeEach(async () => {
      mockConsume.mockResolvedValue({ ...(await mockConsume()), workspaceId: 'ws1' });
      mockFindById.mockResolvedValue({ ...(await mockFindById()), workspaceId: 'ws1' });
    });

    it.each([null, 'viewer', 'unknown'])(
      'rejects revoked or insufficient role %s before exchange',
      async (role) => {
        mockRole.mockResolvedValue(role);
        expect(await (await GET(makeReq())).text()).toContain('connector_authorization_revoked');
        expect(mockExchange).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockSync).not.toHaveBeenCalled();
      },
    );

    it.each(['member', 'admin'])('rejects another creator row for a current %s', async (role) => {
      mockRole.mockResolvedValue(role);
      mockFindById.mockResolvedValue({ ...(await mockFindById()), userId: 'other' });
      expect(await (await GET(makeReq())).text()).toContain('connector_authorization_revoked');
      expect(mockExchange).not.toHaveBeenCalled();
    });

    it.each(['member', 'admin', 'owner'])('allows eligible creator %s', async (role) => {
      mockRole.mockResolvedValue(role);
      mockSync.mockResolvedValue({ toolCount: 1 });
      expect(await (await GET(makeReq())).text()).toContain('"success":true');
    });

    it('allows current primary owner over another creator row', async () => {
      mockRole.mockResolvedValue('owner');
      mockFindById.mockResolvedValue({ ...(await mockFindById()), userId: 'other' });
      expect(await (await GET(makeReq())).text()).toContain('"success":true');
    });

    it.each([null, 'viewer'])('rechecks authority after exchange (%s)', async (role) => {
      mockExchange.mockImplementationOnce(async () => {
        mockRole.mockResolvedValue(role);
        return { tokens: { access_token: 'tok' } };
      });
      expect(await (await GET(makeReq())).text()).toContain('connector_authorization_revoked');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('rechecks ownership transfer after exchange', async () => {
      mockRole.mockResolvedValue('owner');
      mockFindById.mockResolvedValue({ ...(await mockFindById()), userId: 'other' });
      mockExchange.mockImplementationOnce(async () => {
        mockRole.mockResolvedValue('admin');
        return { tokens: { access_token: 'tok' } };
      });
      expect(await (await GET(makeReq())).text()).toContain('connector_authorization_revoked');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('rechecks authority before tool sync', async () => {
      mockUpdate.mockImplementationOnce(async () => {
        mockRole.mockResolvedValue('viewer');
      });
      expect(await (await GET(makeReq())).text()).toContain('connector_authorization_revoked');
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('rechecks revocation during metadata discovery before exchanging', async () => {
      vi.mocked(discoverAuthorizationServerMetadata).mockImplementationOnce(async () => {
        mockRole.mockResolvedValue('viewer');
        return { issuer: 'https://as', token_endpoint: 'https://as/token' };
      });
      expect(await (await GET(makeReq())).text()).toContain('connector_authorization_revoked');
      expect(mockExchange).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects connector configuration changes during exchange', async () => {
      mockExchange.mockImplementationOnce(async () => {
        mockFindById.mockResolvedValue({
          ...(await mockFindById()),
          mcpServerUrl: 'https://changed',
        });
        return { tokens: { access_token: 'tok' } };
      });
      expect(await (await GET(makeReq())).text()).toContain('connector_configuration_changed');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('rejects a mismatched connector scope', async () => {
      mockFindById.mockResolvedValue({ ...(await mockFindById()), workspaceId: 'other' });
      expect(await (await GET(makeReq())).text()).toContain('connector_scope_mismatch');
      expect(mockExchange).not.toHaveBeenCalled();
    });
  });

  it('rejects replayed state without exchanging or writing', async () => {
    mockConsume.mockResolvedValue(null);
    expect(await (await GET(makeReq())).text()).toContain('invalid_or_expired_state');
    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does not require workspace membership for a personal connector', async () => {
    expect(await (await GET(makeReq())).text()).toContain('"success":true');
    expect(mockRole).not.toHaveBeenCalled();
  });

  it('keeps the failure page open and shows the escaped reason', async () => {
    mockFindById.mockResolvedValue(undefined);

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('Authorization failed.');
    expect(body).toContain('>connector_not_found</p>');
    expect(body).not.toContain('window.close');
    expect(console.error).toHaveBeenCalled();
  });

  it('shows the provider error description without injecting markup', async () => {
    const body = await (
      await GET(makeReq('error=access_denied&error_description=%3Cimg%20src%3Dx%3E'))
    ).text();

    expect(body).toContain('access_denied: &lt;img src=x&gt;');
    expect(body).not.toContain('<img');
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('remembers the client auth method that the token endpoint accepted', async () => {
    mockSync.mockResolvedValue({ toolCount: 1 });
    mockExchange.mockResolvedValue({
      authMethod: 'client_secret_post',
      tokens: { access_token: 'tok' },
    });

    await GET(makeReq());

    expect(mockUpdate).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        oidcConfig: expect.objectContaining({
          clientId: 'cid',
          tokenEndpointAuthMethod: 'client_secret_post',
        }),
      }),
    );
  });

  it('leaves the OIDC config alone when the first auth method worked', async () => {
    mockSync.mockResolvedValue({ toolCount: 1 });

    await GET(makeReq());

    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('oidcConfig');
  });
});
