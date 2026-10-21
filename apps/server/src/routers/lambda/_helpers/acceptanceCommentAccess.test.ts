import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAcceptanceCommentAccess } from './acceptanceCommentAccess';

const membership = vi.hoisted(() => vi.fn());
vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: membership }));

const id = '61a3475e-52b5-4a58-8ccc-e3ba43062c7a';
const base = { id, userId: 'creator', visibility: 'private', workspaceId: 'record-workspace' };
const limit = vi.fn();
const db = {
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })),
} as any;

beforeEach(() => {
  vi.resetAllMocks();
  limit.mockResolvedValue([base]);
});

describe('acceptance discussion workspace authority', () => {
  it('denies a revoked creator access to private comments without a workspace header', async () => {
    membership.mockResolvedValue(null);
    await expect(resolveAcceptanceCommentAccess(db, 'creator', id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(membership).toHaveBeenCalledWith(db, {
      userId: 'creator',
      workspaceId: 'record-workspace',
    });
  });

  it('allows public-link comments but not approval or agent signing for a revoked creator', async () => {
    membership.mockResolvedValue(null);
    limit.mockResolvedValue([{ ...base, visibility: 'public' }]);
    await expect(resolveAcceptanceCommentAccess(db, 'creator', id)).resolves.toMatchObject({
      canApprove: false,
      canComment: true,
      isOwner: false,
      memberOfWorkspaceId: undefined,
    });
  });

  it('keeps viewer creators read-only on private discussion', async () => {
    membership.mockResolvedValue('viewer');
    await expect(resolveAcceptanceCommentAccess(db, 'creator', id)).resolves.toMatchObject({
      canApprove: false,
      canComment: false,
      memberOfWorkspaceId: undefined,
    });
  });

  it.each(['member', 'admin', 'owner'])(
    'allows active %s discussion participation',
    async (role) => {
      membership.mockResolvedValue(role);
      await expect(resolveAcceptanceCommentAccess(db, 'creator', id)).resolves.toMatchObject({
        canApprove: true,
        canComment: true,
        isOwner: true,
        memberOfWorkspaceId: 'record-workspace',
      });
    },
  );

  it('propagates lookup failures without granting creator authority', async () => {
    membership.mockRejectedValue(new Error('unavailable'));
    await expect(resolveAcceptanceCommentAccess(db, 'creator', id)).rejects.toThrow('unavailable');
  });

  it('preserves personal creator participation', async () => {
    limit.mockResolvedValue([{ ...base, workspaceId: null }]);
    await expect(resolveAcceptanceCommentAccess(db, 'creator', id)).resolves.toMatchObject({
      canApprove: true,
      canComment: true,
      isOwner: true,
    });
    expect(membership).not.toHaveBeenCalled();
  });
});
