import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorMetadata } from '@/database/schemas';

/**
 * Inventory is shared with every workspace reader, including viewers. Metadata
 * is an extensible, client-writable bag, so allow only known display/identity
 * fields rather than trying to enumerate every possible secret-bearing key.
 * Runtime and protected edit reads must continue using the original model row.
 */
export const projectConnectorInventory = (connector: DecryptedConnector) => {
  const {
    credentials: _credentials,
    mcpStdioConfig: _stdio,
    metadata,
    oidcConfig,
    ...rest
  } = connector;
  const safeMetadata: ConnectorMetadata | null = metadata ? {} : null;
  if (metadata && safeMetadata) {
    for (const key of ['avatar', 'description', 'mountedByAgentId'] as const) {
      if (typeof metadata[key] === 'string') safeMetadata[key] = metadata[key];
    }
    if (typeof metadata.migratedFromCustomPlugin === 'boolean') {
      safeMetadata.migratedFromCustomPlugin = metadata.migratedFromCustomPlugin;
    }
    if (metadata.composio) {
      const { appSlug, authConfigId, connectedAccountId, linkedByUserId, status } =
        metadata.composio;
      // Metadata is accepted as unknown JSON on write, not validated by this
      // interface. Never copy nested objects masquerading as identity strings.
      if (
        typeof appSlug === 'string' &&
        typeof authConfigId === 'string' &&
        typeof connectedAccountId === 'string' &&
        typeof status === 'string'
      ) {
        safeMetadata.composio = {
          appSlug,
          authConfigId,
          connectedAccountId,
          ...(typeof linkedByUserId === 'string' ? { linkedByUserId } : {}),
          status,
        };
      }
    }
  }
  const { clientSecret: _clientSecret, ...safeOidcConfig } = oidcConfig ?? {};

  return {
    ...rest,
    // Launch configuration can carry secrets in both env and arbitrary args.
    // Desktop install/edit obtains it through the protected getForEdit route.
    mcpStdioConfig: null,
    metadata: safeMetadata,
    oidcConfig: oidcConfig ? safeOidcConfig : oidcConfig,
  };
};
