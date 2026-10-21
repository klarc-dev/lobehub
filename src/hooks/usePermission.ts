import { useTranslation } from 'react-i18next';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';

export interface Permission {
  allowed: boolean;
  /** Localised explanation for a disabled action. */
  reason?: string;
}

export const hasWorkspacePermission = (
  role: string | null | undefined,
  action: string,
): boolean => {
  switch (action) {
    case 'manage_settings':
    case 'manage_provider_key':
    case 'view_billing': {
      return role === 'owner' || role === 'admin';
    }
    case 'edit_others_content': {
      // Cross-member maintenance is an owner capability, not an admin shortcut.
      return role === 'owner';
    }
    case 'create_content':
    case 'edit_own_content': {
      return role === 'owner' || role === 'admin' || role === 'member';
    }
    default: {
      return false;
    }
  }
};

export const usePermission = (action: string): Permission => {
  const workspace = useActiveWorkspace();
  const { t } = useTranslation('error');
  const allowed = !workspace || hasWorkspacePermission(workspace.role, action);
  return { allowed, reason: allowed ? undefined : t('forbidden.desc') };
};
