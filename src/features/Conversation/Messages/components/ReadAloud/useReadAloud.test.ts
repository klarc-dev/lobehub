// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReadAloud } from './useReadAloud';

vi.mock('@/services/tts', () => ({ MAX_SPEECH_LENGTH: 2000 }));

const result = { audioBase64: btoa('wave'), mimeType: 'audio/wav' };
let audio: {
  load: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  audio = {
    load: vi.fn(),
    onended: null,
    onerror: null,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    removeAttribute: vi.fn(),
  };
  vi.stubGlobal(
    'Audio',
    vi.fn(function () {
      return audio;
    }),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:speech');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useReadAloud', () => {
  it('plays generated audio then stops and releases its object URL', async () => {
    const synthesize = vi.fn().mockResolvedValue(result);
    const onError = vi.fn();
    const { result: hook } = renderHook(() => useReadAloud(' Bonjour ! ', synthesize, onError));
    await act(() => hook.current.toggle());
    expect(hook.current.state).toBe('playing');
    expect(synthesize.mock.calls[0][0]).toBe('Bonjour !');
    expect(audio.play).toHaveBeenCalledOnce();
    await act(() => hook.current.toggle());
    expect(hook.current.state).toBe('idle');
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:speech');
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['ended', 'error'] as const)('releases audio on %s', async (event) => {
    const onError = vi.fn();
    const { result: hook } = renderHook(() =>
      useReadAloud('Hello', vi.fn().mockResolvedValue(result), onError),
    );
    await act(() => hook.current.toggle());
    act(() => audio[event === 'ended' ? 'onended' : 'onerror']?.());
    expect(hook.current.state).toBe('idle');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(event === 'error' ? 1 : 0);
  });

  it('cancels a pending request without playing a late response', async () => {
    let resolve!: (value: typeof result) => void;
    const synthesize = vi.fn(
      () =>
        new Promise<typeof result>((r) => {
          resolve = r;
        }),
    );
    const { result: hook } = renderHook(() => useReadAloud('Hello', synthesize, vi.fn()));
    let pending: Promise<void>;
    act(() => {
      pending = hook.current.toggle();
    });
    expect(hook.current.state).toBe('loading');
    await act(() => hook.current.toggle());
    expect(synthesize.mock.calls[0][1].aborted).toBe(true);
    await act(async () => {
      resolve(result);
      await pending;
    });
    expect(audio.play).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('releases playback when unmounted or text changes', async () => {
    const {
      result: hook,
      rerender,
      unmount,
    } = renderHook(({ text }) => useReadAloud(text, vi.fn().mockResolvedValue(result), vi.fn()), {
      initialProps: { text: 'Hello' },
    });
    await act(() => hook.current.toggle());
    rerender({ text: 'Changed' });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toBe('idle');
    await act(() => hook.current.toggle());
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it.each([
    [2001, 'tooLong'],
    [0, 'empty'],
  ] as const)('rejects %i characters without truncation', async (length, error) => {
    const synthesize = vi.fn();
    const onError = vi.fn();
    const { result: hook } = renderHook(() =>
      useReadAloud('x'.repeat(length), synthesize, onError),
    );
    await act(() => hook.current.toggle());
    expect(onError).toHaveBeenCalledWith(error);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('accepts exactly 2000 characters', async () => {
    const synthesize = vi.fn().mockResolvedValue(result);
    const { result: hook, unmount } = renderHook(() =>
      useReadAloud('x'.repeat(2000), synthesize, vi.fn()),
    );
    await act(() => hook.current.toggle());
    expect(synthesize.mock.calls[0][0]).toHaveLength(2000);
    unmount();
  });

  it('times out pending synthesis and permits retry', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const synthesize = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(result);
    const { result: hook, unmount } = renderHook(() => useReadAloud('Hello', synthesize, onError));
    act(() => {
      void hook.current.toggle();
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(hook.current.state).toBe('idle');
    expect(onError).toHaveBeenCalledWith('failed');
    expect(synthesize.mock.calls[0][1].aborted).toBe(true);
    await act(() => hook.current.toggle());
    expect(hook.current.state).toBe('playing');
    unmount();
  });

  it('reports rejected playback and releases the URL', async () => {
    audio.play.mockRejectedValue(new Error('Autoplay blocked'));
    const onError = vi.fn();
    const { result: hook } = renderHook(() =>
      useReadAloud('Hello', vi.fn().mockResolvedValue(result), onError),
    );
    await act(() => hook.current.toggle());
    expect(hook.current.state).toBe('idle');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('failed');
  });
});
