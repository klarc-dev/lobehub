import { TRPCError } from '@trpc/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';

import { trpc } from '../lambda/init';

export const userAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  // `ctx.user` is nullable
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  // Every authenticated router must validate the requested scope, including
  // routers that do not use the workspace-specific procedure builders.
  // Never fall back to personal data after a membership has been revoked.
  let workspaceRole: string | undefined;
  if (ctx.workspaceId) {
    const db = await getServerDB();
    const role = await getActiveWorkspaceMembershipRole(db, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    if (!role || !['viewer', 'member', 'admin', 'owner'].includes(role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Active workspace membership required' });
    }
    workspaceRole = role;
  }

  return opts.next({
    // ✅ user value is known to be non-null now
    ctx: { userId: ctx.userId, workspaceRole },
  });
});
