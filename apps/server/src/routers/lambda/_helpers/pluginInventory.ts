import type { CustomPluginParams, LobeTool } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

// JSON schemas may carry prefilled credentials in defaults/examples. Preserve
// validation and tool descriptions but not values intended to seed config.
const withoutSchemaPrefills = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutSchemaPrefills);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'default' && key !== 'examples' && key !== 'example')
      .map(([key, child]) => [
        key,
        (key === 'properties' || key === '$defs' || key === 'definitions') && isRecord(child)
          ? Object.fromEntries(
              Object.entries(child).map(([name, schema]) => [name, withoutSchemaPrefills(schema)]),
            )
          : withoutSchemaPrefills(child),
      ]),
  );
};

/**
 * Workspace discovery is not permission to read connection credentials. Keep
 * the display/tool contract only. In particular URLs, command/args, manifest
 * gateways and settings defaults can embed secrets even without secret keys.
 * This projection belongs at the transport boundary, not PluginModel: native
 * tool discovery and execution must continue reading the original config.
 */
export const toWorkspacePluginInventory = (plugin: LobeTool): LobeTool => {
  const { customParams, identifier, manifest, runtimeType, source, type } = plugin;
  const row: LobeTool = { identifier, runtimeType, source, type };
  if (manifest) {
    row.manifest = {
      api: (manifest.api ?? []).map((api) => ({
        description: api.description,
        humanIntervention: api.humanIntervention,
        name: api.name,
        parameters: withoutSchemaPrefills(api.parameters) as Record<string, unknown>,
      })),
      identifier,
      meta: {
        avatar: manifest.meta?.avatar,
        description: manifest.meta?.description,
        tags: manifest.meta?.tags,
        title: manifest.meta?.title ?? identifier,
      },
      type: manifest.type,
      version: manifest.version,
    };
    if (manifest.settings) {
      row.manifest.settings = {
        properties: Object.fromEntries(
          Object.entries(manifest.settings.properties ?? {}).map(([key, schema]) => [
            key,
            {
              description: schema.description,
              format: schema.format,
              maximum: schema.maximum,
              minimum: schema.minimum,
              title: schema.title,
              type: schema.type,
            },
          ]),
        ),
        required: manifest.settings.required,
        type: 'object',
      };
    }
  }
  const params: CustomPluginParams = {};
  if (customParams?.mcp) params.mcp = { type: customParams.mcp.type };
  if (customParams?.composio) {
    // Account ids and authorization config do not belong in discovery either.
    params.composio = {
      appSlug: customParams.composio.appSlug,
      status: customParams.composio.status,
    } as CustomPluginParams['composio'];
  }
  row.customParams = params;
  return row;
};
