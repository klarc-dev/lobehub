import type { UserTTSConfig } from '@lobechat/types';

export const DEFAULT_TTS_CONFIG: UserTTSConfig = {
  openAI: {
    provider: 'openai-audio',
    ttsModel: 'gpt-realtime-2.1',
    voice: 'marin',
  },
};
