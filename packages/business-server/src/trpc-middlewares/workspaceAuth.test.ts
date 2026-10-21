// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { getActiveWorkspaceMembershipRole, WorkspaceModel } from '@/database/models/workspace';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import type { LambdaContext } from '@/libs/trpc/lambda/context';

import {
  cloudWorkspaceAuth,
  lobeWorkspaceAuth,
  requireWorkspaceRole,
  requireWorkspaceRoleWhenScoped,
  type WorkspaceRole,
  wsAdminProcedure,
  wsCompatProcedure,
  wsMemberProcedure,
  wsOwnerProcedure,
  wsProcedure,
} from './workspaceAuth';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({
  getActiveWorkspaceMembershipRole: vi.fn(),
  WorkspaceModel: vi.fn(),
}));

const testRouter = router({
  admin: wsAdminProcedure.query(({ ctx }) => ctx.workspaceId),
  compat: wsCompatProcedure.query(({ ctx }) => ({
    apiKeyScopes: ctx.apiKeyScopes,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    workspaceSlug: ctx.workspaceSlug,
  })),
  member: wsMemberProcedure.query(({ ctx }) => ctx.workspaceId),
  owner: wsOwnerProcedure.query(({ ctx }) => ctx.workspaceId),
  publicCompat: publicProcedure.use(cloudWorkspaceAuth).query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
    workspaceSlug: ctx.workspaceSlug,
  })),
  roleContext: publicProcedure.use(cloudWorkspaceAuth).query(({ ctx }) => ctx.workspaceRole),
  rawStrict: publicProcedure.use(lobeWorkspaceAuth).query(({ ctx }) => ctx.workspaceId),
  scopedAdmin: publicProcedure
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .query(({ ctx }) => ctx.workspaceId),
  strict: wsProcedure.query(({ ctx }) => ctx.workspaceId),
  strictAdmin: authedProcedure
    .use(requireWorkspaceRole('admin'))
    .query(({ ctx }) => ctx.workspaceId),
});

const caller = (context: LambdaContext = {}) => testRouter.createCaller(context);
const scopedContext = { userId: 'user-1', workspaceId: 'workspace-1' };
const findById = vi.fn();
const roles: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];
const strictBuilders = ['strict', 'member', 'admin', 'owner', 'rawStrict', 'strictAdmin'] as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getServerDB).mockResolvedValue({} as Awaited<ReturnType<typeof getServerDB>>);
  vi.mocked(WorkspaceModel).mockImplementation(function () {
    return { findById } as WorkspaceModel;
  });
  findById.mockResolvedValue({ id: 'workspace-1', slug: 'trusted-team' });
  vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('member');
});

