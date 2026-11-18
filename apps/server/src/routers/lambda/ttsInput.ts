import { z } from 'zod';

export const synthesizeInput = z
  .object({
    input: z.string().trim().min(1).max(2000),
    model: z.string().min(1).default('gpt-realtime-2.1'),
    provider: z.string().min(1).default('openai'),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
    speed: z.number().min(0.25).max(4).optional(),
    voice: z.string().min(1).default('marin'),
  })
  .transform((input) => ({
    ...input,
    response_format:
      input.response_format ?? (input.model.startsWith('gpt-realtime-') ? 'wav' : 'mp3'),
  }));

export const speechMimeType = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  pcm: 'audio/pcm',
  wav: 'audio/wav',
} as const;
