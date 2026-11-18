import { describe, expect, it } from 'vitest';

import { getTranscriptionLanguage } from './transcriptionLanguage';

describe('transcription language contract', () => {
  it.each(['gpt-transcribe', 'gpt-transcribe-2026-10-01'])('uses languages for %s', (model) => {
    expect(getTranscriptionLanguage(model, 'fr')).toEqual({ languages: ['fr'] });
  });
  it.each(['gpt-4o-transcribe', 'whisper-1', 'whisper-large-v3'])(
    'preserves legacy language for %s',
    (model) => {
      expect(getTranscriptionLanguage(model, 'fr')).toEqual({ language: 'fr' });
    },
  );
  it('does not send an unspecified language', () => {
    expect(getTranscriptionLanguage('gpt-transcribe')).toEqual({});
  });
});
