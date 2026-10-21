import { TRPCError } from '@trpc/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { getActiveWorkspaceMembershipRole, WorkspaceModel } from '@/database/models/workspace';
import { normalizeWorkspaceId } from '@/database/utils/workspace';
import { authedProcedure } from '@/libs/trpc/lambda';
import type { LambdaContext } from '@/libs/trpc/lambda/context';
import { trpc } from '@/libs/trpc/lambda/init';

export type WorkspaceRole = 'admin' | 'member' | 'owner' | 'viewer';

const WORKSPACE_ROLE_ORDER: readonly WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];

const isWorkspaceRole = (role: string | null): role is WorkspaceRole =>
  role === 'viewer' || role === 'member' || role === 'admin' || role === 'owner';

/** Never trust the request's workspace scope or a previously supplied role. */
const resolveWorkspaceAuth = async (ctx: LambdaContext, workspaceId: string) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required for workspace access',
    });
  }

  const db = await getServerDB();
  const workspace = await new WorkspaceModel(db, ctx.userId).findById(workspaceId);
  if (!workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }

  // This helper excludes deleted memberships and demotes legacy co-owners to
  // Admin. primaryOwnerId alone must never resurrect a removed membership.
  const role = await getActiveWorkspaceMembershipRole(db, { userId: ctx.userId, workspaceId });
  if (!isWorkspaceRole(role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Active workspace membership required' });
  }

  return { workspaceId, workspaceRole: role, workspaceSlug: workspace.slug };
};

/**
 * Optional workspace scope, also used by public message and Market routes.
 * No scope stays personal. An invalid scope is rejected, never downgraded to
 * personal data. API-key workspace binding is enforced by createLambdaContext.
 */
export const cloudWorkspaceAuth = trpc.middleware(async ({ ctx, next }) => {
  const workspaceId = normalizeWorkspaceId(ctx.workspaceId);
  if (!workspaceId) {
    return next({
      ctx: {
        workspaceId: undefined,
        workspaceRole: undefined as WorkspaceRole | undefined,
        workspaceSlug: undefined as string | undefined,
      },
    });
  }

  return next({ ctx: await resolveWorkspaceAuth(ctx, workspaceId) });
});

const resolveWorkspaceRole = async (
  ctx: LambdaContext,
  workspaceId: string,
  minRole: WorkspaceRole,
) => {
  const workspace = await resolveWorkspaceAuth(ctx, workspaceId);
  const minimum = WORKSPACE_ROLE_ORDER.indexOf(minRole);
  if (minimum < 0 || WORKSPACE_ROLE_ORDER.indexOf(workspace.workspaceRole) < minimum) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${minRole} role or higher` });
  }
  return workspace;
};

export const requireWorkspaceRole = (minRole: WorkspaceRole) =>
  trpc.middleware(async ({ ctx, next }) => {
    if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

    const workspaceId = normalizeWorkspaceId(ctx.workspaceId);
    if (!workspaceId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
    }

    return next({ ctx: await resolveWorkspaceRole(ctx, workspaceId, minRole) });
  });

/** Strict workspace membership, including read-only Viewers. */
export const lobeWorkspaceAuth = requireWorkspaceRole('viewer');

/** Personal calls require authentication, but no workspace role. */
export const requireWorkspaceRoleWhenScoped = (minRole: WorkspaceRole) =>
  trpc.middleware(async ({ ctx, next }) => {
    if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const workspaceId = normalizeWorkspaceId(ctx.workspaceId);
    if (!workspaceId) {
      return next({
        ctx: {
          workspaceId: undefined,
          workspaceRole: undefined as WorkspaceRole | undefined,
          workspaceSlug: undefined as string | undefined,
        },
      });
    }

    return next({ ctx: await resolveWorkspaceRole(ctx, workspaceId, minRole) });
  });

export const wsProcedure = authedProcedure.use(lobeWorkspaceAuth);
export const wsMemberProcedure = authedProcedure.use(requireWorkspaceRole('member'));
export const wsOwnerProcedure = authedProcedure.use(requireWorkspaceRole('owner'));
export const wsAdminProcedure = authedProcedure.use(requireWorkspaceRole('admin'));
export const wsCompatProcedure = authedProcedure.use(cloudWorkspaceAuth);
