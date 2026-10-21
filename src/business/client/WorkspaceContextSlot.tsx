'use client';

import { Center, Spin } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceSyncPathname } from '@/features/Workspace/useWorkspaceSyncPathname';
import {
  isWorkspaceSlugCandidatePath,
  useWorkspaceUrlSync,
} from '@/features/Workspace/useWorkspaceUrlSync';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import { useActiveWorkspace } from './hooks/useActiveWorkspace';
import { useIsWorkspaceLoading } from './hooks/useIsWorkspaceLoading';
import { useWorkspaceStore } from './workspace/store';
import { useFetchMembers, useFetchWorkspaces } from './workspace/useFetchWorkspaces';

const WorkspaceMembersSync = () => {
  useFetchMembers();
  return null;
};

export default function WorkspaceContextSlot({ children }: PropsWithChildren) {
  const userId = useUserStore(userProfileSelectors.userId);
  const isLoaded = useUserStore(authSelectors.isLoaded);
  const pathname = useWorkspaceSyncPathname();
  const { data, error, isValidating, mutate } = useFetchWorkspaces(userId, pathname, isLoaded);
  const isLoading = useIsWorkspaceLoading();
  const active = useActiveWorkspace();
  const inventoryUserId = useWorkspaceStore((s) => s.userId);
  useWorkspaceUrlSync();

  const candidate = isWorkspaceSlugCandidatePath(pathname);
  const target = data?.find((workspace) => workspace.slug === pathname.split('/')[1]);
  // A new URL must not mount consumers under the old scope even for one render.
  const mismatch =
    inventoryUserId !== (userId ?? null) ||
    (candidate ? (target?.id ?? null) !== (active?.id ?? null) : active !== null);

  if (userId && error && (!data || isLoading)) {
    return <AsyncError error={error} retrying={isValidating} onRetry={() => void mutate()} />;
  }
  if ((!isLoaded && candidate) || (userId && (isLoading || mismatch))) {
    return (
      <Center height={'100%'}>
        <Spin />
      </Center>
    );
  }
  return (
    <>
      <WorkspaceMembersSync />
      {children}
    </>
  );
}
