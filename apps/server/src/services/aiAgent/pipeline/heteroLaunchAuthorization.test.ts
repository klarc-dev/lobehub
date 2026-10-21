// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';

import {
  authorizeHeteroDeviceLaunch,
  authorizeHeteroSandboxLaunch,
} from './heteroLaunchAuthorization';

vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({ signUserJWT: vi.fn() }));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: vi.fn(),
}));
const scope = { db: {} as LobeChatDatabase, userId: 'user', workspaceId: 'workspace' };
let role: string | null;
beforeEach(() => {
  vi.clearAllMocks();
  role = 'member';
  vi.mocked(getActiveWorkspaceMembershipRole).mockImplementation(async () => role);
});

describe('heterogeneous launch authorization', () => {
  it('rechecks content membership after device preflight even for personal device addressing', async () => {
    vi.mocked(resolveDeviceDispatchAuthorizationFailure).mockImplementation(async () => {
      role = null;
      return undefined;
    });
    await expect(authorizeHeteroDeviceLaunch(scope, 'device', undefined)).rejects.toThrow(
      'membership required',
    );
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledWith(scope.db, {
      userId: 'user',
      workspaceId: 'workspace',
    });
  });
  it('blocks sandbox launch when membership disappears during JWT setup', async () => {
    vi.mocked(signUserJWT).mockImplementation(async () => {
      role = null;
      return 'token';
    });
    await expect(authorizeHeteroSandboxLaunch(scope)).rejects.toThrow('membership required');
  });
  it('preserves authorized and personal launch preflight results', async () => {
    vi.mocked(resolveDeviceDispatchAuthorizationFailure).mockResolvedValue(undefined);
    vi.mocked(signUserJWT).mockResolvedValue('token');
    await expect(
      authorizeHeteroDeviceLaunch(scope, 'device', 'workspace'),
    ).resolves.toBeUndefined();
    await expect(authorizeHeteroSandboxLaunch(scope)).resolves.toBe('token');
    role = null;
    await expect(authorizeHeteroSandboxLaunch({ ...scope, workspaceId: undefined })).resolves.toBe(
      'token',
    );
  });
});
