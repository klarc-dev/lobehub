import type { LobeAgentTTSConfig, UserTTSConfig } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { aiProviderService } from '@/services/aiProvider';

export const MAX_SPEECH_LENGTH = 2000;

interface SpeechModel {
  id: string;
  providerId: string;
  type: string;
}

export const resolveSpeechOptions = (
  settings: UserTTSConfig['openAI'],
  models: SpeechModel[],
  agent?: LobeAgentTTSConfig,
) => {
  const enabled = models.filter((model) => model.type === 'tts');
  const selected = settings.ttsModel
    ? enabled.find((model) => model.id === settings.ttsModel)
    : (enabled.find((model) => model.id === 'gpt-realtime-2.1') ?? enabled[0]);

  // Agents materialize the old `alloy` default, so only a custom voice is treated as an override.
  const agentVoice = agent?.voice?.openai === 'alloy' ? undefined : agent?.voice?.openai;

  return {
    model: settings.ttsModel || selected?.id || 'gpt-realtime-2.1',
    provider: settings.provider || selected?.providerId || 'openai',
    voice: agentVoice || settings.voice || 'marin',
  };
};

export const ttsService = {
  async synthesize(
    input: string,
    settings: UserTTSConfig['openAI'],
    agent: LobeAgentTTSConfig | undefined,
    signal: AbortSignal,
  ) {
    if (!input.trim() || input.trim().length > MAX_SPEECH_LENGTH) {
      throw new RangeError('Speech text must contain between 1 and 2000 characters');
    }
    const models = settings.provider
      ? []
      : (await aiProviderService.getAiProviderRuntimeState(true)).enabledAiModels;
    signal.throwIfAborted();
    return lambdaClient.tts.synthesize.mutate(
      { input: input.trim(), ...resolveSpeechOptions(settings, models, agent) },
      { signal },
    );
  },
};
