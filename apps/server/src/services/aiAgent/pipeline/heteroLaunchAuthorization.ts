import type { LobeChatDatabase } from '@/database/type';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';

import { assertWorkspaceExecutionAllowed } from '../../workspaceExecutionAuthorization';

interface ExecutionScope {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/** Device addressing can be personal while the run still operates on workspace data. */
export const authorizeHeteroDeviceLaunch = async (
  scope: ExecutionScope,
  deviceId: string,
  deviceWorkspaceId?: string,
) => {
  const failure = await resolveDeviceDispatchAuthorizationFailure(
    scope.db,
    scope.userId,
    deviceId,
    deviceWorkspaceId,
  );
  await assertWorkspaceExecutionAllowed(scope);
  return failure;
};

/** Last awaited preflight before the detached sandbox runner is spawned. */
export const authorizeHeteroSandboxLaunch = async (scope: ExecutionScope) => {
  const token = await signUserJWT(scope.userId, '4h');
  await assertWorkspaceExecutionAllowed(scope);
  return token;
};
