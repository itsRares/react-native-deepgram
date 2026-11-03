import { useCallback, useEffect, useRef, useState } from 'react';
import { Deepgram, type AudioLevelEvent, type AudioPCMEvent } from './native';
import { askMicPermission } from './helpers/askMicPermission';
import { hasAuthConfigured, resolveAuthHeader } from './helpers/auth';
import {
  addInterruptionListener,
  type DeepgramInterruptionEvent,
} from './interruption';
import { createKeepAlive } from './internal/keepAlive';
import {
  buildLiveListenUrl,
  buildPrerecordedUrl,
  DEFAULT_LIVE_SAMPLE_RATE,
  resolveLiveOptions,
} from './internal/listenQuery';
import {
  ManagedSocket,
  type ManagedSocketOptions,
} from './internal/managedSocket';
import {
  computeDownsampleFactor,
  decodePcmFrame,
  NATIVE_SAMPLE_RATE,
} from './internal/pcm';
import { useLatest } from './internal/useLatest';
import { useSessionStats } from './internal/useSessionStats';
import { toDeepgramError } from './types/errors';
import type {
  DeepgramLiveListenOptions,
  DeepgramPrerecordedOptions,
  DeepgramPrerecordedSource,
  UseDeepgramSpeechToTextProps,
  UseDeepgramSpeechToTextReturn,
} from './types';

const DEFAULT_METERING_INTERVAL_MS = 100;

type ListenStatus = 'idle' | 'loading' | 'listening' | 'transcribing' | 'error';

interface LiveSession {
  active: boolean;
  recording: boolean;
  url: string;
  apiVersion: 'v1' | 'v2';
  targetSampleRate: number;
  nativeSampleRate: number;
  downsampleFactor: number;
  paused: boolean;
  interrupted: boolean;
  lastPartial: string;
  lastFinal: string;
  subscriptions: Array<{ remove: () => void }>;
}

const createLiveSession = (): LiveSession => ({
  active: false,
  recording: false,
  url: '',
  apiVersion: 'v1',
  targetSampleRate: DEFAULT_LIVE_SAMPLE_RATE,
  nativeSampleRate: NATIVE_SAMPLE_RATE,
  downsampleFactor: 1,
  paused: false,
  interrupted: false,
  lastPartial: '',
  lastFinal: '',
  subscriptions: [],
});

/** Request body for pre-recorded audio: a hosted URL or an uploaded file. */
function buildPrerecordedBody(file: DeepgramPrerecordedSource): {
  body: FormData | string;
  contentType?: string;
} {
  if (typeof file === 'string' || 'url' in file) {
    const url = typeof file === 'string' ? file : file.url;
    return { body: JSON.stringify({ url }), contentType: 'application/json' };
  }
  const formData = new FormData();
  if (file instanceof Blob) {
    formData.append('audio', file, 'recording.wav');
  } else {
    formData.append('audio', {
      uri: file.uri,
      name: file.name || 'recording.wav',
      type: file.type || 'audio/wav',
    });
  }
  return { body: formData };
}

