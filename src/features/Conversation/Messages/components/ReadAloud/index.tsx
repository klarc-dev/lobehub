import { ActionIcon, toast } from '@lobehub/ui';
import { LoaderCircle, Square, Volume2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ttsService } from '@/services/tts';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { cleanBotPromptTags } from '@/store/chat/utils/parseReferencedMessage';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { contextSelectors, useConversationStore } from '../../../store';
import { useReadAloud } from './useReadAloud';

export const ReadAloud = memo<{ text: string }>(({ text }) => {
  const { t } = useTranslation('chat');
  const agentId = useConversationStore(contextSelectors.agentId);
  const agent = useAgentStore((s) => agentSelectors.getAgentConfigById(agentId || '')(s)?.tts);
  const settings = useUserStore(settingsSelectors.currentTTS);
  const { state, toggle } = useReadAloud(
    cleanBotPromptTags(text),
    (input, signal) => ttsService.synthesize(input, settings.openAI, agent, signal),
    (error) => toast.error({ id: 'message-read-aloud-error', title: t(`readAloud.${error}`) }),
  );
  const active = state !== 'idle';
  const label = t(active ? 'readAloud.stop' : 'readAloud.play');

  return (
    <ActionIcon
      active={active}
      aria-busy={state === 'loading'}
      aria-label={label}
      aria-pressed={active}
      data-testid="message-read-aloud"
      icon={state === 'loading' ? LoaderCircle : active ? Square : Volume2}
      size={'small'}
      spin={state === 'loading'}
      title={state === 'loading' ? t('readAloud.loading') : label}
      onClick={toggle}
    />
  );
});

ReadAloud.displayName = 'ReadAloud';
