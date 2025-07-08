import { useEffect, useRef, useCallback } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import type {
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from './types';

export function UseDeepgramSpeechToText({
  onBeforeStart = () => {},
  onStart = () => {},
  onTranscript = () => {},
  onError = () => {},
  onEnd = () => {},
  onBeforeTranscribe = () => {},
  onTranscribeSuccess = () => {},
  onTranscribeError = () => {},
}: UseDeepgramSpeechToTextProps): UseDeepgramSpeechToTextReturn {
  const ws = useRef<WebSocket | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );

  const closeEverything = () => {
    audioSub.current?.remove();
    Deepgram.stopRecording().catch(() => {});
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
  };

  const startListening = useCallback(async () => {
    try {
      onBeforeStart();

      const granted = await askMicPermission();
      if (!granted) throw new Error('Microphone permission denied');

      await Deepgram.startRecording();

      const apiKey = (global as any).__DEEPGRAM_API_KEY__;
      if (!apiKey) throw new Error('Deepgram API key missing');

      const params = new URLSearchParams({
        encoding: 'linear16',
        sample_rate: '16000',
      }).toString();

      const url = `wss://api.deepgram.com/v1/listen?${params}`;

      ws.current = new (WebSocket as any)(url, undefined, {
        headers: { Authorization: `Token ${apiKey}` },
      });

      ws.current.onopen = () => onStart();

      const emitter = new NativeEventEmitter(NativeModules.Deepgram);
      audioSub.current = emitter.addListener(
        Platform.select({
          ios: 'DeepgramAudioPCM',
          android: 'AudioChunk',
        }) as string,
        ({ b64 }: { b64: string }) => {
          const floatBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const float32 = new Float32Array(floatBytes.buffer);

          const downsampled = float32.filter((_, i) => i % 3 === 0);

          const int16 = new Int16Array(downsampled.length);
          for (let i = 0; i < downsampled.length; i++) {
            const s = Math.max(-1, Math.min(1, downsampled[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(int16.buffer);
          }
        }
      );

      ws.current.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data);
            const transcript = msg.channel?.alternatives?.[0]?.transcript;
            if (transcript) onTranscript(transcript);
          } catch {
            // non-JSON or unexpected format
          }
        }
      };

      ws.current.onerror = onError;
      ws.current.onclose = () => {
        onEnd();
        closeEverything();
      };
    } catch (err) {
      onError(err);
      closeEverything();
    }
  }, [onBeforeStart, onStart, onTranscript, onError, onEnd]);

  const stopListening = useCallback(() => {
    try {
      closeEverything();
      onEnd();
    } catch (err) {
      onError(err);
    }
  }, [onEnd, onError]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const transcribeFile = useCallback(
    async (file: Blob | { uri: string; name?: string; type?: string }) => {
      onBeforeTranscribe();
      try {
        const apiKey = (global as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const formData = new FormData();
        if (file instanceof Blob) {
          formData.append('audio', file, 'recording.wav');
        } else {
          formData.append('audio', {
            uri: file.uri,
            name: file.name || 'recording.wav',
            type: file.type || 'audio/wav',
          } as any);
        }

        const res = await fetch('https://api.deepgram.com/v1/listen', {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
          },
          body: formData,
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`HTTP ${res.status}: ${errBody}`);
        }

        const json = await res.json();
        const transcript =
          json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        if (transcript) {
          onTranscribeSuccess(transcript);
        } else {
          throw new Error('No transcript present in Deepgram response');
        }
      } catch (err) {
        onTranscribeError(err);
      }
    },
    [onBeforeTranscribe, onTranscribeSuccess, onTranscribeError]
  );

  return { startListening, stopListening, transcribeFile };
}
