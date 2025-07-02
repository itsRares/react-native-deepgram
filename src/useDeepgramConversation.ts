import { useEffect, useRef, useCallback } from 'react';
import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { Audio } from 'expo-av';
import { AgentEvents } from '@deepgram/sdk';
import type { VoiceAgentController } from './types';
import type {
  UseConversationHook,
  Message,
} from './types/use-conversation-hook';
import { Deepgram } from './NativeDeepgram';

/* ---------------------------------------------------------------- */
/* ➜ 1. Constants / helpers                                         */
/* ---------------------------------------------------------------- */

const AUDIO_EVT_NATIVE = Platform.select({
  ios: 'DeepgramAudioPCM',
  android: 'AudioChunk', // emitted by AudioRecorder.kt
})!;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const binary = String.fromCharCode(...bytes);
  return global.btoa(binary);
};

/* ---------------------------------------------------------------- */
/* ➜ 2. Hook                                                        */
/* ---------------------------------------------------------------- */

/**
 * Props you pass into the hook – mirrors the blog.
 */
export type UseDeepgramConversationProps = {
  onBeforeStarting?: () => void;
  onStarted?: (vac: VoiceAgentController) => void;
  onAfterStarted?: () => void;
  onError?: (err: unknown) => void;
  onEnd?: () => void;
  onMessage?: (event: Message) => void;
};

/**
 * Hook return type – start/stop only.
 */
export type UseDeepgramConversationReturn = {
  startSession: () => void;
  stopSession: () => void;
};

/**
 * Main hook.
 */
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
  const keepAliveTimer = useRef<NodeJS.Timeout | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const convoContextRef = useRef<any>(null);
  const instructionsRef = useRef<string | null>(null);

  /* Helpers ------------------------------------------------------ */

  const apiKey: string | undefined = (global as any).__DEEPGRAM_API_KEY__;

  const closeEverything = () => {
    audioSub.current?.remove();
    keepAliveTimer.current && clearInterval(keepAliveTimer.current);
    Deepgram.stopRecording().catch(() => {});
    Deepgram.stopAudio().catch(() => {});
    ws.current?.close(1000, 'clean-up');
    ws.current = null;
  };

  /* startSession ------------------------------------------------- */

  const startSession = useCallback(async () => {
    try {
      onBeforeStarting();
      /* 1. Mic permissions */
      const granted =
        Platform.OS === 'ios'
          ? (await Audio.requestPermissionsAsync()).granted
          : (await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
              {
                title: 'Microphone',
                message: 'Microphone permission',
                buttonPositive: 'OK',
              }
            )) === PermissionsAndroid.RESULTS.GRANTED;

      if (!granted) throw new Error('Microphone permission denied');

      /* 2. Kick off native pipes */
      await Deepgram.startRecording();
      await Deepgram.startAudio();

      /* 3. Build voice-agent controller */
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
        makeAgentSay: async () => undefined, // not wired yet
        startConversation: async () => {
          if (!apiKey)
            throw new Error(
              'Deepgram API key missing – call configure() first'
            );

          const settings: any = {
            audio: {
              input: { encoding: 'linear16', sample_rate: 16000 },
              output: {
                encoding: 'linear16',
                sample_rate: 16000,
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

          ws.current = new WebSocket(
            'wss://agent.deepgram.com/agent',
            undefined,
            { headers: { Authorization: `Token ${apiKey}` } }
          );

          ws.current.onopen = () => {
            ws.current?.send(
              JSON.stringify({ type: 'SettingsConfiguration', ...settings })
            );
          };

          /* Forward PCM chunks ➜ WebSocket */
          const emitter = new NativeEventEmitter(NativeModules.Deepgram);
          audioSub.current = emitter.addListener(
            AUDIO_EVT_NATIVE,
            ({ data }: { data: number[] }) => {
              ws.current?.readyState === WebSocket.OPEN &&
                ws.current.send(new Uint8Array(data).buffer);
            }
          );

          /* WS events */
          ws.current.onmessage = (ev) => {
            if (typeof ev.data === 'string') {
              const msg = JSON.parse(ev.data);
              switch (msg.type as AgentEvents) {
                case AgentEvents.SettingsApplied:
                  /* nothing */ break;
                case AgentEvents.ConversationText:
                  onMessage({
                    role: msg.role,
                    content: msg.content,
                    timestamp: Date.now(),
                  });
                  break;
              }
            } else if (ev.data instanceof ArrayBuffer) {
              Deepgram.playAudioChunk(arrayBufferToBase64(ev.data)).catch(
                console.error
              );
            }
          };

          ws.current.onerror = onError;
          ws.current.onclose = onEnd;

          /* Keep-alive */
          keepAliveTimer.current = setInterval(() => {
            ws.current?.readyState === WebSocket.OPEN &&
              ws.current.send(JSON.stringify({ type: 'KeepAlive' }));
          }, 5_000);
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

  /* automatic cleanup on unmount */
  useEffect(() => {
    return () => {
      stopSession().catch(() => {});
    };
  }, [stopSession]);

  return { startSession, stopSession };
};
