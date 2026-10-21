import { useWorkspaceStore, workspaceSelectors } from '../workspace/store';

export const useIsWorkspaceLoading = (): boolean =>
  !useWorkspaceStore(workspaceSelectors.initialized);
