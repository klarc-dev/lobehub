// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canManageAcceptance, filterManageableAcceptances } from './acceptanceWriteScope';

const membershipRows = vi.fn();
const limit = vi.fn();
const where = vi.fn(() => ({ limit }));
const select = vi.fn(() => ({
  from: vi.fn(() => ({
    innerJoin: vi.fn(() => ({ where })),
  })),
}));
const db = { select } as any;
const ctx = { serverDB: db, userId: 'me' };
const row = (userId: string, workspaceId: string | null) => ({ userId, workspaceId });

beforeEach(() => {
  vi.clearAllMocks();
  limit.mockReset().mockResolvedValue([]);
  membershipRows.mockReset().mockResolvedValue([]);
  where.mockImplementation(() => ({ limit }) as any);
});

describe('canManageAcceptance', () => {
  it('allows personal creators without querying membership', async () => {
    await expect(canManageAcceptance(ctx, row('me', null))).resolves.toBe(true);
    await expect(canManageAcceptance(ctx, row('other', null))).resolves.toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it.each([null, 'viewer', 'unknown'])(
    'denies removed or read-only workspace creators: %s',
    async (role) => {
      limit.mockResolvedValue(role ? [{ role, primaryOwnerId: 'other' }] : []);
      await expect(canManageAcceptance(ctx, row('me', 'ws'))).resolves.toBe(false);
    },
  );

  it.each(['member', 'admin', 'owner'])('allows the active %s creator', async (role) => {
    limit.mockResolvedValue([{ role, primaryOwnerId: 'me' }]);
    await expect(canManageAcceptance(ctx, row('me', 'ws'))).resolves.toBe(true);
  });

  it('allows the primary owner to write another creator record', async () => {
    limit.mockResolvedValue([{ role: 'owner', primaryOwnerId: 'me' }]);
    await expect(canManageAcceptance(ctx, row('other', 'ws'))).resolves.toBe(true);
  });

  it.each(['member', 'admin'])('denies %s edits to another creator record', async (role) => {
    limit.mockResolvedValue([{ role, primaryOwnerId: 'other' }]);
    await expect(canManageAcceptance(ctx, row('other', 'ws'))).resolves.toBe(false);
  });

  it('demotes a legacy non-primary owner before cross-creator authorization', async () => {
    limit.mockResolvedValue([{ role: 'owner', primaryOwnerId: 'primary-owner' }]);
    await expect(canManageAcceptance(ctx, row('other', 'ws'))).resolves.toBe(false);
    await expect(canManageAcceptance(ctx, row('me', 'ws'))).resolves.toBe(true);
  });

  it('fails closed on membership errors', async () => {
    limit.mockRejectedValue(new Error('unavailable'));
    await expect(canManageAcceptance(ctx, row('me', 'ws'))).rejects.toThrow('unavailable');
  });

  it('denies anonymous callers', async () => {
    await expect(canManageAcceptance({ serverDB: db }, row('me', 'ws'))).resolves.toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
});

describe('filterManageableAcceptances', () => {
  beforeEach(() => {
    where.mockImplementation(membershipRows as any);
  });

  it('reads normalized membership for all resource workspaces in one batch', async () => {
    membershipRows.mockResolvedValue([
      { workspaceId: 'owned', role: 'owner', primaryOwnerId: 'me' },
      { workspaceId: 'member', role: 'member', primaryOwnerId: 'other' },
      { workspaceId: 'legacy', role: 'owner', primaryOwnerId: 'other' },
      { workspaceId: 'viewer', role: 'viewer', primaryOwnerId: 'other' },
    ]);
    const rows = [
      row('me', null),
      row('me', 'member'),
      row('other', 'owned'),
      row('other', 'member'),
      row('other', 'legacy'),
      row('me', 'legacy'),
      row('me', 'removed'),
      row('me', 'viewer'),
      row('other', null),
    ];
    await expect(filterManageableAcceptances(ctx, rows)).resolves.toEqual([
      row('me', null),
      row('me', 'member'),
      row('other', 'owned'),
      row('me', 'legacy'),
    ]);
    expect(select).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
    expect(limit).not.toHaveBeenCalled();
  });

  it('does not query for personal-only records', async () => {
    await expect(filterManageableAcceptances(ctx, [row('me', null)])).resolves.toEqual([
      row('me', null),
    ]);
    expect(select).not.toHaveBeenCalled();
  });

  it('fails closed on batch membership lookup errors', async () => {
    membershipRows.mockRejectedValue(new Error('unavailable'));
    await expect(filterManageableAcceptances(ctx, [row('me', 'ws')])).rejects.toThrow(
      'unavailable',
    );
  });

  it('denies anonymous callers', async () => {
    await expect(filterManageableAcceptances({ serverDB: db }, [row('me', 'ws')])).resolves.toEqual(
      [],
    );
    expect(select).not.toHaveBeenCalled();
  });
});
