import { useRef, useCallback, useEffect } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
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
  DeepgramVoiceAgentSpeakUpdatedMessage,
  DeepgramVoiceAgentInjectionRefusedMessage,
  DeepgramVoiceAgentWarningMessage,
  DeepgramVoiceAgentErrorMessage,
  DeepgramVoiceAgentAudioConfigMessage,
} from './types';

const DEFAULT_AGENT_ENDPOINT = 'wss://agent.deepgram.com/v1/agent/converse';
const DEFAULT_INPUT_SAMPLE_RATE = 16_000;
const BASE_NATIVE_SAMPLE_RATE = 16_000;

const eventName = Platform.select({
  ios: 'DeepgramAudioPCM',
  android: 'AudioChunk',
  default: 'DeepgramAudioPCM',
});

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
  onSpeakUpdated?: (message: DeepgramVoiceAgentSpeakUpdatedMessage) => void;
  onInjectionRefused?: (
    message: DeepgramVoiceAgentInjectionRefusedMessage
  ) => void;
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
  injectAgentMessage: (message: string) => boolean;
  sendFunctionCallResponse: (
    response: Omit<DeepgramVoiceAgentFunctionCallResponseMessage, 'type'>
  ) => boolean;
  sendKeepAlive: () => boolean;
  updatePrompt: (prompt: string) => boolean;
  sendMedia: (chunk: ArrayBuffer | Uint8Array | number[]) => boolean;
  isConnected: () => boolean;
}

