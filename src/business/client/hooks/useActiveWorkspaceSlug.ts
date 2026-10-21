import { useWorkspaceStore, workspaceSelectors } from '../workspace/store';
import { useActiveWorkspace } from './useActiveWorkspace';

export const getActiveWorkspaceSlug = (): string | null =>
  workspaceSelectors.active(useWorkspaceStore.getState())?.slug ?? null;

export const useActiveWorkspaceSlug = (): string | null => useActiveWorkspace()?.slug ?? null;
