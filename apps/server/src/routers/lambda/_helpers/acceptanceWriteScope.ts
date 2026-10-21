import { and, eq, inArray, isNull } from 'drizzle-orm';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { workspaceMembers, workspaces } from '@/database/schemas';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

export interface AcceptanceScopeCtx {
  serverDB: LobeChatDatabase;
  userId?: string | null;
}

/**
 * May this caller write to this acceptance?
 *
 * Personal records are writable by their creator. Workspace creator authority
 * requires active member-or-higher membership in the record's own workspace.
 * An owner of that workspace may also manage another creator's acceptance.
 * The optional request scope never substitutes for the resource's scope.
 */
export async function canManageAcceptance(
  ctx: AcceptanceScopeCtx,
  acceptance: Pick<AcceptanceItem, 'userId' | 'workspaceId'>,
): Promise<boolean> {
  if (!ctx.userId) return false;
  if (!acceptance.workspaceId) return ctx.userId === acceptance.userId;

  const role = await getActiveWorkspaceMembershipRole(ctx.serverDB, {
    userId: ctx.userId,
    workspaceId: acceptance.workspaceId,
  });
  return (
    role === 'owner' ||
    (ctx.userId === acceptance.userId && (role === 'member' || role === 'admin'))
  );
}

/**
 * Batch twin of {@link canManageAcceptance} for sweep and list endpoints: same
 * rule, but the caller's roles in every distinct resource workspace come back in
 * ONE read — a 200-row sweep, or a participated page spanning many workspaces,
 * must not turn authorization into a chain of sequential queries.
 */
export async function filterManageableAcceptances<
  T extends Pick<AcceptanceItem, 'userId' | 'workspaceId'>,
>(ctx: AcceptanceScopeCtx, rows: T[]): Promise<T[]> {
  if (!ctx.userId) return [];
  const userId = ctx.userId;

  const workspaceIds = [
    ...new Set(rows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))),
  ];
  const memberships = workspaceIds.length
    ? await ctx.serverDB
        .select({
          primaryOwnerId: workspaces.primaryOwnerId,
          role: workspaceMembers.role,
          workspaceId: workspaceMembers.workspaceId,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(
          and(
            inArray(workspaceMembers.workspaceId, workspaceIds),
            eq(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
    : [];
  const roles = new Map(
    memberships.map((member) => [
      member.workspaceId,
      member.role === 'owner' && member.primaryOwnerId !== userId ? 'admin' : member.role,
    ]),
  );

  return rows.filter((row) => {
    if (!row.workspaceId) return row.userId === userId;
    const role = roles.get(row.workspaceId);
    return role === 'owner' || (row.userId === userId && (role === 'member' || role === 'admin'));
  });
}
