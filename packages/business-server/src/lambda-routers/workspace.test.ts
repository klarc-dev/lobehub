import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces, workspaceTeams } from '@/database/schemas';

import { workspaceRouter } from './workspace';
import { workspaceMemberRouter } from './workspaceMember';

const { getServerDB } = vi.hoisted(() => ({ getServerDB: vi.fn() }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB }));

const db = await getTestDB();
const caller = (userId: string, workspaceId?: string) =>
  workspaceRouter.createCaller({ userId, workspaceId } as never);
const members = (userId: string, workspaceId?: string) =>
  workspaceMemberRouter.createCaller({ userId, workspaceId } as never);
const cleanup = async () => {
  await db.delete(workspaces);
  await db.delete(users);
};
let id: string;
beforeEach(async () => {
  await cleanup();
  getServerDB.mockResolvedValue(db);
  await db.insert(users).values([
    { email: 'owner@example.test', emailVerified: true, id: 'owner' },
    { email: 'member@example.test', emailVerified: true, id: 'member' },
    { email: 'outsider@example.test', emailVerified: true, id: 'outsider' },
  ]);
  id = (await caller('owner').create({ name: 'Team', slug: 'test-team' })).id;
});
afterEach(cleanup);

describe('native self-hosted workspace router contracts', () => {
  it('creates real membership and default team, lists and updates scoped workspace', async () => {
    expect(
      await db.query.workspaceTeams.findMany({ where: eq(workspaceTeams.workspaceId, id) }),
    ).toHaveLength(1);
    expect(await caller('owner').list()).toMatchObject([{ id, role: 'owner' }]);
    expect(await caller('outsider').list()).toEqual([]);
    expect(await caller('owner', id).getById()).toMatchObject({ id, name: 'Team' });
    await caller('owner', id).update({ name: 'Renamed' });
    expect(await caller('owner', id).getById()).toMatchObject({ name: 'Renamed' });
    expect(await caller('owner', id).getSettings()).toEqual({});
    expect(await caller('owner', id).getStatistics()).toEqual({
      agents: 0,
      messages: 0,
      messagesToday: 0,
      topics: 0,
    });
    expect(await caller('owner').checkSlugAvailable({ slug: 'test-team' })).toEqual({
      available: false,
    });
    expect(await caller('owner').checkSlugAvailable({ slug: 'unused-team' })).toEqual({
      available: true,
    });
    await expect(
      caller('owner').create({ name: 'Duplicate', slug: 'test-team' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects cross-workspace reads and writes and grants only existing users', async () => {
    await expect(caller('outsider', id).getById()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('outsider', id).update({ name: 'Unauthorized' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await members('owner', id).addByEmail({ email: 'member@example.test' });
    expect(await members('member', id).list()).toHaveLength(2);
    await expect(caller('member', id).update({ name: 'Unauthorized' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller('member', id).getStatistics()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await caller('member', id).getMyStatistics()).toMatchObject({ messages: 0 });
    await expect(
      members('member', id).addByEmail({ email: 'outsider@example.test' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bounds owner-only batch enrollment and safely skips existing roles', async () => {
    expect(
      await members('owner', id).addRegisteredMembers({
        emails: ['member@example.test', 'owner@example.test'],
      }),
    ).toEqual({ added: 1, skipped: 1 });
    expect(
      await members('owner', id).addRegisteredMembers({ emails: ['member@example.test'] }),
    ).toEqual({ added: 0, skipped: 1 });
    expect(
      await db.query.workspaceMembers.findMany({ where: eq(workspaceMembers.workspaceId, id) }),
    ).toHaveLength(2);
    await expect(
      members('owner', id).addRegisteredMembers({
        emails: Array.from({ length: 101 }).fill('member@example.test'),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      members('member', id).addRegisteredMembers({ emails: ['outsider@example.test'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      members('owner', id).addRegisteredMembers({
        emails: ['outsider@example.test', 'unknown@example.test'],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await caller('outsider').list()).toEqual([]);
  });
});
