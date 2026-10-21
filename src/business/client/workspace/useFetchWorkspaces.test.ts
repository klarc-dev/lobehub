import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceListItem } from '../hooks/useActiveWorkspace';
import { useWorkspaceStore, workspaceActions } from './store';
import { useFetchWorkspaces } from './useFetchWorkspaces';

const mocks = vi.hoisted(() => ({
  response: { data: undefined as WorkspaceListItem[] | undefined, error: undefined as unknown },
  success: undefined as ((data: WorkspaceListItem[]) => void) | undefined,
}));
vi.mock('swr', () => ({
  default: (
    _key: unknown,
    _fetcher: unknown,
    options: { onSuccess?: (data: WorkspaceListItem[]) => void } = {},
  ) => {
    mocks.success = options.onSuccess;
    return mocks.response;
  },
}));
vi.mock('@/services/workspace', () => ({ workspaceService: { list: vi.fn(), members: vi.fn() } }));

beforeEach(() => {
  workspaceActions.reset();
  mocks.response = { data: undefined, error: undefined };
});
afterEach(() => cleanup());

describe('workspace inventory lifecycle', () => {
  it('does not treat persisted inventory as authoritative before the network confirms membership', () => {
    mocks.response.data = [];
    renderHook(() => useFetchWorkspaces('user', '/team'));
    expect(useWorkspaceStore.getState().userId).toBe('user');
    expect(useWorkspaceStore.getState().initialized).toBe(false);
    act(() => mocks.success?.([]));
    expect(useWorkspaceStore.getState().initialized).toBe(true);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });

  it('returns request failures without settling them as an empty inventory', () => {
    const error = new Error('Network unavailable');
    mocks.response.error = error;
    const { result } = renderHook(() => useFetchWorkspaces('user', '/team'));
    expect(result.current.error).toBe(error);
    expect(useWorkspaceStore.getState().initialized).toBe(false);
  });

  it('settles signed-out personal mode without calling an authenticated inventory', () => {
    renderHook(() => useFetchWorkspaces(undefined, '/', true));
    expect(useWorkspaceStore.getState().initialized).toBe(true);
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
  });
});
