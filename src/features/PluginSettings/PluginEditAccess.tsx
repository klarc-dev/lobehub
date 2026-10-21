import type { LobeTool } from '@lobechat/types';
import { Alert, Button, Flexbox, Skeleton } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

import { usePluginForEdit } from './usePluginForEdit';

interface PluginEditAccessProps {
  children: (plugin: LobeTool) => ReactNode;
  enabled?: boolean;
  fallback?: LobeTool;
  id: string;
}

/** Never seed an editable form from the workspace inventory projection. */
export const PluginEditAccess = ({
  children,
  enabled = true,
  fallback,
  id,
}: PluginEditAccessProps) => {
  const workspaceId = useActiveWorkspaceId();
  const { data, error, mutate } = usePluginForEdit(id, enabled);
  const { t } = useTranslation('common');
  if (!enabled) return null;
  if (workspaceId && error) {
    return (
      <Flexbox gap={12}>
        <Alert title={error.message} type="error" />
        <Button onClick={() => mutate()}>{t('retry')}</Button>
      </Flexbox>
    );
  }
  const plugin = workspaceId ? data : fallback;
  if (!plugin) return <Skeleton />;
  return children(plugin);
};
