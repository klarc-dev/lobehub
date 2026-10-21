'use client';

import { Button, Flexbox, Select, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useSwitchWorkspace } from '@/business/client/hooks/useSwitchWorkspace';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { openCreateWorkspace } from '@/business/client/workspace/CreateWorkspace';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

interface UserPanelWorkspaceSectionProps {
  onSwitch?: () => void;
}

export default function UserPanelWorkspaceSection({ onSwitch }: UserPanelWorkspaceSectionProps) {
  const { t } = useTranslation('common');
  const workspaces = useWorkspaces();
  const active = useActiveWorkspace();
  const signedIn = useUserStore(authSelectors.isLogin);
  const { switchToPersonal, switchWorkspace } = useSwitchWorkspace();
  if (!signedIn) return null;
  return (
    <Flexbox gap={8} padding={12}>
      <Text type={'secondary'}>{t('selfHostedWorkspace.title')}</Text>
      <Select
        aria-label={t('selfHostedWorkspace.title')}
        style={{ width: '100%' }}
        value={active?.id ?? 'personal'}
        options={[
          { label: t('selfHostedWorkspace.personal'), value: 'personal' },
          ...workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id })),
        ]}
        onChange={(id) => {
          onSwitch?.();
          if (id === 'personal') void switchToPersonal();
          else if (typeof id === 'string') void switchWorkspace(id);
        }}
      />
      {active && (
        <Button
          onClick={() => {
            onSwitch?.();
            // Document navigation intentionally preserves the scope-switch isolation contract.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign(`/${encodeURIComponent(active.slug)}/settings/general`);
          }}
        >
          {t('userPanel.workspaceSetting')}
        </Button>
      )}
      <Button
        onClick={() => {
          onSwitch?.();
          openCreateWorkspace();
        }}
      >
        {t('selfHostedWorkspace.create')}
      </Button>
    </Flexbox>
  );
}
