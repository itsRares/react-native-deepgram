import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
import { useRef, useCallback, useEffect, useMemo } from 'react';
import { NativeModules } from 'react-native';
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
} from './types';
import { DEEPGRAM_BASEURL, DEEPGRAM_BASEWSS } from './constants';
import { buildParams } from './helpers';

const DEFAULT_TTS_MODEL = 'aura-2-asteria-en';
const DEFAULT_TTS_SAMPLE_RATE = 24_000;
const DEFAULT_TTS_HTTP_ENCODING: DeepgramTextToSpeechHttpEncoding = 'linear16';
const DEFAULT_TTS_STREAM_ENCODING: DeepgramTextToSpeechStreamEncoding =
  'linear16';
const DEFAULT_TTS_CONTAINER = 'none';
const DEFAULT_TTS_MP3_BITRATE = 48_000;

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
      /** Set audio configuration */
      setAudioConfig(sampleRate: number, channels: 1 | 2): void;
      /** Feed a base-64 PCM chunk */
      feedAudio(base64Pcm: string): void;
      /** Play a single audio chunk */
      playAudioChunk(base64Pcm: string): Promise<void>;
      /** Stop / reset the player */
      stopPlayer(): void;
    };
  }

  return {
    startPlayer: (sr = 16_000, ch: 1 | 2 = 1) =>
      getModule().startPlayer(sr, ch),

    setAudioConfig: (sr = 16_000, ch: 1 | 2 = 1) =>
      getModule().setAudioConfig(sr, ch),

    feedAudio: (chunk: ArrayBuffer | Uint8Array) => {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      getModule().feedAudio(Buffer.from(u8).toString('base64'));
    },

    playAudioChunk: (chunk: ArrayBuffer | Uint8Array) => {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      return getModule().playAudioChunk(Buffer.from(u8).toString('base64'));
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
  onStreamMetadata = () => {},
  onStreamFlushed = () => {},
  onStreamCleared = () => {},
  onStreamWarning = () => {},
  options = {},
}: UseDeepgramTextToSpeechProps = {}): UseDeepgramTextToSpeechReturn {
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

  const synthesize = useCallback(
    async (text: string) => {
      onBeforeSynthesize();
      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');
        if (!text?.trim()) throw new Error('Text is empty');

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

        const url = params
          ? `${DEEPGRAM_BASEURL}/speak?${params}`
          : `${DEEPGRAM_BASEURL}/speak`;
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${apiKey}`,
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
        await Deepgram.playAudioChunk(audio);

        onSynthesizeSuccess(audio);
        return audio;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw err;
        }

        onSynthesizeError(err);
        throw err;
      }
    },
    [
      onBeforeSynthesize,
      onSynthesizeSuccess,
      onSynthesizeError,
      resolvedHttpOptions,
    ]
  );

  /* ---------- WebSocket (streaming synth) ---------- */
  const ws = useRef<WebSocket | null>(null);

  const closeStream = () => {
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
    Deepgram.stopPlayer();
  };

  const sendMessage = useCallback(
    (message: DeepgramTextToSpeechStreamInputMessage) => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        return false;
      }

      try {
        ws.current.send(JSON.stringify(message));
        return true;
      } catch (err) {
        onStreamError(err);
        return false;
      }
    },
    [onStreamError]
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
        type: 'Text',
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
      onBeforeStream();
      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');
        if (!text?.trim()) throw new Error('Text is empty');

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
        ensureQueryParam(
          wsParams,
          'mip_opt_out',
          resolvedStreamOptions.mipOptOut
        );

        const wsParamString = buildParams(wsParams);
        const url = wsParamString
          ? `${DEEPGRAM_BASEWSS}/speak?${wsParamString}`
          : `${DEEPGRAM_BASEWSS}/speak`;
        ws.current = new (WebSocket as any)(url, undefined, {
          headers: { Authorization: `Token ${apiKey}` },
        });

        // Ensure WebSocket receives binary data as ArrayBuffer
        ws.current.binaryType = 'arraybuffer';

        ws.current.onopen = () => {
          Deepgram.startPlayer(
            Number(resolvedStreamOptions.sampleRate) || DEFAULT_TTS_SAMPLE_RATE,
            1
          );
          sendText(text);
          onStreamStart();
        };

        ws.current.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            Deepgram.feedAudio(ev.data);
            onAudioChunk(ev.data);
          } else if (ev.data instanceof Blob) {
            ev.data.arrayBuffer().then((buffer) => {
              Deepgram.feedAudio(buffer);
              onAudioChunk(buffer);
            });
          } else if (typeof ev.data === 'string') {
            try {
              const message = JSON.parse(
                ev.data
              ) as DeepgramTextToSpeechStreamResponseMessage;

              switch (message.type) {
                case 'Metadata':
                  if (isMetadataMessage(message)) {
                    onStreamMetadata(message);
                  }
                  break;
                case 'Flushed':
                  if (isFlushedMessage(message)) {
                    onStreamFlushed(message);
                  }
                  break;
                case 'Cleared':
                  if (isClearedMessage(message)) {
                    onStreamCleared(message);
                  }
                  break;
                case 'Warning':
                  if (isWarningMessage(message)) {
                    onStreamWarning(message);
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

                  onStreamError(new Error(description ?? code ?? 'TTS error'));
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

        ws.current.onerror = onStreamError;
        ws.current.onclose = () => {
          onStreamEnd();
          closeStream();
        };
      } catch (err) {
        onStreamError(err);
        closeStream();
        throw err;
      }
    },
    [
      onBeforeStream,
      onStreamStart,
      onAudioChunk,
      onStreamError,
      onStreamEnd,
      onStreamMetadata,
      onStreamFlushed,
      onStreamCleared,
      onStreamWarning,
      resolvedStreamOptions,
      sendText,
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

  return {
    synthesize,
    startStreaming,
    sendMessage,
    sendText,
    flushStream,
    clearStream,
    closeStreamGracefully,
    stopStreaming,
  };
}
