import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

export class WorkspaceExecutionDeniedError extends Error {
  readonly code = 'WORKSPACE_EXECUTION_FORBIDDEN';
  readonly kind = 'stop';

  constructor() {
    super('Active workspace Member, Admin or Owner membership required for execution');
    this.name = 'WorkspaceExecutionDeniedError';
  }
}

/** Never cache this decision: queued steps and retries can outlive membership. */
export const assertWorkspaceExecutionAllowed = async (scope: {
  db?: LobeChatDatabase;
  userId?: string;
  workspaceId?: string | null;
}): Promise<void> => {
  if (scope.workspaceId == null) return;
  // A supplied but invalid scope is not permission to run in personal mode.
  if (!scope.workspaceId.trim() || !scope.db || !scope.userId)
    throw new WorkspaceExecutionDeniedError();

  const role = await getActiveWorkspaceMembershipRole(scope.db, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
  if (role !== 'member' && role !== 'admin' && role !== 'owner')
    throw new WorkspaceExecutionDeniedError();
};
