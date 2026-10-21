import { useWorkspaceStore, workspaceSelectors } from '../workspace/store';

export const getActiveWorkspaceId = (): string | null =>
  workspaceSelectors.active(useWorkspaceStore.getState())?.id ?? null;

export const useActiveWorkspaceId = (): string | null =>
  useWorkspaceStore(workspaceSelectors.activeId);
