import { render, act } from '@testing-library/react-native';
import { createElement } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useDeepgramVoiceAgent } from '../useDeepgramVoiceAgent';
import type {
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from '../useDeepgramVoiceAgent';
import NativeDeepgram from '../NativeDeepgram';
import { clearCachedAuthToken } from '../helpers/auth';
import { MockWebSocket, installMockWebSocket } from '../../jest/mockWebSocket';

jest.mock('../helpers/askMicPermission', () => ({
  askMicPermission: jest.fn(() => Promise.resolve(true)),
}));

let hookApi: UseDeepgramVoiceAgentReturn;
let harnessProps: UseDeepgramVoiceAgentProps = {};

function Harness(): null {
  hookApi = useDeepgramVoiceAgent(harnessProps);
  return null;
}

/** Let the auth-header promise resolve so the socket gets constructed. */
const flushAuth = () => act(async () => {});

async function connectSession(
  settings?: Parameters<UseDeepgramVoiceAgentReturn['connect']>[0]
) {
  await render(createElement(Harness));
  await act(async () => {
    await hookApi.connect(settings);
  });
  await flushAuth();
  await act(() => {
    MockWebSocket.last().onopen?.();
  });
}

const keepAlives = (socket: MockWebSocket) =>
  socket.sentTypes().filter((type) => type === 'KeepAlive').length;

describe('useDeepgramVoiceAgent – session lifecycle', () => {
  beforeAll(installMockWebSocket);

  beforeEach(() => {
    MockWebSocket.reset();
    jest.clearAllMocks();
    harnessProps = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the merged Settings message once the socket opens', async () => {
    harnessProps = {
      defaultSettings: {
        audio: { input: { encoding: 'linear16', sample_rate: 16000 } },
        agent: { listen: { provider: { type: 'deepgram', model: 'nova-3' } } },
      },
    };
    await connectSession({ agent: { greeting: 'Hello!' } });

    const socket = MockWebSocket.last();
    expect(socket.binaryType).toBe('arraybuffer');
    expect(socket.options?.headers?.Authorization).toBe('Token test-key');
    expect(socket.sentJson()[0]).toEqual({
      type: 'Settings',
      audio: { input: { encoding: 'linear16', sample_rate: 16000 } },
      agent: {
        listen: { provider: { type: 'deepgram', model: 'nova-3' } },
        greeting: 'Hello!',
      },
    });
    expect(NativeDeepgram!.startRecording).toHaveBeenCalledWith({
      enableVoiceProcessing: true,
    });
  });

  it('reconnects with backoff, re-sends the updated Settings and reports onReconnected', async () => {
    jest.useFakeTimers();
    const onConnect = jest.fn();
    const onReconnecting = jest.fn();
    const onReconnected = jest.fn();
    harnessProps = {
      reconnect: { enabled: true },
      onConnect,
      onReconnecting,
      onReconnected,
    };
    await connectSession({ agent: { think: { prompt: 'v1' } } });

    await act(() => {
      expect(hookApi.updatePrompt('v2')).toBe(true);
    });

    await act(() => {
      MockWebSocket.last().serverClose(1006);
    });
    expect(onReconnecting).toHaveBeenCalledWith(1);
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await flushAuth();
    expect(MockWebSocket.instances).toHaveLength(2);

    await act(() => {
      MockWebSocket.last().onopen?.();
    });
    const resent = MockWebSocket.last().sentJson()[0] as {
      agent: { think: { prompt: string } };
    };
    expect(resent.agent.think.prompt).toBe('v2');
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and reports an error and onClose', async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const onClose = jest.fn();
    harnessProps = {
      reconnect: { enabled: true, maxRetries: 1 },
      onError,
      onClose,
    };
    await connectSession();

    await act(() => {
      MockWebSocket.last().serverClose(1006);
      jest.advanceTimersByTime(1_000);
    });
    await flushAuth();
    await act(() => {
      MockWebSocket.last().serverClose(1006);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0].message)).toContain(
      'reconnect failed after 1 attempts'
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('disconnect() closes the socket without reconnecting', async () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onReconnecting = jest.fn();
    harnessProps = { reconnect: { enabled: true }, onClose, onReconnecting };
    await connectSession();
    const socket = MockWebSocket.last();

    await act(() => {
      hookApi.disconnect();
    });
    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'cleanup' }]);
    expect(NativeDeepgram!.stopRecording).toHaveBeenCalled();

    await act(() => {
      socket.onclose?.({ code: 1000 });
      jest.advanceTimersByTime(20_000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReconnecting).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not open a socket when disconnected before auth resolves', async () => {
    const g = globalThis as { __DEEPGRAM_GET_TOKEN__?: unknown };
    let release: (result: { token: string }) => void = () => {};
    g.__DEEPGRAM_GET_TOKEN__ = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    try {
      await render(createElement(Harness));
      await act(async () => {
        await hookApi.connect();
      });
      await act(() => {
        hookApi.disconnect();
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

  it('routes server messages to callbacks and tracked state', async () => {
    const onWelcome = jest.fn();
    const onFunctionCallRequest = jest.fn();
    const onWarning = jest.fn();
    const onServerError = jest.fn();
    const onError = jest.fn();
    harnessProps = {
      trackState: true,
      trackConversation: true,
      trackAgentStatus: true,
      onWelcome,
      onFunctionCallRequest,
      onWarning,
      onServerError,
      onError,
    };
    await connectSession();
    const socket = MockWebSocket.last();

    await act(() => {
      socket.serverJson({ type: 'Welcome', request_id: 'req-1' });
      socket.serverJson({ type: 'Welcome' });
      socket.serverJson({
        type: 'ConversationText',
        role: 'user',
        content: 'Hi there',
      });
      socket.serverJson({ type: 'AgentThinking', content: 'hmm' });
      socket.serverJson({
        type: 'FunctionCallRequest',
        functions: [{ id: 'f1', name: 'lookup' }],
      });
      socket.serverJson({ type: 'Warning', description: 'slow down' });
    });

    expect(onWelcome).toHaveBeenCalledTimes(1);
    expect(onFunctionCallRequest).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(hookApi.conversation).toEqual([
      { role: 'user', content: 'Hi there' },
    ]);
    expect(hookApi.agentStatus?.thinking).toBe('hmm');
    expect(hookApi.state?.connectionState).toBe('connected');
    expect(hookApi.state?.warning).toBe('slow down');

    await act(() => {
      socket.serverJson({ type: 'AgentAudioDone' });
      socket.serverJson({ type: 'Error', description: 'bad settings' });
    });
    expect(hookApi.agentStatus).toEqual({ thinking: null, latency: null });
    expect(onServerError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('bad settings');
    expect(hookApi.state?.error).toBe('bad settings');
  });

  it('starts the native player from AudioConfig and feeds binary audio', async () => {
    const onAudio = jest.fn();
    harnessProps = { onAudio };
    await connectSession();
    const socket = MockWebSocket.last();

    await act(() => {
      socket.serverJson({ type: 'AudioConfig', sample_rate: 24000 });
      socket.onmessage?.({ data: new Uint8Array([1, 2, 3, 4]) });
    });

    expect(NativeDeepgram!.startPlayer).toHaveBeenLastCalledWith(24000, 1);
    expect(NativeDeepgram!.feedAudio).toHaveBeenCalledWith('AQIDBA==');
    expect(onAudio.mock.calls[0][0].byteLength).toBe(4);
  });

  it('keeps the socket alive with KeepAlive frames while muted', async () => {
    jest.useFakeTimers();
    await connectSession();
    const socket = MockWebSocket.last();

    await act(() => {
      hookApi.mute();
      jest.advanceTimersByTime(11_000);
    });
    expect(keepAlives(socket)).toBe(2);

    await act(() => {
      hookApi.unmute();
      socket.sent = [];
      jest.advanceTimersByTime(20_000);
    });
    expect(keepAlives(socket)).toBe(0);
  });

  it('shares one KeepAlive timer between mute and an interruption', async () => {
    jest.useFakeTimers();
    await connectSession();
    const socket = MockWebSocket.last();

    await act(() => {
      hookApi.mute();
      DeviceEventEmitter.emit('onAudioInterruption', {
        type: 'began',
        reason: 'unknown',
      });
      jest.advanceTimersByTime(11_000);
    });
    expect(keepAlives(socket)).toBe(2);

    await act(() => {
      hookApi.unmute();
      socket.sent = [];
      jest.advanceTimersByTime(6_000);
    });
    // Still interrupted, so the socket stays warm.
    expect(keepAlives(socket)).toBe(1);

    await act(() => {
      DeviceEventEmitter.emit('onAudioInterruption', {
        type: 'ended',
        shouldResume: true,
      });
      socket.sent = [];
      jest.advanceTimersByTime(20_000);
    });
    expect(keepAlives(socket)).toBe(0);
  });

  it('sendMedia accepts ArrayBuffer, typed views and number arrays', async () => {
    await connectSession();
    const socket = MockWebSocket.last();
    socket.sent = [];

    const view = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
    expect(hookApi.sendMedia(new ArrayBuffer(2))).toBe(true);
    expect(hookApi.sendMedia(view)).toBe(true);
    expect(hookApi.sendMedia([7, 8])).toBe(true);

    const sizes = socket.sent.map((frame) => (frame as ArrayBuffer).byteLength);
    expect(sizes).toEqual([2, 2, 2]);
    expect(Array.from(new Uint8Array(socket.sent[1] as ArrayBuffer))).toEqual([
      1, 2,
    ]);
  });
});
