import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import { useDeepgramSpeechToText } from '../useDeepgramSpeechToText';
import type {
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from '../types';

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

/** WebSocket stand-in with a controllable readyState per instance. */
class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  static sentFrames: unknown[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

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

// 320 bytes of PCM (160 samples) → 428-char base64 string.
const FRAME_BYTES = 320;
const frameB64 = (() => {
  const bytes = new Uint8Array(FRAME_BYTES);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
})();
const DECODED_FRAME_BYTES = Math.floor((frameB64.length * 3) / 4);

let hookApi: UseDeepgramSpeechToTextReturn;
let renderCount = 0;
let harnessProps: UseDeepgramSpeechToTextProps = {};

function Harness(): null {
  renderCount += 1;
  hookApi = useDeepgramSpeechToText(harnessProps);
  return null;
}

const lastSocket = () =>
  MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

const emitFrame = () => {
  DeviceEventEmitter.emit('DeepgramAudioPCM', { b64: frameB64 });
};

async function startSession() {
  render(createElement(Harness));
  await act(async () => {
    await hookApi.startListening();
  });
  // Flush the async socket construction (auth header resolution).
  await act(async () => {});
  act(() => {
    lastSocket().onopen?.();
  });
}

describe('useDeepgramSpeechToText – session stats', () => {
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
    MockWebSocket.instances = [];
    MockWebSocket.sentFrames = [];
    renderCount = 0;
    harnessProps = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts bytesSent exactly for N forwarded frames', async () => {
    await startSession();

    const frames = 5;
    act(() => {
      for (let i = 0; i < frames; i++) emitFrame();
    });

    const stats = hookApi.getStats();
    expect(stats.bytesSent).toBe(frames * DECODED_FRAME_BYTES);
    expect(stats.framesDropped).toBe(0);
  });

  it('counts framesDropped while paused', async () => {
    await startSession();

    act(() => {
      emitFrame();
      hookApi.pause();
      emitFrame();
      emitFrame();
    });

    const stats = hookApi.getStats();
    expect(stats.bytesSent).toBe(DECODED_FRAME_BYTES);
    expect(stats.framesDropped).toBe(2);
  });

  it('counts framesDropped when the socket is not open', async () => {
    await startSession();

    act(() => {
      lastSocket().readyState = 0; // CONNECTING — e.g. reconnect gap
      emitFrame();
    });

    expect(hookApi.getStats().framesDropped).toBe(1);
    expect(hookApi.getStats().bytesSent).toBe(0);
  });

  it('counts reconnect attempts', async () => {
    harnessProps = { reconnect: { enabled: true, maxRetries: 3 } };
    await startSession();

    act(() => {
      lastSocket().onclose?.({ code: 1006 });
    });

    expect(hookApi.getStats().reconnects).toBe(1);
  });

  it('records connectedAtMs and firstResultMs', async () => {
    await startSession();

    expect(hookApi.getStats().connectedAtMs).toEqual(expect.any(Number));
    expect(hookApi.getStats().firstResultMs).toBeNull();

    act(() => {
      lastSocket().onmessage?.({
        data: JSON.stringify({
          is_final: true,
          channel: { alternatives: [{ transcript: 'hello world' }] },
        }),
      });
    });

    expect(hookApi.getStats().firstResultMs).toEqual(expect.any(Number));
  });

  it('resets counters on a new startListening()', async () => {
    await startSession();

    act(() => {
      emitFrame();
    });
    expect(hookApi.getStats().bytesSent).toBeGreaterThan(0);

    await act(async () => {
      await hookApi.startListening();
    });

    const stats = hookApi.getStats();
    expect(stats.bytesSent).toBe(0);
    expect(stats.framesDropped).toBe(0);
    expect(stats.reconnects).toBe(0);
    expect(stats.firstResultMs).toBeNull();
  });

  it('publishes stats state at most once per second when trackStats is on', async () => {
    harnessProps = { trackStats: true };
    await startSession();

    act(() => {
      emitFrame();
      emitFrame();
    });
    // Not yet published — the throttle interval has not ticked.
    expect(hookApi.stats?.bytesSent).toBe(0);

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(hookApi.stats?.bytesSent).toBe(2 * DECODED_FRAME_BYTES);

    const rendersAfterFirstTick = renderCount;
    // No new data → the next tick must not re-render.
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(renderCount).toBe(rendersAfterFirstTick);
  });

  it('getStats works without trackStats and causes no re-renders', async () => {
    await startSession();
    const rendersAfterStart = renderCount;

    act(() => {
      emitFrame();
      emitFrame();
      emitFrame();
      jest.advanceTimersByTime(5_000);
    });

    expect(hookApi.getStats().bytesSent).toBe(3 * DECODED_FRAME_BYTES);
    expect(hookApi.stats).toBeUndefined();
    expect(renderCount).toBe(rendersAfterStart);
  });

  it('getStats returns a fresh snapshot, not the live object', async () => {
    await startSession();

    const before = hookApi.getStats();
    act(() => {
      emitFrame();
    });
    const after = hookApi.getStats();

    expect(before.bytesSent).toBe(0);
    expect(after.bytesSent).toBe(DECODED_FRAME_BYTES);
    expect(before).not.toBe(after);
  });
});
