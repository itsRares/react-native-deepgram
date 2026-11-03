import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { useDeepgramTextToSpeech } from '../useDeepgramTextToSpeech';
import type {
  UseDeepgramTextToSpeechProps,
  UseDeepgramTextToSpeechReturn,
} from '../types';
import NativeDeepgram from '../NativeDeepgram';
import { clearCachedAuthToken } from '../helpers/auth';
import { MockWebSocket, installMockWebSocket } from '../../jest/mockWebSocket';

let hookApi: UseDeepgramTextToSpeechReturn;
let harnessProps: UseDeepgramTextToSpeechProps = {};

function Harness(): null {
  hookApi = useDeepgramTextToSpeech(harnessProps);
  return null;
}

const mockFetch = jest.fn();

const audioResponse = (bytes: number[], contentType = 'audio/mpeg') => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
  text: async () => '',
  headers: { get: () => contentType },
});

describe('useDeepgramTextToSpeech', () => {
  beforeAll(() => {
    installMockWebSocket();
    (globalThis as unknown as { fetch: unknown }).fetch = mockFetch;
  });

  beforeEach(() => {
    MockWebSocket.reset();
    jest.clearAllMocks();
    mockFetch.mockReset();
    harnessProps = {};
  });

  it('streams: opens the speak socket, sends Speak + Flush and plays audio', async () => {
    const onStreamStart = jest.fn();
    const onAudioChunk = jest.fn();
    const onStreamEnd = jest.fn();
    harnessProps = { onStreamStart, onAudioChunk, onStreamEnd };
    await render(createElement(Harness));

    await act(async () => {
      await hookApi.startStreaming('Hello there');
    });
    const socket = MockWebSocket.last();
    const url = new URL(socket.url);
    expect(url.pathname).toBe('/v1/speak');
    expect(url.searchParams.get('model')).toBe('aura-2-asteria-en');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('24000');

    await act(() => {
      socket.onopen?.();
      socket.onmessage?.({ data: new Uint8Array([1, 2, 3, 4]).buffer });
    });
    expect(NativeDeepgram!.startPlayer).toHaveBeenCalledWith(24000, 1);
    expect(socket.sentJson()).toEqual([
      { type: 'Speak', text: 'Hello there' },
      { type: 'Flush' },
    ]);
    expect(NativeDeepgram!.feedAudio).toHaveBeenCalledWith('AQIDBA==');
    expect(onAudioChunk).toHaveBeenCalledTimes(1);
    expect(onStreamStart).toHaveBeenCalledTimes(1);

    await act(() => {
      socket.onclose?.({ code: 1000 });
    });
    expect(onStreamEnd).toHaveBeenCalledTimes(1);
    expect(NativeDeepgram!.stopPlayer).toHaveBeenCalled();
  });

  it('routes stream control messages to callbacks', async () => {
    const onStreamFlushed = jest.fn();
    const onStreamError = jest.fn();
    harnessProps = { onStreamFlushed, onStreamError };
    await render(createElement(Harness));
    await act(async () => {
      await hookApi.startStreaming('Hi');
    });
    const socket = MockWebSocket.last();

    await act(() => {
      socket.serverJson({ type: 'Flushed', sequence_id: 0 });
      socket.serverJson({ type: 'Error', description: 'quota' });
    });

    expect(onStreamFlushed).toHaveBeenCalledWith({
      type: 'Flushed',
      sequence_id: 0,
    });
    expect(onStreamError.mock.calls[0][0].message).toBe('quota');
  });

  it('does not open a stream that was stopped while auth was resolving', async () => {
    const g = globalThis as { __DEEPGRAM_GET_TOKEN__?: unknown };
    let release: (result: { token: string }) => void = () => {};
    g.__DEEPGRAM_GET_TOKEN__ = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    try {
      await render(createElement(Harness));
      let pending: Promise<void> | undefined;
      await act(() => {
        pending = hookApi.startStreaming('Hi');
        hookApi.stopStreaming();
      });
      await act(async () => {
        release({ token: 'temp' });
        await pending;
      });

      expect(MockWebSocket.instances).toHaveLength(0);
    } finally {
      delete g.__DEEPGRAM_GET_TOKEN__;
      clearCachedAuthToken();
    }
  });

  it('synthesize() posts to /speak and plays the audio once', async () => {
    mockFetch.mockResolvedValueOnce(audioResponse([1, 2]));
    await render(createElement(Harness));

    await act(async () => {
      await hookApi.synthesize('One shot');
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/v1/speak?');
    expect(String(url)).toContain('container=none');
    expect(JSON.parse(init.body)).toEqual({ text: 'One shot' });
    expect(NativeDeepgram!.playAudioChunk).toHaveBeenCalledWith('AQI=');
  });

  it('synthesizeToBytes() caches identical requests and returns copies', async () => {
    mockFetch.mockResolvedValue(audioResponse([5, 6, 7]));
    await render(createElement(Harness));

    let first: { data: ArrayBuffer; mimeType: string } | undefined;
    let second: { data: ArrayBuffer; mimeType: string } | undefined;
    await act(async () => {
      first = await hookApi.synthesizeToBytes('Cache me', { encoding: 'mp3' });
      second = await hookApi.synthesizeToBytes('Cache me', {
        encoding: 'mp3',
      });
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first!.mimeType).toBe('audio/mpeg');
    expect(second!.data).not.toBe(first!.data);
    expect(Array.from(new Uint8Array(second!.data))).toEqual([5, 6, 7]);
  });
});
