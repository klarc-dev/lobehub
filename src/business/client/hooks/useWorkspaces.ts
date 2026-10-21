import { useWorkspaceStore, workspaceSelectors } from '../workspace/store';
import type { WorkspaceListItem } from './useActiveWorkspace';

export const useWorkspaces = (): WorkspaceListItem[] =>
  useWorkspaceStore(workspaceSelectors.workspaces);
