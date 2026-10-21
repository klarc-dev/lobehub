/**
 * userId → display profile for the members of the active workspace.
 *
 * Business slot. In personal mode (and in OSS, which has no workspace concept)
 * this is an empty map, so a home surface that resolves a topic's triggerer
 * through it simply renders no author — degrading to the personal inbox with no
 * extra branching. The cloud override fills it from the workspace member store.
 *
 * A workspace topic already carries `userId` (its creator / triggerer); this is
 * the client-side lookup that turns that id into a face and a name.
 */
import { useMemo } from 'react';

import { useWorkspaceMembers } from './useWorkspaceMembers';

export interface WorkspaceMemberProfile {
  avatar?: string | null;
  fullName?: string | null;
  username?: string | null;
}

export const useWorkspaceMemberProfiles = (): ReadonlyMap<string, WorkspaceMemberProfile> => {
  const members = useWorkspaceMembers();
  return useMemo(
    () =>
      new Map(
        members
          .filter((member) => !member.deletedAt)
          .map((member) => [member.userId, member.user ?? {}]),
      ),
    [members],
  );
};
