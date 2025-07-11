import { useEffect, useRef, useCallback } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import type {
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from './types';
import { DEEPGRAM_BASEURL, DEEPGRAM_BASEWSS } from './constants';
import { buildParams } from './helpers';

export function useDeepgramSpeechToText({
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

      const params = buildParams({
        encoding: 'linear16',
        sample_rate: '16000',
      });

      const url = `${DEEPGRAM_BASEWSS}/listen?${params}`;

      ws.current = new (WebSocket as any)(url, undefined, {
        headers: { Authorization: `Token ${apiKey}` },
      });
      ws.current.binaryType = 'arraybuffer';

      ws.current.onopen = () => onStart();

      const emitter = new NativeEventEmitter(NativeModules.Deepgram);
      audioSub.current = emitter.addListener(
        Platform.select({
          ios: 'DeepgramAudioPCM',
          android: 'AudioChunk',
        }) as string,
        (ev: any) => {
          let chunk: ArrayBuffer | undefined;
          if (typeof ev?.b64 === 'string') {
            const floatBytes = Uint8Array.from(atob(ev.b64), (c) =>
              c.charCodeAt(0)
            );
            const float32 = new Float32Array(floatBytes.buffer);
            const downsampled = float32.filter((_, i) => i % 3 === 0);
            const int16 = new Int16Array(downsampled.length);
            for (let i = 0; i < downsampled.length; i++) {
              const s = Math.max(-1, Math.min(1, downsampled[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            chunk = int16.buffer;
            console.log(int16.buffer);
          } else if (Array.isArray(ev?.data)) {
            const bytes = new Uint8Array(ev.data.length);
            for (let i = 0; i < ev.data.length; i++) {
              const v = ev.data[i];
              bytes[i] = v < 0 ? v + 256 : v;
            }
            const view = new DataView(bytes.buffer);
            const int16 = new Int16Array(bytes.length / 2);
            for (let i = 0; i < int16.length; i++) {
              int16[i] = view.getInt16(i * 2, true);
            }
            chunk = int16.buffer;
          }

          if (chunk && ws.current?.readyState === WebSocket.OPEN) {
            console.log('byteLength', chunk.byteLength);
            ws.current.send(chunk);
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

        const res = await fetch(`${DEEPGRAM_BASEURL}/listen`, {
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
