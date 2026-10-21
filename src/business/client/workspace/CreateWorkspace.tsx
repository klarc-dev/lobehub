'use client';

import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';
import { Button, createModal, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { workspaceService } from '@/services/workspace';

const CreateWorkspaceForm = () => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const valid =
    name.trim().length > 0 &&
    slug.length >= WORKSPACE_SLUG_MIN &&
    slug.length <= WORKSPACE_SLUG_MAX &&
    isWorkspaceSlugFormatValid(slug);
  return (
    <Flexbox gap={16}>
      <Text>{t('selfHostedWorkspace.privacy')}</Text>
      <Input
        aria-label={t('selfHostedWorkspace.name')}
        maxLength={255}
        placeholder={t('selfHostedWorkspace.name')}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        aria-label={t('selfHostedWorkspace.slug')}
        maxLength={WORKSPACE_SLUG_MAX}
        placeholder={t('selfHostedWorkspace.slug')}
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
      />
      {error ? <AsyncError error={error} variant={'inline'} /> : null}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={pending} onClick={close}>
          {t('cancel')}
        </Button>
        <Button
          disabled={!valid}
          loading={pending}
          type={'primary'}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              const workspace = await workspaceService.create({ name: name.trim(), slug });
              // A fresh document prevents old personal requests from populating workspace stores.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign(`/${encodeURIComponent(workspace.slug)}`);
            } catch (cause) {
              setError(cause);
            } finally {
              setPending(false);
            }
          }}
        >
          {t('selfHostedWorkspace.create')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export const openCreateWorkspace = () =>
  createModal({
    content: <CreateWorkspaceForm />,
    footer: null,
    title: t('selfHostedWorkspace.create', { ns: 'common' }),
    width: 'min(92vw, 480px)',
  });
