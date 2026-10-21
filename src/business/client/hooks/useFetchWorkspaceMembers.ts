import { useFetchMembers } from '../workspace/useFetchWorkspaces';

export interface FetchWorkspaceMembersOptions {
  includeDeleted?: boolean;
}

export const useFetchWorkspaceMembers = (options: FetchWorkspaceMembersOptions = {}) =>
  useFetchMembers(options.includeDeleted);
