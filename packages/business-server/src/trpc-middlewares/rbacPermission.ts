import { getWorkspaceRolePermissionCodes, RBAC_PERMISSIONS } from '@lobechat/const/rbac';
import { TRPCError } from '@trpc/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { normalizeWorkspaceId } from '@/database/utils/workspace';
import { trpc } from '@/libs/trpc/lambda/init';

const knownPermissions = new Set(Object.values(RBAC_PERMISSIONS));

/**
 * Workspace authorization uses the native built-in role matrix, never synthetic
 * grants or a caller-supplied role. Membership is revalidated for every gate so
 * removal and downgrades take effect even for server-side createCaller calls.
 * Personal requests retain OSS behavior after authentication. Their resource
 * models remain responsible for user ownership and API-key scope enforcement.
 */
const withPermissions = (codes: readonly string[], mode: 'all' | 'any') => {
  // Snapshot the required codes so a caller cannot mutate an installed guard.
  const required = [...codes];
  return trpc.middleware(async ({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const workspaceId = normalizeWorkspaceId(ctx.workspaceId);
    if (!workspaceId) return next();

    // Empty requirements and unknown codes are configuration errors, not grants.
    // Validate the entire Any list too: a typo must not silently weaken a gate.
    if (required.length === 0 || required.some((code) => !knownPermissions.has(code))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Unknown workspace permission' });
    }

    const db = await getServerDB();
    const workspaceRole = await getActiveWorkspaceMembershipRole(db, {
      userId: ctx.userId,
      workspaceId,
    });
    if (
      workspaceRole !== 'owner' &&
      workspaceRole !== 'admin' &&
      workspaceRole !== 'member' &&
      workspaceRole !== 'viewer'
    ) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Active workspace membership required' });
    }
    const granted = new Set(getWorkspaceRolePermissionCodes(workspaceRole));
    const permitted =
      mode === 'all'
        ? required.every((code) => granted.has(code))
        : required.some((code) => granted.has(code));
    if (!permitted) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient workspace permission' });
    }

    return next({ ctx: { workspaceId, workspaceRole } });
  });
};

export const withRbacPermission = (code: string) => withPermissions([code], 'all');

export const withAnyRbacPermission = (codes: string[]) => withPermissions(codes, 'any');

export const withAllRbacPermissions = (codes: string[]) => withPermissions(codes, 'all');

/**
 * Accept the catalog-defined :all / :owner grants for an action. Passing an
 * :owner gate does not authorize other members' rows: the router/model must
 * still enforce creator ownership (for example assertWorkspaceRowManageable).
 * Shared registries intentionally retain the native matrix's :all semantics.
 */
export const withScopedPermission = (action: string) =>
  withPermissions(
    [`${action}:all`, `${action}:owner`].filter((code) => knownPermissions.has(code)),
    'any',
  );
