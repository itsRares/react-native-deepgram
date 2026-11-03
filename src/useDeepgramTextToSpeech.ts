import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Deepgram } from './native';
import { arrayBufferToBase64 } from './helpers/audioUtils';
import { resolveAuthHeader } from './helpers/auth';
import { addInterruptionListener } from './interruption';
import {
  buildSpeakHttpParams,
  buildSpeakHttpUrl,
  buildSpeakStreamUrl,
  DEFAULT_TTS_SAMPLE_RATE,
  deriveTtsMimeType,
  resolveHttpOptions,
  resolveStreamOptions,
} from './internal/speakOptions';
import { toArrayBuffer } from './internal/pcm';
import { useLatest } from './internal/useLatest';
import { toDeepgramError } from './types/errors';
import type {
  DeepgramTextToSpeechBytes,
  DeepgramTextToSpeechHttpOptions,
  DeepgramTextToSpeechStreamErrorMessage,
  DeepgramTextToSpeechStreamInputMessage,
  DeepgramTextToSpeechStreamResponseMessage,
  UseDeepgramTextToSpeechProps,
  UseDeepgramTextToSpeechReturn,
} from './types';

const TTS_BYTES_CACHE_MAX = 50;

type SpeakStatus = 'idle' | 'loading' | 'connecting' | 'connected' | 'error';

type HeaderWebSocket = new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> }
) => WebSocket;

const toBase64 = (chunk: ArrayBuffer | Uint8Array) =>
  arrayBufferToBase64(toArrayBuffer(chunk) ?? new ArrayBuffer(0));

/** Required fields per stream message type, checked before dispatching. */
const STREAM_EVENT_SHAPES = {
  Metadata: { callback: 'onStreamMetadata', field: 'request_id', is: 'string' },
  Flushed: { callback: 'onStreamFlushed', field: 'type', is: 'string' },
  Cleared: { callback: 'onStreamCleared', field: 'sequence_id', is: 'number' },
  Warning: { callback: 'onStreamWarning', field: 'description', is: 'string' },
  SpeechStarted: {
    callback: 'onSpeechStarted',
    field: 'speech_id',
    is: 'string',
  },
  SpeechMetadata: {
    callback: 'onSpeechMetadata',
    field: 'speech_id',
    is: 'string',
  },
  SpeechInterrupted: {
    callback: 'onSpeechInterrupted',
    field: 'audio_played_ms',
    is: 'number',
  },
} as const;

/** Messages after which in-flight audio of an interrupted turn is over. */
const INTERRUPT_SETTLED = new Set([
  'SpeechInterrupted',
  'SpeechStarted',
  'Warning',
]);

async function postSpeak(
  url: string,
  text: string,
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': await resolveAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/octet-stream',
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res;
}

