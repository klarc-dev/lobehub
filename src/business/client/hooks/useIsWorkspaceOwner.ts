import { useActiveWorkspace } from './useActiveWorkspace';

export const useIsWorkspaceOwner = (): boolean => useActiveWorkspace()?.role === 'owner';

export const useIsWorkspaceAdmin = (): boolean => {
  const role = useActiveWorkspace()?.role;
  return role === 'owner' || role === 'admin';
};
