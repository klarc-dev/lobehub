'use client';

import { Avatar, Button, Flexbox, Input, Select, Tag, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import {
  useIsWorkspaceAdmin,
  useIsWorkspaceOwner,
} from '@/business/client/hooks/useIsWorkspaceOwner';
import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { workspaceService } from '@/services/workspace';

export default function WorkspaceMembers() {
  const { t } = useTranslation('common');
  const workspaceId = useActiveWorkspaceId();
  const canManage = useIsWorkspaceAdmin();
  const isOwner = useIsWorkspaceOwner();
  const response = useFetchWorkspaceMembers();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Flexbox gap={16}>
      <Text as={'h2'}>{t('selfHostedWorkspace.members')}</Text>
      {canManage ? (
        <Flexbox gap={8}>
          <Text type={'secondary'}>{t('selfHostedWorkspace.registeredOnly')}</Text>
          <Input
            aria-label={t('selfHostedWorkspace.email')}
            placeholder={t('selfHostedWorkspace.email')}
            type={'email'}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select
            aria-label={t('selfHostedWorkspace.members')}
            value={role}
            options={(isOwner ? ['member', 'viewer', 'admin'] : ['member', 'viewer']).map(
              (value) => ({
                label: t(`selfHostedWorkspace.role.${value}` as 'selfHostedWorkspace.role.member'),
                value,
              }),
            )}
            onChange={(value) => {
              if (value === 'admin' || value === 'member' || value === 'viewer') setRole(value);
            }}
          />
          {error ? <AsyncError error={error} variant={'inline'} /> : null}
          <Button
            disabled={!email.trim() || !workspaceId}
            loading={pending}
            type={'primary'}
            onClick={async () => {
              if (!workspaceId) return;
              setPending(true);
              setError(undefined);
              try {
                await workspaceService.addMember(workspaceId, { email: email.trim(), role });
                setEmail('');
                await response.mutate();
              } catch (cause) {
                setError(cause);
              } finally {
                setPending(false);
              }
            }}
          >
            {t('selfHostedWorkspace.addMember')}
          </Button>
        </Flexbox>
      ) : (
        <Text type={'secondary'}>{t('selfHostedWorkspace.readOnly')}</Text>
      )}
      <AsyncBoundary
        data={response.data}
        empty={<Text>{t('selfHostedWorkspace.noMembers')}</Text>}
        error={response.error}
        isEmpty={response.data?.length === 0}
        isLoading={response.isLoading}
        onRetry={() => void response.mutate()}
      >
        <Flexbox gap={12}>
          {response.data?.map((member) => (
            <Flexbox horizontal align={'center'} gap={12} key={member.userId}>
              <Avatar
                size={32}
                avatar={
                  member.user?.avatar ||
                  member.user?.fullName ||
                  member.user?.username ||
                  member.userId
                }
              />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Text ellipsis>
                  {member.user?.fullName ||
                    member.user?.username ||
                    member.user?.email ||
                    member.userId}
                </Text>
                <Text ellipsis type={'secondary'}>
                  {member.user?.email}
                </Text>
              </Flexbox>
              <Tag>
                {t(`selfHostedWorkspace.role.${member.role}` as 'selfHostedWorkspace.role.member')}
              </Tag>
            </Flexbox>
          ))}
        </Flexbox>
      </AsyncBoundary>
    </Flexbox>
  );
}
