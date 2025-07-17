import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
import { useRef, useCallback, useEffect } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  UseDeepgramTextToSpeechProps,
  UseDeepgramTextToSpeechReturn,
} from './types';
import { DEEPGRAM_BASEURL, DEEPGRAM_BASEWSS } from './constants';
import { buildParams } from './helpers';

/* ────────────────────────────────────────────────────────────
   Wrap the unified native module
   ──────────────────────────────────────────────────────────── */
const Deepgram = (() => {
  /** Throws if the native side isn’t linked */
  function getModule() {
    const mod = NativeModules.Deepgram;
    if (!mod) {
      throw new Error(
        'Deepgram native module not found. ' +
          'Did you rebuild the app after installing / adding the module?'
      );
    }
    return mod as {
      /** Initialise playback engine */
      startPlayer(sampleRate: number, channels: 1 | 2): void;
      /** Feed a base-64 PCM chunk */
      feedAudio(base64Pcm: string): void;
      /** Stop / reset the player */
      stopPlayer(): void;
    };
  }

  return {
    startPlayer: (sr = 16_000, ch: 1 | 2 = 1) =>
      getModule().startPlayer(sr, ch),

    feedAudio: (chunk: ArrayBuffer | Uint8Array) => {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      getModule().feedAudio(Buffer.from(u8).toString('base64'));
    },

    stopPlayer: () => getModule().stopPlayer(),
  };
})();

/* ────────────────────────────────────────────────────────────
   Hook: useDeepgramTextToSpeech
   ──────────────────────────────────────────────────────────── */
export function useDeepgramTextToSpeech({
  onBeforeSynthesize = () => {},
  onSynthesizeSuccess = () => {},
  onSynthesizeError = () => {},
  onBeforeStream = () => {},
  onStreamStart = () => {},
  onAudioChunk = () => {},
  onStreamError = () => {},
  onStreamEnd = () => {},
  options = {},
}: UseDeepgramTextToSpeechProps = {}): UseDeepgramTextToSpeechReturn {
  /* ---------- HTTP (one-shot synth) ---------- */
  const abortCtrl = useRef<AbortController | null>(null);

  const synthesize = useCallback(
    async (text: string) => {
      onBeforeSynthesize();
      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');
        if (!text?.trim()) throw new Error('Text is empty');

        const params = buildParams({
          model: options.model ?? 'aura-2-thalia-en',
          encoding: 'linear16',
          sample_rate: options.sampleRate ?? 16000,
          container: 'none',
          bit_rate: options.bitRate,
          callback: options.callback,
          callback_method: options.callbackMethod,
          mip_opt_out: options.mipOptOut,
        });

        const url = `${DEEPGRAM_BASEURL}/speak?${params.toString()}`;
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
          signal: abortCtrl.current.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        console.log(`Synthesized audio: ${res.status}`);

        const audio = await res.arrayBuffer();
        console.log(`Audio buffer size: ${audio.byteLength} bytes`);

        Deepgram.startPlayer(options.sampleRate ?? 16000, 1);
        Deepgram.feedAudio(audio);

        onSynthesizeSuccess(audio);
      } catch (err: any) {
        if (err.name !== 'AbortError') onSynthesizeError(err);
      }
    },
    [
      onBeforeSynthesize,
      onSynthesizeSuccess,
      onSynthesizeError,
      options.model,
      options.sampleRate,
      options.bitRate,
      options.callback,
      options.callbackMethod,
      options.mipOptOut,
    ]
  );

  /* ---------- WebSocket (streaming synth) ---------- */
  const ws = useRef<WebSocket | null>(null);
  const audioEmitterRef = useRef<ReturnType<
    NativeEventEmitter['addListener']
  > | null>(null);

  const closeStream = () => {
    audioEmitterRef.current?.remove();
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
    Deepgram.stopPlayer();
  };

  const startStreaming = useCallback(
    async (text: string) => {
      onBeforeStream();
      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');
        if (!text?.trim()) throw new Error('Text is empty');

        const params = buildParams({
          model: options.model ?? 'aura-2-thalia-en',
          encoding: 'linear16', // Use same encoding as HTTP for consistency
          sample_rate: options.sampleRate ?? 16000,
          bit_rate: options.bitRate,
        });

        const url = `${DEEPGRAM_BASEWSS}/speak?${params.toString()}`;
        ws.current = new (WebSocket as any)(url, undefined, {
          headers: { Authorization: `Token ${apiKey}` },
        });

        ws.current.onopen = () => {
          Deepgram.startPlayer(options.sampleRate ?? 16000, 1);
          ws.current?.send(JSON.stringify({ text }));
          onStreamStart();
        };

        ws.current.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            Deepgram.feedAudio(ev.data);
            onAudioChunk(ev.data);
          }
        };

        ws.current.onerror = onStreamError;
        ws.current.onclose = () => {
          onStreamEnd();
          closeStream();
        };
      } catch (err) {
        onStreamError(err);
        closeStream();
      }
    },
    [
      onBeforeStream,
      onStreamStart,
      onAudioChunk,
      onStreamError,
      onStreamEnd,
      options.model,
      options.sampleRate,
      options.bitRate,
    ]
  );

  const stopStreaming = useCallback(() => {
    try {
      closeStream();
      onStreamEnd();
    } catch (err) {
      onStreamError(err);
    }
  }, [onStreamEnd, onStreamError]);

  /* ---------- cleanup on unmount ---------- */
  useEffect(
    () => () => {
      abortCtrl.current?.abort();
      closeStream();
    },
    []
  );

  return { synthesize, startStreaming, stopStreaming };
}
