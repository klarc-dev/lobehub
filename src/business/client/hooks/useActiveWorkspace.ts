import type { WorkspaceItem } from '@lobechat/database/schemas';

import { useWorkspaceStore, workspaceSelectors } from '../workspace/store';

export type WorkspaceListItem = WorkspaceItem & {
  /**
   * True when the caller is a non-primary member of a workspace whose paid
   * subscription has lapsed. The cloud override of `workspace.list` sets it;
   * open-source stub leaves it absent.
   */
  lockedOut?: boolean;
  plan?: string;
  role?: string | null;
};

export const useActiveWorkspace = (): WorkspaceListItem | null =>
  useWorkspaceStore(workspaceSelectors.active);
