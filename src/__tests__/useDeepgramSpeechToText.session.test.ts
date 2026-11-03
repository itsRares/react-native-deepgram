import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useDeepgramSpeechToText } from '../useDeepgramSpeechToText';
import type {
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from '../types';
import NativeDeepgram from '../NativeDeepgram';
import { clearCachedAuthToken } from '../helpers/auth';
import { MockWebSocket, installMockWebSocket } from '../../jest/mockWebSocket';

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

let hookApi: UseDeepgramSpeechToTextReturn;
let harnessProps: UseDeepgramSpeechToTextProps = {};

function Harness(): null {
  hookApi = useDeepgramSpeechToText(harnessProps);
  return null;
}

const flushAuth = () => act(async () => {});

async function startSession(
  options?: Parameters<UseDeepgramSpeechToTextReturn['startListening']>[0]
) {
  await render(createElement(Harness));
  await act(async () => {
    await hookApi.startListening(options);
  });
  await flushAuth();
  await act(() => {
    MockWebSocket.last().onopen?.();
  });
}

const v1Result = (transcript: string, isFinal: boolean) => ({
  is_final: isFinal,
  channel: { alternatives: [{ transcript }] },
});

describe('useDeepgramSpeechToText – live session', () => {
  beforeAll(installMockWebSocket);

  beforeEach(() => {
    MockWebSocket.reset();
    jest.clearAllMocks();
    harnessProps = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('connects to the v1 listen endpoint with nova-3 defaults', async () => {
    const onStart = jest.fn();
    harnessProps = { onStart };
    await startSession();

    const url = new URL(MockWebSocket.last().url);
    expect(url.pathname).toBe('/v1/listen');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('emits interim and final transcripts and de-duplicates repeats', async () => {
    const onTranscript = jest.fn();
    harnessProps = { onTranscript, trackTranscript: true };
    await startSession();
    const socket = MockWebSocket.last();

    await act(() => {
      socket.serverJson(v1Result('hello', false));
      socket.serverJson(v1Result('hello', false));
      socket.serverJson(v1Result('hello world', true));
      socket.serverJson(v1Result('hello world', true));
    });

    expect(
      onTranscript.mock.calls.map(([text, info]) => [text, info.isFinal])
    ).toEqual([
      ['hello', false],
      ['hello world', true],
    ]);
    expect(hookApi.transcript).toBe('hello world');
    expect(hookApi.interimTranscript).toBe('');
  });

  it('parses Flux (v2) TurnInfo messages', async () => {
    const onTranscript = jest.fn();
    harnessProps = { onTranscript };
    await startSession({ apiVersion: 'v2' });
    const socket = MockWebSocket.last();
    expect(new URL(socket.url).pathname).toBe('/v2/listen');

    await act(() => {
      socket.serverJson({ type: 'TurnInfo', event: 'Update', transcript: 'a' });
      socket.serverJson({
        type: 'TurnInfo',
        event: 'EndOfTurn',
        transcript: 'a b',
      });
    });

    expect(
      onTranscript.mock.calls.map(([text, info]) => [text, info.isFinal])
    ).toEqual([
      ['a', false],
      ['a b', true],
    ]);
  });

  it('tears the session down on a Flux Error without reconnecting', async () => {
    const onError = jest.fn();
    const onEnd = jest.fn();
    harnessProps = { onError, onEnd, reconnect: { enabled: true } };
    await startSession({ apiVersion: 'v2' });
    const socket = MockWebSocket.last();

    await act(() => {
      socket.serverJson({ type: 'Error', description: 'bad audio' });
    });
    expect(onError.mock.calls[0][0].message).toBe('bad audio');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'cleanup' }]);

    await act(() => {
      socket.onclose?.({ code: 1000 });
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reconnects after an unexpected close and reports onReconnected', async () => {
    jest.useFakeTimers();
    const onStart = jest.fn();
    const onReconnecting = jest.fn();
    const onReconnected = jest.fn();
    harnessProps = {
      onStart,
      onReconnecting,
      onReconnected,
      reconnect: { enabled: true },
    };
    await startSession();

    await act(() => {
      MockWebSocket.last().serverClose(1011);
    });
    expect(onReconnecting).toHaveBeenCalledWith(1);

    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await flushAuth();
    await act(() => {
      MockWebSocket.last().onopen?.();
    });

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1]!.url).toBe(
      MockWebSocket.instances[0]!.url
    );
    expect(onReconnected).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('reports an error and ends when reconnect attempts are exhausted', async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const onEnd = jest.fn();
    harnessProps = {
      onError,
      onEnd,
      reconnect: { enabled: true, maxRetries: 1 },
    };
    await startSession();

    await act(() => {
      MockWebSocket.last().serverClose(1006);
      jest.advanceTimersByTime(1_000);
    });
    await flushAuth();
    await act(() => {
      MockWebSocket.last().serverClose(1006);
    });

    expect(onError.mock.calls[0][0].message).toContain(
      'reconnect failed after 1 attempts'
    );
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(NativeDeepgram!.stopRecording).toHaveBeenCalled();
  });

  it('stopListening sends CloseStream on Flux and ends once', async () => {
    const onEnd = jest.fn();
    harnessProps = { onEnd };
    await startSession({ apiVersion: 'v2' });
    const socket = MockWebSocket.last();

    await act(() => {
      hookApi.stopListening();
      socket.onclose?.({ code: 1000 });
    });

    expect(socket.sentTypes()).toContain('CloseStream');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not open a socket when stopped before auth resolves', async () => {
    const g = globalThis as { __DEEPGRAM_GET_TOKEN__?: unknown };
    let release: (result: { token: string }) => void = () => {};
    g.__DEEPGRAM_GET_TOKEN__ = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    try {
      await render(createElement(Harness));
      await act(async () => {
        await hookApi.startListening();
      });
      await act(() => {
        hookApi.stopListening();
      });
      await act(async () => {
        release({ token: 'temp' });
      });

      expect(MockWebSocket.instances).toHaveLength(0);
    } finally {
      delete g.__DEEPGRAM_GET_TOKEN__;
      clearCachedAuthToken();
    }
  });

  it('pause() finalizes, drops mic frames and keeps the socket warm', async () => {
    jest.useFakeTimers();
    await startSession();
    const socket = MockWebSocket.last();
    socket.sent = [];

    await act(() => {
      hookApi.pause();
      DeviceEventEmitter.emit('onAudioPCM', {
        b64: 'AAAAAA==',
        sampleRate: 16000,
      });
      jest.advanceTimersByTime(5_000);
    });
    expect(socket.sentTypes()).toEqual(['Finalize', 'KeepAlive']);
    expect(hookApi.getStats().framesDropped).toBe(1);

    await act(() => {
      hookApi.resume();
      socket.sent = [];
      DeviceEventEmitter.emit('onAudioPCM', {
        b64: 'AAAAAA==',
        sampleRate: 16000,
      });
      jest.advanceTimersByTime(10_000);
    });
    expect(socket.sentTypes()).toEqual([]);
    expect(socket.sent).toHaveLength(1);
  });

  it('downsamples mic audio to the requested sample rate', async () => {
    await startSession({ sampleRate: 8000 });
    const socket = MockWebSocket.last();
    socket.sent = [];

    // 4 PCM16 samples at 16 kHz -> 2 samples at 8 kHz.
    const pcm = new Int16Array([1, 2, 3, 4]);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
    await act(() => {
      DeviceEventEmitter.emit('onAudioPCM', { b64, sampleRate: 16000 });
    });

    expect(Array.from(new Int16Array(socket.sent[0] as ArrayBuffer))).toEqual([
      1, 3,
    ]);
  });

  it('enables metering and reports audio levels', async () => {
    const onAudioLevel = jest.fn();
    harnessProps = {
      onAudioLevel,
      metering: { enabled: true, intervalMs: 50 },
      trackState: true,
    };
    await startSession();

    await act(() => {
      DeviceEventEmitter.emit('onAudioLevel', { level: 0.25 });
    });

    expect(NativeDeepgram!.setMeteringEnabled).toHaveBeenCalledWith(true, 50);
    expect(onAudioLevel).toHaveBeenCalledWith(0.25);
    expect(hookApi.audioLevel).toBe(0.25);
  });
});
