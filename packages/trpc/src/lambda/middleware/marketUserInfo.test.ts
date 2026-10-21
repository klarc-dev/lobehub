import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveMarketUserContext } from './marketUserInfo';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  getSettings: vi.fn(),
  membership: vi.fn(),
}));

vi.mock('@/database/models/workspace', () => ({
  getActiveWorkspaceMembershipRole: mocks.membership,
}));
vi.mock('@/database/models/user', () => {
  class UserModel {
    static findById = mocks.findUser;
    getUserSettings = mocks.getSettings;
  }
  return { UserModel };
});

const db = {} as any;
const context = { serverDB: db, userId: 'user', workspaceId: 'team' };

describe('resolveMarketUserContext workspace trust', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findUser.mockResolvedValue({ email: 'member@example.com', fullName: 'Member' });
    mocks.getSettings.mockResolvedValue({});
  });

  it.each([null, 'unknown', 'superadmin'])(
    'rejects missing or invalid membership %s before building identity',
    async (role) => {
      mocks.membership.mockResolvedValue(role);
      await expect(resolveMarketUserContext(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.findUser).not.toHaveBeenCalled();
    },
  );

  it.each(['viewer', 'member', 'admin', 'owner'])('allows active %s membership', async (role) => {
    mocks.membership.mockResolvedValue(role);
    await expect(resolveMarketUserContext(context)).resolves.toMatchObject({
      marketUserInfo: { userId: 'user', workspaceId: 'team' },
    });
    expect(mocks.membership).toHaveBeenCalledWith(db, { userId: 'user', workspaceId: 'team' });
  });

  it('rechecks scope after membership is revoked', async () => {
    mocks.membership.mockResolvedValueOnce('member').mockResolvedValueOnce(null);
    await resolveMarketUserContext(context);
    await expect(resolveMarketUserContext(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.findUser).toHaveBeenCalledTimes(1);
  });

  it('does not swallow membership lookup errors into anonymous identity', async () => {
    const error = new Error('database unavailable');
    mocks.membership.mockRejectedValue(error);
    await expect(resolveMarketUserContext(context)).rejects.toBe(error);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it('rejects anonymous scoped requests', async () => {
    await expect(
      resolveMarketUserContext({ serverDB: db, workspaceId: 'team' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects scoped identity when membership cannot be queried', async () => {
    await expect(
      resolveMarketUserContext({ userId: 'user', workspaceId: 'team' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('preserves anonymous personal discovery', async () => {
    await expect(resolveMarketUserContext({})).resolves.toEqual({ marketUserInfo: undefined });
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it('does not include workspace claims in personal identity', async () => {
    const result = await resolveMarketUserContext({ serverDB: db, userId: 'user' });
    expect(result.marketUserInfo).not.toHaveProperty('workspaceId');
    expect(mocks.membership).not.toHaveBeenCalled();
  });
});