describe('workspace authentication', () => {
  it('rejects an unverified client scope instead of exposing workspace data', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
    await expect(caller(scopedContext).compat()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(roles)('exposes the verified %s role to downstream permission checks', async (role) => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
    await expect(caller(scopedContext).roleContext()).resolves.toBe(role);
  });

  it('clears forged role and slug values on personal calls', async () => {
    const forged = { userId: 'user-1', workspaceRole: 'owner', workspaceSlug: 'forged' };
    await expect(caller(forged).roleContext()).resolves.toBeUndefined();
    await expect(caller(forged).compat()).resolves.toMatchObject({ workspaceSlug: undefined });
  });

  it('returns the canonical workspace slug from the database', async () => {
    await expect(caller(scopedContext).compat()).resolves.toEqual({
      apiKeyScopes: undefined,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceSlug: 'trusted-team',
    });
  });

  it.each([undefined, null, '', '   '])(
    'keeps %s scope personal without database access',
    async (workspaceId) => {
      await expect(caller({ userId: 'user-1', workspaceId }).compat()).resolves.toEqual({
        apiKeyScopes: undefined,
        userId: 'user-1',
        workspaceId: undefined,
        workspaceSlug: undefined,
      });
      expect(getServerDB).not.toHaveBeenCalled();
    },
  );

  it('normalizes workspace ids before validation', async () => {
    await expect(
      caller({ ...scopedContext, workspaceId: ' workspace-1 ' }).compat(),
    ).resolves.toMatchObject({ workspaceId: 'workspace-1' });
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledWith(expect.anything(), scopedContext);
    expect(findById).toHaveBeenCalledWith('workspace-1');
  });

  it('retains anonymous personal compatibility for public message and market procedures', async () => {
    await expect(caller().publicCompat()).resolves.toEqual({
      workspaceId: undefined,
      workspaceSlug: undefined,
    });
    expect(getServerDB).not.toHaveBeenCalled();
  });

  it.each(['compat', 'publicCompat', 'scopedAdmin', ...strictBuilders] as const)(
    '%s rejects anonymous workspace access before accessing the database',
    async (procedure) => {
      await expect(caller({ workspaceId: 'workspace-1' })[procedure]()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(getServerDB).not.toHaveBeenCalled();
    },
  );

  it.each(strictBuilders)('%s requires a nonblank workspace scope', async (procedure) => {
    await expect(caller({ userId: 'user-1', workspaceId: ' ' })[procedure]()).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
  });

  it.each(['compat', 'publicCompat', 'scopedAdmin', ...strictBuilders] as const)(
    '%s rejects a deleted or nonexistent workspace',
    async (procedure) => {
      findById.mockResolvedValue(undefined);
      await expect(caller(scopedContext)[procedure]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it.each(['compat', 'publicCompat', 'scopedAdmin', ...strictBuilders] as const)(
    '%s rejects absent or soft-deleted membership',
    async (procedure) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
      await expect(caller(scopedContext)[procedure]()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(['inactive', 'custom-admin', '', '__proto__', 'constructor'])(
    'fails closed for unknown role %s',
    async (role) => {
      vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
      await expect(caller(scopedContext).compat()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('propagates database failure instead of falling back to personal data', async () => {
    vi.mocked(getServerDB).mockRejectedValue(new Error('Database unavailable'));
    await expect(caller(scopedContext).compat()).rejects.toThrow('Database unavailable');
  });

  it('does not trust a caller-supplied elevated role or slug', async () => {
    const forged = { ...scopedContext, workspaceRole: 'owner', workspaceSlug: 'forged' };
    await expect(caller(forged).admin()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(forged).compat()).resolves.toMatchObject({ workspaceSlug: 'trusted-team' });
  });
});

describe('workspace role hierarchy', () => {
  const minimums = { admin: 'admin', member: 'member', owner: 'owner', strict: 'viewer' } as const;

  for (const role of roles) {
    for (const [procedure, minimum] of Object.entries(minimums)) {
      it(`${procedure} ${roles.indexOf(role) >= roles.indexOf(minimum) ? 'allows' : 'denies'} ${role}`, async () => {
        vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
        const result = caller(scopedContext)[procedure as keyof typeof minimums]();
        if (roles.indexOf(role) >= roles.indexOf(minimum)) {
          await expect(result).resolves.toBe('workspace-1');
        } else {
          await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
      });
    }
  }

  it('uses normalized database ownership, not a legacy co-owner label', async () => {
    // getActiveWorkspaceMembershipRole demotes non-primary legacy owners to admin.
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('admin');
    await expect(caller(scopedContext).admin()).resolves.toBe('workspace-1');
    await expect(caller(scopedContext).owner()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('checks live membership again when a caller is reused after role revocation', async () => {
    const request = caller(scopedContext);
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('owner');
    await expect(request.owner()).resolves.toBe('workspace-1');
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
    await expect(request.owner()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows authenticated personal calls through conditional role guards', async () => {
    await expect(caller({ userId: 'user-1' }).scopedAdmin()).resolves.toBeUndefined();
    expect(getServerDB).not.toHaveBeenCalled();
  });

  it('does not let a conditional role guard authenticate an anonymous personal call', async () => {
    await expect(caller().scopedAdmin()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('requires the minimum role when the conditional guard is used without prior auth middleware', async () => {
    await expect(caller(scopedContext).scopedAdmin()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue('admin');
    await expect(caller(scopedContext).scopedAdmin()).resolves.toBe('workspace-1');
  });
});

describe('API-key compatibility', () => {
  it.each([null, ['*']])(
    'preserves %s full-access keys but still checks the issuer role',
    async (apiKeyScopes) => {
      const request = caller({ ...scopedContext, apiKeyScopes });
      await expect(request.compat()).resolves.toMatchObject({ apiKeyScopes });
      await expect(request.admin()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('retains API-key capability denial alongside workspace access checks', async () => {
    await expect(caller({ ...scopedContext, apiKeyScopes: [] }).compat()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects revoked workspace API-key issuers even for full-access keys', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(null);
    await expect(caller({ ...scopedContext, apiKeyScopes: null }).compat()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
