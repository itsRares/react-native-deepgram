import { useRef, useCallback, useEffect, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import {
  arrayBufferToBase64,
  resolveAuthHeader,
  hasAuthConfigured,
} from './helpers';
import { getAgentUrl } from './constants';
import type {
  DeepgramVoiceAgentSettings,
  DeepgramVoiceAgentSettingsMessage,
  DeepgramVoiceAgentFunctionCallResponseMessage,
  DeepgramVoiceAgentClientMessage,
  DeepgramVoiceAgentServerMessage,
  DeepgramVoiceAgentWelcomeMessage,
  DeepgramVoiceAgentSettingsAppliedMessage,
  DeepgramVoiceAgentConversationTextMessage,
  DeepgramVoiceAgentAgentThinkingMessage,
  DeepgramVoiceAgentAgentStartedSpeakingMessage,
  DeepgramVoiceAgentAgentAudioDoneMessage,
  DeepgramVoiceAgentUserStartedSpeakingMessage,
  DeepgramVoiceAgentFunctionCallRequestMessage,
  DeepgramVoiceAgentReceiveFunctionCallResponseMessage,
  DeepgramVoiceAgentPromptUpdatedMessage,
  DeepgramVoiceAgentListenUpdatedMessage,
  DeepgramVoiceAgentThinkUpdatedMessage,
  DeepgramVoiceAgentSpeakUpdatedMessage,
  DeepgramVoiceAgentInjectionRefusedMessage,
  DeepgramVoiceAgentHistoryMessage,
  DeepgramVoiceAgentWarningMessage,
  DeepgramVoiceAgentErrorMessage,
  DeepgramVoiceAgentAudioConfigMessage,
  DeepgramVoiceAgentListenConfig,
  DeepgramVoiceAgentThinkConfig,
  DeepgramVoiceAgentSpeakConfig,
  DeepgramVoiceAgentAgentConfig,
  DeepgramReconnectOptions,
} from './types';

const DEFAULT_INPUT_SAMPLE_RATE = 16_000;
const BASE_NATIVE_SAMPLE_RATE = 16_000;

const AGENT_KEEPALIVE_INTERVAL_MS = 5_000;

const DEFAULT_AGENT_RECONNECT = {
  enabled: false,
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
};

const eventName = Platform.select({
  ios: 'DeepgramAudioPCM',
  android: 'AudioChunk',
  default: 'DeepgramAudioPCM',
});

let cachedEmitter: NativeEventEmitter | null = null;
const getEmitter = (): NativeEventEmitter => {
  if (!cachedEmitter) {
    cachedEmitter = new NativeEventEmitter(NativeModules.Deepgram);
  }
  return cachedEmitter;
};

const ensureArrayBuffer = (data: any): ArrayBuffer | null => {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    if (view.buffer instanceof ArrayBuffer) {
      return view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      );
    }

    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }
  return null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as unknown as T;
  }

  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      cloned[key] = cloneValue(entryValue);
    });
    return cloned as T;
  }

  return value;
};

const mergePlainObjects = <T extends Record<string, unknown>>(
  base?: T,
  override?: T
): T | undefined => {
  if (!base && !override) {
    return undefined;
  }

  if (!base) {
    return override ? (cloneValue(override) as T) : undefined;
  }

  const result = cloneValue(base) as Record<string, unknown>;

  if (!override) {
    return result as T;
  }

  Object.entries(override).forEach(([key, overrideValue]) => {
    if (overrideValue === undefined) {
      result[key] = undefined;
      return;
    }

    if (isPlainObject(overrideValue)) {
      const existing = result[key];
      result[key] = mergePlainObjects(
        isPlainObject(existing)
          ? (existing as Record<string, unknown>)
          : undefined,
        overrideValue
      );
      return;
    }

    if (Array.isArray(overrideValue)) {
      result[key] = overrideValue.map((item) => cloneValue(item));
      return;
    }

    result[key] = overrideValue;
  });

  return result as T;
};

const hasKeys = (value: unknown, keys: string[]) =>
  isPlainObject(value) && keys.every((key) => key in value);

const computeDownsampleFactor = (
  target: number | undefined,
  base: number = BASE_NATIVE_SAMPLE_RATE
) => {
  if (!target || target >= base || base <= 0) {
    return 1;
  }
  const ratio = Math.round(base / target);
  return ratio > 0 ? ratio : 1;
};

const resolveDownsampleFactor = (
  overrideFactor: number | undefined,
  targetSampleRate: number | undefined,
  nativeSampleRate: number | undefined
) => {
  if (overrideFactor == null) {
    return computeDownsampleFactor(targetSampleRate, nativeSampleRate);
  }

  const normalized = Math.max(1, Math.round(overrideFactor));

  if (!nativeSampleRate || !targetSampleRate) {
    return normalized;
  }

  if (nativeSampleRate <= targetSampleRate) {
    return 1;
  }

  return normalized;
};

