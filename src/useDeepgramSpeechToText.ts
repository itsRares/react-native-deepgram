import { useRef, useCallback, useState, useEffect } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import { askMicPermission } from './helpers/askMicPermission';
import { addInterruptionListener } from './interruption';
import type {
  DeepgramLiveListenOptions,
  DeepgramPrerecordedOptions,
  DeepgramPrerecordedSource,
  DeepgramTranscriptEvent,
  SessionStats,
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from './types';
import { createEmptySessionStats } from './types/deepgram/stats';
import { getBaseUrl, getBaseWss, getV2BaseWss } from './constants';
import { buildParams, resolveAuthHeader, hasAuthConfigured } from './helpers';
import { toDeepgramError } from './types';

const DEFAULT_SAMPLE_RATE = 16_000;
const BASE_NATIVE_SAMPLE_RATE = 16_000;

const KEEPALIVE_INTERVAL_MS = 5_000;

const STATS_PUBLISH_INTERVAL_MS = 1_000;

const DEFAULT_RECONNECT = {
  enabled: false,
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
};

let cachedEmitter: NativeEventEmitter | null = null;
const getEmitter = (): NativeEventEmitter => {
  if (!cachedEmitter) {
    cachedEmitter = new NativeEventEmitter(NativeModules.Deepgram);
  }
  return cachedEmitter;
};
const AUDIO_EVENT = Platform.select({
  ios: 'DeepgramAudioPCM',
  android: 'AudioChunk',
  default: 'DeepgramAudioPCM',
}) as string;
const AUDIO_LEVEL_EVENT = Platform.select({
  ios: 'DeepgramAudioLevel',
  android: 'AudioLevel',
  default: 'DeepgramAudioLevel',
}) as string;
const DEFAULT_METERING_INTERVAL_MS = 100;

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
    downsampled[i] = data[i * factor]!;
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
  trackStats = false,
  metering = {},
  onAudioLevel = () => {},
  recordToFile = {},
  onRecordingComplete = () => {},
  reconnect = {},
  onReconnecting = () => {},
  onReconnected = () => {},
  onInterruption,
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
  const meterSub = useRef<ReturnType<NativeEventEmitter['addListener']> | null>(
    null
  );
  const interruptionSub = useRef<{ remove: () => void } | null>(null);
  const apiVersionRef = useRef<'v1' | 'v2'>('v1');
  const pausedRef = useRef(false);
  const interruptedRef = useRef(false);
  const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userClosedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsGenerationRef = useRef(0);
  const liveUrlRef = useRef('');
  const reconnectConfigRef = useRef({ ...DEFAULT_RECONNECT });
  const connectSocketRef = useRef<() => void>(() => {});
  const nativeInputSampleRateRef = useRef(BASE_NATIVE_SAMPLE_RATE);
  const targetSampleRateRef = useRef(DEFAULT_SAMPLE_RATE);
  const downsampleFactorRef = useRef(1);
  const lastPartialTranscriptRef = useRef('');
  const lastFinalTranscriptRef = useRef('');

  const statsRef = useRef<SessionStats>(createEmptySessionStats());
  const statsDirtyRef = useRef(false);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onEndRef = useRef(onEnd);
  const onStartRef = useRef(onStart);
  const onBeforeStartRef = useRef(onBeforeStart);
  const onBeforeTranscribeRef = useRef(onBeforeTranscribe);
  const onTranscribeSuccessRef = useRef(onTranscribeSuccess);
  const onTranscribeErrorRef = useRef(onTranscribeError);
  const onReconnectingRef = useRef(onReconnecting);
  const onReconnectedRef = useRef(onReconnected);

  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;
  onEndRef.current = onEnd;
  onStartRef.current = onStart;
  onBeforeStartRef.current = onBeforeStart;
  onBeforeTranscribeRef.current = onBeforeTranscribe;
  onTranscribeSuccessRef.current = onTranscribeSuccess;
  onTranscribeErrorRef.current = onTranscribeError;
  onReconnectingRef.current = onReconnecting;
  onReconnectedRef.current = onReconnected;
  reconnectConfigRef.current = { ...DEFAULT_RECONNECT, ...reconnect };

  const onAudioLevelRef = useRef(onAudioLevel);
  onAudioLevelRef.current = onAudioLevel;
  const onRecordingCompleteRef = useRef(onRecordingComplete);
  onRecordingCompleteRef.current = onRecordingComplete;
  const recordToFileRef = useRef(recordToFile);
  recordToFileRef.current = recordToFile;

  const onInterruptionRef = useRef(onInterruption);
  onInterruptionRef.current = onInterruption;

  const meteringEnabled = metering.enabled === true;
  const meteringIntervalMs =
    typeof metering.intervalMs === 'number' && metering.intervalMs > 0
      ? metering.intervalMs
      : DEFAULT_METERING_INTERVAL_MS;

  const [internalTranscript, setInternalTranscript] = useState('');
  const [internalInterimTranscript, setInternalInterimTranscript] =
    useState('');
  const [internalIsPaused, setInternalIsPaused] = useState(false);
  const [internalAudioLevel, setInternalAudioLevel] = useState(0);
  const [internalRecordingUri, setInternalRecordingUri] = useState<
    string | undefined
  >(undefined);
  const [internalStats, setInternalStats] = useState<SessionStats>(
    createEmptySessionStats
  );

  const endFiredRef = useRef(false);

  const stopStatsPublisher = useCallback(() => {
    if (statsTimerRef.current != null) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
  }, []);

  const startStatsPublisher = useCallback(() => {
    if (statsTimerRef.current != null) {
      return;
    }
    statsTimerRef.current = setInterval(() => {
      if (!statsDirtyRef.current) {
        return;
      }
      statsDirtyRef.current = false;
      setInternalStats({ ...statsRef.current });
    }, STATS_PUBLISH_INTERVAL_MS);
  }, []);

  // Deepgram closes a live socket that gets no audio and no KeepAlive frame
  // for ~10 s (NET-0001); keep it warm while paused/interrupted.
  const startKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current != null) {
      return;
    }
    keepAliveTimerRef.current = setInterval(() => {
      const s = ws.current;
      if (!s || s.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        s.send(JSON.stringify({ type: 'KeepAlive' }));
      } catch {}
    }, KEEPALIVE_INTERVAL_MS);
  }, []);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current != null) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
  }, []);

  const closeResources = useCallback(() => {
    if (keepAliveTimerRef.current != null) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
    stopStatsPublisher();
    if (reconnectTimerRef.current != null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
    pausedRef.current = false;
    interruptedRef.current = false;
    if (audioSub.current) {
      audioSub.current.remove();
      audioSub.current = null;
    }
    if (meterSub.current) {
      meterSub.current.remove();
      meterSub.current = null;
    }
    if (interruptionSub.current) {
      interruptionSub.current.remove();
      interruptionSub.current = null;
    }
    Deepgram.setMeteringEnabled?.(false, 0);
    Deepgram.stopRecording()
      .then((result) => {
        const uri = result?.recordingUri;
        if (uri) {
          onRecordingCompleteRef.current?.(uri);
          if (trackState) {
            setInternalRecordingUri(uri);
          }
        }
      })
      .catch(() => {});
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
      } catch {}
    }
    ws.current?.close(1000, 'cleanup');
    ws.current = null;
    apiVersionRef.current = 'v1';
    if (trackState) {
      setInternalState((prev) => ({ ...prev, status: 'idle' }));
      setInternalIsPaused(false);
      setInternalAudioLevel(0);
    }
    if (trackTranscript) {
      setInternalTranscript('');
      setInternalInterimTranscript('');
    }
  }, [stopStatsPublisher, trackState, trackTranscript]);

  const fireEnd = useCallback(() => {
    if (endFiredRef.current) return;
    endFiredRef.current = true;
    onEndRef.current();
  }, []);

  const emitTranscript = useCallback(
    (transcript: unknown, isFinal: boolean, raw: unknown) => {
      if (typeof transcript !== 'string') {
        return;
      }

      const normalized = transcript.trim();
      if (!normalized) {
        return;
      }

      if (
        statsRef.current.firstResultMs == null &&
        statsRef.current.connectedAtMs != null
      ) {
        statsRef.current.firstResultMs =
          Date.now() - statsRef.current.connectedAtMs;
        statsDirtyRef.current = true;
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

      onTranscriptRef.current(normalized, info);

      if (isFinal) {
        lastPartialTranscriptRef.current = '';
      }
    },
    [trackTranscript]
  );

  const handleDisconnect = useCallback(
    (event?: { code?: number }, failureError?: Error) => {
      const cfg = reconnectConfigRef.current;
      const shouldReconnect =
        !userClosedRef.current &&
        cfg.enabled &&
        event?.code !== 1000 &&
        reconnectAttemptRef.current < cfg.maxRetries;

      if (shouldReconnect) {
        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current = attempt + 1;
        reconnectingRef.current = true;
        statsRef.current.reconnects += 1;
        statsDirtyRef.current = true;

        const backoff = Math.min(
          cfg.maxDelayMs,
          cfg.initialDelayMs * 2 ** attempt
        );
        const delay = backoff + Math.random() * backoff * 0.25;

        if (trackState) {
          setInternalState({ status: 'loading', error: null });
        }
        onReconnectingRef.current(attempt + 1);

        if (reconnectTimerRef.current != null) {
          clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSocketRef.current();
        }, delay);
        return;
      }

      const exhausted =
        !userClosedRef.current &&
        cfg.enabled &&
        reconnectAttemptRef.current >= cfg.maxRetries;

      closeResources();

      if (exhausted) {
        const err = toDeepgramError(
          new Error(
            `Deepgram reconnect failed after ${cfg.maxRetries} attempts`
          )
        );
        onErrorRef.current(err);
        if (trackState) {
          setInternalState({ status: 'error', error: err });
        }
      } else if (failureError && trackState) {
        setInternalState({
          status: 'error',
          error: toDeepgramError(failureError),
        });
      }

      fireEnd();
    },
    [closeResources, fireEnd, trackState]
  );

  const connectSocket = useCallback(() => {
    const isV2 = apiVersionRef.current === 'v2';
    const generation = wsGenerationRef.current + 1;
    wsGenerationRef.current = generation;

    resolveAuthHeader()
      .then((authHeader) => {
        // A newer connection attempt superseded this one; abandon it.
        if (generation !== wsGenerationRef.current) {
          return;
        }

        let socket: WebSocket;
        try {
          socket = new (WebSocket as any)(liveUrlRef.current, undefined, {
            headers: { Authorization: authHeader },
          });
        } catch {
          handleDisconnect();
          return;
        }
        ws.current = socket;

        socket.onopen = () => {
          if (generation !== wsGenerationRef.current) return;
          const wasReconnecting = reconnectingRef.current;
          reconnectingRef.current = false;
          reconnectAttemptRef.current = 0;
          statsRef.current.connectedAtMs = Date.now();
          statsDirtyRef.current = true;
          onStartRef.current();
          if (wasReconnecting) {
            onReconnectedRef.current();
          }
          if (trackState) {
            setInternalState({ status: 'listening', error: null });
          }
        };

        socket.onmessage = (ev: any) => {
          if (generation !== wsGenerationRef.current) return;
          if (typeof ev.data !== 'string') {
            // Binary frame (not expected from the STT APIs) — count bytes only.
            const size =
              typeof ev?.data?.byteLength === 'number' ? ev.data.byteLength : 0;
            if (size > 0) {
              statsRef.current.bytesReceived += size;
              statsDirtyRef.current = true;
            }
            return;
          }
          try {
            const msg = JSON.parse(ev.data);
            if (isV2) {
              // Flux (v2) envelope:
              // https://developers.deepgram.com/reference/speech-to-text-api/listen-flux
              if (msg.type === 'Error') {
                const description = msg.description || 'Deepgram stream error';
                const streamError = toDeepgramError(new Error(description));
                onErrorRef.current(streamError);
                // Fatal stream error: tear down without auto-reconnecting.
                userClosedRef.current = true;
                closeResources();
                if (trackState) {
                  setInternalState({
                    status: 'error',
                    error: streamError,
                  });
                }
                fireEnd();
                return;
              }

              if (msg.type !== 'TurnInfo') {
                return;
              }

              const transcript = msg.transcript;
              if (typeof transcript === 'string' && transcript.length > 0) {
                const isFinal = msg.event === 'EndOfTurn';
                emitTranscript(transcript, isFinal, msg);
              }
              return;
            }

            const transcript = msg.channel?.alternatives?.[0]?.transcript;
            if (typeof transcript === 'string') {
              const isFinal =
                msg.is_final === true || msg.speech_final === true;
              emitTranscript(transcript, Boolean(isFinal), msg);
            }
          } catch {}
        };

        socket.onerror = (err: any) => {
          if (generation !== wsGenerationRef.current) return;
          onErrorRef.current(toDeepgramError(err));
        };

        socket.onclose = (event: any) => {
          if (generation !== wsGenerationRef.current) return;
          handleDisconnect(event);
        };
      })
      .catch((err) => {
        if (generation !== wsGenerationRef.current) return;
        const authError = toDeepgramError(err);
        onErrorRef.current(authError);
        handleDisconnect(undefined, authError);
      });
  }, [closeResources, emitTranscript, fireEnd, handleDisconnect, trackState]);

  connectSocketRef.current = connectSocket;

  const startListening = useCallback(
    async (overrideOptions: DeepgramLiveListenOptions = {}) => {
      try {
        onBeforeStartRef.current();
        endFiredRef.current = false;
        pausedRef.current = false;
        userClosedRef.current = false;
        reconnectAttemptRef.current = 0;
        reconnectingRef.current = false;
        statsRef.current = createEmptySessionStats();
        statsDirtyRef.current = false;
        if (trackStats) {
          setInternalStats({ ...statsRef.current });
          startStatsPublisher();
        }
        if (trackState) {
          setInternalState({ status: 'loading', error: null });
          setInternalIsPaused(false);
        }
        lastPartialTranscriptRef.current = '';
        lastFinalTranscriptRef.current = '';

        const granted = await askMicPermission();
        if (!granted) throw new Error('Microphone permission denied');

        const rtf = recordToFileRef.current;
        if (trackState) {
          setInternalRecordingUri(undefined);
        }
        await Deepgram.startRecording(
          rtf.enabled === true
            ? {
                recordToFile: {
                  enabled: true,
                  path: rtf.path,
                  format: rtf.format,
                },
              }
            : undefined
        );

        if (!hasAuthConfigured()) throw new Error('Deepgram API key missing');

        if (meteringEnabled) {
          Deepgram.setMeteringEnabled?.(true, meteringIntervalMs);
        }

        const requestedVersion: 'v1' | 'v2' =
          overrideOptions.apiVersion ?? live.apiVersion ?? 'v1';

        const merged: DeepgramLiveListenOptions = {
          encoding: 'linear16',
          sampleRate: DEFAULT_SAMPLE_RATE,
          model: requestedVersion === 'v2' ? 'flux-general-en' : 'nova-3',
          apiVersion: requestedVersion,
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

        const isV2 = merged.apiVersion === 'v2';
        apiVersionRef.current = isV2 ? 'v2' : 'v1';
        const usesKeyterm =
          isV2 ||
          (typeof merged.model === 'string' &&
            merged.model.startsWith('nova-3'));
        const keyterm =
          merged.keyterm ?? (usesKeyterm ? merged.keywords : undefined);
        const keywords = usesKeyterm ? undefined : merged.keywords;

        // Flux (v2) accepts only a small set of query params; v1-only params
        // can make the server reject the connection.
        const query: Record<
          string,
          | string
          | number
          | boolean
          | null
          | undefined
          | Array<string | number | boolean | null | undefined>
        > = isV2
          ? {
              model: merged.model,
              encoding: merged.encoding,
              sample_rate: merged.sampleRate,
              eager_eot_threshold: merged.eagerEotThreshold,
              eot_threshold: merged.eotThreshold,
              eot_timeout_ms: merged.eotTimeoutMs,
              keyterm,
              language_hint: merged.languageHint,
              profanity_filter: merged.profanityFilter,
              mip_opt_out: merged.mipOptOut,
              measurements: merged.measurements,
              tag: merged.tag,
            }
          : {
              callback: merged.callback,
              callback_method: merged.callbackMethod,
              channels: merged.channels,
              detect_entities: merged.detectEntities,
              diarize: merged.diarize,
              diarize_model: merged.diarizeModel,
              dictation: merged.dictation,
              encoding: merged.encoding,
              endpointing: merged.endpointing,
              filler_words: merged.fillerWords,
              interim_results: merged.interimResults,
              keyterm,
              keywords,
              language: merged.language,
              mip_opt_out: merged.mipOptOut,
              measurements: merged.measurements,
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

        if (!isV2 && merged.redact) {
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

        const baseWss = isV2 ? getV2BaseWss() : getBaseWss();
        const baseListenUrl = `${baseWss}/listen`;
        const url = params ? `${baseListenUrl}?${params}` : baseListenUrl;

        liveUrlRef.current = url;

        connectSocket();

        // System interruptions pause native capture; bridge the NET-0001 ~10 s
        // idle timeout with KeepAlive frames until the interruption ends. A
        // permanent focus loss ('stopped') tears the session down natively.
        interruptionSub.current?.remove();
        interruptionSub.current = addInterruptionListener((e) => {
          onInterruptionRef.current?.(e);
          if (e.type === 'began') {
            if (interruptedRef.current) {
              return;
            }
            interruptedRef.current = true;
            // Flush buffered audio into finals (Flux has no Finalize message).
            if (
              apiVersionRef.current !== 'v2' &&
              ws.current?.readyState === WebSocket.OPEN
            ) {
              try {
                ws.current.send(JSON.stringify({ type: 'Finalize' }));
              } catch {}
            }
            startKeepAlive();
          } else if (e.type === 'ended') {
            if (!interruptedRef.current) {
              return;
            }
            interruptedRef.current = false;
            if (!pausedRef.current) {
              stopKeepAlive();
            }
          } else {
            // 'stopped' — the native session is gone; end cleanly.
            userClosedRef.current = true;
            closeResources();
            fireEnd();
          }
        });

        audioSub.current = getEmitter().addListener(AUDIO_EVENT, (ev: any) => {
          if (pausedRef.current) {
            statsRef.current.framesDropped += 1;
            statsDirtyRef.current = true;
            return;
          }
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
          let chunk: ArrayBuffer | undefined;
          let decodedBytes = 0;
          if (typeof ev?.b64 === 'string') {
            decodedBytes = Math.floor((ev.b64.length * 3) / 4);
            const bytes = Uint8Array.from(atob(ev.b64), (c) => c.charCodeAt(0));
            let int16 = new Int16Array(bytes.buffer);
            int16 = downsampleInt16(int16, factor) as Int16Array<ArrayBuffer>;
            chunk = int16.buffer as ArrayBuffer;
          }

          if (chunk && ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(chunk);
            statsRef.current.bytesSent += decodedBytes;
            statsDirtyRef.current = true;
          } else if (chunk) {
            // Socket not open (e.g. reconnect gap) — the frame is lost.
            statsRef.current.framesDropped += 1;
            statsDirtyRef.current = true;
          }
        });

        if (meteringEnabled) {
          meterSub.current = getEmitter().addListener(
            AUDIO_LEVEL_EVENT,
            (ev: any) => {
              const level =
                typeof ev?.level === 'number' && Number.isFinite(ev.level)
                  ? ev.level
                  : 0;
              if (trackState) {
                setInternalAudioLevel(level);
              }
              onAudioLevelRef.current(level);
            }
          );
        }
      } catch (err) {
        const dgError = toDeepgramError(err);
        onErrorRef.current(dgError);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: dgError,
          });
        }
        closeResources();
      }
    },
    [
      connectSocket,
      live,
      trackState,
      trackStats,
      closeResources,
      fireEnd,
      startKeepAlive,
      startStatsPublisher,
      stopKeepAlive,
      meteringEnabled,
      meteringIntervalMs,
    ]
  );

  const stopListening = useCallback(() => {
    try {
      userClosedRef.current = true;
      closeResources();
      fireEnd();
    } catch (err) {
      const dgError = toDeepgramError(err);
      onErrorRef.current(dgError);
      if (trackState) {
        setInternalState({
          status: 'error',
          error: dgError,
        });
      }
    }
  }, [closeResources, trackState, fireEnd]);

  const pause = useCallback(() => {
    if (pausedRef.current) {
      return;
    }
    pausedRef.current = true;

    const socket = ws.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Finalize flushes buffered audio into finals; Flux (v2) is turn-based
      // and has no Finalize control message.
      if (apiVersionRef.current !== 'v2') {
        try {
          socket.send(JSON.stringify({ type: 'Finalize' }));
        } catch {}
      }
    }

    if (keepAliveTimerRef.current == null) {
      startKeepAlive();
    }

    if (trackState) {
      setInternalIsPaused(true);
    }
  }, [startKeepAlive, trackState]);

  const resume = useCallback(() => {
    if (!pausedRef.current) {
      return;
    }
    pausedRef.current = false;

    // A system interruption may still hold the mic; keep KeepAlive until it ends.
    if (!interruptedRef.current) {
      stopKeepAlive();
    }

    if (trackState) {
      setInternalIsPaused(false);
    }
  }, [stopKeepAlive, trackState]);

  const getStats = useCallback(
    (): SessionStats => ({ ...statsRef.current }),
    []
  );

  const transcribeFile = useCallback(
    async (
      file: DeepgramPrerecordedSource,
      overrideOptions: DeepgramPrerecordedOptions = {}
    ) => {
      onBeforeTranscribeRef.current();
      if (trackState) {
        setInternalState({ status: 'transcribing', error: null });
      }
      try {
        const authHeader = await resolveAuthHeader();

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
          diarize_model: merged.diarizeModel,
          dictation: merged.dictation,
          encoding: merged.encoding,
          filler_words: merged.fillerWords,
          keyterm: merged.keyterm,
          keywords: merged.keywords,
          language: merged.language,
          measurements: merged.measurements,
          mip_opt_out: merged.mipOptOut,
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
          query.detect_language = merged.detectLanguage;
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
        const baseUrl = `${getBaseUrl()}/listen`;
        const url = params ? `${baseUrl}?${params}` : baseUrl;

        const headers: Record<string, string> = {
          Authorization: authHeader,
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
          onTranscribeSuccessRef.current(transcript);
          if (trackState) {
            setInternalState({ status: 'idle', error: null });
          }
        } else {
          throw new Error('No transcript present in Deepgram response');
        }
      } catch (err) {
        const dgError = toDeepgramError(err);
        onTranscribeErrorRef.current(dgError);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: dgError,
          });
        }
      }
    },
    [prerecorded, trackState]
  );

  useEffect(
    () => () => {
      userClosedRef.current = true;
      closeResources();
    },
    [closeResources]
  );

  return {
    startListening,
    stopListening,
    transcribeFile,
    pause,
    resume,
    getStats,
    ...(trackState
      ? {
          state: internalState,
          isPaused: internalIsPaused,
          ...(meteringEnabled ? { audioLevel: internalAudioLevel } : {}),
          ...(internalRecordingUri !== undefined
            ? { recordingUri: internalRecordingUri }
            : {}),
        }
      : {}),
    ...(trackTranscript
      ? {
          transcript: internalTranscript,
          interimTranscript: internalInterimTranscript,
        }
      : {}),
    ...(trackStats ? { stats: internalStats } : {}),
  };
}