export function useDeepgramSpeechToText(
  props: UseDeepgramSpeechToTextProps = {}
): UseDeepgramSpeechToTextReturn {
  const {
    trackState = false,
    trackTranscript = false,
    trackStats = false,
    metering = {},
  } = props;
  const propsRef = useLatest(props);
  const flagsRef = useLatest({ trackState, trackTranscript });

  const meteringEnabled = metering.enabled === true;
  const meteringIntervalMs =
    typeof metering.intervalMs === 'number' && metering.intervalMs > 0
      ? metering.intervalMs
      : DEFAULT_METERING_INTERVAL_MS;

  const [state, setState] = useState<{
    status: ListenStatus;
    error: Error | null;
  }>({ status: 'idle', error: null });
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | undefined>();
  const stats = useSessionStats(trackStats);

  const sessionRef = useRef<LiveSession>(createLiveSession());
  const endFiredRef = useRef(true);
  const socketEvents = useRef<ManagedSocketOptions | null>(null);

  const [socket] = useState(
    () =>
      new ManagedSocket({
        url: () => sessionRef.current.url,
        reconnect: () => propsRef.current.reconnect,
        onOpen: (info) => socketEvents.current?.onOpen(info),
        onMessage: (message) => socketEvents.current?.onMessage(message),
        onError: (error) => socketEvents.current?.onError(error),
        onReconnecting: (attempt) =>
          socketEvents.current?.onReconnecting?.(attempt),
        onClose: (info) => socketEvents.current?.onClose(info),
      })
  );

  const trySendJson = useCallback(
    (message: object) => {
      try {
        socket.sendJson(message);
      } catch {
        // The socket is closing; the frame is not needed anymore.
      }
    },
    [socket]
  );

  const [keepAlive] = useState(() =>
    createKeepAlive(() => trySendJson({ type: 'KeepAlive' }))
  );

  const setStatus = useCallback(
    (status: ListenStatus, error: Error | null = null) => {
      if (flagsRef.current.trackState) {
        setState({ status, error });
      }
    },
    [flagsRef]
  );

  const fireEnd = useCallback(() => {
    if (endFiredRef.current) return;
    endFiredRef.current = true;
    propsRef.current.onEnd?.();
  }, [propsRef]);

  const { stopPublishing, update: updateStats } = stats;
  const teardown = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = createLiveSession();
    keepAlive.clear();
    stopPublishing();
    session.subscriptions.forEach((subscription) => subscription.remove());

    if (session.recording) {
      Deepgram.setMeteringEnabled(false, 0);
      Deepgram.stopRecording()
        .then((result) => {
          const uri = result?.recordingUri;
          if (!uri) return;
          propsRef.current.onRecordingComplete?.(uri);
          if (flagsRef.current.trackState) {
            setRecordingUri(uri);
          }
        })
        .catch(() => {});
    }

    if (session.apiVersion === 'v2') {
      trySendJson({ type: 'CloseStream' });
    }
    socket.close();

    if (flagsRef.current.trackState) {
      setState((prev) => ({ ...prev, status: 'idle' }));
      setIsPaused(false);
      setAudioLevel(0);
    }
    if (flagsRef.current.trackTranscript) {
      setTranscript('');
      setInterimTranscript('');
    }
  }, [flagsRef, keepAlive, propsRef, socket, stopPublishing, trySendJson]);

  const failSession = useCallback(
    (error: Error) => {
      const dgError = toDeepgramError(error);
      propsRef.current.onError?.(dgError);
      teardown();
      setStatus('error', dgError);
      fireEnd();
    },
    [fireEnd, propsRef, setStatus, teardown]
  );

  const emitTranscript = (text: unknown, isFinal: boolean, raw: unknown) => {
    if (typeof text !== 'string') return;
    const normalized = text.trim();
    if (!normalized) return;

    stats.markFirstResult();

    const session = sessionRef.current;
    if (isFinal) {
      if (session.lastFinal === normalized) return;
      session.lastFinal = normalized;
      session.lastPartial = '';
    } else {
      if (session.lastPartial === normalized) return;
      session.lastPartial = normalized;
    }

    if (trackTranscript) {
      if (isFinal) {
        setTranscript((prev) => (prev ? `${prev} ${normalized}` : normalized));
        setInterimTranscript('');
      } else {
        setInterimTranscript(normalized);
      }
    }

    propsRef.current.onTranscript?.(normalized, { isFinal, raw });
  };

  socketEvents.current = {
    url: () => sessionRef.current.url,
    reconnect: () => propsRef.current.reconnect,
    onOpen: ({ reconnected }) => {
      stats.update((s) => {
        s.connectedAtMs = Date.now();
      });
      propsRef.current.onStart?.();
      if (reconnected) {
        propsRef.current.onReconnected?.();
      }
      setStatus('listening');
    },
    onMessage: ({ data }) => {
      if (typeof data !== 'string') {
        // Binary frames are not expected from the STT APIs; count them only.
        const size = (data as ArrayBuffer | null)?.byteLength;
        if (typeof size === 'number' && size > 0) {
          stats.update((s) => {
            s.bytesReceived += size;
          });
        }
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (sessionRef.current.apiVersion === 'v2') {
        // https://developers.deepgram.com/reference/speech-to-text-api/listen-flux
        if (msg.type === 'Error') {
          failSession(new Error(msg.description || 'Deepgram stream error'));
        } else if (msg.type === 'TurnInfo') {
          emitTranscript(msg.transcript, msg.event === 'EndOfTurn', msg);
        }
        return;
      }

      emitTranscript(
        msg.channel?.alternatives?.[0]?.transcript,
        msg.is_final === true || msg.speech_final === true,
        msg
      );
    },
    onError: (error) => propsRef.current.onError?.(error),
    onReconnecting: (attempt) => {
      stats.update((s) => {
        s.reconnects += 1;
      });
      setStatus('loading');
      propsRef.current.onReconnecting?.(attempt);
    },
    onClose: ({ exhausted, maxRetries, error }) => {
      if (sessionRef.current.active) {
        teardown();
        if (exhausted) {
          const reconnectError = toDeepgramError(
            new Error(`Deepgram reconnect failed after ${maxRetries} attempts`)
          );
          propsRef.current.onError?.(reconnectError);
          setStatus('error', reconnectError);
        } else if (error) {
          setStatus('error', error);
        }
      }
      fireEnd();
    },
  };

  const handleAudio = useCallback(
    (event: AudioPCMEvent) => {
      const session = sessionRef.current;
      if (session.paused) {
        updateStats((s) => {
          s.framesDropped += 1;
        });
        return;
      }
      if (
        event.sampleRate > 0 &&
        event.sampleRate !== session.nativeSampleRate
      ) {
        session.nativeSampleRate = event.sampleRate;
        session.downsampleFactor = computeDownsampleFactor(
          session.targetSampleRate,
          event.sampleRate
        );
      }

      const frame = decodePcmFrame(event.b64, session.downsampleFactor);
      const sent = socket.send(frame.audio);
      updateStats((s) => {
        if (sent) {
          s.bytesSent += frame.decodedBytes;
        } else {
          // Socket not open (e.g. reconnect gap); the frame is lost.
          s.framesDropped += 1;
        }
      });
    },
    [socket, updateStats]
  );

  const handleAudioLevel = useCallback(
    ({ level }: AudioLevelEvent) => {
      const normalized = Number.isFinite(level) ? level : 0;
      if (flagsRef.current.trackState) {
        setAudioLevel(normalized);
      }
      propsRef.current.onAudioLevel?.(normalized);
    },
    [flagsRef, propsRef]
  );

  // Native capture pauses during system interruptions; KeepAlive frames
  // bridge Deepgram's idle timeout until the interruption ends.
  const handleInterruption = useCallback(
    (event: DeepgramInterruptionEvent) => {
      propsRef.current.onInterruption?.(event);
      const session = sessionRef.current;
      if (event.type === 'began') {
        if (session.interrupted) return;
        session.interrupted = true;
        // Flux is turn-based and has no Finalize message.
        if (session.apiVersion !== 'v2') {
          trySendJson({ type: 'Finalize' });
        }
        keepAlive.hold('interruption');
      } else if (event.type === 'ended') {
        if (!session.interrupted) return;
        session.interrupted = false;
        keepAlive.release('interruption');
      } else {
        // Permanent focus loss: the native session is gone.
        teardown();
        fireEnd();
      }
    },
    [fireEnd, keepAlive, propsRef, teardown, trySendJson]
  );

  const { reset: resetStats, startPublishing } = stats;
  const startListening = useCallback(
    async (overrides: DeepgramLiveListenOptions = {}) => {
      try {
        propsRef.current.onBeforeStart?.();
        if (sessionRef.current.active) {
          teardown();
        }
        const session = createLiveSession();
        session.active = true;
        sessionRef.current = session;
        endFiredRef.current = false;
        resetStats();
        startPublishing();
        setStatus('loading');
        if (trackState) {
          setIsPaused(false);
          setRecordingUri(undefined);
        }

        const granted = await askMicPermission();
        if (!granted) throw new Error('Microphone permission denied');

        const rtf = propsRef.current.recordToFile ?? {};
        await Deepgram.startRecording(
          rtf.enabled === true
            ? {
                recordToFile: {
                  enabled: true,
                  path: rtf.path,
                  format: rtf.format,
                },
              }
            : {}
        );
        session.recording = true;

        if (!hasAuthConfigured()) throw new Error('Deepgram API key missing');

        if (meteringEnabled) {
          Deepgram.setMeteringEnabled(true, meteringIntervalMs);
        }

        const options = resolveLiveOptions(
          propsRef.current.live ?? {},
          overrides
        );
        session.apiVersion = options.apiVersion === 'v2' ? 'v2' : 'v1';
        session.targetSampleRate =
          typeof options.sampleRate === 'number' && options.sampleRate > 0
            ? options.sampleRate
            : DEFAULT_LIVE_SAMPLE_RATE;
        session.downsampleFactor = computeDownsampleFactor(
          session.targetSampleRate,
          session.nativeSampleRate
        );
        session.url = buildLiveListenUrl(options);
        socket.open();

        session.subscriptions.push(
          addInterruptionListener(handleInterruption),
          Deepgram.onAudioPCM(handleAudio)
        );
        if (meteringEnabled) {
          session.subscriptions.push(Deepgram.onAudioLevel(handleAudioLevel));
        }
      } catch (err) {
        const dgError = toDeepgramError(err);
        propsRef.current.onError?.(dgError);
        teardown();
        setStatus('error', dgError);
      }
    },
    [
      handleAudio,
      handleAudioLevel,
      handleInterruption,
      meteringEnabled,
      meteringIntervalMs,
      propsRef,
      resetStats,
      setStatus,
      socket,
      startPublishing,
      teardown,
      trackState,
    ]
  );

  const stopListening = useCallback(() => {
    teardown();
    fireEnd();
  }, [fireEnd, teardown]);

  const pause = useCallback(() => {
    const session = sessionRef.current;
    if (session.paused) return;
    session.paused = true;
    // Finalize flushes buffered audio into finals (Flux has no Finalize).
    if (session.apiVersion !== 'v2') {
      trySendJson({ type: 'Finalize' });
    }
    keepAlive.hold('pause');
    if (trackState) setIsPaused(true);
  }, [keepAlive, trackState, trySendJson]);

  const resume = useCallback(() => {
    const session = sessionRef.current;
    if (!session.paused) return;
    session.paused = false;
    keepAlive.release('pause');
    if (trackState) setIsPaused(false);
  }, [keepAlive, trackState]);

  const transcribeFile = useCallback(
    async (
      file: DeepgramPrerecordedSource,
      overrides: DeepgramPrerecordedOptions = {}
    ) => {
      const p = propsRef.current;
      p.onBeforeTranscribe?.();
      setStatus('transcribing');
      try {
        const authHeader = await resolveAuthHeader();
        const url = buildPrerecordedUrl({
          ...(p.prerecorded ?? {}),
          ...overrides,
        });
        const { body, contentType } = buildPrerecordedBody(file);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            ...(contentType ? { 'Content-Type': contentType } : {}),
          },
          body,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        const json = await res.json();
        const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        if (!text) {
          throw new Error('No transcript present in Deepgram response');
        }
        propsRef.current.onTranscribeSuccess?.(text);
        setStatus('idle');
      } catch (err) {
        const dgError = toDeepgramError(err);
        propsRef.current.onTranscribeError?.(dgError);
        setStatus('error', dgError);
      }
    },
    [propsRef, setStatus]
  );

  useEffect(() => teardown, [teardown]);

  return {
    startListening,
    stopListening,
    transcribeFile,
    pause,
    resume,
    getStats: stats.getStats,
    ...(trackState
      ? {
          state,
          isPaused,
          ...(meteringEnabled ? { audioLevel } : {}),
          ...(recordingUri !== undefined ? { recordingUri } : {}),
        }
      : {}),
    ...(trackTranscript ? { transcript, interimTranscript } : {}),
    ...(trackStats ? { stats: stats.stats } : {}),
  };
}
