// @vitest-environment node
import { EventEmitter } from 'node:events';

import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { synthesizeRealtimeSpeech } from './realtimeSpeech';

const state = vi.hoisted(() => ({ connections: [] as any[] }));
vi.mock('openai/realtime/ws', () => ({
  OpenAIRealtimeWS: class extends EventEmitter {
    socket = new EventEmitter() as EventEmitter & { terminate: ReturnType<typeof vi.fn> };
    send = vi.fn();
    constructor(public config: unknown) {
      super();
      this.socket.terminate = vi.fn();
      state.connections.push(this);
    }
  },
}));
const client = new OpenAI({ apiKey: 'test-key' });
const payload = { input: 'Bonjour Joachim.', model: 'gpt-realtime-2.1', voice: 'marin' };
async function start(extra = {}, options = {}) {
  const result = synthesizeRealtimeSpeech(client, { ...payload, ...extra }, options);
  // Dynamic SDK transport import must resolve before emitting server events.
  await vi.waitFor(() => expect(state.connections).toHaveLength(1));
  return { connection: state.connections[0], result };
}
function complete(connection: any, transcript = payload.input, status = 'completed') {
  connection.emit('session.created', {});
  connection.emit('session.updated', {});
  connection.emit('response.output_audio.delta', {
    delta: Buffer.from([1, 0, 2, 0]).toString('base64'),
  });
  connection.emit('response.output_audio_transcript.done', { transcript });
  connection.emit('response.done', { response: { status } });
}
afterEach(() => {
  state.connections.length = 0;
  vi.useRealTimers();
});
describe('Realtime native narration', () => {
  it('returns playable PCM24 WAV only after completed verbatim narration and closes', async () => {
    const { connection, result } = await start();
    complete(connection);
    const wav = Buffer.from(await result);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect([...wav.subarray(44)]).toEqual([1, 0, 2, 0]);
    expect(connection.config.model).toBe('gpt-realtime-2.1');
    expect(connection.send.mock.calls[1][0].response).toMatchObject({
      conversation: 'none',
      max_output_tokens: 4096,
      tools: [],
      output_modalities: ['audio'],
    });
    expect(connection.socket.terminate).toHaveBeenCalledOnce();
  });
  it('returns raw PCM when explicitly requested', async () => {
    const { connection, result } = await start({ response_format: 'pcm' });
    complete(connection);
    expect([...new Uint8Array(await result)]).toEqual([1, 0, 2, 0]);
  });
  it.each(['rewritten narration', ''])(
    'rejects mismatched or absent transcript: %s',
    async (text) => {
      const { connection, result } = await start();
      const assertion = expect(result).rejects.toThrow('verbatim');
      complete(connection, text);
      await assertion;
      expect(connection.socket.terminate).toHaveBeenCalledOnce();
    },
  );
  it('rejects incomplete responses instead of returning truncated audio', async () => {
    const { connection, result } = await start();
    const assertion = expect(result).rejects.toThrow('complete');
    complete(connection, payload.input, 'incomplete');
    await assertion;
  });
  it('rejects early socket closure and sanitizes provider errors', async () => {
    const { connection, result } = await start();
    const assertion = expect(result).rejects.toThrow('connection closed');
    connection.socket.emit('close');
    await assertion;
  });
  it('does not expose provider error bodies', async () => {
    const { connection, result } = await start();
    const assertion = expect(result).rejects.toThrow(/^OpenAI Realtime speech failed$/);
    connection.emit('error', new Error('sensitive provider body'));
    await assertion;
  });
  it('aborts active sessions and rejects pre-aborted calls without connecting', async () => {
    const controller = new AbortController();
    const { connection, result } = await start({}, { signal: controller.signal });
    const assertion = expect(result).rejects.toThrow('aborted');
    controller.abort();
    await assertion;
    expect(connection.socket.terminate).toHaveBeenCalledOnce();
    state.connections.length = 0;
    await expect(
      synthesizeRealtimeSpeech(client, payload, { signal: controller.signal }),
    ).rejects.toThrow('aborted');
    expect(state.connections).toHaveLength(0);
  });
  it('bounds session duration including connection establishment', async () => {
    const { connection, result } = await start();
    vi.useFakeTimers();
    // Existing timer was real, so re-establish with fake timers.
    connection.emit('error', new Error('stop'));
    await result.catch(() => undefined);
    state.connections.length = 0;
    const pending = synthesizeRealtimeSpeech(client, payload);
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(90_001);
    await assertion;
    expect(state.connections[0].socket.terminate).toHaveBeenCalledOnce();
  });
  it('caps accumulated audio before allocation and rejects malformed base64', async () => {
    const { connection, result } = await start();
    const assertion = expect(result).rejects.toThrow('audio');
    connection.emit('response.output_audio.delta', { delta: '*invalid*' });
    await assertion;
  });
  it('rejects oversized output', async () => {
    const { connection, result } = await start();
    const assertion = expect(result).rejects.toThrow('limit');
    connection.emit('response.output_audio.delta', {
      delta: Buffer.alloc(3 * 1024 * 1024 + 2).toString('base64'),
    });
    await assertion;
  });
  it.each([
    { input: '' },
    { input: 'x'.repeat(2001) },
    { voice: 'nova' },
    { speed: 2 },
    { response_format: 'mp3' },
  ])('rejects invalid payload before connecting: %j', async (extra) => {
    await expect(
      synthesizeRealtimeSpeech(client, { ...payload, ...extra } as any),
    ).rejects.toThrow();
    expect(state.connections).toHaveLength(0);
  });
  it('never sends native speech through a gateway', async () => {
    await expect(
      synthesizeRealtimeSpeech(
        new OpenAI({ apiKey: 'test', baseURL: 'https://gateway.example/v1' }),
        payload,
      ),
    ).rejects.toThrow('first-party');
    expect(state.connections).toHaveLength(0);
  });
});
