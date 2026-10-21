// @vitest-environment node
import {
  getWorkspaceRolePermissionCodes,
  PERMISSION_ACTIONS,
  RBAC_PERMISSIONS,
} from '@lobechat/const/rbac';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import { trpc } from '@/libs/trpc/lambda/init';

import {
  withAllRbacPermissions,
  withAnyRbacPermission,
  withRbacPermission,
  withScopedPermission,
} from './rbacPermission';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));

const context = { userId: 'user-1', workspaceId: 'workspace-1' };
const db = {} as Awaited<ReturnType<typeof getServerDB>>;

const callGuard = (
  guard: ReturnType<typeof withRbacPermission>,
  ctx: { userId?: string | null; workspaceId?: string | null; workspaceRole?: string } = context,
) => {
  const router = trpc.router({
    check: trpc.procedure.use(guard).query(({ ctx }) => ({
      role: Reflect.get(ctx, 'workspaceRole'),
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    })),
  });
  return router.createCaller(ctx).check();
};

describe('self-hosted workspace RBAC guards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getServerDB).mockResolvedValue(db);
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('member');
  });

  it.each(['owner', 'admin', 'member', 'viewer'])(
    'matches every catalog code against the %s role matrix',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      const grants = getWorkspaceRolePermissionCodes(role);
      for (const code of Object.values(RBAC_PERMISSIONS)) {
        const result = callGuard(withRbacPermission(code));
        if (grants.includes(code)) {
          await expect(result).resolves.toMatchObject({ role });
        } else {
          await expect(result, `${role}: ${code}`).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
      }
    },
  );

  it.each(['owner', 'admin', 'member', 'viewer'])(
    'matches every scoped action against the %s role matrix',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      const grants = getWorkspaceRolePermissionCodes(role);
      for (const action of Object.values(PERMISSION_ACTIONS)) {
        const result = callGuard(withScopedPermission(action));
        if (grants.includes(`${action}:all`) || grants.includes(`${action}:owner`)) {
          await expect(result).resolves.toMatchObject({ role });
        } else {
          await expect(result, `${role}: ${action}`).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
      }
    },
  );

  it('keeps authenticated personal operations unchanged without querying membership', async () => {
    const guards = [
      withRbacPermission('unknown:personal:operation'),
      withScopedPermission('unknown:personal'),
      withAnyRbacPermission([]),
      withAllRbacPermissions([]),
    ];
    for (const workspaceId of [undefined, null, '', '  ']) {
      for (const guard of guards) {
        await expect(
          callGuard(guard, { userId: context.userId, workspaceId }),
        ).resolves.toMatchObject({ userId: context.userId });
      }
    }
    expect(getServerDB).not.toHaveBeenCalled();
    expect(getActiveWorkspaceMembershipRole).not.toHaveBeenCalled();
  });

  it.each([
    withRbacPermission('agent:read:all'),
    withScopedPermission('agent:read'),
    withAnyRbacPermission(['agent:read:all']),
    withAllRbacPermissions(['agent:read:all']),
  ])('requires authentication even without workspace scope', async (guard) => {
    for (const workspaceId of [undefined, context.workspaceId]) {
      await expect(callGuard(guard, { workspaceId })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    }
    expect(getActiveWorkspaceMembershipRole).not.toHaveBeenCalled();
  });

  it.each([null, 'unknown', 'super_admin'])(
    'rejects inactive, absent or unknown membership (%s) despite a supplied owner role',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      await expect(
        callGuard(withRbacPermission('agent:read:all'), { ...context, workspaceRole: 'owner' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('does not trust a stale owner context after membership downgrade', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('viewer');
    await expect(
      callGuard(withScopedPermission('agent:update'), { ...context, workspaceRole: 'owner' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('revalidates membership on each request and passes the current role downstream', async () => {
    await expect(callGuard(withScopedPermission('agent:update'))).resolves.toMatchObject({
      role: 'member',
    });
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
    await expect(callGuard(withScopedPermission('agent:update'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledTimes(2);
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledWith(db, context);
  });

  it('does not widen owner-scoped member grants to workspace-wide grants', async () => {
    await expect(callGuard(withRbacPermission('agent:update:owner'))).resolves.toMatchObject({
      role: 'member',
    });
    await expect(callGuard(withRbacPermission('agent:update:all'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(callGuard(withRbacPermission('workspace:update:all'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(callGuard(withScopedPermission('ai_provider:update'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('implements any versus all against a single membership lookup', async () => {
    const codes = ['agent:update:owner', 'workspace:update:all'];
    await expect(callGuard(withAnyRbacPermission(codes))).resolves.toMatchObject({
      role: 'member',
    });
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledTimes(1);
    await expect(callGuard(withAllRbacPermissions(codes))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      callGuard(withAllRbacPermissions(['agent:update:owner', 'message:create:owner'])),
    ).resolves.toMatchObject({ role: 'member' });
  });

  it('rejects unknown codes, actions, invalid scopes and empty lists even for workspace owners', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('owner');
    const guards = [
      withRbacPermission('unknown:update:all'),
      withRbacPermission('workspace:update:owner'),
      withRbacPermission('agent:update'),
      withRbacPermission('agent:update:ALL'),
      withScopedPermission('unknown:update'),
      withScopedPermission('agent:update:all'),
      withAnyRbacPermission(['agent:read:all', 'unknown:read:all']),
      withAllRbacPermissions(['agent:read:all', 'unknown:read:all']),
      withAnyRbacPermission([]),
      withAllRbacPermissions([]),
    ];
    for (const guard of guards) {
      await expect(callGuard(guard)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('snapshots permission requirements when installing a guard', async () => {
    const required = ['workspace:update:all'];
    const guard = withAnyRbacPermission(required);
    required.push('agent:update:owner');
    await expect(callGuard(guard)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('uses normalized workspace scope for membership and downstream operations', async () => {
    await expect(
      callGuard(withScopedPermission('agent:update'), {
        ...context,
        workspaceId: '  workspace-1  ',
      }),
    ).resolves.toMatchObject({ role: 'member', workspaceId: context.workspaceId });
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledWith(db, context);
  });

  it('fails closed when membership lookup fails', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(callGuard(withScopedPermission('agent:update'))).rejects.toThrow(
      'database unavailable',
    );
  });
});
