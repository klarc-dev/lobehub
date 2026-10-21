import {
  agents,
  messages,
  topics,
  users,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, asc, count, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';
import { hasLiveParentTopic } from '@/database/utils/topicVisibility';

export const assertWorkspaceAccess = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
  minimum: 'member' | 'admin' | 'owner' = 'member',
) => {
  const role = await getActiveWorkspaceMembershipRole(db, { userId, workspaceId });
  const allowed =
    minimum === 'owner'
      ? role === 'owner'
      : minimum === 'admin'
        ? role === 'owner' || role === 'admin'
        : ['owner', 'admin', 'member', 'viewer'].includes(role ?? '');
  if (!allowed) throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace access denied' });
  return role;
};

const trustedConfigSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/),
  ownerEmail: z.string().trim().toLowerCase().email(),
  workspaceId: z.string().trim().min(1),
});

/** All three settings are required. No public/client environment variables are trusted. */
export const getTrustedWorkspaceConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const result = trustedConfigSchema.safeParse({
    domain: env.SELF_HOSTED_WORKSPACE_EMAIL_DOMAIN,
    ownerEmail: env.SELF_HOSTED_WORKSPACE_OWNER_EMAIL,
    workspaceId: env.SELF_HOSTED_WORKSPACE_ID,
  });
  if (!result.success || result.data.ownerEmail.split('@')[1] !== result.data.domain) return null;
  return result.data;
};

export const isTrustedWorkspaceUser = (
  user: {
    banned: boolean | null;
    email: string | null;
    emailVerified: boolean;
    emailVerifiedAt: Date | null;
  },
  domain: string,
) =>
  !user.banned &&
  (user.emailVerified || !!user.emailVerifiedAt) &&
  z.string().email().safeParse(user.email?.trim()).success &&
  user.email?.trim().toLowerCase().split('@')[1] === domain;

/** Explicit opt-in reconciliation, not invitation acceptance. Never restores a removed member. */
export const ensureTrustedWorkspaceMembership = async (db: LobeChatDatabase, userId: string) => {
  const config = getTrustedWorkspaceConfig();
  if (!config) return false;
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, config.workspaceId))
      .for('update');
    if (!workspace) return false;
    const owner = await tx.query.users.findFirst({ where: eq(users.id, workspace.primaryOwnerId) });
    if (
      !owner ||
      !isTrustedWorkspaceUser(owner, config.domain) ||
      owner.email?.trim().toLowerCase() !== config.ownerEmail
    )
      return false;
    const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !isTrustedWorkspaceUser(user, config.domain)) return false;
    // DO NOTHING preserves active roles and removal tombstones, even under concurrent requests.
    const added = await tx
      .insert(workspaceMembers)
      .values({
        role: userId === workspace.primaryOwnerId ? 'owner' : 'member',
        userId,
        workspaceId: workspace.id,
      })
      .onConflictDoNothing()
      .returning({ userId: workspaceMembers.userId });
    return added.length > 0;
  });
};

/** Bounded, repeatable deployment-admin operation. Requires a real authenticated owner session/key. */
export const provisionTrustedWorkspaceMembers = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
  options: { cursor?: string; limit: number },
) => {
  await assertWorkspaceAccess(db, userId, workspaceId, 'owner');
  const config = getTrustedWorkspaceConfig();
  if (!config || config.workspaceId !== workspaceId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Trusted workspace enrollment is not configured',
    });
  }
  const owner = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (
    !owner ||
    !isTrustedWorkspaceUser(owner, config.domain) ||
    owner.email?.trim().toLowerCase() !== config.ownerEmail
  ) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Configured deployment owner required' });
  }
  const page = await db.query.users.findMany({
    columns: { id: true },
    limit: options.limit + 1,
    orderBy: [asc(users.id)],
    where: options.cursor ? gt(users.id, options.cursor) : undefined,
  });
  const selected = page.slice(0, options.limit);
  let added = 0;
  for (const user of selected) if (await ensureTrustedWorkspaceMembership(db, user.id)) added++;
  return {
    added,
    nextCursor: page.length > options.limit ? selected.at(-1)?.id : undefined,
    scanned: selected.length,
  };
};

