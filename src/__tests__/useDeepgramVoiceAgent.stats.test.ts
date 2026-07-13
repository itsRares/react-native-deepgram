import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import { useDeepgramVoiceAgent } from '../useDeepgramVoiceAgent';
import type {
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from '../useDeepgramVoiceAgent';

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
    startAudio: jest.fn(() => Promise.resolve()),
    stopAudio: jest.fn(() => Promise.resolve()),
    startPlayer: jest.fn(),
    stopPlayer: jest.fn(),
    feedAudio: jest.fn(),
    interruptAudio: jest.fn(),
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
  binaryType = '';
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

// 320 bytes of PCM (160 samples) → base64 mic frame.
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

const AUDIO_EVENT = 'DeepgramAudioPCM'; // jest runs with Platform.OS === 'ios'

let hookApi: UseDeepgramVoiceAgentReturn;
let harnessProps: UseDeepgramVoiceAgentProps = {};
let renderCount = 0;

function Harness(): null {
  renderCount += 1;
  hookApi = useDeepgramVoiceAgent(harnessProps);
  return null;
}

const lastSocket = () =>
  MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

async function connectSession() {
  render(createElement(Harness));
  await act(async () => {
    await hookApi.connect();
  });
  // Flush the async socket construction (auth header resolution).
  await act(async () => {});
  act(() => {
    lastSocket().onopen?.();
  });
}

const emitMicFrame = () => {
  DeviceEventEmitter.emit(AUDIO_EVENT, { b64: frameB64 });
};

describe('useDeepgramVoiceAgent – session stats', () => {
  beforeAll(() => {
    (NativeModules as Record<string, unknown>).Deepgram = {
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    globalRef.WebSocket = MockWebSocket;
    globalRef.__DEEPGRAM_API_KEY__ = 'test-key';
  });

  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.sentFrames = [];
    jest.clearAllMocks();
    renderCount = 0;
    harnessProps = {};
  });

  it('counts bytesSent for forwarded mic frames', async () => {
    await connectSession();

    act(() => {
      emitMicFrame();
      emitMicFrame();
      emitMicFrame();
    });

    const stats = hookApi.getStats();
    expect(stats.bytesSent).toBe(3 * DECODED_FRAME_BYTES);
    expect(stats.framesDropped).toBe(0);
  });

  it('counts framesDropped while muted and when the socket is not open', async () => {
    await connectSession();

    act(() => {
      hookApi.mute();
      emitMicFrame();
      emitMicFrame();
      hookApi.unmute();
    });

    act(() => {
      lastSocket().readyState = 0;
      emitMicFrame();
    });

    const stats = hookApi.getStats();
    expect(stats.framesDropped).toBe(3);
    expect(stats.bytesSent).toBe(0);
  });

  it('counts bytesReceived and firstResultMs for binary agent audio', async () => {
    await connectSession();

    const stats0 = hookApi.getStats();
    expect(stats0.connectedAtMs).not.toBeNull();
    expect(stats0.firstResultMs).toBeNull();

    act(() => {
      lastSocket().onmessage?.({ data: new ArrayBuffer(48) });
      lastSocket().onmessage?.({ data: new ArrayBuffer(16) });
    });

    const stats = hookApi.getStats();
    expect(stats.bytesReceived).toBe(64);
    expect(stats.firstResultMs).not.toBeNull();
  });

  it('counts reconnects when the socket drops with reconnect enabled', async () => {
    harnessProps = { reconnect: { enabled: true } };
    await connectSession();

    act(() => {
      lastSocket().onclose?.({ code: 1006 });
    });

    expect(hookApi.getStats().reconnects).toBe(1);
  });

  it('resets counters on a new connect()', async () => {
    await connectSession();

    act(() => {
      emitMicFrame();
    });
    expect(hookApi.getStats().bytesSent).toBe(DECODED_FRAME_BYTES);

    await act(async () => {
      await hookApi.connect();
    });
    expect(hookApi.getStats().bytesSent).toBe(0);
  });

  it('publishes throttled stats state when trackStats is enabled', async () => {
    jest.useFakeTimers();
    try {
      harnessProps = { trackStats: true };
      await connectSession();

      act(() => {
        emitMicFrame();
      });
      // Counter mutations alone must not re-render.
      expect(hookApi.stats!.bytesSent).toBe(0);

      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(hookApi.stats!.bytesSent).toBe(DECODED_FRAME_BYTES);

      // Ticks without new data must not publish (no extra re-renders).
      const rendersAfterPublish = renderCount;
      act(() => {
        jest.advanceTimersByTime(2_000);
      });
      expect(renderCount).toBe(rendersAfterPublish);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not re-render and returns no stats value without trackStats', async () => {
    await connectSession();

    const rendersAfterConnect = renderCount;
    act(() => {
      emitMicFrame();
    });

    expect(hookApi.stats).toBeUndefined();
    expect(renderCount).toBe(rendersAfterConnect);
    expect(hookApi.getStats().bytesSent).toBe(DECODED_FRAME_BYTES);
  });

  it('getStats returns a fresh snapshot each call', async () => {
    await connectSession();

    const a = hookApi.getStats();
    act(() => {
      emitMicFrame();
    });
    const b = hookApi.getStats();

    expect(a).not.toBe(b);
    expect(a.bytesSent).toBe(0);
    expect(b.bytesSent).toBe(DECODED_FRAME_BYTES);
  });
});
