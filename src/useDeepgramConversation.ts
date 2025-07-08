import { useEffect, useRef, useCallback } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { VoiceAgentController } from './types';
import type {
  UseConversationHook,
  Message,
} from './types/use-conversation-hook';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';

/* ---------------------------------------------------------------- */
/* ➜ 1. Constants / helpers                                         */
/* ---------------------------------------------------------------- */

const AUDIO_EVT_NATIVE = Platform.select({
  ios: 'DeepgramAudioPCM',
  android: 'DeepgramAudioPCM',
}) as string;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string =>
  global.btoa(String.fromCharCode(...new Uint8Array(buffer)));

/* ---------------------------------------------------------------- */
/* ➜ 2. Hook                                                        */
/* ---------------------------------------------------------------- */

export type UseDeepgramConversationProps = {
  onBeforeStarting?: () => void;
  onStarted?: (vac: VoiceAgentController) => void;
  onAfterStarted?: () => void;
  onError?: (err: unknown) => void;
  onEnd?: () => void;
  onMessage?: (event: Message) => void;
};

export type UseDeepgramConversationReturn = {
  startSession: () => void;
  stopSession: () => void;
};

export const useDeepgramConversation: UseConversationHook = ({
  onBeforeStarting = () => {},
  onStarted = () => {},
  onAfterStarted = () => {},
  onError = () => {},
  onEnd = () => {},
  onMessage = () => {},
}: UseDeepgramConversationProps): UseDeepgramConversationReturn => {
  /* Refs --------------------------------------------------------- */
  const ws = useRef<WebSocket | null>(null);
  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const convoContextRef = useRef<any>(null);
  const instructionsRef = useRef<string | null>(null);

  /* Helpers ------------------------------------------------------ */
  const apiKey: string | undefined = (global as any).__DEEPGRAM_API_KEY__;

  const closeEverything = () => {
    audioSub.current?.remove();
    if (keepAlive.current) clearInterval(keepAlive.current);
    Deepgram.stopRecording().catch(() => {});
    Deepgram.stopAudio().catch(() => {});
    ws.current?.close(1000, 'clean-up');
    ws.current = null;
  };

  /* startSession ------------------------------------------------- */
  const startSession = useCallback(async () => {
    try {
      onBeforeStarting();

      /* 🆕 microphone permission */
      const granted = await askMicPermission();
      if (!granted) throw new Error('Microphone permission denied');

      /* 2️⃣ Start native capture / playback */
      await Deepgram.startRecording();
      await Deepgram.startAudio();

      /* 3️⃣ Build the controller object */
      const vac: VoiceAgentController = {
        sendInitialIntructions: async (s) => {
          instructionsRef.current = s;
        },
        setInitialConversationPhrases: async (p) => {
          convoContextRef.current = p.map(({ role, text }) => ({
            role,
            content: text,
          }));
        },
        makeAgentSay: async () => undefined,
        startConversation: async () => {
          if (!apiKey)
            throw new Error(
              'Deepgram API key missing – call configure() first'
            );

          /* Deepgram settings – 48 kHz Float32 in, 16 kHz Int16 out */
          const settings = {
            audio: {
              input: { encoding: 'float32', sample_rate: 48_000 },
              output: {
                encoding: 'linear16',
                sample_rate: 16_000,
                container: 'none',
              },
            },
            agent: {
              listen: { model: 'nova-2' },
              speak: { model: 'aura-asteria-en' },
              think: {
                model: 'gpt-4o-mini',
                provider: { type: 'open_ai' },
                instructions:
                  instructionsRef.current ?? 'You are a helpful agent',
              },
            },
            context: {
              messages: convoContextRef.current ?? [],
              replay: !!convoContextRef.current?.length,
            },
          };

          /* Open WebSocket with auth header */
          ws.current = new (WebSocket as any)(
            'wss://agent.deepgram.com/agent',
            undefined,
            { headers: { Authorization: `Token ${apiKey}` } }
          );

          /* Send configuration on open */
          ws.current.onopen = () =>
            ws.current?.send(
              JSON.stringify({ type: 'SettingsConfiguration', ...settings })
            );

          /* Forward PCM chunks (base-64 Float32) ➜ WS */
          const emitter = new NativeEventEmitter(NativeModules.Deepgram);
          audioSub.current = emitter.addListener(
            AUDIO_EVT_NATIVE,
            ({ b64 }: { b64: string }) => {
              if (ws.current?.readyState === WebSocket.OPEN) {
                const binary = Uint8Array.from(atob(b64), (c) =>
                  c.charCodeAt(0)
                );
                ws.current.send(binary.buffer);
              }
            }
          );

          /* Handle WS events */
          ws.current.onmessage = (ev) => {
            if (typeof ev.data === 'string') {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'ConversationText') {
                onMessage({
                  role: msg.role,
                  content: msg.content,
                  timestamp: Date.now(),
                });
              }
            } else if (ev.data instanceof ArrayBuffer) {
              Deepgram.playAudioChunk(arrayBufferToBase64(ev.data)).catch(
                console.error
              );
            }
          };
          ws.current.onerror = onError;
          ws.current.onclose = onEnd;

          /* Keep-alive ping */
          keepAlive.current = setInterval(() => {
            ws.current?.readyState === WebSocket.OPEN &&
              ws.current.send(JSON.stringify({ type: 'KeepAlive' }));
          }, 5000);
        },
      };

      onStarted(vac);
    } catch (err) {
      onError(err);
      closeEverything();
    } finally {
      onAfterStarted();
    }
  }, [
    apiKey,
    onBeforeStarting,
    onStarted,
    onAfterStarted,
    onError,
    onEnd,
    onMessage,
  ]);

  /* stopSession -------------------------------------------------- */
  const stopSession = useCallback(async () => {
    try {
      closeEverything();
      onEnd();
    } catch (err) {
      onError(err);
    }
  }, [onEnd, onError]);

  /* cleanup on unmount ------------------------------------------ */
  useEffect(() => {
    return () => {
      stopSession().catch(() => {});
    };
  }, [stopSession]);

  return { startSession, stopSession };
};