export function useDeepgramTextToSpeech(
  props: UseDeepgramTextToSpeechProps = {}
): UseDeepgramTextToSpeechReturn {
  const { options = {}, autoPlayAudio = true, trackState = false } = props;
  const propsRef = useLatest(props);

  const [state, setState] = useState<{
    status: SpeakStatus;
    error: Error | null;
  }>({ status: 'idle', error: null });

  const setStatus = useCallback(
    (status: SpeakStatus, error: Error | null = null) => {
      if (trackState) setState({ status, error });
    },
    [trackState]
  );

  const reportStreamError = useCallback(
    (err: unknown) => {
      const dgError = toDeepgramError(err);
      propsRef.current.onStreamError?.(dgError);
      setStatus('error', dgError);
      return dgError;
    },
    [propsRef, setStatus]
  );

  const wantsInterruptions = typeof props.onInterruption === 'function';
  useEffect(() => {
    if (!wantsInterruptions) return;
    const sub = addInterruptionListener((e) =>
      propsRef.current.onInterruption?.(e)
    );
    return () => sub.remove();
  }, [propsRef, wantsInterruptions]);

  const httpOptions = useMemo(() => resolveHttpOptions(options), [options]);
  const streamOptions = useMemo(() => resolveStreamOptions(options), [options]);

  /* ---------- HTTP (one-shot synth) ---------- */
  const abortCtrl = useRef<AbortController | null>(null);
  const bytesCacheRef = useRef(new Map<string, DeepgramTextToSpeechBytes>());

  const synthesize = useCallback(
    async (text: string) => {
      propsRef.current.onBeforeSynthesize?.();
      setStatus('loading');
      try {
        if (!text?.trim()) throw new Error('Text is empty');
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const params = buildSpeakHttpParams(httpOptions);
        const res = await postSpeak(
          buildSpeakHttpUrl(params),
          text,
          abortCtrl.current.signal
        );
        const audio = await res.arrayBuffer();
        // The native player renders raw PCM16 only; other formats would play
        // as noise, so they are returned without playback.
        if (
          autoPlayAudio &&
          params.encoding === 'linear16' &&
          params.container === 'none'
        ) {
          Deepgram.startPlayer(
            Number(params.sample_rate) || DEFAULT_TTS_SAMPLE_RATE,
            1
          );
          await Deepgram.playAudioChunk(toBase64(audio));
        }

        propsRef.current.onSynthesizeSuccess?.(audio);
        setStatus('idle');
        return audio;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw err;
        }
        const dgError = toDeepgramError(err);
        propsRef.current.onSynthesizeError?.(dgError);
        setStatus('error', dgError);
        throw dgError;
      }
    },
    [autoPlayAudio, httpOptions, propsRef, setStatus]
  );

  /* ---------- HTTP (synth to bytes + LRU cache) ---------- */
  const synthesizeToBytes = useCallback(
    async (
      text: string,
      overrides?: DeepgramTextToSpeechHttpOptions
    ): Promise<DeepgramTextToSpeechBytes> => {
      if (!text?.trim()) throw new Error('Text is empty');

      // Bytes are needed now, so never ask Deepgram for an async callback.
      const params = buildSpeakHttpParams(httpOptions, {
        ...overrides,
        callback: undefined,
        callbackMethod: undefined,
      });
      const cache = bytesCacheRef.current;
      const cacheKey = JSON.stringify({ text, params });
      const cached = cache.get(cacheKey);
      if (cached) {
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return { data: cached.data.slice(0), mimeType: cached.mimeType };
      }

      const res = await postSpeak(buildSpeakHttpUrl(params), text);
      const data = await res.arrayBuffer();
      const encoding = overrides?.encoding ?? httpOptions.encoding;
      const container =
        overrides && 'container' in overrides
          ? overrides.container
          : httpOptions.container;
      const mimeType =
        res.headers?.get?.('Content-Type') ||
        deriveTtsMimeType(encoding, container);

      cache.set(cacheKey, { data: data.slice(0), mimeType });
      while (cache.size > TTS_BYTES_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return { data, mimeType };
    },
    [httpOptions]
  );

  /* ---------- WebSocket (streaming synth) ---------- */
  const ws = useRef<WebSocket | null>(null);
  // Bumped on every start/close so a stream superseded while its auth
  // header was resolving never opens a socket.
  const streamIdRef = useRef(0);
  const streamEndFiredRef = useRef(false);
  const streamFluxRef = useRef(false);
  // Set by interrupt(): audio frames already in flight belong to the
  // cancelled turn and must not be played.
  const discardAudioRef = useRef(false);

  const fireStreamEnd = useCallback(() => {
    if (streamEndFiredRef.current) return;
    streamEndFiredRef.current = true;
    propsRef.current.onStreamEnd?.();
  }, [propsRef]);

  const closeStream = useCallback(() => {
    streamIdRef.current += 1;
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
    if (autoPlayAudio) {
      Deepgram.stopPlayer().catch(() => {});
    }
    if (trackState) {
      setState((prev) => ({ ...prev, status: 'idle' }));
    }
  }, [autoPlayAudio, trackState]);

  const sendMessage = useCallback(
    (message: DeepgramTextToSpeechStreamInputMessage) => {
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (err) {
        reportStreamError(err);
        return false;
      }
    },
    [reportStreamError]
  );

  const flushStream = useCallback(
    () => sendMessage({ type: 'Flush' }),
    [sendMessage]
  );

  const interrupt = useCallback(
    (config?: { playbackOffsetMs?: number }) => {
      if (!streamFluxRef.current) return false;
      const offset = config?.playbackOffsetMs;
      const sent = sendMessage({
        type: 'Interrupt',
        ...(typeof offset === 'number'
          ? { playback_offset: { type: 'time_ms' as const, value: offset } }
          : {}),
      });
      if (sent) {
        discardAudioRef.current = true;
        if (autoPlayAudio) Deepgram.interruptAudio();
      }
      return sent;
    },
    [autoPlayAudio, sendMessage]
  );

  const configureStream = useCallback(
    (config: { speed?: number }) =>
      streamFluxRef.current &&
      sendMessage({
        type: 'Configure',
        ...(config.speed != null ? { speed: config.speed } : {}),
      }),
    [sendMessage]
  );

  const clearStream = useCallback(
    () =>
      streamFluxRef.current ? interrupt() : sendMessage({ type: 'Clear' }),
    [interrupt, sendMessage]
  );

  const closeStreamGracefully = useCallback(
    () => sendMessage({ type: 'Close' }),
    [sendMessage]
  );

  const sendText = useCallback(
    (text: string, config?: { flush?: boolean; sequenceId?: number }) => {
      if (typeof text !== 'string' || !text.trim()) {
        return false;
      }
      const flux = streamFluxRef.current;
      const didSend = sendMessage({
        type: 'Speak',
        // Flux does not add whitespace between Speak messages, so keep
        // streamed tokens intact.
        text: flux ? text : text.trim(),
        ...(!flux && config?.sequenceId != null
          ? { sequence_id: config.sequenceId }
          : {}),
      });
      if (didSend && (config?.flush ?? streamOptions.autoFlush)) {
        flushStream();
      }
      return didSend;
    },
    [flushStream, sendMessage, streamOptions.autoFlush]
  );

  const handleStreamAudio = useCallback(
    (audio: ArrayBuffer) => {
      if (discardAudioRef.current) return;
      if (autoPlayAudio) {
        Deepgram.feedAudio(toBase64(audio));
      }
      propsRef.current.onAudioChunk?.(audio);
    },
    [autoPlayAudio, propsRef]
  );

  const handleStreamMessage = useCallback(
    (raw: string) => {
      let message: DeepgramTextToSpeechStreamResponseMessage;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (typeof message?.type !== 'string') return;
      propsRef.current.onStreamMessage?.(message);

      if (message.type === 'Error') {
        const err = message as Partial<DeepgramTextToSpeechStreamErrorMessage>;
        const description =
          typeof err.description === 'string' ? err.description : undefined;
        const code = typeof err.code === 'string' ? err.code : undefined;
        reportStreamError(new Error(description ?? code ?? 'TTS error'));
        return;
      }
      if (INTERRUPT_SETTLED.has(message.type)) {
        discardAudioRef.current = false;
      }

      const shape =
        STREAM_EVENT_SHAPES[message.type as keyof typeof STREAM_EVENT_SHAPES];
      if (
        shape &&
        typeof (message as Record<string, unknown>)[shape.field] === shape.is
      ) {
        (
          propsRef.current[shape.callback] as
            ((m: typeof message) => void) | undefined
        )?.(message);
      }
    },
    [propsRef, reportStreamError]
  );

  const startStreaming = useCallback(
    async (text: string) => {
      if (ws.current) closeStream();
      const streamId = ++streamIdRef.current;
      streamEndFiredRef.current = false;
      streamFluxRef.current = streamOptions.flux;
      discardAudioRef.current = false;
      propsRef.current.onBeforeStream?.();
      setStatus('connecting');
      try {
        if (!text?.trim()) throw new Error('Text is empty');
        const authHeader = await resolveAuthHeader();
        if (streamId !== streamIdRef.current) return;

        const socket = new (WebSocket as unknown as HeaderWebSocket)(
          buildSpeakStreamUrl(streamOptions),
          undefined,
          { headers: { Authorization: authHeader } }
        );
        socket.binaryType = 'arraybuffer';
        ws.current = socket;
        const isCurrent = () => ws.current === socket;

        socket.onopen = () => {
          if (!isCurrent()) return;
          if (autoPlayAudio) {
            Deepgram.startPlayer(
              Number(streamOptions.sampleRate) || DEFAULT_TTS_SAMPLE_RATE,
              1
            );
          }
          sendText(text);
          propsRef.current.onStreamStart?.();
          setStatus('connected');
        };
        socket.onmessage = (event) => {
          if (!isCurrent()) return;
          const { data } = event as { data: unknown };
          if (typeof data === 'string') {
            handleStreamMessage(data);
          } else if (data instanceof Blob) {
            data.arrayBuffer().then(handleStreamAudio);
          } else {
            const audio = toArrayBuffer(data);
            if (audio) handleStreamAudio(audio);
          }
        };
        socket.onerror = (event) => {
          if (!isCurrent()) return;
          reportStreamError(event);
        };
        socket.onclose = () => {
          fireStreamEnd();
          if (isCurrent()) closeStream();
        };
      } catch (err) {
        const dgError = reportStreamError(err);
        closeStream();
        throw dgError;
      }
    },
    [
      autoPlayAudio,
      closeStream,
      fireStreamEnd,
      handleStreamAudio,
      handleStreamMessage,
      propsRef,
      reportStreamError,
      sendText,
      setStatus,
      streamOptions,
    ]
  );

  const stopStreaming = useCallback(() => {
    closeStream();
    fireStreamEnd();
  }, [closeStream, fireStreamEnd]);

  useEffect(
    () => () => {
      abortCtrl.current?.abort();
      closeStream();
    },
    [closeStream]
  );

  return {
    synthesize,
    synthesizeToBytes,
    startStreaming,
    sendMessage,
    sendText,
    flushStream,
    clearStream,
    interrupt,
    configureStream,
    closeStreamGracefully,
    stopStreaming,
    ...(trackState ? { state } : {}),
  };
}
