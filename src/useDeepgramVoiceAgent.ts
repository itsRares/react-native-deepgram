import { useCallback, useEffect, useRef, useState } from 'react';
import { Deepgram, type AudioPCMEvent } from './native';
import { askMicPermission } from './helpers/askMicPermission';
import { arrayBufferToBase64 } from './helpers/audioUtils';
import { hasAuthConfigured } from './helpers/auth';
import {
  addInterruptionListener,
  type DeepgramInterruptionEvent,
} from './interruption';
import { getAgentUrl } from './constants';
import {
  hasKeys,
  mergePlainObjects,
  sanitizeSettings,
} from './internal/agentSettings';
import { createKeepAlive } from './internal/keepAlive';
import {
  ManagedSocket,
  type ManagedSocketOptions,
} from './internal/managedSocket';
import {
  decodePcmFrame,
  NATIVE_SAMPLE_RATE,
  resolveDownsampleFactor,
  toArrayBuffer,
} from './internal/pcm';
import { useLatest } from './internal/useLatest';
import { useSessionStats } from './internal/useSessionStats';
import { toDeepgramError } from './types/errors';
import type {
  DeepgramVoiceAgentAgentAudioDoneMessage,
  DeepgramVoiceAgentAgentConfig,
  DeepgramVoiceAgentAgentStartedSpeakingMessage,
  DeepgramVoiceAgentAgentThinkingMessage,
  DeepgramVoiceAgentAudioConfigMessage,
  DeepgramVoiceAgentClientMessage,
  DeepgramVoiceAgentConversationTextMessage,
  DeepgramVoiceAgentErrorMessage,
  DeepgramVoiceAgentFunctionCallResponseMessage,
  DeepgramVoiceAgentInjectBehavior,
  DeepgramVoiceAgentListenConfig,
  DeepgramVoiceAgentServerMessage,
  DeepgramVoiceAgentSettings,
  DeepgramVoiceAgentSettingsMessage,
  DeepgramVoiceAgentSpeakConfig,
  DeepgramVoiceAgentThinkConfig,
  DeepgramVoiceAgentUserStartedSpeakingMessage,
  DeepgramVoiceAgentWarningMessage,
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from './types';

export type {
  UseDeepgramVoiceAgentProps,
  UseDeepgramVoiceAgentReturn,
} from './types';

const DEFAULT_SAMPLE_RATE = 16_000;

type AgentState = NonNullable<UseDeepgramVoiceAgentReturn['state']>;
type AgentStatus = NonNullable<UseDeepgramVoiceAgentReturn['agentStatus']>;
type ConversationEntry = { role: string; content: string };

/**
 * Server events that are only forwarded to a callback, with the keys a
 * message needs before it is considered well-formed.
 */
const FORWARDED_EVENTS: Record<
  string,
  { callback: keyof UseDeepgramVoiceAgentProps; requires: string[] }
> = {
  Welcome: { callback: 'onWelcome', requires: ['request_id'] },
  SettingsApplied: { callback: 'onSettingsApplied', requires: [] },
  FunctionCallRequest: {
    callback: 'onFunctionCallRequest',
    requires: ['functions'],
  },
  FunctionCallResponse: {
    callback: 'onFunctionCallResponse',
    requires: ['id', 'name'],
  },
  PromptUpdated: { callback: 'onPromptUpdated', requires: [] },
  ListenUpdated: { callback: 'onListenUpdated', requires: [] },
  ThinkUpdated: { callback: 'onThinkUpdated', requires: [] },
  SpeakUpdated: { callback: 'onSpeakUpdated', requires: [] },
  ThinkLiveUpdated: { callback: 'onThinkLiveUpdated', requires: [] },
  LatencyReport: { callback: 'onLatencyReport', requires: [] },
  FunctionCallCancelled: {
    callback: 'onFunctionCallCancelled',
    requires: ['functions'],
  },
  FrustrationDetected: { callback: 'onFrustrationDetected', requires: [] },
  __customFromThinkProvider: {
    callback: 'onCustomFromThinkProvider',
    requires: [],
  },
  InjectionRefused: { callback: 'onInjectionRefused', requires: ['message'] },
  History: { callback: 'onHistory', requires: [] },
};

interface AgentSession {
  active: boolean;
  microphone: boolean;
  muted: boolean;
  interrupted: boolean;
  /** True while agent audio is queued/playing on the native player. */
  agentAudioInFlight: boolean;
  nativeSampleRate: number;
  targetSampleRate: number;
  /** Re-sent on every (re)connect; kept in sync with Update* messages. */
  settings: DeepgramVoiceAgentSettingsMessage | null;
  subscriptions: Array<{ remove: () => void }>;
}

const createAgentSession = (): AgentSession => ({
  active: false,
  microphone: false,
  muted: false,
  interrupted: false,
  agentAudioInFlight: false,
  nativeSampleRate: NATIVE_SAMPLE_RATE,
  targetSampleRate: DEFAULT_SAMPLE_RATE,
  settings: null,
  subscriptions: [],
});

export function useDeepgramVoiceAgent(
  props: UseDeepgramVoiceAgentProps = {}
): UseDeepgramVoiceAgentReturn {
  const {
    autoPlayAudio = true,
    trackState = false,
    trackConversation = false,
    trackAgentStatus = false,
    trackStats = false,
  } = props;
  const propsRef = useLatest(props);
  const flagsRef = useLatest({
    autoPlayAudio,
    trackState,
    trackConversation,
    trackAgentStatus,
  });

  const [state, setState] = useState<AgentState>({
    connectionState: 'idle',
    error: null,
    warning: null,
  });
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    thinking: null,
    latency: null,
  });
  const [isMuted, setIsMuted] = useState(false);
  const stats = useSessionStats(trackStats);
  const { update: updateStats, stopPublishing } = stats;

  const sessionRef = useRef<AgentSession>(createAgentSession());
  const socketEvents = useRef<ManagedSocketOptions | null>(null);

  const [socket] = useState(
    () =>
      new ManagedSocket({
        url: () => propsRef.current.endpoint ?? getAgentUrl(),
        binaryType: 'arraybuffer',
        reconnect: () => propsRef.current.reconnect,
        onOpen: (info) => socketEvents.current?.onOpen(info),
        onMessage: (message) => socketEvents.current?.onMessage(message),
        onError: (error) => socketEvents.current?.onError(error),
        onReconnecting: (attempt) =>
          socketEvents.current?.onReconnecting?.(attempt),
        onClose: (info) => socketEvents.current?.onClose(info),
      })
  );

  const reportError = useCallback(
    (error: unknown) => propsRef.current.onError?.(toDeepgramError(error)),
    [propsRef]
  );

  const sendJson = useCallback(
    (message: DeepgramVoiceAgentClientMessage): boolean => {
      try {
        return socket.sendJson(message);
      } catch (err) {
        reportError(err);
        return false;
      }
    },
    [reportError, socket]
  );

  const [keepAlive] = useState(() =>
    createKeepAlive(() => {
      try {
        socket.sendJson({ type: 'KeepAlive' });
      } catch {
        // The socket is closing; nothing left to keep alive.
      }
    })
  );

  const updateState = useCallback(
    (patch: Partial<AgentState>) => {
      if (flagsRef.current.trackState) {
        setState((prev) => ({ ...prev, ...patch }));
      }
    },
    [flagsRef]
  );

  const teardown = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = createAgentSession();
    keepAlive.clear();
    stopPublishing();
    session.subscriptions.forEach((subscription) => subscription.remove());
    if (session.microphone) {
      Deepgram.stopRecording().catch(() => {});
    }
    if (session.active) {
      Deepgram.stopAudio().catch(() => {});
    }
    socket.close();
    if (flagsRef.current.trackState) {
      setIsMuted(false);
    }
  }, [flagsRef, keepAlive, socket, stopPublishing]);

  const handleServerMessage = (message: DeepgramVoiceAgentServerMessage) => {
    const p = propsRef.current;
    const flags = flagsRef.current;
    const session = sessionRef.current;
    p.onMessage?.(message);

    const forwarded = FORWARDED_EVENTS[message.type];
    if (forwarded) {
      if (hasKeys(message, forwarded.requires)) {
        (p[forwarded.callback] as ((m: unknown) => void) | undefined)?.(
          message
        );
      }
      return;
    }

    switch (message.type) {
      case 'ConversationText': {
        if (!hasKeys(message, ['role', 'content'])) break;
        const msg = message as DeepgramVoiceAgentConversationTextMessage;
        if (flags.trackConversation) {
          setConversation((prev) => [
            ...prev,
            { role: msg.role, content: msg.content },
          ]);
        }
        p.onConversationText?.(msg);
        break;
      }
      case 'AgentThinking': {
        if (!hasKeys(message, ['content'])) break;
        const msg = message as DeepgramVoiceAgentAgentThinkingMessage;
        if (flags.trackAgentStatus) {
          setAgentStatus((prev) => ({ ...prev, thinking: msg.content }));
        }
        p.onAgentThinking?.(msg);
        break;
      }
      case 'AgentStartedSpeaking': {
        const msg = message as DeepgramVoiceAgentAgentStartedSpeakingMessage;
        if (flags.trackAgentStatus) {
          setAgentStatus((prev) => ({
            ...prev,
            latency: {
              total: msg.total_latency,
              tts: msg.tts_latency,
              ttt: msg.ttt_latency,
            },
          }));
        }
        p.onAgentStartedSpeaking?.(msg);
        break;
      }
      case 'AgentAudioDone':
        session.agentAudioInFlight = false;
        if (flags.trackAgentStatus) {
          setAgentStatus({ thinking: null, latency: null });
        }
        p.onAgentAudioDone?.(
          message as DeepgramVoiceAgentAgentAudioDoneMessage
        );
        break;
      case 'UserStartedSpeaking':
        // Barge-in: flush native playback so the agent stops talking when
        // the user talks over it (skipped while muted).
        if (p.bargeIn && session.agentAudioInFlight && !session.muted) {
          Deepgram.interruptAudio();
          session.agentAudioInFlight = false;
          p.onBargeIn?.();
        }
        p.onUserStartedSpeaking?.(
          message as DeepgramVoiceAgentUserStartedSpeakingMessage
        );
        break;
      case 'AudioConfig': {
        if (!hasKeys(message, ['sample_rate'])) break;
        const msg = message as DeepgramVoiceAgentAudioConfigMessage;
        if (flags.autoPlayAudio) {
          Deepgram.startPlayer(
            msg.sample_rate || DEFAULT_SAMPLE_RATE,
            msg.channels || 1
          );
        }
        p.onAudioConfig?.(msg);
        break;
      }
      case 'Warning': {
        if (!hasKeys(message, ['description'])) break;
        const msg = message as DeepgramVoiceAgentWarningMessage;
        updateState({ warning: msg.description });
        p.onWarning?.(msg);
        break;
      }
      case 'Error': {
        const msg = message as Partial<DeepgramVoiceAgentErrorMessage>;
        const description =
          typeof msg.description === 'string' ? msg.description : undefined;
        const code = typeof msg.code === 'string' ? msg.code : undefined;
        const errorMessage = description ?? code ?? 'Voice agent error';
        updateState({ connectionState: 'disconnected', error: errorMessage });
        if (description || code) {
          p.onServerError?.(message as DeepgramVoiceAgentErrorMessage);
        }
        reportError(new Error(errorMessage));
        break;
      }
      default:
        // `Audio` arrives as binary frames; unknown types are ignored.
        break;
    }
  };

  const handleAgentAudio = (buffer: ArrayBuffer) => {
    updateStats((s) => {
      s.bytesReceived += buffer.byteLength;
    });
    stats.markFirstResult();
    if (flagsRef.current.autoPlayAudio) {
      try {
        Deepgram.feedAudio(arrayBufferToBase64(buffer));
        sessionRef.current.agentAudioInFlight = true;
      } catch (err) {
        console.warn('[VoiceAgent] Auto-feed audio error:', err);
      }
    }
    propsRef.current.onAudio?.(buffer);
  };

  socketEvents.current = {
    url: () => propsRef.current.endpoint ?? getAgentUrl(),
    reconnect: () => propsRef.current.reconnect,
    onOpen: ({ reconnected }) => {
      updateStats((s) => {
        s.connectedAtMs = Date.now();
      });
      const settings = sessionRef.current.settings;
      if (settings) {
        sendJson(settings);
      }
      updateState({ connectionState: 'connected' });
      if (flagsRef.current.autoPlayAudio) {
        Deepgram.startPlayer(
          settings?.audio?.output?.sample_rate ?? DEFAULT_SAMPLE_RATE,
          1
        );
      }
      if (reconnected) {
        propsRef.current.onReconnected?.();
      } else {
        propsRef.current.onConnect?.();
      }
    },
    onMessage: ({ data }) => {
      if (typeof data === 'string') {
        try {
          handleServerMessage(JSON.parse(data));
        } catch (err) {
          reportError(err);
        }
        return;
      }
      const buffer = toArrayBuffer(data);
      if (buffer) {
        handleAgentAudio(buffer);
      }
    },
    onError: (error) => propsRef.current.onError?.(error),
    onReconnecting: (attempt) => {
      updateStats((s) => {
        s.reconnects += 1;
      });
      updateState({ connectionState: 'connecting' });
      propsRef.current.onReconnecting?.(attempt);
    },
    onClose: ({ event, exhausted, maxRetries, error }) => {
      if (sessionRef.current.active) {
        teardown();
      }
      if (exhausted) {
        const reconnectError = new Error(
          `Deepgram reconnect failed after ${maxRetries} attempts`
        );
        updateState({
          connectionState: 'disconnected',
          error: reconnectError.message,
        });
        reportError(reconnectError);
      } else {
        updateState({
          connectionState: 'disconnected',
          ...(error ? { error: error.message } : {}),
        });
      }
      propsRef.current.onClose?.(event);
    },
  };

  const handleMicChunk = useCallback(
    (event: AudioPCMEvent) => {
      const session = sessionRef.current;
      if (session.muted || !socket.isOpen) {
        updateStats((s) => {
          s.framesDropped += 1;
        });
        return;
      }
      if (event.sampleRate > 0) {
        session.nativeSampleRate = event.sampleRate;
      }
      const factor = resolveDownsampleFactor(
        propsRef.current.downsampleFactor,
        session.targetSampleRate,
        session.nativeSampleRate
      );
      const frame = decodePcmFrame(event.b64, factor);
      try {
        socket.send(frame.audio);
        updateStats((s) => {
          s.bytesSent += frame.decodedBytes;
        });
      } catch (err) {
        reportError(err);
      }
    },
    [propsRef, reportError, socket, updateStats]
  );

  // Native capture/playback pauses during system interruptions; KeepAlive
  // frames bridge the idle timeout until they end.
  const handleInterruption = useCallback(
    (event: DeepgramInterruptionEvent) => {
      propsRef.current.onInterruption?.(event);
      const session = sessionRef.current;
      if (event.type === 'began') {
        if (session.interrupted) return;
        session.interrupted = true;
        keepAlive.hold('interruption');
      } else if (event.type === 'ended') {
        session.interrupted = false;
        keepAlive.release('interruption');
      } else {
        // Permanent focus loss: the native session is gone. The socket
        // close then delivers onClose.
        teardown();
      }
    },
    [keepAlive, propsRef, teardown]
  );

  const { reset: resetStats, startPublishing } = stats;
  const connect = useCallback(
    async (overrideSettings?: DeepgramVoiceAgentSettings) => {
      teardown();
      const session = createAgentSession();
      session.active = true;
      sessionRef.current = session;
      resetStats();
      if (trackState) {
        setState({ connectionState: 'connecting', error: null, warning: null });
      }
      if (trackConversation) setConversation([]);
      if (trackAgentStatus) setAgentStatus({ thinking: null, latency: null });

      const p = propsRef.current;
      p.onBeforeConnect?.();

      if (!hasAuthConfigured()) throw new Error('Deepgram API key missing');

      if (p.autoStartMicrophone ?? true) {
        const granted = await askMicPermission();
        if (!granted) throw new Error('Microphone permission denied');
        await Deepgram.startRecording({ enableVoiceProcessing: true });
        if (sessionRef.current !== session) {
          // disconnect() ran while the recorder was starting.
          Deepgram.stopRecording().catch(() => {});
          return;
        }
        session.microphone = true;
        session.subscriptions.push(Deepgram.onAudioPCM(handleMicChunk));
      } else {
        // startRecording activates the audio session; otherwise do it here.
        await Deepgram.startAudio();
        if (sessionRef.current !== session) return;
      }

      startPublishing();

      const merged = mergePlainObjects(
        sanitizeSettings(p.defaultSettings),
        sanitizeSettings(overrideSettings)
      );
      session.settings = { type: 'Settings', ...(merged ?? {}) };
      session.targetSampleRate =
        session.settings.audio?.input?.sample_rate ?? DEFAULT_SAMPLE_RATE;

      session.subscriptions.push(addInterruptionListener(handleInterruption));
      socket.open();
    },
    [
      handleInterruption,
      handleMicChunk,
      propsRef,
      resetStats,
      socket,
      startPublishing,
      teardown,
      trackAgentStatus,
      trackConversation,
      trackState,
    ]
  );

  const disconnect = useCallback(() => {
    teardown();
    updateState({ connectionState: 'disconnected' });
  }, [teardown, updateState]);

  useEffect(() => teardown, [teardown]);

  const sendSettings = useCallback(
    (settings: DeepgramVoiceAgentSettings) => {
      const message: DeepgramVoiceAgentSettingsMessage = {
        type: 'Settings',
        ...(sanitizeSettings(settings) ?? {}),
      };
      const sent = sendJson(message);
      if (sent) {
        sessionRef.current.settings = message;
      }
      return sent;
    },
    [sendJson]
  );

  /** Send an Update* message and mirror it into the stored settings. */
  const sendAgentUpdate = useCallback(
    (
      message: DeepgramVoiceAgentClientMessage,
      patch: (
        agent: DeepgramVoiceAgentAgentConfig
      ) => DeepgramVoiceAgentAgentConfig
    ) => {
      const sent = sendJson(message);
      const settings = sessionRef.current.settings;
      // A stored agent configuration (UUID string) lives on the server.
      if (sent && settings && typeof settings.agent !== 'string') {
        sessionRef.current.settings = {
          ...settings,
          agent: patch(settings.agent ?? {}),
        };
      }
      return sent;
    },
    [sendJson]
  );

  const updatePrompt = useCallback(
    (prompt: string) =>
      sendAgentUpdate({ type: 'UpdatePrompt', prompt }, (agent) => ({
        ...agent,
        think: { ...(agent.think ?? {}), prompt },
      })),
    [sendAgentUpdate]
  );

  const updateListen = useCallback(
    (listen: DeepgramVoiceAgentListenConfig) =>
      sendAgentUpdate({ type: 'UpdateListen', listen }, (agent) => ({
        ...agent,
        listen,
      })),
    [sendAgentUpdate]
  );

  const updateThink = useCallback(
    (think: DeepgramVoiceAgentThinkConfig) =>
      sendAgentUpdate({ type: 'UpdateThink', think }, (agent) => ({
        ...agent,
        think,
      })),
    [sendAgentUpdate]
  );

  const updateSpeak = useCallback(
    (speak: DeepgramVoiceAgentSpeakConfig | DeepgramVoiceAgentSpeakConfig[]) =>
      sendAgentUpdate({ type: 'UpdateSpeak', speak }, (agent) => ({
        ...agent,
        speak,
      })),
    [sendAgentUpdate]
  );

  const updateThinkLive = useCallback(
    (thinkLive: Record<string, unknown>) =>
      sendAgentUpdate(
        { type: 'UpdateThink_Live', think_live: thinkLive },
        (agent) => ({ ...agent, think_live: thinkLive })
      ),
    [sendAgentUpdate]
  );

  const forceEndTurn = useCallback(
    () => sendJson({ type: 'ForceEndTurn' }),
    [sendJson]
  );

  const injectUserMessage = useCallback(
    (content: string) => sendJson({ type: 'InjectUserMessage', content }),
    [sendJson]
  );

  const injectAgentMessage = useCallback(
    (
      message: string,
      options?:
        | DeepgramVoiceAgentInjectBehavior
        | { behavior?: DeepgramVoiceAgentInjectBehavior; dynamic?: boolean }
    ) => {
      const { behavior, dynamic } =
        typeof options === 'string'
          ? { behavior: options, dynamic: false }
          : {
              behavior: options?.behavior,
              dynamic: options?.dynamic === true,
            };
      return sendJson({
        type: 'InjectAgentMessage',
        message,
        ...(behavior !== undefined ? { behavior } : {}),
        ...(dynamic ? { is_dynamic: true } : {}),
      });
    },
    [sendJson]
  );

  const sendFunctionCallResponse = useCallback(
    (response: Omit<DeepgramVoiceAgentFunctionCallResponseMessage, 'type'>) =>
      sendJson({
        type: 'FunctionCallResponse',
        ...response,
      } as DeepgramVoiceAgentFunctionCallResponseMessage),
    [sendJson]
  );

  const sendKeepAlive = useCallback(
    () => sendJson({ type: 'KeepAlive' }),
    [sendJson]
  );

  const sendMedia = useCallback(
    (chunk: ArrayBuffer | Uint8Array | number[]) => {
      const payload = toArrayBuffer(chunk);
      if (!payload) return false;
      try {
        return socket.send(payload);
      } catch (err) {
        reportError(err);
        return false;
      }
    },
    [reportError, socket]
  );

  const mute = useCallback(() => {
    const session = sessionRef.current;
    if (session.muted) return;
    session.muted = true;
    keepAlive.hold('mute');
    if (trackState) setIsMuted(true);
  }, [keepAlive, trackState]);

  const unmute = useCallback(() => {
    const session = sessionRef.current;
    if (!session.muted) return;
    session.muted = false;
    keepAlive.release('mute');
    if (trackState) setIsMuted(false);
  }, [keepAlive, trackState]);

  const isConnected = useCallback(() => socket.isOpen, [socket]);

  const clearConversation = useCallback(() => {
    if (trackConversation) setConversation([]);
  }, [trackConversation]);

  return {
    connect,
    disconnect,
    sendMessage: sendJson,
    sendSettings,
    injectUserMessage,
    injectAgentMessage,
    forceEndTurn,
    sendFunctionCallResponse,
    sendKeepAlive,
    updatePrompt,
    updateListen,
    updateThink,
    updateSpeak,
    updateThinkLive,
    sendMedia,
    mute,
    unmute,
    getStats: stats.getStats,
    isConnected,
    ...(trackState ? { state, isMuted } : {}),
    ...(trackConversation ? { conversation, clearConversation } : {}),
    ...(trackAgentStatus ? { agentStatus } : {}),
    ...(trackStats ? { stats: stats.stats } : {}),
  };
}
