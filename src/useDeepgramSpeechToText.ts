import { useRef, useCallback, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import type {
  DeepgramLiveListenOptions,
  DeepgramPrerecordedOptions,
  DeepgramPrerecordedSource,
  DeepgramTranscriptEvent,
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from './types';
import {
  DEEPGRAM_BASEURL,
  DEEPGRAM_BASEWSS,
  DEEPGRAM_V2_BASEWSS,
} from './constants';
import { buildParams } from './helpers';

const DEFAULT_SAMPLE_RATE = 16_000;
const BASE_NATIVE_SAMPLE_RATE = 16_000;

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

const downsampleInt16 = (
  data: Int16Array<ArrayBufferLike>,
  factor: number
): Int16Array<ArrayBufferLike> => {
  if (factor <= 1 || data.length < factor) {
    return data;
  }

  const downsampled = new Int16Array(Math.floor(data.length / factor));
  for (let i = 0; i < downsampled.length; i++) {
    downsampled[i] = data[i * factor];
  }
  return downsampled as Int16Array<ArrayBufferLike>;
};

export function useDeepgramSpeechToText({
  onBeforeStart = () => {},
  onStart = () => {},
  onTranscript = () => {},
  onError = () => {},
  onEnd = () => {},
  onBeforeTranscribe = () => {},
  onTranscribeSuccess = () => {},
  onTranscribeError = () => {},
  live = {},
  prerecorded = {},
  trackState = false,
  trackTranscript = false,
}: UseDeepgramSpeechToTextProps = {}): UseDeepgramSpeechToTextReturn {
  const [internalState, setInternalState] = useState<{
    status: 'idle' | 'loading' | 'listening' | 'transcribing' | 'error';
    error: Error | null;
  }>({
    status: 'idle',
    error: null,
  });
  const ws = useRef<WebSocket | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const apiVersionRef = useRef<'v1' | 'v2'>('v1');
  const nativeInputSampleRateRef = useRef(BASE_NATIVE_SAMPLE_RATE);
  const targetSampleRateRef = useRef(DEFAULT_SAMPLE_RATE);
  const downsampleFactorRef = useRef(1);
  const lastPartialTranscriptRef = useRef('');
  const lastFinalTranscriptRef = useRef('');

  // Transcript tracking state
  const [internalTranscript, setInternalTranscript] = useState('');
  const [internalInterimTranscript, setInternalInterimTranscript] =
    useState('');

  const closeEverything = useCallback(() => {
    if (audioSub.current) {
      audioSub.current.remove();
      audioSub.current = null;
    }
    Deepgram.stopRecording().catch(() => {});
    nativeInputSampleRateRef.current = BASE_NATIVE_SAMPLE_RATE;
    targetSampleRateRef.current = DEFAULT_SAMPLE_RATE;
    downsampleFactorRef.current = 1;
    lastPartialTranscriptRef.current = '';
    lastFinalTranscriptRef.current = '';
    if (
      apiVersionRef.current === 'v2' &&
      ws.current?.readyState === WebSocket.OPEN
    ) {
      try {
        ws.current.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        // ignore close errors
      }
    }
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
    apiVersionRef.current = 'v1';
    if (trackState) {
      setInternalState((prev) => ({ ...prev, status: 'idle' }));
    }
    if (trackTranscript) {
      setInternalTranscript('');
      setInternalInterimTranscript('');
    }
  }, [trackState, trackTranscript]);

  const emitTranscript = useCallback(
    (transcript: unknown, isFinal: boolean, raw: unknown) => {
      if (typeof onTranscript !== 'function') {
        return;
      }

      if (typeof transcript !== 'string') {
        return;
      }

      const normalized = transcript.trim();
      if (!normalized) {
        return;
      }

      if (isFinal) {
        if (lastFinalTranscriptRef.current === normalized) {
          return;
        }
        lastFinalTranscriptRef.current = normalized;
        lastPartialTranscriptRef.current = '';
      } else {
        if (lastPartialTranscriptRef.current === normalized) {
          return;
        }
        lastPartialTranscriptRef.current = normalized;
      }

      const info: DeepgramTranscriptEvent = { isFinal: !!isFinal, raw };

      if (trackTranscript) {
        if (isFinal) {
          setInternalTranscript((prev) => {
            const next = prev ? `${prev} ${normalized}` : normalized;
            return next.trim();
          });
          setInternalInterimTranscript('');
        } else {
          setInternalInterimTranscript(normalized);
        }
      }

      onTranscript(normalized, info);

      if (isFinal) {
        lastPartialTranscriptRef.current = '';
      }
    },
    [onTranscript, trackTranscript]
  );

  const startListening = useCallback(
    async (overrideOptions: DeepgramLiveListenOptions = {}) => {
      try {
        onBeforeStart();
        if (trackState) {
          setInternalState({ status: 'loading', error: null });
        }
        lastPartialTranscriptRef.current = '';
        lastFinalTranscriptRef.current = '';

        const granted = await askMicPermission();
        if (!granted) throw new Error('Microphone permission denied');

        await Deepgram.startRecording();

        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const merged: DeepgramLiveListenOptions = {
          encoding: 'linear16',
          sampleRate: DEFAULT_SAMPLE_RATE,
          model: 'nova-2',
          apiVersion: 'v1',
          ...live,
          ...overrideOptions,
        };

        targetSampleRateRef.current =
          typeof merged.sampleRate === 'number' && merged.sampleRate > 0
            ? merged.sampleRate
            : DEFAULT_SAMPLE_RATE;
        downsampleFactorRef.current = computeDownsampleFactor(
          targetSampleRateRef.current,
          nativeInputSampleRateRef.current
        );

        if (merged.apiVersion === 'v2' && !merged.model) {
          merged.model = 'flux-general-en';
        }

        const isV2 = merged.apiVersion === 'v2';
        apiVersionRef.current = isV2 ? 'v2' : 'v1';

        const query: Record<
          string,
          | string
          | number
          | boolean
          | null
          | undefined
          | Array<string | number | boolean | null | undefined>
        > = {
          callback: merged.callback,
          callback_method: merged.callbackMethod,
          channels: merged.channels,
          diarize: merged.diarize,
          dictation: merged.dictation,
          encoding: merged.encoding,
          endpointing: merged.endpointing,
          filler_words: merged.fillerWords,
          interim_results: merged.interimResults,
          keyterm: merged.keyterm,
          keywords: merged.keywords,
          language: merged.language,
          mip_opt_out: merged.mipOptOut,
          model: merged.model,
          multichannel: merged.multichannel,
          numerals: merged.numerals,
          profanity_filter: merged.profanityFilter,
          punctuate: merged.punctuate,
          replace: merged.replace,
          sample_rate: merged.sampleRate,
          search: merged.search,
          smart_format: merged.smartFormat,
          tag: merged.tag,
          utterance_end_ms: merged.utteranceEndMs,
          vad_events: merged.vadEvents,
          version: merged.version,
        };

        if (isV2) {
          query.eager_eot_threshold = merged.eagerEotThreshold;
          query.eot_threshold = merged.eotThreshold;
          query.eot_timeout_ms = merged.eotTimeoutMs;
        }

        if (merged.redact) {
          query.redact = Array.isArray(merged.redact)
            ? merged.redact
            : [merged.redact];
        }

        if (merged.extra) {
          Object.entries(merged.extra).forEach(([key, value]) => {
            query[`extra.${key}`] = value;
          });
        }

        const params = buildParams(query);

        const baseWss = isV2 ? DEEPGRAM_V2_BASEWSS : DEEPGRAM_BASEWSS;
        const baseListenUrl = `${baseWss}/listen`;
        const url = params ? `${baseListenUrl}?${params}` : baseListenUrl;

        ws.current = new (WebSocket as any)(url, undefined, {
          headers: { Authorization: `Token ${apiKey}` },
        });

        ws.current.onopen = () => {
          onStart();
          if (trackState) {
            setInternalState({ status: 'listening', error: null });
          }
        };

        const emitter = new NativeEventEmitter(NativeModules.Deepgram);
        audioSub.current = emitter.addListener(
          Platform.select({
            ios: 'DeepgramAudioPCM',
            android: 'AudioChunk',
          }) as string,
          (ev: any) => {
            if (typeof ev?.sampleRate === 'number' && ev.sampleRate > 0) {
              if (ev.sampleRate !== nativeInputSampleRateRef.current) {
                nativeInputSampleRateRef.current = ev.sampleRate;
                downsampleFactorRef.current = computeDownsampleFactor(
                  targetSampleRateRef.current,
                  nativeInputSampleRateRef.current
                );
              }
            }

            const factor = downsampleFactorRef.current;
            let chunk: ArrayBufferLike | undefined;
            if (typeof ev?.b64 === 'string') {
              const bytes = Uint8Array.from(atob(ev.b64), (c) =>
                c.charCodeAt(0)
              );
              let int16: Int16Array<ArrayBufferLike> = new Int16Array(
                bytes.buffer
              );
              int16 = downsampleInt16(int16, factor);
              chunk = int16.buffer;
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
              const downsampled = downsampleInt16(
                int16 as Int16Array<ArrayBufferLike>,
                factor
              );
              chunk = downsampled.buffer;
            }

            if (chunk && ws.current?.readyState === WebSocket.OPEN) {
              ws.current.send(chunk);
            }
          }
        );

        ws.current.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            try {
              const msg = JSON.parse(ev.data);
              if (isV2) {
                if (msg.type === 'Error') {
                  const description =
                    msg.description || 'Deepgram stream error';
                  onError(new Error(description));
                  if (trackState) {
                    setInternalState({
                      status: 'error',
                      error: new Error(description),
                    });
                  }
                  closeEverything();
                  return;
                }

                const transcript = msg.transcript;
                if (typeof transcript === 'string' && transcript.length > 0) {
                  const type =
                    typeof msg.type === 'string'
                      ? msg.type.toLowerCase()
                      : undefined;
                  const isFinal =
                    msg.is_final === true ||
                    msg.speech_final === true ||
                    msg.finished === true ||
                    type === 'utteranceend' ||
                    type === 'speechfinal' ||
                    type === 'speech.end' ||
                    (typeof type === 'string' && type.includes('final'));
                  emitTranscript(transcript, Boolean(isFinal), msg);
                }
                return;
              }

              const transcript = msg.channel?.alternatives?.[0]?.transcript;
              if (typeof transcript === 'string') {
                const isFinal =
                  msg.is_final === true || msg.speech_final === true;
                emitTranscript(transcript, Boolean(isFinal), msg);
              }
            } catch {
              // non-JSON or unexpected format
            }
          }
        };

        ws.current.onerror = (err) => {
          onError(err);
          if (trackState) {
            setInternalState({
              status: 'error',
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        };
        ws.current.onclose = () => {
          onEnd();
          closeEverything();
        };
      } catch (err) {
        onError(err);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
        closeEverything();
      }
    },
    [
      emitTranscript,
      onBeforeStart,
      onStart,
      onError,
      onEnd,
      live,
      closeEverything,
      trackState,
    ]
  );

  const stopListening = useCallback(() => {
    try {
      closeEverything();
      onEnd();
    } catch (err) {
      onError(err);
      if (trackState) {
        setInternalState({
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }, [onEnd, onError, closeEverything, trackState]);

  const transcribeFile = useCallback(
    async (
      file: DeepgramPrerecordedSource,
      overrideOptions: DeepgramPrerecordedOptions = {}
    ) => {
      onBeforeTranscribe();
      if (trackState) {
        setInternalState({ status: 'transcribing', error: null });
      }
      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const merged: DeepgramPrerecordedOptions = {
          ...prerecorded,
          ...overrideOptions,
        };

        const query: Record<
          string,
          | string
          | number
          | boolean
          | null
          | undefined
          | Array<string | number | boolean | null | undefined>
        > = {
          callback: merged.callback,
          callback_method: merged.callbackMethod,
          sentiment: merged.sentiment,
          summarize: merged.summarize,
          tag: merged.tag,
          topics: merged.topics,
          custom_topic_mode: merged.customTopicMode,
          intents: merged.intents,
          custom_intent_mode: merged.customIntentMode,
          detect_entities: merged.detectEntities,
          diarize: merged.diarize,
          dictation: merged.dictation,
          encoding: merged.encoding,
          filler_words: merged.fillerWords,
          keyterm: merged.keyterm,
          keywords: merged.keywords,
          language: merged.language,
          measurements: merged.measurements,
          model: merged.model,
          multichannel: merged.multichannel,
          numerals: merged.numerals,
          paragraphs: merged.paragraphs,
          profanity_filter: merged.profanityFilter,
          punctuate: merged.punctuate,
          replace: merged.replace,
          search: merged.search,
          smart_format: merged.smartFormat,
          utterances: merged.utterances,
          utt_split: merged.uttSplit,
          version: merged.version,
        };

        if (merged.customTopic) {
          query.custom_topic = merged.customTopic;
        }

        if (merged.customIntent) {
          query.custom_intent = merged.customIntent;
        }

        if (merged.detectLanguage !== undefined) {
          if (typeof merged.detectLanguage === 'boolean') {
            query.detect_language = merged.detectLanguage;
          } else {
            query.detect_language = merged.detectLanguage;
          }
        }

        if (merged.redact) {
          query.redact = Array.isArray(merged.redact)
            ? merged.redact
            : [merged.redact];
        }

        if (merged.extra) {
          if (typeof merged.extra === 'string' || Array.isArray(merged.extra)) {
            query.extra = merged.extra;
          } else {
            Object.entries(merged.extra).forEach(([key, value]) => {
              if (value == null) return;
              query[`extra.${key}`] = value;
            });
          }
        }

        const params = buildParams(query);
        const baseUrl = `${DEEPGRAM_BASEURL}/listen`;
        const url = params ? `${baseUrl}?${params}` : baseUrl;

        const headers: Record<string, string> = {
          Authorization: `Token ${apiKey}`,
        };

        let body: FormData | string;
        if (typeof file === 'string') {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({ url: file });
        } else if (typeof file === 'object' && file !== null && 'url' in file) {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({ url: (file as { url: string }).url });
        } else {
          const formData = new FormData();
          if (file instanceof Blob) {
            formData.append('audio', file, 'recording.wav');
          } else {
            formData.append('audio', {
              uri: (file as { uri: string; name?: string; type?: string }).uri,
              name: (file as { name?: string }).name || 'recording.wav',
              type: (file as { type?: string }).type || 'audio/wav',
            } as any);
          }
          body = formData;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
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
          if (trackState) {
            setInternalState({ status: 'idle', error: null });
          }
        } else {
          throw new Error('No transcript present in Deepgram response');
        }
      } catch (err) {
        onTranscribeError(err);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    },
    [
      onBeforeTranscribe,
      onTranscribeSuccess,
      onTranscribeError,
      prerecorded,
      trackState,
    ]
  );

  return {
    startListening,
    stopListening,
    transcribeFile,
    ...(trackState ? { state: internalState } : {}),
    ...(trackTranscript
      ? {
          transcript: internalTranscript,
          interimTranscript: internalInterimTranscript,
        }
      : {}),
  };
}
