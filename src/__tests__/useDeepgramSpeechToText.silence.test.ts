import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import { useDeepgramSpeechToText } from '../useDeepgramSpeechToText';
import type {
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from '../types';

const mockSetMeteringEnabled = jest.fn();
const mockStopRecording = jest.fn(() => Promise.resolve(null));

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: jest.fn(() => Promise.resolve({ sampleRate: 16000 })),
    stopRecording: () => mockStopRecording(),
    setMeteringEnabled: (...args: unknown[]) => mockSetMeteringEnabled(...args),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

/** WebSocket stand-in that records every frame sent through it. */
class MockWebSocket {
  static readonly OPEN = 1;
  static sentFrames: unknown[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(_url: string) {}

  send(data?: unknown): void {
    MockWebSocket.sentFrames.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3;
  }
}

const globalRef = globalThis as unknown as {
  WebSocket: unknown;
  __DEEPGRAM_API_KEY__: string;
};

let hookApi: UseDeepgramSpeechToTextReturn;
let harnessProps: UseDeepgramSpeechToTextProps = {};

function Harness(): null {
  hookApi = useDeepgramSpeechToText(harnessProps);
  return null;
}

const emitLevel = (level: number) => {
  DeviceEventEmitter.emit('DeepgramAudioLevel', { level });
};

// 8 zero samples of PCM16 → forwarded as a binary frame when not gated.
const FRAME_B64 = Buffer.from(new Uint8Array(16)).toString('base64');
const emitAudioChunk = () => {
  DeviceEventEmitter.emit('DeepgramAudioPCM', {
    b64: FRAME_B64,
    sampleRate: 16000,
  });
};

const binaryFrames = () =>
  MockWebSocket.sentFrames.filter((f) => f instanceof ArrayBuffer);

const keepAliveFrames = () =>
  MockWebSocket.sentFrames.filter(
    (f) => typeof f === 'string' && f.includes('KeepAlive')
  );

const finalizeFrames = () =>
  MockWebSocket.sentFrames.filter(
    (f) => typeof f === 'string' && f.includes('Finalize')
  );

async function startSession(props: UseDeepgramSpeechToTextProps) {
  harnessProps = props;
  render(createElement(Harness));
  await act(async () => {
    await hookApi.startListening();
  });
  // Flush the async socket construction (auth header resolution).
  await act(async () => {});
}

describe('useDeepgramSpeechToText – silence gating / auto-stop', () => {
  beforeAll(() => {
    (NativeModules as Record<string, unknown>).Deepgram = {
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    globalRef.WebSocket = MockWebSocket;
    globalRef.__DEEPGRAM_API_KEY__ = 'test-key';
  });

  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.sentFrames = [];
    mockSetMeteringEnabled.mockClear();
    mockStopRecording.mockClear();
  });

  afterEach(() => {
    act(() => {
      hookApi.stopListening();
    });
    jest.useRealTimers();
  });

  it('forces metering on for the session and restores it off on stop', async () => {
    await startSession({ silence: { gate: true } });

    expect(mockSetMeteringEnabled).toHaveBeenCalledWith(true, 100);

    act(() => {
      hookApi.stopListening();
    });
    expect(mockSetMeteringEnabled).toHaveBeenCalledWith(false, 0);
  });

  it('gates frames after the hangover, keeps the socket alive, and resumes on voice', async () => {
    const onSilenceChange = jest.fn();
    await startSession({ silence: { gate: true }, onSilenceChange });

    // Loud audio flows through.
    act(() => {
      emitLevel(0.5);
      emitAudioChunk();
    });
    expect(binaryFrames().length).toBe(1);

    // Below-threshold levels shorter than the hangover do not gate.
    act(() => {
      emitLevel(0.001);
      jest.advanceTimersByTime(300);
      emitLevel(0.001);
    });
    expect(onSilenceChange).not.toHaveBeenCalled();

    // Past the hangover (default 800 ms) the gate engages once.
    act(() => {
      jest.advanceTimersByTime(600);
      emitLevel(0.001);
    });
    expect(onSilenceChange).toHaveBeenCalledTimes(1);
    expect(onSilenceChange).toHaveBeenLastCalledWith(true);
    expect(finalizeFrames().length).toBe(1);

    // Frames are dropped while gated (counted in stats)…
    act(() => {
      emitAudioChunk();
      emitAudioChunk();
    });
    expect(binaryFrames().length).toBe(1);
    expect(hookApi.getStats().framesDropped).toBe(2);

    // …and KeepAlive frames bridge the idle timeout.
    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(keepAliveFrames().length).toBeGreaterThanOrEqual(2);

    // Voice returns: gate lifts, KeepAlive stops, frames flow again.
    act(() => {
      emitLevel(0.5);
    });
    expect(onSilenceChange).toHaveBeenCalledTimes(2);
    expect(onSilenceChange).toHaveBeenLastCalledWith(false);

    const keepAlivesAtResume = keepAliveFrames().length;
    act(() => {
      jest.advanceTimersByTime(11_000);
      emitAudioChunk();
    });
    expect(keepAliveFrames().length).toBe(keepAlivesAtResume);
    expect(binaryFrames().length).toBe(2);
  });

  it('stops the session once after autoStopMs of continuous silence', async () => {
    const onEnd = jest.fn();
    await startSession({
      silence: { autoStopMs: 3_000, hangoverMs: 500 },
      onEnd,
    });

    act(() => {
      emitLevel(0.001);
      jest.advanceTimersByTime(600);
      emitLevel(0.001);
    });
    expect(onEnd).not.toHaveBeenCalled();

    // autoStopMs measures from the start of silence, so 2.4 s remain.
    act(() => {
      jest.advanceTimersByTime(2_400);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(mockStopRecording).toHaveBeenCalled();

    // No double stop on further timer activity.
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('honors autoStopMs even when it is shorter than the hangover', async () => {
    const onEnd = jest.fn();
    await startSession({
      silence: { autoStopMs: 100, hangoverMs: 800 },
      onEnd,
    });

    act(() => {
      emitLevel(0);
      jest.advanceTimersByTime(100);
    });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(mockStopRecording).toHaveBeenCalled();
  });

  it('accepts a zero threshold and treats a zero RMS level as silence', async () => {
    const onSilenceChange = jest.fn();
    await startSession({
      silence: { gate: true, threshold: 0, hangoverMs: 0 },
      onSilenceChange,
    });

    act(() => {
      emitLevel(0);
    });

    expect(onSilenceChange).toHaveBeenCalledWith(true);
    expect(finalizeFrames()).toHaveLength(1);
  });

  it('never lets gating resume a user pause', async () => {
    await startSession({ silence: { gate: true } });

    act(() => {
      hookApi.pause();
    });

    // Gate engages and then lifts while the user pause is still active.
    act(() => {
      emitLevel(0.001);
      jest.advanceTimersByTime(900);
      emitLevel(0.001);
      emitLevel(0.5);
    });

    // KeepAlive keeps running — the pause still owns it.
    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(keepAliveFrames().length).toBeGreaterThanOrEqual(2);

    // Frames stay dropped while paused, and resume() restores the flow.
    act(() => {
      emitAudioChunk();
    });
    expect(binaryFrames().length).toBe(0);

    const keepAlivesBeforeResume = keepAliveFrames().length;
    act(() => {
      hookApi.resume();
      jest.advanceTimersByTime(11_000);
      emitAudioChunk();
    });
    expect(keepAliveFrames().length).toBe(keepAlivesBeforeResume);
    expect(binaryFrames().length).toBe(1);
  });
});
