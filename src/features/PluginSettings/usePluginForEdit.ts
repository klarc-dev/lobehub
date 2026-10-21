import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { pluginService } from '@/services/plugin';

/** Detail data stays local to the editor, never in the shared plugin replica. */
export const usePluginForEdit = (id: string, enabled = true) => {
  const workspaceId = useActiveWorkspaceId();
  return useClientDataSWR(
    enabled && workspaceId ? ['pluginForEdit', workspaceId, id] : null,
    () => pluginService.getPluginForEdit(id),
    { revalidateOnFocus: true },
  );
};
