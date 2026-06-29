import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Deepgram } from './NativeDeepgram';
import type {
  UseDeepgramTextToSpeechProps,
  UseDeepgramTextToSpeechReturn,
  DeepgramTextToSpeechStreamInputMessage,
  DeepgramTextToSpeechStreamResponseMessage,
  DeepgramTextToSpeechStreamMetadataMessage,
  DeepgramTextToSpeechStreamFlushedMessage,
  DeepgramTextToSpeechStreamClearedMessage,
  DeepgramTextToSpeechStreamWarningMessage,
  DeepgramTextToSpeechStreamErrorMessage,
  DeepgramTextToSpeechHttpEncoding,
  DeepgramTextToSpeechStreamEncoding,
  DeepgramTextToSpeechHttpOptions,
  DeepgramTextToSpeechBytes,
} from './types';
import { getBaseUrl, getBaseWss } from './constants';
import { buildParams, arrayBufferToBase64, resolveAuthHeader } from './helpers';
import { toDeepgramError } from './types';

const DEFAULT_TTS_MODEL = 'aura-2-asteria-en';
const DEFAULT_TTS_SAMPLE_RATE = 24_000;
const DEFAULT_TTS_HTTP_ENCODING: DeepgramTextToSpeechHttpEncoding = 'linear16';
const DEFAULT_TTS_STREAM_ENCODING: DeepgramTextToSpeechStreamEncoding =
  'linear16';
const DEFAULT_TTS_CONTAINER = 'none';
const DEFAULT_TTS_MP3_BITRATE = 48_000;

const TTS_BYTES_CACHE_MAX = 50;

const deriveTtsMimeType = (encoding?: string, container?: string): string => {
  if (container === 'wav') return 'audio/wav';
  if (container === 'ogg') return 'audio/ogg';
  switch (encoding) {
    case 'mp3':
      return 'audio/mpeg';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'opus':
      return 'audio/ogg';
    default:
      // linear16 / mulaw / alaw and other raw PCM payloads have no container.
      return 'application/octet-stream';
  }
};

type QueryParamPrimitive = string | number | boolean | null | undefined;
type QueryParamValue = QueryParamPrimitive | Array<QueryParamPrimitive>;

const normalizeStreamEncoding = (
  encoding?: string | null
): DeepgramTextToSpeechStreamEncoding => {
  switch (encoding) {
    case 'linear16':
    case 'mulaw':
    case 'alaw':
      return encoding;
    default:
      return DEFAULT_TTS_STREAM_ENCODING;
  }
};

const ensureQueryParam = (
  params: Record<string, QueryParamValue>,
  key: string,
  value: QueryParamValue
) => {
  if (value == null) return;
  if (
    Object.prototype.hasOwnProperty.call(params, key) &&
    params[key] != null
  ) {
    return;
  }
  params[key] = value;
};

const isMetadataMessage = (
  message: DeepgramTextToSpeechStreamResponseMessage
): message is DeepgramTextToSpeechStreamMetadataMessage =>
  message.type === 'Metadata' &&
  typeof (message as Partial<DeepgramTextToSpeechStreamMetadataMessage>)
    .request_id === 'string';

const isFlushedMessage = (
  message: DeepgramTextToSpeechStreamResponseMessage
): message is DeepgramTextToSpeechStreamFlushedMessage =>
  message.type === 'Flushed' &&
  typeof (message as Partial<DeepgramTextToSpeechStreamFlushedMessage>)
    .sequence_id === 'number';

const isClearedMessage = (
  message: DeepgramTextToSpeechStreamResponseMessage
): message is DeepgramTextToSpeechStreamClearedMessage =>
  message.type === 'Cleared' &&
  typeof (message as Partial<DeepgramTextToSpeechStreamClearedMessage>)
    .sequence_id === 'number';

const isWarningMessage = (
  message: DeepgramTextToSpeechStreamResponseMessage
): message is DeepgramTextToSpeechStreamWarningMessage =>
  message.type === 'Warning' &&
  typeof (message as Partial<DeepgramTextToSpeechStreamWarningMessage>)
    .description === 'string' &&
  typeof (message as Partial<DeepgramTextToSpeechStreamWarningMessage>).code ===
    'string';

const asErrorMessage = (
  message: DeepgramTextToSpeechStreamResponseMessage
): DeepgramTextToSpeechStreamErrorMessage | null =>
  message.type === 'Error'
    ? (message as DeepgramTextToSpeechStreamErrorMessage)
    : null;

