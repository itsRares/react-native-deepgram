import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { NativeModules } from 'react-native';
import { useDeepgramSpeechToText } from '../useDeepgramSpeechToText';
import type { UseDeepgramSpeechToTextReturn } from '../types';
import type { DeepgramInterruptionEvent } from '../interruption';

jest.mock('../NativeDeepgram', () => ({
  Deepgram: {
    startRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

const mockInterruptionListeners: Array<(e: DeepgramInterruptionEvent) => void> =
  [];
jest.mock('../interruption', () => ({
  addInterruptionListener: (cb: (e: DeepgramInterruptionEvent) => void) => {
    mockInterruptionListeners.push(cb);
    return {
      remove: () => {
        const idx = mockInterruptionListeners.indexOf(cb);
        if (idx >= 0) mockInterruptionListeners.splice(idx, 1);
      },
    };
  },
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
const onEnd = jest.fn();
const onError = jest.fn();
const onInterruption = jest.fn();

function Harness(): null {
  hookApi = useDeepgramSpeechToText({ onEnd, onError, onInterruption });
  return null;
}

const emitInterruption = (e: DeepgramInterruptionEvent) => {
  for (const cb of [...mockInterruptionListeners]) cb(e);
};

const keepAliveFrames = () =>
  MockWebSocket.sentFrames.filter(
    (f) => typeof f === 'string' && f.includes('KeepAlive')
  );

describe('useDeepgramSpeechToText – interruption handling', () => {
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
    mockInterruptionListeners.length = 0;
    onEnd.mockClear();
    onError.mockClear();
    onInterruption.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function startSession() {
    render(createElement(Harness));
    await act(async () => {
      await hookApi.startListening();
    });
    // Flush the async socket construction (auth header resolution).
    await act(async () => {});
  }

  it('sends KeepAlive frames while an interruption is active', async () => {
    await startSession();
    expect(mockInterruptionListeners.length).toBe(1);

    act(() => {
      emitInterruption({ type: 'began', reason: 'unknown' });
    });
    expect(onInterruption).toHaveBeenCalledWith({
      type: 'began',
      reason: 'unknown',
    });
    // Finalize flushes buffered audio at the start of the interruption (v1).
    expect(
      MockWebSocket.sentFrames.some(
        (f) => typeof f === 'string' && f.includes('Finalize')
      )
    ).toBe(true);

    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(keepAliveFrames().length).toBeGreaterThanOrEqual(2);
  });

  it('stops sending KeepAlive when the interruption ends', async () => {
    await startSession();

    act(() => {
      emitInterruption({ type: 'began', reason: 'unknown' });
      jest.advanceTimersByTime(6_000);
    });
    expect(keepAliveFrames().length).toBeGreaterThanOrEqual(1);

    act(() => {
      emitInterruption({ type: 'ended', shouldResume: true });
    });
    MockWebSocket.sentFrames = [];
    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(keepAliveFrames().length).toBe(0);
  });

  it('keeps KeepAlive running after "ended" while user-paused', async () => {
    await startSession();

    act(() => {
      hookApi.pause();
      emitInterruption({ type: 'began', reason: 'unknown' });
      emitInterruption({ type: 'ended', shouldResume: true });
    });
    MockWebSocket.sentFrames = [];
    act(() => {
      jest.advanceTimersByTime(6_000);
    });
    // Still paused by the user, so the socket must stay warm.
    expect(keepAliveFrames().length).toBeGreaterThanOrEqual(1);
  });

  it('ends the session gracefully on a permanent focus loss', async () => {
    await startSession();

    act(() => {
      emitInterruption({ type: 'stopped', reason: 'focusLossPermanent' });
    });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    // Listener is removed with the session.
    expect(mockInterruptionListeners.length).toBe(0);
  });
});
