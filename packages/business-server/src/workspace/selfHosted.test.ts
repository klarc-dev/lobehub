import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { WorkspaceModel } from '@/database/models/workspace';
import { agents, messages, topics, users, workspaceMembers, workspaces } from '@/database/schemas';

import {
  addWorkspaceMemberByEmail,
  assertWorkspaceAccess,
  ensureTrustedWorkspaceMembership,
  getTrustedWorkspaceConfig,
  getWorkspaceStatistics,
  isTrustedWorkspaceUser,
  listWorkspaceMembers,
  provisionTrustedWorkspaceMembers,
} from './selfHosted';

const db = await getTestDB();
let workspaceId: string;
let otherWorkspaceId: string;
const cleanup = async () => {
  await db.delete(workspaces);
  await db.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([
    { email: 'owner@example.test', emailVerified: true, id: 'owner' },
    { email: 'admin@example.test', emailVerified: true, id: 'admin' },
    { email: 'member@example.test', emailVerified: true, id: 'member' },
    { email: 'new@example.test', emailVerified: true, id: 'new' },
    { email: 'unverified@example.test', id: 'unverified' },
    { email: 'suffix@notexample.test', emailVerified: true, id: 'suffix' },
    { banned: true, email: 'banned@example.test', emailVerified: true, id: 'banned' },
  ]);
  workspaceId = (await new WorkspaceModel(db, 'owner').create({ name: 'Team', slug: 'team' })).id;
  otherWorkspaceId = (
    await new WorkspaceModel(db, 'admin').create({ name: 'Other', slug: 'other' })
  ).id;
  await db.insert(workspaceMembers).values([
    { role: 'admin', userId: 'admin', workspaceId },
    { role: 'member', userId: 'member', workspaceId },
  ]);
  vi.stubEnv('SELF_HOSTED_WORKSPACE_ID', workspaceId);
  vi.stubEnv('SELF_HOSTED_WORKSPACE_EMAIL_DOMAIN', 'example.test');
  vi.stubEnv('SELF_HOSTED_WORKSPACE_OWNER_EMAIL', 'owner@example.test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

const membership = (userId: string) =>
  db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  });