type WebSocketLike = Pick<
  WebSocket,
  | 'readyState'
  | 'send'
  | 'close'
  | 'onopen'
  | 'onmessage'
  | 'onerror'
  | 'onclose'
>;

export interface UseDeepgramVoiceAgentProps {
  endpoint?: string;
  defaultSettings?: DeepgramVoiceAgentSettings;
  autoStartMicrophone?: boolean;
  downsampleFactor?: number;
  autoPlayAudio?: boolean;
  trackState?: boolean;
  trackConversation?: boolean;
  trackAgentStatus?: boolean;
  /**
   * Auto-reconnect configuration for the agent socket. Disabled by default;
   * set `reconnect.enabled` to opt in. On reconnect the stored `Settings`
   * message is automatically re-sent.
   */
  reconnect?: DeepgramReconnectOptions;
  /** Called when a reconnect attempt begins (1-based attempt number). */
  onReconnecting?: (attempt: number) => void;
  /** Called once the agent socket has successfully reconnected. */
  onReconnected?: () => void;
  onBeforeConnect?: () => void;
  onConnect?: () => void;
  onClose?: (event?: any) => void;
  onError?: (error: unknown) => void;
  onMessage?: (message: DeepgramVoiceAgentServerMessage) => void;
  onWelcome?: (message: DeepgramVoiceAgentWelcomeMessage) => void;
  onSettingsApplied?: (
    message: DeepgramVoiceAgentSettingsAppliedMessage
  ) => void;
  onConversationText?: (
    message: DeepgramVoiceAgentConversationTextMessage
  ) => void;
  onAgentThinking?: (message: DeepgramVoiceAgentAgentThinkingMessage) => void;
  onAgentStartedSpeaking?: (
    message: DeepgramVoiceAgentAgentStartedSpeakingMessage
  ) => void;
  onAgentAudioDone?: (message: DeepgramVoiceAgentAgentAudioDoneMessage) => void;
  onUserStartedSpeaking?: (
    message: DeepgramVoiceAgentUserStartedSpeakingMessage
  ) => void;
  onFunctionCallRequest?: (
    message: DeepgramVoiceAgentFunctionCallRequestMessage
  ) => void;
  onFunctionCallResponse?: (
    message: DeepgramVoiceAgentReceiveFunctionCallResponseMessage
  ) => void;
  onPromptUpdated?: (message: DeepgramVoiceAgentPromptUpdatedMessage) => void;
  onListenUpdated?: (message: DeepgramVoiceAgentListenUpdatedMessage) => void;
  onThinkUpdated?: (message: DeepgramVoiceAgentThinkUpdatedMessage) => void;
  onSpeakUpdated?: (message: DeepgramVoiceAgentSpeakUpdatedMessage) => void;
  onInjectionRefused?: (
    message: DeepgramVoiceAgentInjectionRefusedMessage
  ) => void;
  onHistory?: (message: DeepgramVoiceAgentHistoryMessage) => void;
  onWarning?: (message: DeepgramVoiceAgentWarningMessage) => void;
  onServerError?: (message: DeepgramVoiceAgentErrorMessage) => void;
  onAudioConfig?: (message: DeepgramVoiceAgentAudioConfigMessage) => void;
  onAudio?: (audioData: ArrayBuffer) => void;
}

export interface UseDeepgramVoiceAgentReturn {
  connect: (settings?: DeepgramVoiceAgentSettings) => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: DeepgramVoiceAgentClientMessage) => boolean;
  sendSettings: (settings: DeepgramVoiceAgentSettings) => boolean;
  injectUserMessage: (content: string) => boolean;
  injectAgentMessage: (message: string, behavior?: string) => boolean;
  sendFunctionCallResponse: (
    response: Omit<DeepgramVoiceAgentFunctionCallResponseMessage, 'type'>
  ) => boolean;
  sendKeepAlive: () => boolean;
  updatePrompt: (prompt: string) => boolean;
  updateListen: (listen: DeepgramVoiceAgentListenConfig) => boolean;
  updateThink: (think: DeepgramVoiceAgentThinkConfig) => boolean;
  updateSpeak: (speak: DeepgramVoiceAgentSpeakConfig) => boolean;
  sendMedia: (chunk: ArrayBuffer | Uint8Array | number[]) => boolean;
  /** Stop forwarding mic frames; keep the socket alive with KeepAlive. */
  mute: () => void;
  /** Resume forwarding mic frames after {@link mute}. */
  unmute: () => void;
  isConnected: () => boolean;
  state?: {
    connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected';
    error: string | null;
    warning: string | null;
  };
  /** Whether the microphone is currently muted (only when trackState is enabled). */
  isMuted?: boolean;
  conversation?: Array<{ role: string; content: string }>;
  clearConversation?: () => void;
  agentStatus?: {
    thinking: string | null;
    latency: { total?: number; tts?: number; ttt?: number } | null;
  };
}

