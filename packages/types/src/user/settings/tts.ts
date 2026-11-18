export interface UserTTSConfig {
  openAI: {
    provider?: string;
    ttsModel: string;
    voice?: string;
  };
}
