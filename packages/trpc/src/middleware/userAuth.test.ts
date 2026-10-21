import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext } from '@/libs/trpc/lambda/context';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { trpc } from '../lambda/init';
import { userAuth } from './userAuth';

const membership = vi.hoisted(() => vi.fn());
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/models/workspace', () => ({
  getActiveWorkspaceMembershipRole: membership,
}));

const appRouter = trpc.router({
  protectedQuery: trpc.procedure.use(userAuth).query(async ({ ctx }) => {
    return ctx.userId;
  }),
  scope: trpc.procedure.use(userAuth).query(({ ctx }) => ({
    role: ctx.workspaceRole,
    workspaceId: ctx.workspaceId,
  })),
});

const createCaller = createCallerFactory(appRouter);
let ctx: AuthContext;
let router: ReturnType<typeof createCaller>;

beforeEach(async () => {
  vi.resetAllMocks();
});

describe('userAuth middleware', () => {
  it.each([null, 'unknown', 'superadmin'])(
    'rejects absent or unknown membership %s',
    async (role) => {
      membership.mockResolvedValue(role);
      const caller = createCaller(
        await createContextInner({ userId: 'user-id', workspaceId: 'other' }),
      );
      await expect(caller.scope()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(['viewer', 'member', 'admin', 'owner'])('preserves validated %s scope', async (role) => {
    membership.mockResolvedValue(role);
    const caller = createCaller(
      await createContextInner({ userId: 'user-id', workspaceId: 'team' }),
    );
    await expect(caller.scope()).resolves.toEqual({ role, workspaceId: 'team' });
    expect(membership).toHaveBeenCalledWith({}, { userId: 'user-id', workspaceId: 'team' });
  });

  it('revalidates membership on each request after revocation', async () => {
    membership.mockResolvedValueOnce('member').mockResolvedValueOnce(null);
    const caller = createCaller(
      await createContextInner({ userId: 'user-id', workspaceId: 'team' }),
    );
    await expect(caller.scope()).resolves.toEqual({ role: 'member', workspaceId: 'team' });
    await expect(caller.scope()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('should throw UNAUTHORIZED error if userId is not present in context', async () => {
    ctx = await createContextInner();
    router = createCaller(ctx);

    try {
      await router.protectedQuery();
    } catch (e) {
      expect(e).toEqual(new TRPCError({ code: 'UNAUTHORIZED' }));
    }
  });

  it('should call next with userId in context if userId is present', async () => {
    ctx = await createContextInner({ userId: 'user-id' });
    router = createCaller(ctx);

    const data = await router.protectedQuery();

    expect(data).toEqual('user-id');
  });
});
