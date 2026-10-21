import { create } from 'zustand';

import type { WorkspaceListItem } from '../hooks/useActiveWorkspace';
import type { WorkspaceMemberWithProfile } from '../hooks/useWorkspaceMembers';

interface WorkspaceState {
  activeWorkspaceId: string | null;
  initialized: boolean;
  members: Record<string, WorkspaceMemberWithProfile[]>;
  userId: string | null;
  workspaces: WorkspaceListItem[];
}

const initialState: WorkspaceState = {
  activeWorkspaceId: null,
  initialized: false,
  members: {},
  userId: null,
  workspaces: [],
};

export const useWorkspaceStore = create<WorkspaceState>()(() => initialState);

export const workspaceSelectors = {
  active: (s: WorkspaceState) =>
    s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId) ?? null,
  activeId: (s: WorkspaceState) => s.activeWorkspaceId,
  activeMembers: (s: WorkspaceState) => s.members[s.activeWorkspaceId ?? ''] ?? EMPTY_MEMBERS,
  initialized: (s: WorkspaceState) => s.initialized,
  workspaces: (s: WorkspaceState) => s.workspaces,
};

const EMPTY_MEMBERS: WorkspaceMemberWithProfile[] = [];

export const workspaceActions = {
  reset: (userId: string | null = null) => {
    useWorkspaceStore.setState({ ...initialState, userId });
  },
  resolve: (userId: string, workspaces: WorkspaceListItem[], pathname: string) => {
    const state = useWorkspaceStore.getState();
    if (state.userId !== userId) return;
    const slug = pathname.split('/')[1];
    const activeWorkspaceId = workspaces.find((workspace) => workspace.slug === slug)?.id ?? null;
    // Membership revocation must not leave old scoped data mounted. A document
    // transition also discards pending legacy store writes from the old scope.
    if (state.initialized && state.activeWorkspaceId !== activeWorkspaceId) {
      window.location.reload();
      return;
    }
    useWorkspaceStore.setState({ activeWorkspaceId, initialized: true, workspaces });
  },
  setMembers: (userId: string, workspaceId: string, members: WorkspaceMemberWithProfile[]) => {
    const state = useWorkspaceStore.getState();
    if (state.userId !== userId || state.activeWorkspaceId !== workspaceId) return;
    useWorkspaceStore.setState({ members: { ...state.members, [workspaceId]: members } });
  },
  switchToPersonal: async () => {
    window.location.assign('/');
  },
  switchWorkspace: async (id: string) => {
    const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === id);
    if (!workspace) throw new Error('Workspace membership is unavailable');
    // Do not mutate the header while old requests and stores are still alive.
    // The destination boot resolves its scope from the URL and fresh membership.
    window.location.assign(`/${encodeURIComponent(workspace.slug)}`);
  },
  reconcilePersonal: async () => {
    if (useWorkspaceStore.getState().activeWorkspaceId !== null) window.location.reload();
  },
  reconcileWorkspace: async (id: string) => {
    const state = useWorkspaceStore.getState();
    if (state.activeWorkspaceId !== id && state.workspaces.some((item) => item.id === id)) {
      window.location.reload();
    }
  },
};