/* Native player helpers — delegates to shared Deepgram import */
const NativePlayer = {
  startPlayer: (sr = 16_000, ch: 1 | 2 = 1) => Deepgram.startPlayer(sr, ch),

  feedAudio: (chunk: ArrayBuffer | Uint8Array) => {
    const b64 = arrayBufferToBase64(
      chunk instanceof Uint8Array ? (chunk.buffer as ArrayBuffer) : chunk
    );
    Deepgram.feedAudio(b64);
  },

  playAudioChunk: (chunk: ArrayBuffer | Uint8Array) => {
    const b64 = arrayBufferToBase64(
      chunk instanceof Uint8Array ? (chunk.buffer as ArrayBuffer) : chunk
    );
    return Deepgram.playAudioChunk(b64);
  },

  stopPlayer: () => Deepgram.stopPlayer(),
};

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
  onStreamMetadata = () => {},
  onStreamFlushed = () => {},
  onStreamCleared = () => {},
  onStreamWarning = () => {},
  options = {},
  autoPlayAudio = true,
  trackState = false,
}: UseDeepgramTextToSpeechProps = {}): UseDeepgramTextToSpeechReturn {
  /* ---------- Stable refs for callbacks ---------- */
  const onBeforeSynthesizeRef = useRef(onBeforeSynthesize);
  const onSynthesizeSuccessRef = useRef(onSynthesizeSuccess);
  const onSynthesizeErrorRef = useRef(onSynthesizeError);
  const onBeforeStreamRef = useRef(onBeforeStream);
  const onStreamStartRef = useRef(onStreamStart);
  const onAudioChunkRef = useRef(onAudioChunk);
  const onStreamErrorRef = useRef(onStreamError);
  const onStreamEndRef = useRef(onStreamEnd);
  const onStreamMetadataRef = useRef(onStreamMetadata);
  const onStreamFlushedRef = useRef(onStreamFlushed);
  const onStreamClearedRef = useRef(onStreamCleared);
  const onStreamWarningRef = useRef(onStreamWarning);

  useEffect(() => {
    onBeforeSynthesizeRef.current = onBeforeSynthesize;
    onSynthesizeSuccessRef.current = onSynthesizeSuccess;
    onSynthesizeErrorRef.current = onSynthesizeError;
    onBeforeStreamRef.current = onBeforeStream;
    onStreamStartRef.current = onStreamStart;
    onAudioChunkRef.current = onAudioChunk;
    onStreamErrorRef.current = onStreamError;
    onStreamEndRef.current = onStreamEnd;
    onStreamMetadataRef.current = onStreamMetadata;
    onStreamFlushedRef.current = onStreamFlushed;
    onStreamClearedRef.current = onStreamCleared;
    onStreamWarningRef.current = onStreamWarning;
  });

  const streamEndFiredRef = useRef(false);
  const [internalState, setInternalState] = useState<{
    status: 'idle' | 'loading' | 'connecting' | 'connected' | 'error';
    error: Error | null;
  }>({
    status: 'idle',
    error: null,
  });
  const resolvedHttpOptions = useMemo(() => {
    const encoding =
      options.http?.encoding ?? options.encoding ?? DEFAULT_TTS_HTTP_ENCODING;

    const model = options.http?.model ?? options.model ?? DEFAULT_TTS_MODEL;

    const derivedSampleRate = (() => {
      const explicit = options.http?.sampleRate ?? options.sampleRate;
      if (explicit != null) return explicit;

      if (encoding === 'linear16') return DEFAULT_TTS_SAMPLE_RATE;
      if (encoding === 'mulaw' || encoding === 'alaw') return 8000;

      return undefined;
    })();

    const container = (() => {
      const provided = options.http?.container ?? options.container;
      if (provided) return provided;

      if (encoding === 'opus') return 'ogg';
      if (
        encoding === 'linear16' ||
        encoding === 'mulaw' ||
        encoding === 'alaw'
      ) {
        return DEFAULT_TTS_CONTAINER;
      }
      return undefined;
    })();

    const bitRate = (() => {
      const provided = options.http?.bitRate ?? options.bitRate;
      if (provided != null) return provided;
      if (encoding === 'mp3') return DEFAULT_TTS_MP3_BITRATE;
      return undefined;
    })();

    return {
      model,
      sampleRate: derivedSampleRate,
      encoding,
      container,
      format: options.http?.format ?? options.format,
      bitRate,
      speed: options.http?.speed ?? options.speed,
      tag: options.http?.tag ?? options.tag,
      callback: options.http?.callback ?? options.callback,
      callbackMethod: options.http?.callbackMethod ?? options.callbackMethod,
      mipOptOut: options.http?.mipOptOut ?? options.mipOptOut,
      queryParams: {
        ...(options.queryParams ?? {}),
        ...(options.http?.queryParams ?? {}),
      },
    };
  }, [options]);

  const resolvedStreamOptions = useMemo(() => {
    const model = options.stream?.model ?? options.model ?? DEFAULT_TTS_MODEL;
    const encoding = normalizeStreamEncoding(
      options.stream?.encoding ?? options.encoding
    );
    const sampleRate = (() => {
      const explicit = options.stream?.sampleRate ?? options.sampleRate;
      if (explicit != null) return explicit;
      if (encoding === 'mulaw' || encoding === 'alaw') return 8000;
      return DEFAULT_TTS_SAMPLE_RATE;
    })();

    return {
      model,
      sampleRate,
      encoding,
      speed: options.stream?.speed ?? options.speed,
      mipOptOut: options.stream?.mipOptOut ?? options.mipOptOut,
      queryParams: {
        ...(options.queryParams ?? {}),
        ...(options.stream?.queryParams ?? {}),
      },
      autoFlush: options.stream?.autoFlush ?? true,
    };
  }, [options]);

  /* ---------- HTTP (one-shot synth) ---------- */
  const abortCtrl = useRef<AbortController | null>(null);
  const ttsBytesCacheRef = useRef<Map<string, DeepgramTextToSpeechBytes>>(
    new Map()
  );

  const synthesize = useCallback(
    async (text: string) => {
      onBeforeSynthesizeRef.current();
      if (trackState) {
        setInternalState({ status: 'loading', error: null });
      }
      try {
        if (!text?.trim()) throw new Error('Text is empty');
        const authHeader = await resolveAuthHeader();

        const httpParams: Record<string, QueryParamValue> = {
          ...resolvedHttpOptions.queryParams,
        };

        ensureQueryParam(httpParams, 'model', resolvedHttpOptions.model);
        ensureQueryParam(httpParams, 'encoding', resolvedHttpOptions.encoding);
        ensureQueryParam(
          httpParams,
          'sample_rate',
          resolvedHttpOptions.sampleRate
        );
        ensureQueryParam(
          httpParams,
          'container',
          resolvedHttpOptions.container
        );
        ensureQueryParam(httpParams, 'format', resolvedHttpOptions.format);
        ensureQueryParam(httpParams, 'bit_rate', resolvedHttpOptions.bitRate);
        ensureQueryParam(httpParams, 'speed', resolvedHttpOptions.speed);
        ensureQueryParam(httpParams, 'tag', resolvedHttpOptions.tag);
        ensureQueryParam(httpParams, 'callback', resolvedHttpOptions.callback);
        ensureQueryParam(
          httpParams,
          'callback_method',
          resolvedHttpOptions.callbackMethod
        );
        ensureQueryParam(
          httpParams,
          'mip_opt_out',
          resolvedHttpOptions.mipOptOut
        );

        const params = buildParams(httpParams);

        const baseUrl = getBaseUrl();
        const url = params ? `${baseUrl}/speak?${params}` : `${baseUrl}/speak`;
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/octet-stream',
          },
          body: JSON.stringify({ text }),
          signal: abortCtrl.current.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const audio = await res.arrayBuffer();
        await NativePlayer.playAudioChunk(audio);

        onSynthesizeSuccessRef.current(audio);
        if (trackState) {
          setInternalState({ status: 'idle', error: null });
        }
        return audio;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw err;
        }

        const dgError = toDeepgramError(err);
        onSynthesizeErrorRef.current(dgError);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: dgError,
          });
        }
        throw dgError;
      }
    },
    [resolvedHttpOptions, trackState]
  );

  /* ---------- HTTP (synth to bytes + cache) ---------- */
  const synthesizeToBytes = useCallback(
    async (
      text: string,
      opts?: DeepgramTextToSpeechHttpOptions
    ): Promise<DeepgramTextToSpeechBytes> => {
      if (!text?.trim()) throw new Error('Text is empty');

      // Per-call overrides win over the hook's resolved HTTP options.
      const merged = { ...resolvedHttpOptions, ...(opts ?? {}) };

      const httpParams: Record<string, QueryParamValue> = {
        ...resolvedHttpOptions.queryParams,
        ...(opts?.queryParams ?? {}),
      };
      ensureQueryParam(httpParams, 'model', merged.model);
      ensureQueryParam(httpParams, 'encoding', merged.encoding);
      ensureQueryParam(httpParams, 'sample_rate', merged.sampleRate);
      ensureQueryParam(httpParams, 'container', merged.container);
      ensureQueryParam(httpParams, 'format', merged.format);
      ensureQueryParam(httpParams, 'bit_rate', merged.bitRate);
      ensureQueryParam(httpParams, 'speed', merged.speed);
      ensureQueryParam(httpParams, 'tag', merged.tag);
      ensureQueryParam(httpParams, 'mip_opt_out', merged.mipOptOut);

      const cache = ttsBytesCacheRef.current;
      const cacheKey = JSON.stringify({ text, params: httpParams });
      const cached = cache.get(cacheKey);
      if (cached) {
        // LRU touch: re-insert to mark as most-recently-used.
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return { data: cached.data.slice(0), mimeType: cached.mimeType };
      }

      const authHeader = await resolveAuthHeader();
      const params = buildParams(httpParams);
      const baseUrl = getBaseUrl();
      const url = params ? `${baseUrl}/speak?${params}` : `${baseUrl}/speak`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/octet-stream',
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        // Don't cache error responses.
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.arrayBuffer();
      const mimeType =
        res.headers?.get?.('Content-Type') ||
        deriveTtsMimeType(merged.encoding, merged.container);

      const result: DeepgramTextToSpeechBytes = { data, mimeType };
      cache.set(cacheKey, { data: data.slice(0), mimeType });
      while (cache.size > TTS_BYTES_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return result;
    },
    [resolvedHttpOptions]
  );

  /* ---------- WebSocket (streaming synth) ---------- */
  const ws = useRef<WebSocket | null>(null);

  const closeStream = useCallback(() => {
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
    if (autoPlayAudio) {
      NativePlayer.stopPlayer();
    }
    if (trackState) {
      setInternalState((prev) => ({ ...prev, status: 'idle' }));
    }
  }, [autoPlayAudio, trackState]);

  const sendMessage = useCallback(
    (message: DeepgramTextToSpeechStreamInputMessage) => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        return false;
      }

      try {
        const normalizedMessage =
          message.type === 'Text'
            ? { ...message, type: 'Speak' as const }
            : message;
        ws.current.send(JSON.stringify(normalizedMessage));
        return true;
      } catch (err) {
        const dgError = toDeepgramError(err);
        onStreamErrorRef.current(dgError);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: dgError,
          });
        }
        return false;
      }
    },
    [trackState]
  );

  const flushStream = useCallback(
    () => sendMessage({ type: 'Flush' }),
    [sendMessage]
  );

  const clearStream = useCallback(
    () => sendMessage({ type: 'Clear' }),
    [sendMessage]
  );

  const closeStreamGracefully = useCallback(
    () => sendMessage({ type: 'Close' }),
    [sendMessage]
  );

  const sendText = useCallback(
    (text: string, config?: { flush?: boolean; sequenceId?: number }) => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        return false;
      }

      const trimmed = text?.trim();
      if (!trimmed) {
        return false;
      }

      const didSend = sendMessage({
        type: 'Speak',
        text: trimmed,
        ...(config?.sequenceId != null
          ? { sequence_id: config.sequenceId }
          : {}),
      });
      const shouldFlush =
        config?.flush ?? resolvedStreamOptions.autoFlush ?? true;

      if (didSend && shouldFlush) {
        flushStream();
      }

      return didSend;
    },
    [flushStream, resolvedStreamOptions.autoFlush, sendMessage]
  );

  const startStreaming = useCallback(
    async (text: string) => {
      streamEndFiredRef.current = false;
      onBeforeStreamRef.current();
      if (trackState) {
        setInternalState({ status: 'connecting', error: null });
      }
      try {
        if (!text?.trim()) throw new Error('Text is empty');
        const authHeader = await resolveAuthHeader();

        const wsParams: Record<string, QueryParamValue> = {
          ...resolvedStreamOptions.queryParams,
        };

        ensureQueryParam(wsParams, 'model', resolvedStreamOptions.model);
        ensureQueryParam(wsParams, 'encoding', resolvedStreamOptions.encoding);
        ensureQueryParam(
          wsParams,
          'sample_rate',
          resolvedStreamOptions.sampleRate
        );
        ensureQueryParam(wsParams, 'speed', resolvedStreamOptions.speed);
        ensureQueryParam(
          wsParams,
          'mip_opt_out',
          resolvedStreamOptions.mipOptOut
        );

        const wsParamString = buildParams(wsParams);
        const baseWss = getBaseWss();
        const url = wsParamString
          ? `${baseWss}/speak?${wsParamString}`
          : `${baseWss}/speak`;
        ws.current = new (WebSocket as any)(url, undefined, {
          headers: { Authorization: authHeader },
        });
        const socket = ws.current as WebSocket;

        // Ensure WebSocket receives binary data as ArrayBuffer
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          if (autoPlayAudio) {
            NativePlayer.startPlayer(
              Number(resolvedStreamOptions.sampleRate) ||
                DEFAULT_TTS_SAMPLE_RATE,
              1
            );
          }
          sendText(text);
          onStreamStartRef.current();
          if (trackState) {
            setInternalState({ status: 'connected', error: null });
          }
        };

        socket.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            if (autoPlayAudio) {
              NativePlayer.feedAudio(ev.data);
            }
            onAudioChunkRef.current(ev.data);
          } else if (ev.data instanceof Blob) {
            ev.data.arrayBuffer().then((buffer) => {
              if (autoPlayAudio) {
                NativePlayer.feedAudio(buffer);
              }
              onAudioChunkRef.current(buffer);
            });
          } else if (typeof ev.data === 'string') {
            try {
              const message = JSON.parse(
                ev.data
              ) as DeepgramTextToSpeechStreamResponseMessage;

              switch (message.type) {
                case 'Metadata':
                  if (isMetadataMessage(message)) {
                    onStreamMetadataRef.current(message);
                  }
                  break;
                case 'Flushed':
                  if (isFlushedMessage(message)) {
                    onStreamFlushedRef.current(message);
                  }
                  break;
                case 'Cleared':
                  if (isClearedMessage(message)) {
                    onStreamClearedRef.current(message);
                  }
                  break;
                case 'Warning':
                  if (isWarningMessage(message)) {
                    onStreamWarningRef.current(message);
                  }
                  break;
                case 'Error': {
                  const err = asErrorMessage(message);
                  const description =
                    err && typeof err.description === 'string'
                      ? err.description
                      : undefined;
                  const code =
                    err && typeof err.code === 'string' ? err.code : undefined;

                  const dgError = toDeepgramError(
                    new Error(description ?? code ?? 'TTS error')
                  );
                  onStreamErrorRef.current(dgError);
                  if (trackState) {
                    setInternalState({
                      status: 'error',
                      error: dgError,
                    });
                  }
                  break;
                }
                default:
                  // Ignore other informational messages.
                  break;
              }
            } catch {
              // Ignore non-JSON string messages
            }
          }
        };

        socket.onerror = (err) => {
          const dgError = toDeepgramError(err);
          onStreamErrorRef.current(dgError);
          if (trackState) {
            setInternalState({
              status: 'error',
              error: dgError,
            });
          }
        };
        socket.onclose = () => {
          if (!streamEndFiredRef.current) {
            streamEndFiredRef.current = true;
            onStreamEndRef.current();
          }
          closeStream();
        };
      } catch (err) {
        const dgError = toDeepgramError(err);
        onStreamErrorRef.current(dgError);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: dgError,
          });
        }
        closeStream();
        throw dgError;
      }
    },
    [resolvedStreamOptions, sendText, autoPlayAudio, closeStream, trackState]
  );

  const stopStreaming = useCallback(() => {
    try {
      closeStream();
      if (!streamEndFiredRef.current) {
        streamEndFiredRef.current = true;
        onStreamEndRef.current();
      }
    } catch (err) {
      const dgError = toDeepgramError(err);
      onStreamErrorRef.current(dgError);
      if (trackState) {
        setInternalState({
          status: 'error',
          error: dgError,
        });
      }
    }
  }, [closeStream, trackState]);

  /* ---------- cleanup on unmount ---------- */
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
    closeStreamGracefully,
    stopStreaming,
    ...(trackState ? { state: internalState } : {}),
  };
}
