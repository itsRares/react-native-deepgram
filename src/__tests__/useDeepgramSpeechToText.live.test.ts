import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { NativeModules } from 'react-native';
import { useDeepgramSpeechToText } from '../useDeepgramSpeechToText';
import type { UseDeepgramSpeechToTextReturn } from '../types';

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

/**
 * Minimal WebSocket stand-in that records the URL it was constructed with so
 * tests can assert which query parameters were serialized into the live URL.
 */
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

  send(_data?: unknown): void {
    // no-op: tests only inspect the constructor URL
  }

  close(_code?: number, _reason?: string): void {
    // no-op: tests only inspect the constructor URL
  }
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

describe('useDeepgramSpeechToText – live measurements', () => {
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
  });

  it('forwards measurements into the v1 live query URL', async () => {
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening({ measurements: true });
    });

    expect(MockWebSocket.lastUrl).toContain('measurements=true');
  });

  it('forwards measurements into the v2 (Flux) live query URL', async () => {
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening({ apiVersion: 'v2', measurements: true });
    });

    expect(MockWebSocket.lastUrl).toContain('measurements=true');
  });

  it('omits measurements from the live query when it is not provided', async () => {
    render(createElement(Harness));

    await act(async () => {
      await hookApi.startListening();
    });

    expect(MockWebSocket.lastUrl).not.toContain('measurements');
  });
});
