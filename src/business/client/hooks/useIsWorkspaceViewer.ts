import { useActiveWorkspace } from './useActiveWorkspace';

export const useIsWorkspaceViewer = (): boolean => useActiveWorkspace()?.role === 'viewer';
