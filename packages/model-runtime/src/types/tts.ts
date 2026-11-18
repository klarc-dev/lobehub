export interface TextToSpeechPayload {
  input: string;
  model: string;
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  speed?: number;
  voice: string;
}

export interface TextToSpeechOptions {
  headers?: Record<string, any>;
  signal?: AbortSignal;
  /**
   * userId for the embeddings
   */
  user?: string;
}
