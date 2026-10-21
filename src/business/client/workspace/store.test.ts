import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceListItem } from '../hooks/useActiveWorkspace';
import { getActiveWorkspaceId } from '../hooks/useActiveWorkspaceId';
import { useIsWorkspaceAdmin, useIsWorkspaceOwner } from '../hooks/useIsWorkspaceOwner';
import { useIsWorkspaceViewer } from '../hooks/useIsWorkspaceViewer';
import { getWorkspaceMembers } from '../hooks/useWorkspaceMembers';
import { getBusinessTrpcHeaders } from '../trpc-headers';
import { useWorkspaceStore, workspaceActions, workspaceSelectors } from './store';

const workspace = (id: string, role: string): WorkspaceListItem => ({
  id,
  slug: id,
  name: id,
  role,
  primaryOwnerId: 'owner',
  avatar: null,
  description: null,
  settings: {},
  frozen: false,
  frozenAt: null,
  frozenReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

beforeEach(() => workspaceActions.reset('user'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('self-hosted workspace state', () => {
  it('uses fresh documents for A to B to personal without mutating in-flight request scope', async () => {
    const assign = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { assign, reload } });
    const inventory = [workspace('team-a', 'owner'), workspace('team-b', 'member')];
    workspaceActions.resolve('user', inventory, '/team-a');
    await workspaceActions.switchWorkspace('team-b');
    expect(assign).toHaveBeenCalledWith('/team-b');
    expect(await getBusinessTrpcHeaders()).toEqual({ 'X-Workspace-Id': 'team-a' });
    workspaceActions.reset('user');
    workspaceActions.resolve('user', inventory, '/team-b');
    expect(await getBusinessTrpcHeaders()).toEqual({ 'X-Workspace-Id': 'team-b' });
    await workspaceActions.switchToPersonal();
    expect(assign).toHaveBeenCalledWith('/');
    workspaceActions.reset('user');
    workspaceActions.resolve('user', inventory, '/');
    expect(await getBusinessTrpcHeaders()).toEqual({});
  });

  it('reloads on passive scope changes and membership removal rather than reusing old stores', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    workspaceActions.resolve('user', [workspace('team', 'member')], '/team');
    workspaceActions.resolve('user', [], '/team');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('never selects a workspace merely because the user belongs to one', async () => {
    workspaceActions.resolve('user', [workspace('team', 'owner')], '/');
    expect(getActiveWorkspaceId()).toBeNull();
    expect(await getBusinessTrpcHeaders()).toEqual({});
  });

  it('resolves a cold workspace deep link only from authenticated membership', async () => {
    expect(useWorkspaceStore.getState().initialized).toBe(false);
    workspaceActions.resolve('user', [workspace('team', 'member')], '/team/settings/connector');
    expect(getActiveWorkspaceId()).toBe('team');
    expect(await getBusinessTrpcHeaders()).toEqual({ 'X-Workspace-Id': 'team' });
    expect(useWorkspaceStore.getState().initialized).toBe(true);
  });

  it('does not trust missing, removed or stale-user memberships', () => {
    workspaceActions.resolve('old-user', [workspace('team', 'owner')], '/team');
    expect(useWorkspaceStore.getState().initialized).toBe(false);
    workspaceActions.resolve('user', [], '/team');
    expect(getActiveWorkspaceId()).toBeNull();
    expect(workspaceSelectors.active(useWorkspaceStore.getState())).toBeNull();
  });

  it.each(['owner', 'admin', 'member', 'viewer'])(
    'derives %s permissions from backend membership',
    (role) => {
      workspaceActions.resolve('user', [workspace('team', role)], '/team');
      const { result } = renderHook(() => ({
        owner: useIsWorkspaceOwner(),
        admin: useIsWorkspaceAdmin(),
        viewer: useIsWorkspaceViewer(),
      }));
      expect(result.current).toEqual({
        owner: role === 'owner',
        admin: role === 'owner' || role === 'admin',
        viewer: role === 'viewer',
      });
      act(() => workspaceActions.reset());
      expect(result.current).toEqual({ owner: false, admin: false, viewer: false });
    },
  );

  it('ignores late member responses after account or workspace changes', () => {
    workspaceActions.resolve('user', [workspace('team', 'member')], '/team');
    const members = [
      {
        workspaceId: 'team',
        userId: 'user',
        role: 'member',
        joinedAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ];
    workspaceActions.setMembers('user', 'team', members);
    expect(getWorkspaceMembers()).toEqual(members);
    workspaceActions.reset('next-user');
    workspaceActions.setMembers('user', 'team', members);
    expect(getWorkspaceMembers()).toEqual([]);
    expect(getActiveWorkspaceId()).toBeNull();
    workspaceActions.resolve('next-user', [workspace('other', 'viewer')], '/other');
    workspaceActions.setMembers('next-user', 'team', members);
    expect(getWorkspaceMembers()).toEqual([]);
  });

  it('rejects explicit switches to inaccessible workspaces', async () => {
    await expect(workspaceActions.switchWorkspace('unknown')).rejects.toThrow('membership');
    expect(getActiveWorkspaceId()).toBeNull();
  });
});