/** Adds a registered verified account, never creates an account or a pending invitation. */
export const addWorkspaceMemberByEmail = async (
  db: LobeChatDatabase,
  actorId: string,
  workspaceId: string,
  input: { email: string; role: 'admin' | 'member' | 'viewer' },
) =>
  db.transaction(async (tx) => {
    // Serialize this service's membership writes and ownership transfer with the native workspace row.
    const [workspace] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');
    if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
    const actorRole = await assertWorkspaceAccess(tx, actorId, workspaceId, 'admin');
    if (input.role === 'admin' && actorRole !== 'owner') throw new TRPCError({ code: 'FORBIDDEN' });
    const matches = await tx.query.users.findMany({
      limit: 2,
      where: sql`lower(trim(${users.email})) = ${input.email.trim().toLowerCase()}`,
    });
    const target = matches[0];
    if (
      matches.length !== 1 ||
      !target ||
      target.banned ||
      (!target.emailVerified && !target.emailVerifiedAt)
    ) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'A registered, verified account is required',
      });
    }
    const [member] = await tx
      .insert(workspaceMembers)
      .values({
        role: input.role,
        userId: target.id,
        workspaceId,
      })
      .onConflictDoNothing()
      .returning();
    if (!member)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Membership already exists or was removed',
      });
    return member;
  });

export const listWorkspaceMembers = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
  includeDeleted = false,
) => {
  await assertWorkspaceAccess(db, userId, workspaceId, includeDeleted ? 'admin' : 'member');
  return db
    .select({
      deletedAt: workspaceMembers.deletedAt,
      joinedAt: workspaceMembers.joinedAt,
      role: sql<string>`case when ${workspaceMembers.role} = 'owner' and ${workspaces.primaryOwnerId} <> ${workspaceMembers.userId} then 'admin' else ${workspaceMembers.role} end`,
      updatedAt: workspaceMembers.updatedAt,
      user: {
        avatar: users.avatar,
        email: users.email,
        fullName: users.fullName,
        username: users.username,
      },
      userId: workspaceMembers.userId,
      workspaceId: workspaceMembers.workspaceId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        includeDeleted ? undefined : isNull(workspaceMembers.deletedAt),
      ),
    );
};

export const getWorkspaceStatistics = async (
  db: LobeChatDatabase,
  workspaceId: string,
  userId?: string,
  todayStartAt?: string,
) => {
  const now = new Date();
  const start = todayStartAt
    ? new Date(todayStartAt)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const messageWhere = and(
    eq(messages.workspaceId, workspaceId),
    userId ? eq(messages.userId, userId) : undefined,
    notTrashed(messages.isDeleted),
    hasLiveParentTopic(messages.topicId),
  );
  const [[agentCount], [topicCount], [messageCount]] = await Promise.all([
    db
      .select({ total: count() })
      .from(agents)
      .where(
        and(
          eq(agents.workspaceId, workspaceId),
          notTrashed(agents.isDeleted),
          userId ? eq(agents.userId, userId) : undefined,
        ),
      ),
    db
      .select({ total: count() })
      .from(topics)
      .where(
        and(
          eq(topics.workspaceId, workspaceId),
          notTrashed(topics.isDeleted),
          userId ? eq(topics.userId, userId) : undefined,
        ),
      ),
    db
      .select({
        today: sql<number>`count(*) filter (where ${gte(messages.createdAt, start)})`.mapWith(
          Number,
        ),
        total: count(),
      })
      .from(messages)
      .where(messageWhere),
  ]);
  return {
    agents: agentCount.total,
    messages: messageCount.total,
    messagesToday: messageCount.today,
    topics: topicCount.total,
  };
};
