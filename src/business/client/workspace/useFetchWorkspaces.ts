'use client';

import { useLayoutEffect } from 'react';
import useSWR from 'swr';

import { workspaceService } from '@/services/workspace';

import { useActiveWorkspaceId } from '../hooks/useActiveWorkspaceId';
import { useWorkspaceStore, workspaceActions } from './store';

// Membership inventory is account scoped, never augmented by active workspace.
export const useFetchWorkspaces = (
  userId: string | undefined,
  pathname: string,
  identityLoaded = true,
) => {
  const response = useSWR(userId ? ['workspaceList', userId] : null, workspaceService.list, {
    onSuccess: (workspaces) => {
      if (userId) workspaceActions.resolve(userId, workspaces, pathname);
    },
    revalidateOnMount: true,
  });
  useLayoutEffect(() => {
    const previous = useWorkspaceStore.getState();
    if (previous.userId !== (userId ?? null)) {
      if (previous.userId) {
        // Account changes must discard all legacy requests and caches too.
        window.location.reload();
        return;
      }
      workspaceActions.reset(userId ?? null);
    }
    if (!userId && identityLoaded) useWorkspaceStore.setState({ initialized: true });
    if (userId && response.data && useWorkspaceStore.getState().initialized) {
      workspaceActions.resolve(userId, response.data, pathname);
    }
  }, [userId, response.data, pathname, identityLoaded]);
  return response;
};

export const useFetchMembers = (includeDeleted = false) => {
  const workspaceId = useActiveWorkspaceId();
  const userId = useWorkspaceStore((s) => s.userId);
  const response = useSWR(
    userId && workspaceId ? ['workspaceMembers', userId, workspaceId, includeDeleted] : null,
    () => workspaceService.members(workspaceId!, includeDeleted),
  );
  useLayoutEffect(() => {
    if (userId && workspaceId && response.data && !includeDeleted) {
      workspaceActions.setMembers(userId, workspaceId, response.data);
    }
  }, [userId, workspaceId, response.data, includeDeleted]);
  return response;
};
