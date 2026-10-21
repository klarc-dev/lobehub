import type { LobeChatDatabase } from '@lobechat/database';
import type { LobeTool } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { ConnectorModel } from '@/database/models/connector';
import { mcpService } from '@/server/services/mcp';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

/** Execute a stored legacy connection without ever sending it to the browser. */
export const callLegacyPluginTool = async (
  input: { args?: string; identifier: string; toolName: string },
  plugin: Pick<LobeTool, 'manifest' | 'customParams' | 'settings'>,
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId?: string },
) => {
  const api = plugin.manifest?.api?.find(({ name }) => name === input.toolName);
  if (!api) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Plugin tool not found' });

  // A migrated connector takes precedence over its legacy row. Refuse to let
  // this route bypass connector enablement or tool approval settings.
  const [connector] = await new ConnectorModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId,
  ).queryByIdentifiers([input.identifier]);
  if (connector) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Use the connector tool execution path' });
  }

  // Direct calls have no durable operation-bound approval. Rules/dynamic
  // policies must be evaluated by the native agent runtime, not by a boolean
  // supplied by this browser. Only an absent policy or explicit never is safe.
  if (api.humanIntervention !== undefined && api.humanIntervention !== 'never') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This tool requires approval through the agent runtime',
    });
  }

  const connection = plugin.customParams?.mcp;
  if (!connection) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Plugin has no MCP connection' });
  }
  const settings = Object.fromEntries(
    Object.entries(plugin.settings ?? {}).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
  const mcpParams = {
    ...connection,
    ...(connection.type === 'http' && { headers: { ...connection.headers, ...settings } }),
    ...(connection.type === 'stdio' && { env: { ...connection.env, ...settings } }),
    name: input.identifier,
  };
  const service = new ToolExecutionService({
    builtinToolsExecutor: new BuiltinToolsExecutor(ctx.serverDB, ctx.userId),
    mcpService,
  });
  const manifest = { ...plugin.manifest!, mcpParams };
  return service.executeTool(
    {
      apiName: input.toolName,
      arguments: input.args ?? '{}',
      id: crypto.randomUUID(),
      identifier: input.identifier,
      type: 'mcp',
    },
    {
      ...ctx,
      toolManifestMap: {
        [input.identifier]: manifest,
      },
    },
  );
};