export function useDeepgramVoiceAgent({
  endpoint,
  defaultSettings,
  autoStartMicrophone = true,
  autoPlayAudio = true,
  trackState = false,
  trackConversation = false,
  trackAgentStatus = false,
  downsampleFactor,
  reconnect = {},
  onReconnecting = () => {},
  onReconnected = () => {},
  onBeforeConnect,
  onConnect,
  onClose,
  onError,
  onMessage,
  onWelcome,
  onSettingsApplied,
  onConversationText,
  onAgentThinking,
  onAgentStartedSpeaking,
  onAgentAudioDone,
  onUserStartedSpeaking,
  onFunctionCallRequest,
  onFunctionCallResponse,
  onPromptUpdated,
  onListenUpdated,
  onThinkUpdated,
  onSpeakUpdated,
  onInjectionRefused,
  onHistory,
  onWarning,
  onServerError,
  onAudioConfig,
  onAudio,
}: UseDeepgramVoiceAgentProps = {}): UseDeepgramVoiceAgentReturn {
  const ws = useRef<WebSocketLike | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const nativeInputSampleRate = useRef(BASE_NATIVE_SAMPLE_RATE);
  const targetInputSampleRate = useRef(DEFAULT_INPUT_SAMPLE_RATE);
  const currentDownsample = useRef(
    resolveDownsampleFactor(
      downsampleFactor,
      targetInputSampleRate.current,
      nativeInputSampleRate.current
    )
  );
  const microphoneActive = useRef(false);
  const mutedRef = useRef(false);
  const muteKeepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const defaultSettingsRef = useRef(defaultSettings);
  const endpointRef = useRef(endpoint);

  const userDisconnectedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsGenerationRef = useRef(0);
  const mergedSettingsRef = useRef<DeepgramVoiceAgentSettingsMessage | null>(
    null
  );
  const reconnectConfigRef = useRef({ ...DEFAULT_AGENT_RECONNECT });
  const openSocketRef = useRef<() => void>(() => {});

  const onBeforeConnectRef = useRef(onBeforeConnect);
  const onConnectRef = useRef(onConnect);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  const onReconnectingRef = useRef(onReconnecting);
  const onReconnectedRef = useRef(onReconnected);
  const onMessageRef = useRef(onMessage);
  const onWelcomeRef = useRef(onWelcome);
  const onSettingsAppliedRef = useRef(onSettingsApplied);
  const onConversationTextRef = useRef(onConversationText);
  const onAgentThinkingRef = useRef(onAgentThinking);
  const onAgentStartedSpeakingRef = useRef(onAgentStartedSpeaking);
  const onAgentAudioDoneRef = useRef(onAgentAudioDone);
  const onUserStartedSpeakingRef = useRef(onUserStartedSpeaking);
  const onFunctionCallRequestRef = useRef(onFunctionCallRequest);
  const onFunctionCallResponseRef = useRef(onFunctionCallResponse);
  const onPromptUpdatedRef = useRef(onPromptUpdated);
  const onListenUpdatedRef = useRef(onListenUpdated);
  const onThinkUpdatedRef = useRef(onThinkUpdated);
  const onSpeakUpdatedRef = useRef(onSpeakUpdated);
  const onInjectionRefusedRef = useRef(onInjectionRefused);
  const onHistoryRef = useRef(onHistory);
  const onWarningRef = useRef(onWarning);
  const onServerErrorRef = useRef(onServerError);
  const onAudioConfigRef = useRef(onAudioConfig);
  const onAudioRef = useRef(onAudio);
  const autoStartMicRef = useRef(autoStartMicrophone);

  const [internalState, setInternalState] = useState<{
    connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected';
    error: string | null;
    warning: string | null;
  }>(() => ({
    connectionState: 'idle',
    error: null,
    warning: null,
  }));

  const [internalConversation, setInternalConversation] = useState<
    Array<{ role: string; content: string }>
  >([]);

  const [internalAgentStatus, setInternalAgentStatus] = useState<{
    thinking: string | null;
    latency: { total?: number; tts?: number; ttt?: number } | null;
  }>(() => ({
    thinking: null,
    latency: null,
  }));

  const [internalIsMuted, setInternalIsMuted] = useState(false);

  const sanitizeAudioSettings = useCallback(
    (audio?: DeepgramVoiceAgentSettings['audio']) => {
      if (!audio) {
        return undefined;
      }

      const sanitized: DeepgramVoiceAgentSettings['audio'] = {};

      if (audio.input) {
        sanitized.input = { ...audio.input };
      }

      if (audio.output) {
        sanitized.output = { ...audio.output };
      }

      Object.entries(audio).forEach(([key, value]) => {
        if (key === 'input' || key === 'output') {
          return;
        }
        let clonedValue: unknown = value;
        if (Array.isArray(value)) {
          clonedValue = value.map((item) => cloneValue(item));
        } else if (isPlainObject(value)) {
          clonedValue = cloneValue(value);
        }
        (sanitized as any)[key] = clonedValue;
      });

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },
    []
  );

  const sanitizeAgentConfig = useCallback(
    (agent?: DeepgramVoiceAgentSettings['agent']) => {
      if (!agent) {
        return undefined;
      }

      const sanitized: DeepgramVoiceAgentSettings['agent'] = {};

      Object.entries(agent).forEach(([key, value]) => {
        if (key === 'speak') {
          return;
        }
        let clonedValue: unknown = value;
        if (Array.isArray(value)) {
          clonedValue = value.map((item) => cloneValue(item));
        } else if (isPlainObject(value)) {
          clonedValue = cloneValue(value);
        }
        (sanitized as any)[key] = clonedValue;
      });

      if (agent.speak) {
        sanitized.speak = { ...agent.speak };
        if (agent.speak.provider) {
          sanitized.speak.provider = { ...agent.speak.provider };
        }
      }

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },
    []
  );

  const sanitizeSettings = useCallback(
    (
      settings?: DeepgramVoiceAgentSettings
    ): DeepgramVoiceAgentSettings | undefined => {
      if (!settings) {
        return undefined;
      }

      const sanitized: DeepgramVoiceAgentSettings = {};

      Object.entries(settings).forEach(([key, value]) => {
        if (key === 'audio') {
          const audio = sanitizeAudioSettings(value as any);
          if (audio) {
            sanitized.audio = audio;
          }
          return;
        }

        if (key === 'agent') {
          const agent = sanitizeAgentConfig(value as any);
          if (agent) {
            sanitized.agent = agent;
          }
          return;
        }

        (sanitized as any)[key] = value;
      });

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },
    [sanitizeAgentConfig, sanitizeAudioSettings]
  );

  const mergeSettings = useCallback(
    (
      base?: DeepgramVoiceAgentSettings,
      override?: DeepgramVoiceAgentSettings
    ): DeepgramVoiceAgentSettings | undefined =>
      mergePlainObjects(base as any, override as any) as
        | DeepgramVoiceAgentSettings
        | undefined,
    []
  );

  defaultSettingsRef.current = defaultSettings;
  endpointRef.current = endpoint;
  reconnectConfigRef.current = { ...DEFAULT_AGENT_RECONNECT, ...reconnect };
  onBeforeConnectRef.current = onBeforeConnect;
  onConnectRef.current = onConnect;
  onCloseRef.current = onClose;
  onErrorRef.current = onError;
  onReconnectingRef.current = onReconnecting;
  onReconnectedRef.current = onReconnected;
  onMessageRef.current = onMessage;
  onWelcomeRef.current = onWelcome;
  onSettingsAppliedRef.current = onSettingsApplied;
  onConversationTextRef.current = onConversationText;
  onAgentThinkingRef.current = onAgentThinking;
  onAgentStartedSpeakingRef.current = onAgentStartedSpeaking;
  onAgentAudioDoneRef.current = onAgentAudioDone;
  onUserStartedSpeakingRef.current = onUserStartedSpeaking;
  onFunctionCallRequestRef.current = onFunctionCallRequest;
  onFunctionCallResponseRef.current = onFunctionCallResponse;
  onPromptUpdatedRef.current = onPromptUpdated;
  onListenUpdatedRef.current = onListenUpdated;
  onThinkUpdatedRef.current = onThinkUpdated;
  onSpeakUpdatedRef.current = onSpeakUpdated;
  onInjectionRefusedRef.current = onInjectionRefused;
  onHistoryRef.current = onHistory;
  onWarningRef.current = onWarning;
  onServerErrorRef.current = onServerError;
  onAudioConfigRef.current = onAudioConfig;
  onAudioRef.current = onAudio;
  autoStartMicRef.current = autoStartMicrophone;
  if (downsampleFactor != null) {
    currentDownsample.current = downsampleFactor;
  }

  const cleanup = useCallback(() => {
    if (muteKeepAliveTimerRef.current != null) {
      clearInterval(muteKeepAliveTimerRef.current);
      muteKeepAliveTimerRef.current = null;
    }
    mutedRef.current = false;
    setInternalIsMuted(false);

    if (reconnectTimerRef.current != null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;

    audioSub.current?.remove();
    audioSub.current = null;

    if (microphoneActive.current) {
      Deepgram.stopRecording().catch(() => {});
      microphoneActive.current = false;
    }

    // Cleanup audio session for playback
    Deepgram.stopAudio().catch(() => {});

    const socket = ws.current;
    if (socket) {
      ws.current = null;
      try {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close(1000, 'cleanup');
        } else {
          socket.close();
        }
      } catch {
        // ignore socket close errors
      }
    }
  }, []);

  useEffect(
    () => () => {
      userDisconnectedRef.current = true;
      cleanup();
    },
    [cleanup]
  );

  const handleMicChunk = useCallback(
    (ev: any) => {
      if (mutedRef.current) {
        return;
      }
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (typeof ev?.sampleRate === 'number' && ev.sampleRate > 0) {
        if (ev.sampleRate !== nativeInputSampleRate.current) {
          nativeInputSampleRate.current = ev.sampleRate;
          currentDownsample.current = resolveDownsampleFactor(
            downsampleFactor,
            targetInputSampleRate.current,
            nativeInputSampleRate.current
          );
        }
      }

      const factor = currentDownsample.current ?? 1;
      let chunk: ArrayBuffer | null = null;

      if (typeof ev?.b64 === 'string') {
        const binary = Uint8Array.from(atob(ev.b64), (c) => c.charCodeAt(0));
        let int16 = new Int16Array(binary.buffer);
        if (factor > 1 && int16.length >= factor) {
          const downsampled = new Int16Array(Math.floor(int16.length / factor));
          for (let i = 0; i < downsampled.length; i++) {
            downsampled[i] = int16[i * factor] ?? 0;
          }
          int16 = downsampled;
        }
        chunk = int16.buffer as ArrayBuffer;
      }

      if (!chunk) {
        return;
      }

      try {
        socket.send(chunk);
      } catch (err) {
        onErrorRef.current?.(err);
      }
    },
    [downsampleFactor]
  );

  const handleSocketMessage = useCallback(
    (ev: any) => {
      if (typeof ev.data === 'string') {
        try {
          const message = JSON.parse(
            ev.data
          ) as DeepgramVoiceAgentServerMessage;
          onMessageRef.current?.(message);

          switch (message.type) {
            case 'Welcome':
              if (hasKeys(message, ['request_id'])) {
                onWelcomeRef.current?.(
                  message as DeepgramVoiceAgentWelcomeMessage
                );
              }
              break;
            case 'SettingsApplied':
              onSettingsAppliedRef.current?.(
                message as DeepgramVoiceAgentSettingsAppliedMessage
              );
              break;
            case 'ConversationText':
              if (hasKeys(message, ['role', 'content'])) {
                const convMsg =
                  message as DeepgramVoiceAgentConversationTextMessage;

                if (trackConversation) {
                  setInternalConversation((prev) => [
                    ...prev,
                    { role: convMsg.role, content: convMsg.content },
                  ]);
                }

                onConversationTextRef.current?.(convMsg);
              }
              break;
            case 'AgentThinking':
              if (hasKeys(message, ['content'])) {
                const thinkMsg =
                  message as DeepgramVoiceAgentAgentThinkingMessage;

                if (trackAgentStatus) {
                  setInternalAgentStatus((prev) => ({
                    ...prev,
                    thinking: thinkMsg.content,
                  }));
                }

                onAgentThinkingRef.current?.(thinkMsg);
              }
              break;
            case 'AgentStartedSpeaking':
              {
                const speakMsg =
                  message as DeepgramVoiceAgentAgentStartedSpeakingMessage;

                if (trackAgentStatus) {
                  setInternalAgentStatus((prev) => ({
                    ...prev,
                    latency: {
                      total: speakMsg.total_latency,
                      tts: speakMsg.tts_latency,
                      ttt: speakMsg.ttt_latency,
                    },
                  }));
                }

                onAgentStartedSpeakingRef.current?.(speakMsg);
              }
              break;
            case 'AgentAudioDone':
              {
                const doneMsg =
                  message as DeepgramVoiceAgentAgentAudioDoneMessage;

                if (trackAgentStatus) {
                  setInternalAgentStatus({
                    thinking: null,
                    latency: null,
                  });
                }

                onAgentAudioDoneRef.current?.(doneMsg);
              }
              break;
            case 'UserStartedSpeaking':
              if (autoPlayAudio) {
                Deepgram.interruptAudio?.();
              }

              onUserStartedSpeakingRef.current?.(
                message as DeepgramVoiceAgentUserStartedSpeakingMessage
              );
              break;
            case 'FunctionCallRequest':
              if (hasKeys(message, ['functions'])) {
                onFunctionCallRequestRef.current?.(
                  message as DeepgramVoiceAgentFunctionCallRequestMessage
                );
              }
              break;
            case 'FunctionCallResponse':
              if (hasKeys(message, ['id', 'name'])) {
                onFunctionCallResponseRef.current?.(
                  message as DeepgramVoiceAgentReceiveFunctionCallResponseMessage
                );
              }
              break;
            case 'PromptUpdated':
              onPromptUpdatedRef.current?.(
                message as DeepgramVoiceAgentPromptUpdatedMessage
              );
              break;
            case 'ListenUpdated':
              onListenUpdatedRef.current?.(
                message as DeepgramVoiceAgentListenUpdatedMessage
              );
              break;
            case 'ThinkUpdated':
              onThinkUpdatedRef.current?.(
                message as DeepgramVoiceAgentThinkUpdatedMessage
              );
              break;
            case 'SpeakUpdated':
              onSpeakUpdatedRef.current?.(
                message as DeepgramVoiceAgentSpeakUpdatedMessage
              );
              break;
            case 'Audio':
              // Audio binary data will be handled by onmessage binary path
              break;
            case 'AudioConfig':
              if (hasKeys(message, ['sample_rate'])) {
                const configMsg =
                  message as DeepgramVoiceAgentAudioConfigMessage;

                if (autoPlayAudio) {
                  const sampleRate =
                    configMsg.sample_rate || DEFAULT_INPUT_SAMPLE_RATE;
                  const channels = configMsg.channels || 1;
                  Deepgram.startPlayer(sampleRate, channels);
                }

                onAudioConfigRef.current?.(configMsg);
              }
              break;
            case 'InjectionRefused':
              if (hasKeys(message, ['message'])) {
                onInjectionRefusedRef.current?.(
                  message as DeepgramVoiceAgentInjectionRefusedMessage
                );
              }
              break;
            case 'History':
              {
                const historyMsg = message as DeepgramVoiceAgentHistoryMessage;

                onHistoryRef.current?.(historyMsg);
              }
              break;
            case 'Warning':
              if (hasKeys(message, ['description'])) {
                const warnMsg = message as DeepgramVoiceAgentWarningMessage;

                if (trackState) {
                  setInternalState((prev) => ({
                    ...prev,
                    warning: warnMsg.description,
                  }));
                }

                onWarningRef.current?.(warnMsg);
              }
              break;
            case 'Error':
              {
                const description =
                  typeof (message as any).description === 'string'
                    ? (message as any).description
                    : undefined;
                const code =
                  typeof (message as any).code === 'string'
                    ? (message as any).code
                    : undefined;

                const errorMsg = description ?? code ?? 'Voice agent error';

                if (trackState) {
                  setInternalState((prev) => ({
                    ...prev,
                    connectionState: 'disconnected',
                    error: errorMsg,
                  }));
                }

                if (description || code) {
                  onServerErrorRef.current?.(
                    message as DeepgramVoiceAgentErrorMessage
                  );
                }

                onErrorRef.current?.(new Error(errorMsg));
              }
              break;
            default:
              break;
          }
        } catch (err) {
          onErrorRef.current?.(err);
        }
        return;
      }

      const buffer = ensureArrayBuffer(ev.data);
      if (buffer) {
        if (autoPlayAudio) {
          try {
            const b64 = arrayBufferToBase64(buffer);
            Deepgram.feedAudio(b64);
          } catch (err) {
            console.warn('[VoiceAgent] Auto-feed audio error:', err);
          }
        }

        onAudioRef.current?.(buffer);
      }
    },
    [autoPlayAudio, trackAgentStatus, trackConversation, trackState]
  );

  const sendJsonMessage = useCallback(
    (message: DeepgramVoiceAgentClientMessage) => {
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (err) {
        onErrorRef.current?.(err);
        return false;
      }
    },
    []
  );

  const sendBinary = useCallback(
    (chunk: ArrayBuffer | Uint8Array | number[]) => {
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      let payload: ArrayBuffer | null = null;
      if (chunk instanceof ArrayBuffer) {
        payload = chunk;
      } else if (chunk instanceof Uint8Array) {
        if (chunk.buffer instanceof ArrayBuffer) {
          payload = chunk.buffer.slice(
            chunk.byteOffset,
            chunk.byteOffset + chunk.byteLength
          );
        } else {
          const copy = new Uint8Array(chunk.byteLength);
          copy.set(chunk);
          payload = copy.buffer;
        }
      } else if (Array.isArray(chunk)) {
        const uint = new Uint8Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          uint[i] = chunk[i] ?? 0;
        }
        payload = uint.buffer;
      }

      if (!payload) return false;

      try {
        socket.send(payload);
        return true;
      } catch (err) {
        onErrorRef.current?.(err);
        return false;
      }
    },
    []
  );

  const handleAgentDisconnect = useCallback(
    (event?: { code?: number }) => {
      const cfg = reconnectConfigRef.current;
      const shouldReconnect =
        !userDisconnectedRef.current &&
        cfg.enabled &&
        event?.code !== 1000 &&
        reconnectAttemptRef.current < cfg.maxRetries;

      if (shouldReconnect) {
        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current = attempt + 1;
        reconnectingRef.current = true;

        const backoff = Math.min(
          cfg.maxDelayMs,
          cfg.initialDelayMs * 2 ** attempt
        );
        const delay = backoff + Math.random() * backoff * 0.25;

        if (trackState) {
          setInternalState((prev) => ({
            ...prev,
            connectionState: 'connecting',
          }));
        }
        onReconnectingRef.current?.(attempt + 1);

        if (reconnectTimerRef.current != null) {
          clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          openSocketRef.current();
        }, delay);
        return;
      }

      const exhausted =
        !userDisconnectedRef.current &&
        cfg.enabled &&
        reconnectAttemptRef.current >= cfg.maxRetries;

      cleanup();

      if (exhausted) {
        const err = new Error(
          `Deepgram reconnect failed after ${cfg.maxRetries} attempts`
        );
        if (trackState) {
          setInternalState((prev) => ({
            ...prev,
            connectionState: 'disconnected',
            error: err.message,
          }));
        }
        onErrorRef.current?.(err);
      } else if (trackState) {
        setInternalState((prev) => ({
          ...prev,
          connectionState: 'disconnected',
        }));
      }

      onCloseRef.current?.(event);
    },
    [cleanup, trackState]
  );

  const openSocket = useCallback(() => {
    const generation = wsGenerationRef.current + 1;
    wsGenerationRef.current = generation;

    resolveAuthHeader()
      .then((authHeader) => {
        // A newer connection attempt superseded this one while the auth token
        // was resolving — abandon this stale socket setup.
        if (generation !== wsGenerationRef.current) {
          return;
        }

        const socket = new (WebSocket as any)(
          endpointRef.current ?? getAgentUrl(),
          undefined,
          {
            headers: { Authorization: authHeader },
          }
        );

        socket.binaryType = 'arraybuffer';
        ws.current = socket;

        socket.onopen = () => {
          if (generation !== wsGenerationRef.current) return;

          const wasReconnecting = reconnectingRef.current;
          reconnectingRef.current = false;
          reconnectAttemptRef.current = 0;

          if (mergedSettingsRef.current) {
            sendJsonMessage(mergedSettingsRef.current);
          }

          if (trackState) {
            setInternalState((prev) => ({
              ...prev,
              connectionState: 'connected',
            }));
          }

          if (autoPlayAudio) {
            const sampleRate =
              mergedSettingsRef.current?.audio?.output?.sample_rate ??
              DEFAULT_INPUT_SAMPLE_RATE;
            const channels = 1;
            Deepgram.startPlayer(sampleRate, channels);
          }

          if (wasReconnecting) {
            onReconnectedRef.current?.();
          } else {
            onConnectRef.current?.();
          }
        };

        socket.onmessage = handleSocketMessage;
        socket.onerror = (err: any) => {
          if (generation !== wsGenerationRef.current) return;
          onErrorRef.current?.(err);
        };
        socket.onclose = (event: any) => {
          if (generation !== wsGenerationRef.current) return;
          handleAgentDisconnect(event);
        };
      })
      .catch((err) => {
        if (generation !== wsGenerationRef.current) return;
        onErrorRef.current?.(err);
        handleAgentDisconnect();
      });
  }, [
    autoPlayAudio,
    handleAgentDisconnect,
    handleSocketMessage,
    sendJsonMessage,
    trackState,
  ]);

  openSocketRef.current = openSocket;

  const connect = useCallback(
    async (overrideSettings?: DeepgramVoiceAgentSettings) => {
      cleanup();
      userDisconnectedRef.current = false;
      reconnectAttemptRef.current = 0;
      reconnectingRef.current = false;

      if (trackState) {
        setInternalState({
          connectionState: 'connecting',
          error: null,
          warning: null,
        });
        setInternalIsMuted(false);
      }

      if (trackConversation) {
        setInternalConversation([]);
      }
      if (trackAgentStatus) {
        setInternalAgentStatus({ thinking: null, latency: null });
      }

      onBeforeConnectRef.current?.();

      if (!hasAuthConfigured()) throw new Error('Deepgram API key missing');

      const shouldCaptureMic = autoStartMicRef.current;
      if (shouldCaptureMic) {
        const granted = await askMicPermission();
        if (!granted) {
          throw new Error('Microphone permission denied');
        }
        await Deepgram.startRecording({ enableVoiceProcessing: true });
        microphoneActive.current = true;

        if (eventName) {
          audioSub.current = getEmitter().addListener(
            eventName,
            handleMicChunk
          );
        }
      } else {
        // Only initialize audio session for playback if not recording
        // (startRecording already activates the audio session)
        await Deepgram.startAudio();
      }

      const sanitizedDefault = sanitizeSettings(defaultSettingsRef.current);
      const sanitizedOverride = sanitizeSettings(overrideSettings);

      const merged = mergeSettings(sanitizedDefault, sanitizedOverride);

      mergedSettingsRef.current = {
        type: 'Settings',
        ...(merged ?? {}),
      };

      const targetSampleRate =
        overrideSettings?.audio?.input?.sample_rate ??
        defaultSettingsRef.current?.audio?.input?.sample_rate ??
        DEFAULT_INPUT_SAMPLE_RATE;
      targetInputSampleRate.current = targetSampleRate;
      currentDownsample.current = resolveDownsampleFactor(
        downsampleFactor,
        targetInputSampleRate.current,
        nativeInputSampleRate.current
      );

      openSocket();
    },
    [
      cleanup,
      downsampleFactor,
      handleMicChunk,
      mergeSettings,
      openSocket,
      sanitizeSettings,
      trackAgentStatus,
      trackConversation,
      trackState,
    ]
  );

  const disconnect = useCallback(() => {
    userDisconnectedRef.current = true;
    cleanup();
  }, [cleanup]);

  const sendSettings = useCallback(
    (settings: DeepgramVoiceAgentSettings) => {
      const sanitized = sanitizeSettings(settings);
      const message: DeepgramVoiceAgentSettingsMessage = {
        type: 'Settings',
        ...(sanitized ?? {}),
      };
      const sent = sendJsonMessage(message);
      if (sent) {
        mergedSettingsRef.current = message;
      }
      return sent;
    },
    [sanitizeSettings, sendJsonMessage]
  );

  const injectUserMessage = useCallback(
    (content: string) =>
      sendJsonMessage({ type: 'InjectUserMessage', content }),
    [sendJsonMessage]
  );

  const injectAgentMessage = useCallback(
    (message: string, behavior?: string) =>
      sendJsonMessage({
        type: 'InjectAgentMessage',
        message,
        ...(behavior !== undefined ? { behavior } : {}),
      }),
    [sendJsonMessage]
  );

  const sendFunctionCallResponse = useCallback(
    (response: Omit<DeepgramVoiceAgentFunctionCallResponseMessage, 'type'>) =>
      sendJsonMessage({
        type: 'FunctionCallResponse',
        ...response,
      } as DeepgramVoiceAgentFunctionCallResponseMessage),
    [sendJsonMessage]
  );

  const sendKeepAlive = useCallback(
    () => sendJsonMessage({ type: 'KeepAlive' }),
    [sendJsonMessage]
  );

  const mute = useCallback(() => {
    if (mutedRef.current) {
      return;
    }
    mutedRef.current = true;

    if (muteKeepAliveTimerRef.current == null) {
      muteKeepAliveTimerRef.current = setInterval(() => {
        const socket = ws.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        try {
          socket.send(JSON.stringify({ type: 'KeepAlive' }));
        } catch {}
      }, AGENT_KEEPALIVE_INTERVAL_MS);
    }

    if (trackState) {
      setInternalIsMuted(true);
    }
  }, [trackState]);

  const unmute = useCallback(() => {
    if (!mutedRef.current) {
      return;
    }
    mutedRef.current = false;

    if (muteKeepAliveTimerRef.current != null) {
      clearInterval(muteKeepAliveTimerRef.current);
      muteKeepAliveTimerRef.current = null;
    }

    if (trackState) {
      setInternalIsMuted(false);
    }
  }, [trackState]);

  const patchAgentSettings = useCallback(
    (patch: Partial<DeepgramVoiceAgentAgentConfig>) => {
      const current = mergedSettingsRef.current;
      if (!current) {
        return;
      }
      mergedSettingsRef.current = {
        ...current,
        agent: { ...(current.agent ?? {}), ...patch },
      };
    },
    []
  );

  const updatePrompt = useCallback(
    (prompt: string) => {
      const sent = sendJsonMessage({ type: 'UpdatePrompt', prompt });
      if (sent) {
        const currentThink = mergedSettingsRef.current?.agent?.think ?? {};
        patchAgentSettings({ think: { ...currentThink, prompt } });
      }
      return sent;
    },
    [patchAgentSettings, sendJsonMessage]
  );

  const updateListen = useCallback(
    (listen: DeepgramVoiceAgentListenConfig) => {
      const sent = sendJsonMessage({ type: 'UpdateListen', listen });
      if (sent) {
        patchAgentSettings({ listen });
      }
      return sent;
    },
    [patchAgentSettings, sendJsonMessage]
  );

  const updateThink = useCallback(
    (think: DeepgramVoiceAgentThinkConfig) => {
      const sent = sendJsonMessage({ type: 'UpdateThink', think });
      if (sent) {
        patchAgentSettings({ think });
      }
      return sent;
    },
    [patchAgentSettings, sendJsonMessage]
  );

  const updateSpeak = useCallback(
    (speak: DeepgramVoiceAgentSpeakConfig) => {
      const sent = sendJsonMessage({ type: 'UpdateSpeak', speak });
      if (sent) {
        patchAgentSettings({ speak });
      }
      return sent;
    },
    [patchAgentSettings, sendJsonMessage]
  );

  const sendMessage = useCallback(
    (message: DeepgramVoiceAgentClientMessage) => sendJsonMessage(message),
    [sendJsonMessage]
  );

  const isConnected = useCallback(
    () => ws.current?.readyState === WebSocket.OPEN,
    []
  );

  const clearConversation = useCallback(() => {
    if (trackConversation) {
      setInternalConversation([]);
    }
  }, [trackConversation]);

  return {
    connect,
    disconnect,
    sendMessage,
    sendSettings,
    injectUserMessage,
    injectAgentMessage,
    sendFunctionCallResponse,
    sendKeepAlive,
    updatePrompt,
    updateListen,
    updateThink,
    updateSpeak,
    sendMedia: sendBinary,
    mute,
    unmute,
    isConnected,
    ...(trackState ? { state: internalState, isMuted: internalIsMuted } : {}),
    ...(trackConversation
      ? { conversation: internalConversation, clearConversation }
      : {}),
    ...(trackAgentStatus ? { agentStatus: internalAgentStatus } : {}),
  };
}
