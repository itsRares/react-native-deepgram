import { useRef, useCallback } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import type {
  DeepgramLiveListenOptions,
  DeepgramPrerecordedOptions,
  DeepgramPrerecordedSource,
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from './types';
import {
  DEEPGRAM_BASEURL,
  DEEPGRAM_BASEWSS,
  DEEPGRAM_V2_BASEWSS,
} from './constants';
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
  live = {},
  prerecorded = {},
}: UseDeepgramSpeechToTextProps = {}): UseDeepgramSpeechToTextReturn {
  const ws = useRef<WebSocket | null>(null);
  const audioSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const apiVersionRef = useRef<'v1' | 'v2'>('v1');

  const closeEverything = () => {
    audioSub.current?.remove();
    Deepgram.stopRecording().catch(() => {});
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
  };

  const startListening = useCallback(
    async (overrideOptions: DeepgramLiveListenOptions = {}) => {
      try {
        onBeforeStart();

        const granted = await askMicPermission();
        if (!granted) throw new Error('Microphone permission denied');

        await Deepgram.startRecording();

        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const merged: DeepgramLiveListenOptions = {
          encoding: 'linear16',
          sampleRate: 16000,
          model: 'nova-2',
          apiVersion: 'v1',
          ...live,
          ...overrideOptions,
        };

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
                  closeEverything();
                  return;
                }

                const transcript = msg.transcript;
                if (typeof transcript === 'string' && transcript.length > 0) {
                  onTranscript(transcript);
                }
                return;
              }

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
    },
    [onBeforeStart, onStart, onTranscript, onError, onEnd, live]
  );

  const stopListening = useCallback(() => {
    try {
      closeEverything();
      onEnd();
    } catch (err) {
      onError(err);
    }
  }, [onEnd, onError]);

  const transcribeFile = useCallback(
    async (
      file: DeepgramPrerecordedSource,
      overrideOptions: DeepgramPrerecordedOptions = {}
    ) => {
      onBeforeTranscribe();
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
        } else {
          throw new Error('No transcript present in Deepgram response');
        }
      } catch (err) {
        onTranscribeError(err);
      }
    },
    [onBeforeTranscribe, onTranscribeSuccess, onTranscribeError, prerecorded]
  );

  return { startListening, stopListening, transcribeFile };
}
