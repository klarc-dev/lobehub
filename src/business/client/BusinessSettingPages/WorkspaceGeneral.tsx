'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useIsWorkspaceAdmin } from '@/business/client/hooks/useIsWorkspaceOwner';
import AsyncError from '@/components/AsyncError';
import { workspaceService } from '@/services/workspace';

export default function WorkspaceGeneral() {
  const workspace = useActiveWorkspace();
  const canManage = useIsWorkspaceAdmin();
  const { t } = useTranslation('common');
  const [name, setName] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!workspace) return null;
  return (
    <Flexbox gap={16}>
      <Text as={'h2'}>{workspace.name}</Text>
      <Text>{t('selfHostedWorkspace.privacy')}</Text>
      {!canManage && <Text>{t('selfHostedWorkspace.readOnly')}</Text>}
      <Input
        aria-label={t('selfHostedWorkspace.name')}
        disabled={!canManage}
        maxLength={255}
        value={name ?? workspace.name}
        onChange={(event) => setName(event.target.value)}
      />
      <Text type={'secondary'}>/{workspace.slug}</Text>
      {error ? <AsyncError error={error} variant={'inline'} /> : null}
      {canManage && (
        <Button
          disabled={!name?.trim()}
          loading={pending}
          type={'primary'}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              await workspaceService.update(workspace.id, { name: name!.trim() });
              window.location.reload();
            } catch (cause) {
              setError(cause);
            } finally {
              setPending(false);
            }
          }}
        >
          {t('save')}
        </Button>
      )}
    </Flexbox>
  );
}
