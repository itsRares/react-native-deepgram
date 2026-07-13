import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { NativeModules } from 'react-native';
import { useDeepgramVoiceAgent } from '../useDeepgramVoiceAgent';
import type {
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from '../useDeepgramVoiceAgent';
import { Deepgram } from '../NativeDeepgram';

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

/** WebSocket stand-in that lets tests drive server events. */
class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  send(_data?: unknown): void {}

  close(_code?: number, _reason?: string): void {
    this.readyState = 3;
  }
}

const globalRef = globalThis as unknown as {
  WebSocket: unknown;
  __DEEPGRAM_API_KEY__: string;
};

const interruptAudioMock = Deepgram.interruptAudio as jest.Mock;

let hookApi: UseDeepgramVoiceAgentReturn;
let harnessProps: UseDeepgramVoiceAgentProps = {};
const onBargeIn = jest.fn();
const onUserStartedSpeaking = jest.fn();

function Harness(): null {
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

const emitAgentAudio = (bytes = 64) => {
  lastSocket().onmessage?.({ data: new ArrayBuffer(bytes) });
};

const emitServerMessage = (message: Record<string, unknown>) => {
  lastSocket().onmessage?.({ data: JSON.stringify(message) });
};

describe('useDeepgramVoiceAgent – barge-in', () => {
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
    jest.clearAllMocks();
    harnessProps = { bargeIn: true, onBargeIn, onUserStartedSpeaking };
  });

  it('flushes playback once and fires onBargeIn when the user talks over the agent', async () => {
    await connectSession();

    act(() => {
      emitServerMessage({ type: 'AgentStartedSpeaking' });
      emitAgentAudio();
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });

    expect(interruptAudioMock).toHaveBeenCalledTimes(1);
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    expect(onUserStartedSpeaking).toHaveBeenCalledTimes(1);
  });

  it('does not flush when bargeIn is unset', async () => {
    harnessProps = { onBargeIn, onUserStartedSpeaking };
    await connectSession();

    act(() => {
      emitAgentAudio();
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });

    expect(interruptAudioMock).not.toHaveBeenCalled();
    expect(onBargeIn).not.toHaveBeenCalled();
    // The existing callback still fires regardless.
    expect(onUserStartedSpeaking).toHaveBeenCalledTimes(1);
  });

  it('does not flush when no agent audio is in flight', async () => {
    await connectSession();

    act(() => {
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });

    expect(interruptAudioMock).not.toHaveBeenCalled();
    expect(onBargeIn).not.toHaveBeenCalled();
    expect(onUserStartedSpeaking).toHaveBeenCalledTimes(1);
  });

  it('does not flush after AgentAudioDone completed the turn', async () => {
    await connectSession();

    act(() => {
      emitAgentAudio();
      emitServerMessage({ type: 'AgentAudioDone' });
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });

    expect(interruptAudioMock).not.toHaveBeenCalled();
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it('does not flush while muted', async () => {
    await connectSession();

    act(() => {
      emitAgentAudio();
      hookApi.mute();
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });

    expect(interruptAudioMock).not.toHaveBeenCalled();
    expect(onBargeIn).not.toHaveBeenCalled();
    expect(onUserStartedSpeaking).toHaveBeenCalledTimes(1);

    // Unmuting restores barge-in for the still-pending audio? No — the flush
    // was skipped, but the in-flight state must remain intact for later.
    act(() => {
      hookApi.unmute();
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });
    expect(interruptAudioMock).toHaveBeenCalledTimes(1);
    expect(onBargeIn).toHaveBeenCalledTimes(1);
  });

  it('treats a late AgentAudioDone after a flush as a no-op and does not wedge', async () => {
    await connectSession();

    // Turn 1: audio in flight → barge-in flush.
    act(() => {
      emitAgentAudio();
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });
    expect(interruptAudioMock).toHaveBeenCalledTimes(1);

    // Late AgentAudioDone for the discarded audio — must not throw or wedge.
    act(() => {
      emitServerMessage({ type: 'AgentAudioDone' });
    });

    // Turn 2: new audio in flight → barge-in flushes again.
    act(() => {
      emitAgentAudio();
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });
    expect(interruptAudioMock).toHaveBeenCalledTimes(2);
    expect(onBargeIn).toHaveBeenCalledTimes(2);
  });

  it('flushes only once for repeated UserStartedSpeaking without new audio', async () => {
    await connectSession();

    act(() => {
      emitAgentAudio();
      emitServerMessage({ type: 'UserStartedSpeaking' });
      emitServerMessage({ type: 'UserStartedSpeaking' });
    });

    expect(interruptAudioMock).toHaveBeenCalledTimes(1);
    expect(onBargeIn).toHaveBeenCalledTimes(1);
  });
});
