import type { ConnectorModel } from '@/database/models/connector';
import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

import type { ConnectorOAuthStatePayload } from './stateStore';

/** State identifies the initiator, but never grants durable workspace authority. */
export const authorizeConnectorOAuthCallback = async (
  db: LobeChatDatabase,
  model: ConnectorModel,
  payload: ConnectorOAuthStatePayload,
) => {
  const connector = await model.findById(payload.connectorId);
  if (!connector) throw new Error('connector_not_found');
  if (
    connector.id !== payload.connectorId ||
    (connector.workspaceId ?? undefined) !== payload.workspaceId
  ) {
    throw new Error('connector_scope_mismatch');
  }

  if (payload.workspaceId) {
    const role = await getActiveWorkspaceMembershipRole(db, {
      userId: payload.lobeUserId,
      workspaceId: payload.workspaceId,
    });
    if (
      !role ||
      !['owner', 'admin', 'member'].includes(role) ||
      (connector.userId !== payload.lobeUserId && role !== 'owner')
    ) {
      throw new Error('connector_authorization_revoked');
    }
  } else if (connector.userId !== payload.lobeUserId) {
    throw new Error('connector_scope_mismatch');
  }

  return connector;
};
