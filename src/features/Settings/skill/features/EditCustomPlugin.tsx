import isEqual from 'fast-deep-equal';
import { memo, type ReactNode } from 'react';

import CustomConnectorModal from '@/features/Connectors/CustomConnectorModal';
import { PluginEditAccess } from '@/features/PluginSettings/PluginEditAccess';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

interface EditCustomPluginProps {
  children: ReactNode;
  identifier: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/**
 * "Configure" entry for a legacy `user_installed_plugins` custom MCP row.
 *
 * As of the connector rewrite, saving here promotes the legacy plugin to a
 * `user_connectors` row via {@link CustomConnectorModal}'s migration mode. The
 * legacy table is only touched (deleted) AFTER the connector + tool sync both
 * succeed, so cancelling or hitting a transient MCP error leaves the user with
 * the working legacy plugin untouched.
 */
const EditCustomPlugin = memo<EditCustomPluginProps>(
  ({ identifier, open, onOpenChange, children }) => {
    const legacyPlugin = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <PluginEditAccess enabled={open} fallback={legacyPlugin} id={identifier}>
          {(plugin) => (
            <CustomConnectorModal
              open={open}
              legacyPlugin={{
                ...plugin,
                customParams: plugin.customParams ?? undefined,
                manifest: plugin.manifest ?? undefined,
                type: 'customPlugin',
              }}
              onClose={() => onOpenChange(false)}
              onEditSuccess={() => onOpenChange(false)}
            />
          )}
        </PluginEditAccess>
        {children}
      </div>
    );
  },
);

export default EditCustomPlugin;
