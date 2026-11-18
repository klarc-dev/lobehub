import { useEffect, useRef, useState } from 'react';

import { MAX_SPEECH_LENGTH } from '@/services/tts';

interface SpeechAudio {
  audioBase64: string;
  mimeType: string;
}

interface Playback {
  audio?: HTMLAudioElement;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  url?: string;
}

type PlaybackState = 'idle' | 'loading' | 'playing';
type PlaybackError = 'empty' | 'tooLong' | 'failed';

export const useReadAloud = (
  text: string,
  synthesize: (text: string, signal: AbortSignal) => Promise<SpeechAudio>,
  onError: (error: PlaybackError) => void,
) => {
  const [state, setState] = useState<PlaybackState>('idle');
  const active = useRef<Playback | null>(null);

  const release = () => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.controller.abort();
    if (current.audio) {
      current.audio.onended = null;
      current.audio.onerror = null;
      current.audio.pause();
      current.audio.removeAttribute('src');
      current.audio.load();
    }
    if (current.url) URL.revokeObjectURL(current.url);
  };

  useEffect(() => {
    setState('idle');
    return release;
  }, [text]);

  const toggle = async () => {
    if (active.current) {
      release();
      setState('idle');
      return;
    }
    const content = text.trim();
    if (!content) return onError('empty');
    if (content.length > MAX_SPEECH_LENGTH) return onError('tooLong');

    const current: Playback = { controller: new AbortController() };
    active.current = current;
    setState('loading');
    const finish = (failed = false) => {
      if (active.current !== current) return;
      release();
      setState('idle');
      if (failed) onError('failed');
    };
    current.timer = setTimeout(() => finish(true), 60_000);
    try {
      const result = await synthesize(content, current.controller.signal);
      if (active.current !== current) return;
      const bytes = Uint8Array.from(atob(result.audioBase64), (char) => char.charCodeAt(0));
      current.url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      current.audio = new Audio(current.url);
      current.audio.onended = () => finish();
      current.audio.onerror = () => finish(true);
      await current.audio.play();
      if (active.current !== current) return;
      clearTimeout(current.timer);
      setState('playing');
    } catch {
      // Do not surface provider payloads, which can contain private request details.
      finish(true);
    }
  };

  return { state, toggle };
};
