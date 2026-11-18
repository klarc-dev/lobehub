import { afterEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { aiProviderService } from '@/services/aiProvider';

import { resolveSpeechOptions, ttsService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { tts: { synthesize: { mutate: vi.fn() } } },
}));
vi.mock('@/services/aiProvider', () => ({
  aiProviderService: { getAiProviderRuntimeState: vi.fn() },
}));

const models = [
  { id: 'chat', providerId: 'openai', type: 'chat' },
  { id: 'tts-1', providerId: 'legacy', type: 'tts' },
  { id: 'gpt-realtime-2.1', providerId: 'openai-audio', type: 'tts' },
];

afterEach(() => vi.clearAllMocks());

describe('native speech selection', () => {
  it('honors explicit model/provider and agent voice over user voice', () => {
    expect(
      resolveSpeechOptions({ provider: 'personal', ttsModel: 'my-tts', voice: 'marin' }, models, {
        ttsService: 'openai',
        voice: { openai: 'cedar' },
      }),
    ).toEqual({ model: 'my-tts', provider: 'personal', voice: 'cedar' });
    expect(
      resolveSpeechOptions({ ttsModel: 'my-tts', voice: 'marin' }, [], {
        ttsService: 'openai',
        voice: { openai: 'alloy' },
      }).voice,
    ).toBe('marin');
  });

  it('discovers the enabled provider for the chosen model', () => {
    expect(resolveSpeechOptions({ ttsModel: 'tts-1' }, models)).toEqual({
      model: 'tts-1',
      provider: 'legacy',
      voice: 'marin',
    });
  });

  it('prefers realtime when no model was chosen, then another enabled TTS model', () => {
    expect(resolveSpeechOptions({ ttsModel: '' }, models).provider).toBe('openai-audio');
    expect(resolveSpeechOptions({ ttsModel: '' }, models.slice(0, 2)).model).toBe('tts-1');
    expect(resolveSpeechOptions({ ttsModel: '' }, [])).toEqual({
      model: 'gpt-realtime-2.1',
      provider: 'openai',
      voice: 'marin',
    });
  });

  it('does not replace unsupported explicit preferences', () => {
    expect(resolveSpeechOptions({ ttsModel: 'unsupported' }, models).model).toBe('unsupported');
  });
});

describe('authenticated TTS service', () => {
  it('uses native TRPC, preserving input and mimeType', async () => {
    const output = { audioBase64: 'AA==', format: 'wav', mimeType: 'audio/wav' };
    vi.mocked(lambdaClient.tts.synthesize.mutate).mockResolvedValue(output);
    const signal = new AbortController().signal;
    expect(
      await ttsService.synthesize(
        'Bonjour !',
        {
          provider: 'openai-audio',
          ttsModel: 'gpt-realtime-2.1',
          voice: 'marin',
        },
        undefined,
        signal,
      ),
    ).toEqual(output);
    expect(lambdaClient.tts.synthesize.mutate).toHaveBeenCalledWith(
      {
        input: 'Bonjour !',
        model: 'gpt-realtime-2.1',
        provider: 'openai-audio',
        voice: 'marin',
      },
      { signal },
    );
    expect(aiProviderService.getAiProviderRuntimeState).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(2001)])(
    'rejects invalid length before requesting audio',
    async (input) => {
      await expect(
        ttsService.synthesize(
          input,
          { ttsModel: 'tts-1' },
          undefined,
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(RangeError);
      expect(lambdaClient.tts.synthesize.mutate).not.toHaveBeenCalled();
    },
  );

  it('does not send audio requests after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      ttsService.synthesize(
        'hello',
        { provider: 'openai-audio', ttsModel: 'gpt-realtime-2.1' },
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(lambdaClient.tts.synthesize.mutate).not.toHaveBeenCalled();
  });
});
