// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composioToolsRouter } from './composio';

const mocks = vi.hoisted(() => ({
  connectorQueryByIdentifiers: vi.fn(),
  isComposioNotFound: vi.fn(),
  markComposioUnavailable: vi.fn(),
  pluginFindById: vi.fn(),
  processToolCallResult: vi.fn(),
  toolsExecute: vi.fn(),
  toolsList: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    return {
      markComposioConnectionUnavailable: mocks.markComposioUnavailable,
      queryByIdentifiers: mocks.connectorQueryByIdentifiers,
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.pluginFindById };
  }),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    getClient: () => ({ tools: { list: mocks.toolsList } }),
    tools: { execute: mocks.toolsExecute },
  }),
  isComposioConnectedAccountNotFoundError: mocks.isComposioNotFound,
}));

vi.mock('@/server/services/mcp', () => ({
  MCPService: { processToolCallResult: mocks.processToolCallResult },
}));

const caller = () => composioToolsRouter.createCaller({ userId: 'user-1' } as any);
const input = { identifier: 'gmail', toolArgs: { to: 'a@b.c' }, toolSlug: 'GMAIL_SEND_EMAIL' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
  mocks.isComposioNotFound.mockImplementation(function (error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'CONNECTED_ACCOUNT_NOT_FOUND'
    );
  });
  mocks.markComposioUnavailable.mockResolvedValue(false);
  mocks.pluginFindById.mockResolvedValue(undefined);
  mocks.toolsExecute.mockResolvedValue({ data: 'ok' });
  mocks.processToolCallResult.mockResolvedValue({ content: 'ok', success: true });
});

describe('composioToolsRouter discovery', () => {
  for (const method of ['getActions', 'listActions'] as const) {
    it(`${method} returns tools beyond the first page without touching connections`, async () => {
      mocks.toolsList.mockResolvedValueOnce({
        items: [{ description: 'first', input_parameters: { type: 'object' }, slug: 'FIRST' }],
        next_cursor: 'next',
      });
      mocks.toolsList.mockResolvedValueOnce({
        items: [
          {
            description: 'batch',
            input_parameters: { type: 'object' },
            slug: 'GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT',
          },
        ],
        next_cursor: null,
      });

      const result = await caller()[method]({ appSlug: 'googledocs' });

      expect(result.tools.map((tool) => tool.name)).toEqual([
        'FIRST',
        'GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT',
      ]);
      expect(mocks.toolsList).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'next' }));
      expect(mocks.toolsExecute).not.toHaveBeenCalled();
      expect(mocks.connectorQueryByIdentifiers).not.toHaveBeenCalled();
      expect(mocks.markComposioUnavailable).not.toHaveBeenCalled();
    });
  }
});

describe('composioToolsRouter.executeAction', () => {
  for (const response of [
    { data: { misleading: 'payload' }, successful: false },
    { data: {}, error: 'sensitive-provider-details', successful: true },
  ]) {
    it('returns a sanitized error for an explicit provider failure', async () => {
      mocks.pluginFindById.mockResolvedValue({
        customParams: { composio: { connectedAccountId: 'ca-own' } },
      });
      mocks.toolsExecute.mockResolvedValue(response);

      await caller().executeAction(input);

      expect(mocks.processToolCallResult).toHaveBeenCalledWith({
        content: [
          { text: expect.stringContaining('Composio tool execution failed'), type: 'text' },
        ],
        isError: true,
      });
      expect(JSON.stringify(mocks.processToolCallResult.mock.calls)).not.toContain(
        'sensitive-provider-details',
      );
    });
  }

  it('resolves connectedAccountId from connector metadata (new path)', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'user-1' }),
    );
    expect(mocks.pluginFindById).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(connector.status).toBe('error');
   */
  it('delegates a connected-account 404 to ConnectorModel for manual execution', async () => {
    const notFound = Object.assign(new Error('connected account not found'), {
      code: 'CONNECTED_ACCOUNT_NOT_FOUND',
    });
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);
    mocks.toolsExecute.mockRejectedValue(notFound);
    mocks.markComposioUnavailable.mockResolvedValue(true);

    await expect(caller().executeAction(input)).rejects.toMatchObject({
      message: 'connected account not found',
    });
    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('conn-gmail', 'ca-connector');
  });

  /**
   * @example
   * expect(connector.status).toBe('connected');
   */
  it('does not disable a connector when manual execution reports a remote resource 404', async () => {
    // ROOT CAUSE:
    //
    // Tool actions can return 404 for the target resource while their connected account is healthy.
    // Only Composio's explicit connected-account-not-found error may update connector health here.
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);
    mocks.toolsExecute.mockRejectedValue(
      Object.assign(new Error('message not found'), { status: 404 }),
    );

    await expect(caller().executeAction(input)).rejects.toMatchObject({
      message: 'message not found',
    });
    expect(mocks.markComposioUnavailable).not.toHaveBeenCalled();
  });

  it('falls back to plugin customParams when no connector projection exists', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
    mocks.pluginFindById.mockResolvedValue({
      customParams: { composio: { connectedAccountId: 'ca-plugin' } },
    });

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-plugin' }),
    );
  });

  it('throws NOT_FOUND when neither source has a connection', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
    mocks.pluginFindById.mockResolvedValue(undefined);

    await expect(caller().executeAction(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });
});
