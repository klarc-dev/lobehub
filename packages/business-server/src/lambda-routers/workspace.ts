import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';
import type { WorkspaceItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  wsAdminProcedure,
  wsCompatProcedure,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { WorkspaceModel } from '@/database/models/workspace';
import { authedProcedure, router } from '@/libs/trpc/lambda';

import {
  assertWorkspaceAccess,
  ensureTrustedWorkspaceMembership,
  getWorkspaceStatistics,
  provisionTrustedWorkspaceMembers,
} from '../workspace/selfHosted';

export interface WorkspaceMembershipSummary extends WorkspaceItem {
  lockedOut?: boolean;
  plan?: string;
  role: string | null;
}

export interface WorkspaceStatistics {
  agents: number;
  messages: number;
  messagesToday: number;
  topics: number;
}

const workspaceSlugSchema = z
  .string()
  .min(WORKSPACE_SLUG_MIN)
  .max(WORKSPACE_SLUG_MAX)
  .refine(isWorkspaceSlugFormatValid, { message: 'invalid-slug' });
const workspaceStatisticsInput = z
  .object({ todayStartAt: z.string().datetime().optional() })
  .optional();

export const workspaceRouter = router({
  checkSlugAvailable: authedProcedure
    .input(z.object({ slug: z.string().min(WORKSPACE_SLUG_MIN).max(WORKSPACE_SLUG_MAX) }))
    .query(async ({ ctx, input }) => ({
      available:
        isWorkspaceSlugFormatValid(input.slug) &&
        !(await new WorkspaceModel(await getServerDB(), ctx.userId).findBySlug(input.slug)),
    })),

  create: authedProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().trim().min(1).max(255),
        slug: workspaceSlugSchema,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<WorkspaceItem> => {
      const model = new WorkspaceModel(await getServerDB(), ctx.userId);
      if (await model.findBySlug(input.slug))
        throw new TRPCError({ code: 'CONFLICT', message: 'Workspace slug is already in use' });
      return model.create(input);
    }),

  ensureMarketOrganization: authedProcedure
    .input(z.object({ autoProvision: z.boolean().optional() }).optional())
    .mutation(async (): Promise<{ created: boolean; marketAccountId: number }> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace market organization is a cloud-only feature.',
      });
    }),

  getById: wsCompatProcedure.query(async ({ ctx }): Promise<WorkspaceItem | null> => {
    if (!ctx.workspaceId) return null;
    const db = await getServerDB();
    await assertWorkspaceAccess(db, ctx.userId, ctx.workspaceId);
    return (await new WorkspaceModel(db, ctx.userId).findById(ctx.workspaceId)) ?? null;
  }),

  getMyStatistics: wsProcedure
    .input(workspaceStatisticsInput)
    .query(async ({ ctx, input }): Promise<WorkspaceStatistics> => {
      const db = await getServerDB();
      await assertWorkspaceAccess(db, ctx.userId, ctx.workspaceId);
      return getWorkspaceStatistics(db, ctx.workspaceId, ctx.userId, input?.todayStartAt);
    }),

  getSettings: wsProcedure.query(async ({ ctx }): Promise<Record<string, unknown>> => {
    const db = await getServerDB();
    await assertWorkspaceAccess(db, ctx.userId, ctx.workspaceId);
    return new WorkspaceModel(db, ctx.userId).getSettings(ctx.workspaceId) as Promise<
      Record<string, unknown>
    >;
  }),

  getStatistics: wsAdminProcedure
    .input(workspaceStatisticsInput)
    .query(async ({ ctx, input }): Promise<WorkspaceStatistics> => {
      const db = await getServerDB();
      await assertWorkspaceAccess(db, ctx.userId, ctx.workspaceId, 'admin');
      return getWorkspaceStatistics(db, ctx.workspaceId, undefined, input?.todayStartAt);
    }),

  list: authedProcedure.query(async ({ ctx }): Promise<WorkspaceMembershipSummary[]> => {
    const db = await getServerDB();
    await ensureTrustedWorkspaceMembership(db, ctx.userId);
    const workspaces = await new WorkspaceModel(db, ctx.userId).listUserWorkspaces();
    return workspaces
      .filter((workspace) => ['owner', 'admin', 'member', 'viewer'].includes(workspace.role))
      .map((workspace) => ({
        ...workspace,
        role:
          workspace.role === 'owner' && workspace.primaryOwnerId !== ctx.userId
            ? 'admin'
            : workspace.role,
      }));
  }),

  provisionTrustedMembers: wsAdminProcedure
    .input(
      z
        .object({
          cursor: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .default({ limit: 50 }),
    )
    .mutation(async ({ ctx, input }) =>
      provisionTrustedWorkspaceMembers(await getServerDB(), ctx.userId, ctx.workspaceId, input),
    ),

  update: wsAdminProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().trim().min(1).max(255).optional(),
        slug: workspaceSlugSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<void> => {
      const db = await getServerDB();
      await assertWorkspaceAccess(db, ctx.userId, ctx.workspaceId, 'admin');
      const model = new WorkspaceModel(db, ctx.userId);
      if (input.slug) {
        const existing = await model.findBySlug(input.slug);
        if (existing && existing.id !== ctx.workspaceId)
          throw new TRPCError({ code: 'CONFLICT', message: 'Workspace slug is already in use' });
      }
      await model.update(ctx.workspaceId, input);
    }),
});
