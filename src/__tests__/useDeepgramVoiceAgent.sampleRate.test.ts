import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { NativeModules } from 'react-native';
import { useDeepgramVoiceAgent } from '../useDeepgramVoiceAgent';
import type {
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from '../useDeepgramVoiceAgent';

const mockStartRecording = jest.fn((_options?: unknown) =>
  Promise.resolve({ sampleRate: 16000 })
);

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: (options?: unknown) => mockStartRecording(options),
    stopRecording: jest.fn(() => Promise.resolve()),
    startAudio: jest.fn(() => Promise.resolve()),
    stopAudio: jest.fn(() => Promise.resolve()),
    startPlayer: jest.fn(),
    stopPlayer: jest.fn(),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

/** WebSocket stand-in that records Settings payloads. */
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

let hookApi: UseDeepgramVoiceAgentReturn;
let harnessProps: UseDeepgramVoiceAgentProps = {};

function Harness(): null {
  hookApi = useDeepgramVoiceAgent(harnessProps);
  return null;
}

const lastSocket = () =>
  MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

const lastSettings = () => {
  const payload = [...MockWebSocket.sentFrames]
    .reverse()
    .find((frame) => typeof frame === 'string' && frame.includes('Settings'));
  return JSON.parse(payload as string) as {
    audio?: { input?: { encoding?: string; sample_rate?: number } };
  };
};

async function connectSession(props: UseDeepgramVoiceAgentProps) {
  harnessProps = props;
  render(createElement(Harness));
  await act(async () => {
    await hookApi.connect();
  });
  await act(async () => {});
  act(() => {
    lastSocket().onopen?.();
  });
}

describe('useDeepgramVoiceAgent – capture sample rate', () => {
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
    mockStartRecording.mockClear();
    mockStartRecording.mockResolvedValue({ sampleRate: 16000 });
  });

  afterEach(() => {
    act(() => {
      hookApi.disconnect();
    });
  });

  it('clamps a higher non-native target to the PCM capture rate', async () => {
    await connectSession({
      defaultSettings: {
        audio: { input: { encoding: 'linear16', sample_rate: 44100 } },
      },
    });

    expect(mockStartRecording).toHaveBeenCalledWith({
      enableVoiceProcessing: true,
      sampleRate: 16000,
    });
    expect(lastSettings().audio?.input?.sample_rate).toBe(16000);
  });

  it('preserves a lower target that can be downsampled from native capture', async () => {
    await connectSession({
      defaultSettings: {
        audio: { input: { encoding: 'linear16', sample_rate: 8000 } },
      },
    });

    expect(mockStartRecording).toHaveBeenCalledWith({
      enableVoiceProcessing: true,
      sampleRate: 16000,
    });
    expect(lastSettings().audio?.input?.sample_rate).toBe(8000);
  });

  it('keeps later Settings input media aligned with active native capture', async () => {
    await connectSession({
      defaultSettings: {
        audio: { input: { encoding: 'linear16', sample_rate: 16000 } },
      },
    });

    act(() => {
      expect(
        hookApi.sendSettings({
          audio: { input: { encoding: 'mulaw', sample_rate: 48000 } },
        })
      ).toBe(true);
    });

    expect(lastSettings().audio?.input).toEqual({
      encoding: 'linear16',
      sample_rate: 16000,
    });
  });

  it('adds active input media to a partial later Settings message', async () => {
    await connectSession({
      defaultSettings: {
        audio: { input: { encoding: 'linear16', sample_rate: 24000 } },
      },
    });

    act(() => {
      expect(hookApi.sendSettings({ tags: ['updated'] })).toBe(true);
    });

    expect(lastSettings().audio?.input).toEqual({
      encoding: 'linear16',
      sample_rate: 16000,
    });
  });
});
