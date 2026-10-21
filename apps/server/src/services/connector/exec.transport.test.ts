import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { DecryptedConnector } from '@/database/models/connector';
import { ConnectorToolPermission } from '@/database/schemas';

import { callConnectorToolById } from './exec';
import type { ConnectorToolSyncContext } from './sync';

// Only deployment configuration is isolated. The executor, OAuth freshness
// logic, MCP service, client and HTTP transport all run their real code.
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { isConfigured: false } }));

const calls: unknown[] = [];
const requests: string[] = [];
const connections = new Set<McpServer>();
const server = createServer(async (req, res) => {
  requests.push(req.method ?? '');
  const mcp = new McpServer({ name: 'connector-exec-regression', version: '1.0.0' });
  mcp.registerTool('echo', { inputSchema: { value: z.string() } }, async ({ value }) => {
    calls.push(value);
    return { content: [{ text: value, type: 'text' }] };
  });
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  connections.add(mcp);
  res.on('close', () => {
    void mcp.close().finally(() => connections.delete(mcp));
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Regression MCP endpoint failed', error);
    res.writeHead(500).end();
  }
});
let connector: DecryptedConnector;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  connector = {
    credentials: null,
    id: 'connector-transport',
    identifier: 'transport',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: `http://127.0.0.1:${port}/mcp`,
    mcpStdioConfig: null,
    metadata: null,
    name: 'Transport regression',
    oidcConfig: null,
    userId: 'owner',
    workspaceId: null,
  } as DecryptedConnector;
});

afterAll(async () => {
  await Promise.all([...connections].map((mcp) => mcp.close()));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

const context = (permission: ConnectorToolPermission): ConnectorToolSyncContext =>
  ({
    connectorModel: { queryByIdentifiers: vi.fn().mockResolvedValue([connector]) },
    connectorToolModel: {
      queryByConnector: vi.fn().mockResolvedValue([
        {
          permission,
          toolName: 'echo',
          updatedAt: new Date(),
          userConnectorId: connector.id,
        },
      ]),
    },
  }) as unknown as ConnectorToolSyncContext;

describe('native connector execution over real MCP HTTP', () => {
  it.each(['headless', 'manual'])(
    'rejects %s approval claims without contacting the MCP endpoint',
    async (mode) => {
      const requestCount = requests.length;
      const callCount = calls.length;
      const params = {
        approved: true,
        args: JSON.stringify({ approved: true, mode, value: 'must-not-execute' }),
        identifier: 'transport',
        operationId: 'untrusted-operation',
        toolName: 'echo',
      };

      await expect(
        callConnectorToolById(params, context(ConnectorToolPermission.needs_approval)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('approval') });
      expect(requests).toHaveLength(requestCount);
      expect(calls).toHaveLength(callCount);
    },
  );

  it('keeps disabled tools blocked without contacting the MCP endpoint', async () => {
    const requestCount = requests.length;
    const callCount = calls.length;

    await expect(
      callConnectorToolById(
        { identifier: 'transport', toolName: 'echo' },
        context(ConnectorToolPermission.disabled),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('disabled') });
    expect(requests).toHaveLength(requestCount);
    expect(calls).toHaveLength(callCount);
  });

  it('executes an auto tool through the real MCP service and HTTP client', async () => {
    const result = await callConnectorToolById(
      { args: JSON.stringify({ value: 'auto-result' }), identifier: 'transport', toolName: 'echo' },
      context(ConnectorToolPermission.auto),
    );

    expect(result).toMatchObject({ content: 'auto-result', success: true });
    expect(calls).toEqual(['auto-result']);
  });
});
