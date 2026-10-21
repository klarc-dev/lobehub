import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canReadAcceptance, resolveReportReadAccess } from './reportReadAccess';

const getMember = vi.hoisted(() => vi.fn());
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function () {
    return { getMember };
  }),
}));

const ctx = { serverDB: {} as any, userId: 'creator' };
const report = { userId: 'creator', visibility: 'private', workspaceId: 'record-workspace' };

describe('report resource-scope authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects a removed creator of a private workspace record without a scope header', async () => {
    getMember.mockResolvedValue(undefined);
    await expect(resolveReportReadAccess(ctx, report)).resolves.toEqual({
      canRead: false,
      isOwner: false,
    });
    await expect(canReadAcceptance(ctx, report)).resolves.toBe(false);
    expect(getMember).toHaveBeenCalledWith('record-workspace', 'creator');
  });

  it.each(['viewer', 'member', 'admin', 'owner'])(
    'allows active %s to read private workspace reports',
    async (role) => {
      getMember.mockResolvedValue({ role });
      await expect(resolveReportReadAccess(ctx, report)).resolves.toEqual({
        canRead: true,
        isOwner: true,
      });
      await expect(resolveReportReadAccess({ ...ctx, userId: 'other' }, report)).resolves.toEqual({
        canRead: true,
        isOwner: false,
      });
    },
  );

  it('does not grant private reads to an unknown role', async () => {
    getMember.mockResolvedValue({ role: 'superadmin' });
    await expect(canReadAcceptance(ctx, report)).resolves.toBe(false);
  });

  it('preserves public sharing but strips removed creator owner privileges', async () => {
    getMember.mockResolvedValue(undefined);
    await expect(
      resolveReportReadAccess(ctx, { ...report, visibility: 'public' }),
    ).resolves.toEqual({
      canRead: true,
      isOwner: false,
    });
  });

  it('allows anonymous public links and rejects private ones', async () => {
    const anonymous = { serverDB: ctx.serverDB };
    await expect(resolveReportReadAccess(anonymous, report)).resolves.toEqual({
      canRead: false,
      isOwner: false,
    });
    await expect(
      resolveReportReadAccess(anonymous, { ...report, visibility: 'public' }),
    ).resolves.toEqual({ canRead: true, isOwner: false });
    expect(getMember).not.toHaveBeenCalled();
  });

  it('preserves personal owner reads without requiring workspace membership', async () => {
    await expect(resolveReportReadAccess(ctx, { ...report, workspaceId: null })).resolves.toEqual({
      canRead: true,
      isOwner: true,
    });
    expect(getMember).not.toHaveBeenCalled();
  });

  it('propagates database failures instead of restoring owner access', async () => {
    const error = new Error('membership unavailable');
    getMember.mockRejectedValue(error);
    await expect(resolveReportReadAccess(ctx, report)).rejects.toBe(error);
  });
});
