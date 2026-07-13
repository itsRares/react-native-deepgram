import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import { useDeepgramVoiceAgent } from '../useDeepgramVoiceAgent';
import type {
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from '../useDeepgramVoiceAgent';

const mockSetMeteringEnabled = jest.fn();
const mockStopRecording = jest.fn(() => Promise.resolve());

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: jest.fn(() => Promise.resolve({ sampleRate: 16000 })),
    stopRecording: () => mockStopRecording(),
    startAudio: jest.fn(() => Promise.resolve()),
    stopAudio: jest.fn(() => Promise.resolve()),
    setMeteringEnabled: (...args: unknown[]) => mockSetMeteringEnabled(...args),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

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

const FRAME_B64 = Buffer.from(new Uint8Array(16)).toString('base64');
const VOICED_FRAME_B64 = Buffer.from(
  new Int16Array(8).fill(8_192).buffer
).toString('base64');
const emitMicFrame = () => {
  DeviceEventEmitter.emit('DeepgramAudioPCM', {
    b64: FRAME_B64,
    sampleRate: 16000,
  });
};
const emitVoicedMicFrame = () => {
  DeviceEventEmitter.emit('DeepgramAudioPCM', {
    b64: VOICED_FRAME_B64,
    sampleRate: 16000,
  });
};
const emitLevel = (level: number) => {
  DeviceEventEmitter.emit('DeepgramAudioLevel', { level });
};
const binaryFrames = () =>
  MockWebSocket.sentFrames.filter((frame) => frame instanceof ArrayBuffer);
const keepAliveFrames = () =>
  MockWebSocket.sentFrames.filter(
    (frame) => typeof frame === 'string' && frame.includes('KeepAlive')
  );
const lastSocket = () => MockWebSocket.instances.at(-1)!;

let hookApi: UseDeepgramVoiceAgentReturn;
let harnessProps: UseDeepgramVoiceAgentProps = {};

function Harness(): null {
  hookApi = useDeepgramVoiceAgent(harnessProps);
  return null;
}

async function connectSession(props: UseDeepgramVoiceAgentProps) {
  harnessProps = props;
  render(createElement(Harness));
  await act(async () => {
    await hookApi.connect();
  });
  await act(async () => {});
}

describe('useDeepgramVoiceAgent – silence gating', () => {
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
    mockSetMeteringEnabled.mockClear();
    mockStopRecording.mockClear();
  });

  afterEach(() => {
    act(() => {
      hookApi.disconnect();
    });
    jest.useRealTimers();
  });

  it('stops sending sustained silent mic frames and resumes when voice returns', async () => {
    const onSilenceChange = jest.fn();
    await connectSession({
      silence: { gate: true },
      onSilenceChange,
    });

    expect(mockSetMeteringEnabled).toHaveBeenCalledWith(true, 100);

    act(() => emitMicFrame());
    expect(binaryFrames()).toHaveLength(1);
    const bytesBeforeGating = hookApi.getStats().bytesSent;

    act(() => {
      emitLevel(0.001);
      jest.advanceTimersByTime(800);
      emitLevel(0.001);
      emitMicFrame();
    });
    expect(onSilenceChange).toHaveBeenLastCalledWith(true);
    expect(binaryFrames()).toHaveLength(1);
    expect(hookApi.getStats().bytesSent).toBe(bytesBeforeGating);
    expect(hookApi.getStats().framesDropped).toBe(1);

    act(() => {
      jest.advanceTimersByTime(8_000);
    });
    expect(keepAliveFrames()).toHaveLength(1);

    act(() => emitVoicedMicFrame());
    expect(onSilenceChange).toHaveBeenLastCalledWith(false);
    expect(binaryFrames()).toHaveLength(2);
    expect(hookApi.getStats().bytesSent).toBeGreaterThan(bytesBeforeGating);

    act(() => {
      hookApi.disconnect();
    });
    expect(mockSetMeteringEnabled).toHaveBeenLastCalledWith(false, 0);
  });

  it('forwards the first voiced frame before a delayed meter event arrives', async () => {
    await connectSession({ silence: { gate: true } });

    act(() => {
      emitLevel(0);
      jest.advanceTimersByTime(800);
      emitLevel(0);
    });
    expect(hookApi.getStats().bytesSent).toBe(0);

    // Android emits PCM before its throttled AudioLevel event. The frame that
    // proves speech has resumed must be delivered rather than lost.
    act(() => emitVoicedMicFrame());

    expect(binaryFrames()).toHaveLength(1);
    expect(hookApi.getStats().framesDropped).toBe(0);
  });

  it('keeps trailing audio flowing until the agent accepts the user turn', async () => {
    await connectSession({ silence: { gate: true } });

    act(() => {
      emitVoicedMicFrame();
      emitLevel(0.5);
      jest.advanceTimersByTime(800);
      emitLevel(0);
      emitMicFrame();
    });

    // The turn is still active, so the trailing silence reaches Voice Agent
    // VAD instead of being gated after 800 ms.
    expect(binaryFrames()).toHaveLength(2);

    act(() => {
      lastSocket().onmessage?.({
        data: JSON.stringify({ type: 'AgentThinking', content: 'thinking' }),
      });
      emitLevel(0);
      jest.advanceTimersByTime(800);
      emitLevel(0);
      emitMicFrame();
    });

    // Once AgentThinking confirms the user turn is accepted, the idle gate
    // resumes and stops further silent PCM from being sent.
    expect(binaryFrames()).toHaveLength(2);
    expect(hookApi.getStats().framesDropped).toBe(1);
  });

  it('disconnects after autoStopMs of continuous silence', async () => {
    await connectSession({ silence: { autoStopMs: 100 } });

    act(() => {
      emitLevel(0);
      jest.advanceTimersByTime(100);
    });

    expect(mockStopRecording).toHaveBeenCalledTimes(1);
  });
});
