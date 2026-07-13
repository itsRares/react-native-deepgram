import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { NativeModules } from 'react-native';
import { useDeepgramSpeechToText } from '../useDeepgramSpeechToText';
import type { UseDeepgramSpeechToTextReturn } from '../types';

const mockStartRecording = jest.fn(
  (_options?: unknown): Promise<{ sampleRate: number }> =>
    Promise.resolve({ sampleRate: 16000 })
);

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: (options?: unknown) => mockStartRecording(options),
    stopRecording: jest.fn(() => Promise.resolve(null)),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

/** WebSocket stand-in that records the URL it was constructed with. */
class MockWebSocket {
  static readonly OPEN = 1;
  static lastUrl = '';
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    MockWebSocket.lastUrl = url;
  }

  send(_data?: unknown): void {}

  close(_code?: number, _reason?: string): void {}
}

const globalRef = globalThis as unknown as {
  WebSocket: unknown;
  __DEEPGRAM_API_KEY__: string;
};

let hookApi: UseDeepgramSpeechToTextReturn;

function Harness(): null {
  hookApi = useDeepgramSpeechToText();
  return null;
}

describe('useDeepgramSpeechToText – capture sample rate', () => {
  beforeAll(() => {
    (NativeModules as Record<string, unknown>).Deepgram = {
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    globalRef.WebSocket = MockWebSocket;
    globalRef.__DEEPGRAM_API_KEY__ = 'test-key';
  });

  beforeEach(() => {
    MockWebSocket.lastUrl = '';
    mockStartRecording.mockClear();
    mockStartRecording.mockResolvedValue({ sampleRate: 16000 });
  });

  it('captures at 16 kHz by default and labels the query to match', async () => {
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening();
    });

    expect(mockStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 16000 })
    );
    expect(MockWebSocket.lastUrl).toContain('sample_rate=16000');
  });

  it('requests a supported native rate and forwards it to the live query', async () => {
    mockStartRecording.mockResolvedValueOnce({ sampleRate: 48000 });
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening({ sampleRate: 48000 });
    });

    expect(mockStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 48000 })
    );
    expect(MockWebSocket.lastUrl).toContain('sample_rate=48000');
  });

  it('labels the query with the actual rate when native falls back to 16 kHz', async () => {
    mockStartRecording.mockResolvedValueOnce({ sampleRate: 16000 });
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening({ sampleRate: 24000 });
    });

    expect(mockStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 24000 })
    );
    expect(MockWebSocket.lastUrl).toContain('sample_rate=16000');
  });

  it('keeps the JS downsample path for rates below the native base', async () => {
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening({ sampleRate: 8000 });
    });

    // Capture stays at the 16 kHz base; JS downsamples to the 8 kHz target.
    expect(mockStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 16000 })
    );
    expect(MockWebSocket.lastUrl).toContain('sample_rate=8000');
  });
});
