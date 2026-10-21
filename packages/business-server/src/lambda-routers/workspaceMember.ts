import type { WorkspaceInvitationItem, WorkspaceMemberItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { router } from '@/libs/trpc/lambda';

import {
  addWorkspaceMemberByEmail,
  assertWorkspaceAccess,
  listWorkspaceMembers,
} from '../workspace/selfHosted';

/** A membership row joined with the public profile of the member. */
export interface WorkspaceMemberSummary extends WorkspaceMemberItem {
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
}

// Cloud gates these on the compat procedure plus a role check rather than on a
// procedure that requires the header, so an unscoped call reads as empty rather
// than as a bad request. Mirror that here.
const wsCompatAdminProcedure = wsCompatProcedure.use(requireWorkspaceRole('admin'));

// Self-hosted member administration uses verified, registered accounts.
// Invitations remain unsupported until the complete acceptance/revocation lifecycle exists.
export const workspaceMemberRouter = router({
  addByEmail: wsCompatAdminProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
      return addWorkspaceMemberByEmail(await getServerDB(), ctx.userId, ctx.workspaceId, input);
    }),

  /** Deployment-admin enrollment of existing accounts, not email invitations. Atomic and bounded. */
  addRegisteredMembers: wsCompatAdminProcedure
    .input(
      z.object({
        emails: z.array(z.string().trim().email()).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;
      if (!workspaceId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'workspaceId is required' });
      const db = await getServerDB();
      await assertWorkspaceAccess(db, ctx.userId, workspaceId, 'owner');
      return db.transaction(async (tx) => {
        let added = 0;
        let skipped = 0;
        for (const email of new Set(input.emails.map((email) => email.toLowerCase()))) {
          try {
            await addWorkspaceMemberByEmail(tx, ctx.userId, workspaceId, { email, role: 'member' });
            added++;
          } catch (error) {
            if (!(error instanceof TRPCError) || error.code !== 'CONFLICT') throw error;
            skipped++;
          }
        }
        return { added, skipped };
      });
    }),
  invite: wsCompatAdminProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
      }),
    )
    .mutation(async (): Promise<WorkspaceInvitationItem> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace invitations are a cloud-only feature.',
      });
    }),

  list: wsCompatProcedure
    .input(z.object({ includeDeleted: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }): Promise<WorkspaceMemberSummary[]> => {
      if (!ctx.workspaceId) return [];
      return listWorkspaceMembers(
        await getServerDB(),
        ctx.userId,
        ctx.workspaceId,
        input?.includeDeleted,
      );
    }),

  listInvitations: wsCompatAdminProcedure.query(
    async ({ ctx }): Promise<WorkspaceInvitationItem[]> => {
      if (!ctx.workspaceId) return [];
      const db = await getServerDB();
      await assertWorkspaceAccess(db, ctx.userId, ctx.workspaceId, 'admin');
      return new WorkspaceMemberModel(db, ctx.userId).listPendingInvitations(ctx.workspaceId);
    },
  ),
});
