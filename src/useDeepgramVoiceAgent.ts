import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
import { useRef, useCallback, useEffect } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import type {
  DeepgramVoiceAgentSettings,
  DeepgramVoiceAgentSettingsMessage,
  DeepgramVoiceAgentUpdateSpeakMessage,
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
} from './types';

const DEFAULT_AGENT_ENDPOINT = 'wss://agent.deepgram.com/v1/agent/converse';
const DEFAULT_INPUT_SAMPLE_RATE = 24_000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 24_000;
const BASE_NATIVE_SAMPLE_RATE = 48_000;

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

const hasKeys = (value: unknown, keys: string[]) =>
  typeof value === 'object' &&
  value !== null &&
  keys.every((key) => key in (value as Record<string, unknown>));

const computeDownsampleFactor = (target: number | undefined) => {
  if (!target || target >= BASE_NATIVE_SAMPLE_RATE) {
    return 1;
  }
  const ratio = Math.round(BASE_NATIVE_SAMPLE_RATE / target);
  return ratio > 0 ? ratio : 1;
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
  autoPlayAgentAudio?: boolean;
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
  onAgentAudioChunk?: (chunk: ArrayBuffer) => void;
}

export interface UseDeepgramVoiceAgentReturn {
  connect: (settings?: DeepgramVoiceAgentSettings) => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: DeepgramVoiceAgentClientMessage) => boolean;
  sendSettings: (settings: DeepgramVoiceAgentSettings) => boolean;
  updateSpeak: (
    speak: DeepgramVoiceAgentUpdateSpeakMessage['speak']
  ) => boolean;
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
  autoPlayAgentAudio = true,
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
  onAgentAudioChunk,
}: UseDeepgramVoiceAgentProps = {}): UseDeepgramVoiceAgentReturn {
  const ws = useRef<WebSocketLike | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const currentDownsample = useRef(
    downsampleFactor ?? computeDownsampleFactor(DEFAULT_INPUT_SAMPLE_RATE)
  );
  const playbackActive = useRef(false);
  const playbackConfig = useRef<{
    sampleRate: number;
    channels: number;
  } | null>(null);
  const microphoneActive = useRef(false);
  const suppressMicRef = useRef(false);
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
  const onAgentAudioChunkRef = useRef(onAgentAudioChunk);
  const autoStartMicRef = useRef(autoStartMicrophone);
  const autoPlayAudioRef = useRef(autoPlayAgentAudio);

  const applyOutputSampleRate = useCallback(
    (sampleRate?: number, channels?: number) => {
      const normalizedSampleRate =
        typeof sampleRate === 'number' && Number.isFinite(sampleRate)
          ? sampleRate
          : undefined;

      if (!normalizedSampleRate) {
        return;
      }

      let normalizedChannels = 1;
      if (
        typeof channels === 'number' &&
        Number.isFinite(channels) &&
        channels > 0
      ) {
        normalizedChannels = channels;
      }

      playbackConfig.current = {
        sampleRate: normalizedSampleRate,
        channels: normalizedChannels,
      };

      if (!autoPlayAudioRef.current) {
        return;
      }

      try {
        if (typeof Deepgram.setAudioConfig === 'function') {
          Deepgram.setAudioConfig(normalizedSampleRate, normalizedChannels);
          playbackActive.current = true;
          return;
        }

        if (typeof Deepgram.startPlayer === 'function') {
          Deepgram.startPlayer(normalizedSampleRate, normalizedChannels);
          playbackActive.current = true;
          return;
        }

        if (
          !playbackActive.current &&
          typeof Deepgram.startAudio === 'function'
        ) {
          Promise.resolve(Deepgram.startAudio())
            .then(() => {
              playbackActive.current = true;
            })
            .catch((err) => {
              onErrorRef.current?.(err);
            });
        }
      } catch (err) {
        onErrorRef.current?.(err);
      }
    },
    [onErrorRef]
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
  onAgentAudioChunkRef.current = onAgentAudioChunk;
  autoStartMicRef.current = autoStartMicrophone;
  autoPlayAudioRef.current = autoPlayAgentAudio;
  if (downsampleFactor != null) {
    currentDownsample.current = downsampleFactor;
  }

  useEffect(() => {
    if (!autoPlayAgentAudio) {
      if (playbackActive.current) {
        try {
          if (typeof Deepgram.stopPlayer === 'function') {
            Deepgram.stopPlayer();
          } else if (typeof Deepgram.stopAudio === 'function') {
            Deepgram.stopAudio().catch((err) => {
              onErrorRef.current?.(err);
            });
          }
        } catch (err) {
          onErrorRef.current?.(err);
        } finally {
          playbackActive.current = false;
        }
      }
      suppressMicRef.current = false;
      return;
    }

    const config = playbackConfig.current;
    if (config) {
      applyOutputSampleRate(config.sampleRate, config.channels);
    }
  }, [autoPlayAgentAudio, applyOutputSampleRate, onErrorRef]);

  const cleanup = useCallback(() => {
    audioSub.current?.remove();
    audioSub.current = null;

    if (microphoneActive.current) {
      Deepgram.stopRecording().catch(() => {});
      microphoneActive.current = false;
    }

    suppressMicRef.current = false;

    if (playbackActive.current) {
      try {
        if (typeof Deepgram.stopPlayer === 'function') {
          Deepgram.stopPlayer();
        } else if (typeof Deepgram.stopAudio === 'function') {
          Deepgram.stopAudio().catch((err) => {
            onErrorRef.current?.(err);
          });
        }
      } catch (err) {
        onErrorRef.current?.(err);
      }
      playbackActive.current = false;
    }

    playbackConfig.current = null;

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
  }, [onErrorRef]);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleMicChunk = useCallback(
    (ev: any) => {
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (suppressMicRef.current) {
        return;
      }

      const factor = currentDownsample.current ?? 1;
      let chunk: ArrayBuffer | null = null;

      if (typeof ev?.b64 === 'string') {
        const binary = Uint8Array.from(atob(ev.b64), (c) => c.charCodeAt(0));
        const float32 = new Float32Array(binary.buffer);
        const downsampled =
          factor > 1 ? float32.filter((_, i) => i % factor === 0) : float32;
        const int16 = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const sample = Math.max(-1, Math.min(1, downsampled[i]));
          int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
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
    [onErrorRef]
  );

  const handleAgentAudio = useCallback(
    (base64: string, rawBuffer?: ArrayBuffer) => {
      if (!base64) {
        return;
      }

      if (autoPlayAudioRef.current) {
        suppressMicRef.current = true;
      }

      let buffer = rawBuffer ?? null;

      if (!buffer) {
        try {
          const audio = Buffer.from(base64, 'base64');
          if (audio.length > 0) {
            buffer = audio.buffer.slice(
              audio.byteOffset,
              audio.byteOffset + audio.length
            );
          }
        } catch (err) {
          onErrorRef.current?.(err);
          return;
        }
      }

      if (buffer) {
        onAgentAudioChunkRef.current?.(buffer);
      }

      if (!autoPlayAudioRef.current) {
        return;
      }

      try {
        if (typeof Deepgram.feedAudio === 'function') {
          Deepgram.feedAudio(base64);
          playbackActive.current = true;
          return;
        }

        if (typeof Deepgram.playAudioChunk === 'function') {
          const result = Deepgram.playAudioChunk(base64);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>)
              .then(() => {
                playbackActive.current = true;
              })
              .catch((err) => {
                onErrorRef.current?.(err);
              });
          } else {
            playbackActive.current = true;
          }
        }
      } catch (err) {
        onErrorRef.current?.(err);
      }
    },
    [onAgentAudioChunkRef, onErrorRef]
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
              if (autoPlayAudioRef.current) {
                suppressMicRef.current = true;
              }
              onAgentStartedSpeakingRef.current?.(
                message as DeepgramVoiceAgentAgentStartedSpeakingMessage
              );
              break;
            case 'AgentAudioDone':
              suppressMicRef.current = false;
              onAgentAudioDoneRef.current?.(
                message as DeepgramVoiceAgentAgentAudioDoneMessage
              );
              break;
            case 'UserStartedSpeaking':
              suppressMicRef.current = false;
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
            case 'Audio': {
              const payload = message as {
                chunk?: string;
                sample_rate?: number;
                channels?: number;
              };

              if (typeof payload.sample_rate === 'number') {
                applyOutputSampleRate(payload.sample_rate, payload.channels);
              }

              if (typeof payload.chunk === 'string' && payload.chunk) {
                if (autoPlayAudioRef.current) {
                  suppressMicRef.current = true;
                }
                handleAgentAudio(payload.chunk);
              }
              break;
            }
            case 'AudioConfig': {
              const sampleRate = Number((message as any)?.sample_rate);
              const channels = Number((message as any)?.channels);
              if (Number.isFinite(sampleRate)) {
                applyOutputSampleRate(
                  sampleRate,
                  Number.isFinite(channels) ? channels : undefined
                );
              }
              break;
            }
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
          try {
            if (ev.data) {
              handleAgentAudio(ev.data);
            }
          } catch (error) {
            onErrorRef.current?.(err ?? error);
          }
        }
        return;
      }

      const buffer = ensureArrayBuffer(ev.data);
      if (buffer) {
        const base64 = Buffer.from(new Uint8Array(buffer)).toString('base64');
        handleAgentAudio(base64, buffer);
      }
    },
    [applyOutputSampleRate, handleAgentAudio]
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
        suppressMicRef.current = false;

        const emitter = new NativeEventEmitter(NativeModules.Deepgram);
        if (eventName) {
          audioSub.current = emitter.addListener(eventName, handleMicChunk);
        }
      }

      if (autoPlayAudioRef.current) {
        const outputSampleRate =
          overrideSettings?.audio?.output?.sample_rate ??
          defaultSettingsRef.current?.audio?.output?.sample_rate ??
          DEFAULT_OUTPUT_SAMPLE_RATE;

        const outputChannels =
          (overrideSettings?.audio?.output as any)?.channels ??
          (defaultSettingsRef.current?.audio?.output as any)?.channels;

        applyOutputSampleRate(outputSampleRate, outputChannels);
      }

      const mergedSettings: DeepgramVoiceAgentSettingsMessage = {
        type: 'Settings',
        ...(defaultSettingsRef.current ?? {}),
        ...(overrideSettings ?? {}),
      };

      const targetSampleRate =
        overrideSettings?.audio?.input?.sample_rate ??
        defaultSettingsRef.current?.audio?.input?.sample_rate ??
        DEFAULT_INPUT_SAMPLE_RATE;
      currentDownsample.current =
        downsampleFactor ?? computeDownsampleFactor(targetSampleRate);

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
      applyOutputSampleRate,
      cleanup,
      downsampleFactor,
      handleMicChunk,
      handleSocketMessage,
      sendJsonMessage,
    ]
  );

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const sendSettings = useCallback(
    (settings: DeepgramVoiceAgentSettings) =>
      sendJsonMessage({ type: 'Settings', ...settings }),
    [sendJsonMessage]
  );

  const updateSpeak = useCallback(
    (speak: DeepgramVoiceAgentUpdateSpeakMessage['speak']) =>
      sendJsonMessage({ type: 'UpdateSpeak', speak }),
    [sendJsonMessage]
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
    updateSpeak,
    injectUserMessage,
    injectAgentMessage,
    sendFunctionCallResponse,
    sendKeepAlive,
    updatePrompt,
    sendMedia: sendBinary,
    isConnected,
  };
}