export function useDeepgramVoiceAgent({
  endpoint = DEFAULT_AGENT_ENDPOINT,
  defaultSettings,
  autoStartMicrophone = true,
  downsampleFactor,
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
  onSpeakUpdated,
  onInjectionRefused,
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
  const defaultSettingsRef = useRef(defaultSettings);
  const endpointRef = useRef(endpoint);

  const onBeforeConnectRef = useRef(onBeforeConnect);
  const onConnectRef = useRef(onConnect);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
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
  const onSpeakUpdatedRef = useRef(onSpeakUpdated);
  const onInjectionRefusedRef = useRef(onInjectionRefused);
  const onWarningRef = useRef(onWarning);
  const onServerErrorRef = useRef(onServerError);
  const onAudioConfigRef = useRef(onAudioConfig);
  const onAudioRef = useRef(onAudio);
  const autoStartMicRef = useRef(autoStartMicrophone);

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
  onBeforeConnectRef.current = onBeforeConnect;
  onConnectRef.current = onConnect;
  onCloseRef.current = onClose;
  onErrorRef.current = onError;
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
  onSpeakUpdatedRef.current = onSpeakUpdated;
  onInjectionRefusedRef.current = onInjectionRefused;
  onWarningRef.current = onWarning;
  onServerErrorRef.current = onServerError;
  onAudioConfigRef.current = onAudioConfig;
  onAudioRef.current = onAudio;
  autoStartMicRef.current = autoStartMicrophone;
  if (downsampleFactor != null) {
    currentDownsample.current = downsampleFactor;
  }

  const cleanup = useCallback(() => {
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

  useEffect(() => () => cleanup(), [cleanup]);

  const handleMicChunk = useCallback(
    (ev: any) => {
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
            downsampled[i] = int16[i * factor];
          }
          int16 = downsampled;
        }
        chunk = int16.buffer;
      } else if (Array.isArray(ev?.data)) {
        const bytes = new Uint8Array(ev.data.length);
        for (let i = 0; i < ev.data.length; i++) {
          const value = ev.data[i];
          bytes[i] = value < 0 ? value + 256 : value;
        }
        const view = new DataView(bytes.buffer);
        const int16 = new Int16Array(bytes.length / 2);
        for (let i = 0; i < int16.length; i++) {
          int16[i] = view.getInt16(i * 2, true);
        }
        chunk = int16.buffer;
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
    [downsampleFactor, onErrorRef]
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
                onConversationTextRef.current?.(
                  message as DeepgramVoiceAgentConversationTextMessage
                );
              }
              break;
            case 'AgentThinking':
              if (hasKeys(message, ['content'])) {
                onAgentThinkingRef.current?.(
                  message as DeepgramVoiceAgentAgentThinkingMessage
                );
              }
              break;
            case 'AgentStartedSpeaking':
              onAgentStartedSpeakingRef.current?.(
                message as DeepgramVoiceAgentAgentStartedSpeakingMessage
              );
              break;
            case 'AgentAudioDone':
              onAgentAudioDoneRef.current?.(
                message as DeepgramVoiceAgentAgentAudioDoneMessage
              );
              break;
            case 'UserStartedSpeaking':
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
                onAudioConfigRef.current?.(
                  message as DeepgramVoiceAgentAudioConfigMessage
                );
              }
              break;
            case 'InjectionRefused':
              if (hasKeys(message, ['message'])) {
                onInjectionRefusedRef.current?.(
                  message as DeepgramVoiceAgentInjectionRefusedMessage
                );
              }
              break;
            case 'Warning':
              if (hasKeys(message, ['description'])) {
                onWarningRef.current?.(
                  message as DeepgramVoiceAgentWarningMessage
                );
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

                if (description || code) {
                  onServerErrorRef.current?.(
                    message as DeepgramVoiceAgentErrorMessage
                  );
                }

                onErrorRef.current?.(
                  new Error(description ?? code ?? 'Voice agent error')
                );
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
        // Binary audio from server
        onAudioRef.current?.(buffer);
      }
    },
    [
      onAgentAudioDoneRef,
      onAgentStartedSpeakingRef,
      onAgentThinkingRef,
      onConversationTextRef,
      onErrorRef,
      onFunctionCallRequestRef,
      onFunctionCallResponseRef,
      onInjectionRefusedRef,
      onMessageRef,
      onPromptUpdatedRef,
      onServerErrorRef,
      onSettingsAppliedRef,
      onSpeakUpdatedRef,
      onUserStartedSpeakingRef,
      onWarningRef,
    ]
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
          uint[i] = chunk[i];
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

  const connect = useCallback(
    async (overrideSettings?: DeepgramVoiceAgentSettings) => {
      cleanup();
      onBeforeConnectRef.current?.();

      const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
      if (!apiKey) throw new Error('Deepgram API key missing');

      const shouldCaptureMic = autoStartMicRef.current;
      if (shouldCaptureMic) {
        const granted = await askMicPermission();
        if (!granted) {
          throw new Error('Microphone permission denied');
        }
        await Deepgram.startRecording();
        microphoneActive.current = true;

        const emitter = new NativeEventEmitter(NativeModules.Deepgram);
        if (eventName) {
          audioSub.current = emitter.addListener(eventName, handleMicChunk);
        }
      } else {
        // Only initialize audio session for playback if not recording
        // (startRecording already activates the audio session)
        await Deepgram.startAudio();
      }

      const sanitizedDefault = sanitizeSettings(defaultSettingsRef.current);
      const sanitizedOverride = sanitizeSettings(overrideSettings);

      const merged = mergeSettings(sanitizedDefault, sanitizedOverride);

      const mergedSettings: DeepgramVoiceAgentSettingsMessage = {
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

      const socket = new (WebSocket as any)(endpointRef.current, undefined, {
        headers: { Authorization: `Token ${apiKey}` },
      });

      socket.binaryType = 'arraybuffer';
      ws.current = socket;

      socket.onopen = () => {
        sendJsonMessage(mergedSettings);
        onConnectRef.current?.();
      };

      socket.onmessage = handleSocketMessage;
      socket.onerror = (err: any) => {
        onErrorRef.current?.(err);
      };
      socket.onclose = (event: any) => {
        cleanup();
        onCloseRef.current?.(event);
      };
    },
    [
      cleanup,
      downsampleFactor,
      handleMicChunk,
      handleSocketMessage,
      mergeSettings,
      sanitizeSettings,
      sendJsonMessage,
    ]
  );

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const sendSettings = useCallback(
    (settings: DeepgramVoiceAgentSettings) => {
      const sanitized = sanitizeSettings(settings);
      return sendJsonMessage({ type: 'Settings', ...(sanitized ?? {}) });
    },
    [sanitizeSettings, sendJsonMessage]
  );

  const injectUserMessage = useCallback(
    (content: string) =>
      sendJsonMessage({ type: 'InjectUserMessage', content }),
    [sendJsonMessage]
  );

  const injectAgentMessage = useCallback(
    (message: string) =>
      sendJsonMessage({ type: 'InjectAgentMessage', message }),
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

  const updatePrompt = useCallback(
    (prompt: string) => sendJsonMessage({ type: 'UpdatePrompt', prompt }),
    [sendJsonMessage]
  );

  const sendMessage = useCallback(
    (message: DeepgramVoiceAgentClientMessage) => sendJsonMessage(message),
    [sendJsonMessage]
  );

  const isConnected = useCallback(
    () => ws.current?.readyState === WebSocket.OPEN,
    []
  );

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
    sendMedia: sendBinary,
    isConnected,
  };
}
