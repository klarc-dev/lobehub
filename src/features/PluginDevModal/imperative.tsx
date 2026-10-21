'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { mountImperative } from '@/components/ImperativeMount';
import { PluginEditAccess } from '@/features/PluginSettings/PluginEditAccess';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import DevModal from '.';

interface PluginEditDrawerProps {
  identifier: string;
  onClose: () => void;
  open: boolean;
}

const PluginEditDrawer = memo<PluginEditDrawerProps>(({ identifier, onClose, open }) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const value = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);
  const [uninstallPlugin, installCustomPlugin, updateNewCustomPlugin] = useToolStore((s) => [
    s.uninstallCustomPlugin,
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
  ]);

  return (
    <PluginEditAccess enabled={open} fallback={value} id={identifier}>
      {(plugin) => (
        <DevModal
          mode={'edit'}
          open={open}
          value={{
            ...plugin,
            customParams: plugin.customParams ?? undefined,
            manifest: plugin.manifest ?? undefined,
            type: 'customPlugin',
          }}
          onValueChange={updateNewCustomPlugin}
          onDelete={() => {
            if (!canEdit) return;
            uninstallPlugin(identifier);
            onClose();
          }}
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
          onSave={async (devPlugin) => {
            if (!canEdit) return;
            await installCustomPlugin(devPlugin);
            onClose();
          }}
        />
      )}
    </PluginEditAccess>
  );
});

PluginEditDrawer.displayName = 'PluginEditDrawer';

export const openPluginEditDrawer = (identifier: string) =>
  mountImperative(({ close, open }) => (
    <PluginEditDrawer identifier={identifier} open={open} onClose={close} />
  ));