describe('self-hosted workspace security and enrollment', () => {
  it('denies outsiders and members admin access, even for a second workspace', async () => {
    await expect(assertWorkspaceAccess(db, 'new', workspaceId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(assertWorkspaceAccess(db, 'member', workspaceId, 'admin')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(assertWorkspaceAccess(db, 'owner', otherWorkspaceId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(assertWorkspaceAccess(db, 'admin', workspaceId, 'owner')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('adds only registered verified accounts, using case-insensitive exact email', async () => {
    await addWorkspaceMemberByEmail(db, 'owner', workspaceId, {
      email: ' NEW@EXAMPLE.TEST ',
      role: 'member',
    });
    expect(await membership('new')).toMatchObject({ role: 'member' });
    for (const email of [
      'missing@example.test',
      'unverified@example.test',
      'banned@example.test',
    ]) {
      await expect(
        addWorkspaceMemberByEmail(db, 'owner', workspaceId, { email, role: 'member' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await membership('unverified')).toBeUndefined();
  });

  it('blocks privilege escalation and preserves primary owner and active roles', async () => {
    await expect(
      addWorkspaceMemberByEmail(db, 'admin', workspaceId, {
        email: 'new@example.test',
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      addWorkspaceMemberByEmail(db, 'member', workspaceId, {
        email: 'new@example.test',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      addWorkspaceMemberByEmail(db, 'owner', workspaceId, {
        email: 'owner@example.test',
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await membership('owner')).toMatchObject({ role: 'owner' });
    expect(await membership('new')).toBeUndefined();
  });

  it('requires explicit complete configuration and the actual verified primary owner', async () => {
    expect(
      isTrustedWorkspaceUser(
        {
          banned: false,
          email: 'user@example.test@evil.test',
          emailVerified: true,
          emailVerifiedAt: null,
        },
        'example.test',
      ),
    ).toBe(false);
    expect(getTrustedWorkspaceConfig({})).toBeNull();
    expect(
      getTrustedWorkspaceConfig({
        SELF_HOSTED_WORKSPACE_ID: workspaceId,
        SELF_HOSTED_WORKSPACE_EMAIL_DOMAIN: 'example.test',
        SELF_HOSTED_WORKSPACE_OWNER_EMAIL: 'someone@evil.test',
      }),
    ).toBeNull();
    vi.stubEnv('SELF_HOSTED_WORKSPACE_OWNER_EMAIL', 'admin@example.test');
    expect(await ensureTrustedWorkspaceMembership(db, 'new')).toBe(false);
    expect(await membership('new')).toBeUndefined();
  });

  it('enrolls future eligible users once, preserves role and removal tombstones', async () => {
    expect(await ensureTrustedWorkspaceMembership(db, 'new')).toBe(true);
    expect(await ensureTrustedWorkspaceMembership(db, 'new')).toBe(false);
    expect(await ensureTrustedWorkspaceMembership(db, 'owner')).toBe(false);
    expect(await ensureTrustedWorkspaceMembership(db, 'admin')).toBe(false);
    expect(await membership('admin')).toMatchObject({ role: 'admin' });
    for (const id of ['suffix', 'unverified', 'banned'])
      expect(await ensureTrustedWorkspaceMembership(db, id)).toBe(false);
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, 'new')),
      );
    expect(await ensureTrustedWorkspaceMembership(db, 'new')).toBe(false);
    await expect(
      addWorkspaceMemberByEmail(db, 'owner', workspaceId, {
        email: 'new@example.test',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await membership('new'))?.deletedAt).toBeInstanceOf(Date);
  });

  it('paginates existing-user provisioning, rejects non-owners and foreign scope', async () => {
    await expect(
      provisionTrustedWorkspaceMembers(db, 'admin', workspaceId, { limit: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      provisionTrustedWorkspaceMembers(db, 'admin', otherWorkspaceId, { limit: 2 }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    let cursor: string | undefined;
    let added = 0;
    do {
      const page = await provisionTrustedWorkspaceMembers(db, 'owner', workspaceId, {
        cursor,
        limit: 2,
      });
      expect(page.scanned).toBeLessThanOrEqual(2);
      added += page.added;
      cursor = page.nextCursor;
    } while (cursor);
    expect(added).toBe(1);
    expect(await membership('new')).toMatchObject({ role: 'member' });
    expect(
      await provisionTrustedWorkspaceMembers(db, 'owner', workspaceId, { limit: 100 }),
    ).toMatchObject({ added: 0 });
  });

  it('joins only workspace profiles and hides tombstones unless admin requested', async () => {
    const rows = await listWorkspaceMembers(db, 'member', workspaceId);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.userId === 'owner')?.user?.email).toBe('owner@example.test');
    await expect(listWorkspaceMembers(db, 'member', workspaceId, true)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(listWorkspaceMembers(db, 'new', workspaceId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('counts only scoped live resources, respecting personal and other-workspace boundaries', async () => {
    await db.insert(agents).values([
      { id: 'agent', userId: 'member', workspaceId },
      { id: 'other-agent', userId: 'admin', workspaceId: otherWorkspaceId },
      { id: 'private-agent', userId: 'member' },
      { id: 'trashed-agent', isDeleted: true, userId: 'member', workspaceId },
    ]);
    await db.insert(topics).values([
      { id: 'topic', userId: 'member', workspaceId },
      { id: 'trashed-topic', isDeleted: true, userId: 'member', workspaceId },
    ]);
    await db.insert(messages).values([
      { id: 'message', role: 'user', userId: 'member', workspaceId },
      { id: 'owner-message', role: 'user', userId: 'owner', workspaceId },
      {
        id: 'deleted-parent-message',
        role: 'user',
        topicId: 'trashed-topic',
        userId: 'member',
        workspaceId,
      },
      { id: 'deleted-message', isDeleted: true, role: 'user', userId: 'member', workspaceId },
      { id: 'private-message', role: 'user', userId: 'member' },
    ]);
    expect(await getWorkspaceStatistics(db, workspaceId)).toEqual({
      agents: 1,
      messages: 2,
      messagesToday: 2,
      topics: 1,
    });
    expect(
      await getWorkspaceStatistics(db, workspaceId, 'member', '2999-01-01T00:00:00.000Z'),
    ).toEqual({ agents: 1, messages: 1, messagesToday: 0, topics: 1 });
  });
});
