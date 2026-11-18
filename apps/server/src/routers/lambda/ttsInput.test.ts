import { describe, expect, it } from 'vitest';

import { speechMimeType, synthesizeInput } from './ttsInput';

describe('native synthesis input', () => {
  it('defaults to full quality Realtime with a playable WAV and marin', () => {
    const input = synthesizeInput.parse({ input: 'Bonjour.' });
    expect(input).toMatchObject({
      model: 'gpt-realtime-2.1',
      voice: 'marin',
      response_format: 'wav',
      provider: 'openai',
    });
    expect(speechMimeType[input.response_format]).toBe('audio/wav');
  });
  it('accepts a custom provider id such as openai-audio with WAV output', () => {
    const input = synthesizeInput.parse({ input: 'Bonjour.', provider: 'openai-audio' });
    expect(input.provider).toBe('openai-audio');
    expect(speechMimeType[input.response_format]).toBe('audio/wav');
  });
  it('preserves legacy MP3 default and explicit raw PCM', () => {
    expect(
      synthesizeInput.parse({ input: 'Hello', model: 'gpt-4o-mini-tts' }).response_format,
    ).toBe('mp3');
    expect(synthesizeInput.parse({ input: 'Hello', response_format: 'pcm' }).response_format).toBe(
      'pcm',
    );
  });
  it.each(['', ' ', 'x'.repeat(2001)])('rejects empty or oversized text', (input) => {
    expect(synthesizeInput.safeParse({ input }).success).toBe(false);
  });
});
