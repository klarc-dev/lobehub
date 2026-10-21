// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceMembershipRole } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

import {
  assertWorkspaceExecutionAllowed,
  WorkspaceExecutionDeniedError,
} from './workspaceExecutionAuthorization';

vi.mock('@/database/models/workspace', () => ({ getActiveWorkspaceMembershipRole: vi.fn() }));
const db = {} as LobeChatDatabase;
const scope = { db, userId: 'user', workspaceId: 'workspace' };

beforeEach(() => vi.clearAllMocks());

describe('live workspace execution authorization', () => {
  it.each(['member', 'admin', 'owner'])('allows active %s', async (role) => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
    await expect(assertWorkspaceExecutionAllowed(scope)).resolves.toBeUndefined();
  });
  it.each(['viewer', 'inactive', 'unknown', null])('denies %s', async (role) => {
    vi.mocked(getActiveWorkspaceMembershipRole).mockResolvedValue(role);
    await expect(assertWorkspaceExecutionAllowed(scope)).rejects.toBeInstanceOf(
      WorkspaceExecutionDeniedError,
    );
  });
  it('does not retain an earlier successful decision', async () => {
    vi.mocked(getActiveWorkspaceMembershipRole)
      .mockResolvedValueOnce('member')
      .mockResolvedValueOnce(null);
    await assertWorkspaceExecutionAllowed(scope);
    await expect(assertWorkspaceExecutionAllowed(scope)).rejects.toBeInstanceOf(
      WorkspaceExecutionDeniedError,
    );
    expect(getActiveWorkspaceMembershipRole).toHaveBeenCalledTimes(2);
  });
  it('fails closed on missing identity, DB, invalid scope and DB outage', async () => {
    for (const invalid of [
      { workspaceId: 'workspace' },
      { db, workspaceId: 'workspace' },
      { ...scope, workspaceId: ' ' },
    ]) {
      await expect(assertWorkspaceExecutionAllowed(invalid)).rejects.toBeInstanceOf(
        WorkspaceExecutionDeniedError,
      );
    }
    vi.mocked(getActiveWorkspaceMembershipRole).mockRejectedValue(new Error('DB unavailable'));
    await expect(assertWorkspaceExecutionAllowed(scope)).rejects.toThrow('DB unavailable');
  });
  it('leaves personal execution independent of workspace membership', async () => {
    await assertWorkspaceExecutionAllowed({});
    await assertWorkspaceExecutionAllowed({ workspaceId: null });
    expect(getActiveWorkspaceMembershipRole).not.toHaveBeenCalled();
  });
});
