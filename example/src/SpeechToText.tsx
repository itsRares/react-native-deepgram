import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import {
  DeepgramError,
  toSRT,
  toSpeakerSegments,
  toWebVTT,
  useDeepgramSpeechToText,
  type DeepgramFluxTurnEvent,
  type DeepgramLiveListenOptions,
  type SpeakerSegment,
} from 'react-native-deepgram';
import Button from './components/Button';
import Card from './components/Card';
import Field from './components/Field';
import OptionSelect from './components/OptionSelect';
import SegmentedControl from './components/SegmentedControl';
import StatusBadge from './components/StatusBadge';
import { colors, radius, spacing, type } from './theme';

const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / (1024 * 1024)).toFixed(1)} MB`;

const formatClock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

type Engine = 'nova' | 'multi' | 'flux';

const ENGINES: {
  key: Engine;
  label: string;
  hint: string;
  options: DeepgramLiveListenOptions;
}[] = [
  {
    key: 'nova',
    label: 'Nova-3',
    hint: 'Interim + final results over /v1/listen.',
    options: {},
  },
  {
    key: 'multi',
    label: 'Nova-3 multi',
    hint: 'language=multi: speak and switch between 50+ languages.',
    options: { language: 'multi' },
  },
  {
    key: 'flux',
    label: 'Flux',
    hint: 'Turn-based /v2/listen: end-of-turn detection, End turn button.',
    options: { apiVersion: 'v2', model: 'flux-general-en' },
  },
];

const ENGINE_SEGMENTS = ENGINES.map(({ key, label }) => ({
  value: key,
  label,
}));

const CAPTION_SEGMENTS = [
  { value: 'srt', label: 'SRT' },
  { value: 'vtt', label: 'WebVTT' },
  { value: 'speakers', label: 'Speakers' },
] as const;

const TURN_LABEL: Record<DeepgramFluxTurnEvent, string> = {
  StartOfTurn: '🗣 Speaking',
  Update: '🗣 Speaking',
  TurnResumed: '🗣 Resumed',
  EagerEndOfTurn: '⏳ Likely done',
  EndOfTurn: '✅ Turn ended',
};

const parseKeyterms = (input: string) =>
  input
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);

export default function SpeechToText() {
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');
  const [fileTranscript, setFileTranscript] = useState('');
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null);
  const [engine, setEngine] = useState<Engine>('nova');
  const [turnEvent, setTurnEvent] = useState<DeepgramFluxTurnEvent | null>(
    null
  );
  const [keytermInput, setKeytermInput] = useState('Deepgram');
  const [configureStatus, setConfigureStatus] = useState<string | null>(null);

  // Captions & speaker segments (2.4.0)
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const [captionsFileName, setCaptionsFileName] = useState<string | null>(null);
  const [captionView, setCaptionView] = useState<'srt' | 'vtt' | 'speakers'>(
    'srt'
  );
  const [captionSrt, setCaptionSrt] = useState('');
  const [captionVtt, setCaptionVtt] = useState('');
  const [speakerSegments, setSpeakerSegments] = useState<SpeakerSegment[]>([]);

  // Record-to-file is opt-in: the user chooses whether to save and where.
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [recordFolder, setRecordFolder] = useState<'documents' | 'cache'>(
    'documents'
  );
  const [recordFileName, setRecordFileName] = useState(
    'deepgram-recording.wav'
  );

  const safeRecordName =
    recordFileName.trim().replace(/[/\\]/g, '') || 'deepgram-recording.wav';
  const recordPath = useMemo(
    () =>
      new File(
        recordFolder === 'cache' ? Paths.cache : Paths.document,
        safeRecordName
      ).uri,
    [recordFolder, safeRecordName]
  );

  const {
    startListening,
    stopListening,
    pause,
    resume,
    configure,
    forceEndTurn,
    state: liveState,
    isPaused,
    audioLevel,
    recordingUri,
    stats,
  } = useDeepgramSpeechToText({
    trackState: true,
    trackStats: true,
    reconnect: { enabled: true },
    metering: { enabled: true },
    recordToFile: { enabled: recordEnabled, path: recordPath },
    onBeforeStart: () => {
      setLiveTranscript('');
      setLiveInterimTranscript('');
      setReconnectAttempt(null);
      setTurnEvent(null);
      setConfigureStatus(null);
    },
    onTurnInfo: (turn) => setTurnEvent(turn.event),
    onMessage: (message) => {
      if (message.type === 'ConfigureSuccess') {
        setConfigureStatus('✅ Applied by Deepgram');
      } else if (message.type === 'ConfigureFailure') {
        setConfigureStatus(
          `⚠ Rejected: ${String(message.description ?? 'unknown reason')}`
        );
      }
    },
    onTranscript: (text, info) => {
      if (info?.isFinal) {
        setLiveTranscript((prev) => (prev ? `${prev} ${text}` : text).trim());
        setLiveInterimTranscript('');
      } else {
        setLiveInterimTranscript(text);
      }
    },
    onError: (err) => {
      console.error('Live STT error', err);
    },
    onReconnecting: (attempt) => {
      setReconnectAttempt(attempt);
    },
    onReconnected: () => {
      setReconnectAttempt(null);
    },
    onEnd: () => {
      setLiveInterimTranscript('');
      setReconnectAttempt(null);
      setTurnEvent(null);
    },
    onRecordingComplete: (uri) => {
      console.log('Saved mic recording to', uri);
    },
    live: {
      model: 'nova-3',
      interimResults: true,
      punctuate: true,
    },
  });

  const { transcribeFile, state: fileState } = useDeepgramSpeechToText({
    trackState: true,
    onBeforeTranscribe: () => setFileTranscript(''),
    onTranscribeSuccess: setFileTranscript,
    prerecorded: {
      punctuate: true,
      summarize: 'v2',
      diarizeModel: 'latest',
      detectEntities: true,
    },
  });

  const isReconnecting = reconnectAttempt !== null;
  const isListening = liveState?.status === 'listening';
  const isTranscribing = fileState?.status === 'transcribing';
  const sessionActive = isListening || isReconnecting;
  const isCapturing = sessionActive && !isPaused;

  // Mic pulse
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isCapturing) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isCapturing, pulse]);

  // Mic level meter
  const levelAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(levelAnim, {
      toValue: isCapturing ? Math.min(1, Math.max(0, audioLevel ?? 0)) : 0,
      duration: 90,
      useNativeDriver: false,
    }).start();
  }, [audioLevel, isCapturing, levelAnim]);
  const meterWidth = levelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const pickAndTranscribe = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0]!;
        setPickedFileName(asset.name ?? 'audio file');
        await transcribeFile(
          {
            uri: asset.uri,
            name: asset.name || 'audio-file',
            type: asset.mimeType || 'audio/mpeg',
          },
          { topics: true, intents: true }
        );
      }
    } catch (err) {
      Alert.alert('File picker error', String(err));
    }
  };

  const stopLive = () => {
    setReconnectAttempt(null);
    stopListening();
  };

  const activeEngine = ENGINES.find((e) => e.key === engine) ?? ENGINES[0]!;
  const startLive = () =>
    startListening({
      keyterm: parseKeyterms(keytermInput),
      ...activeEngine.options,
    });

  const applyKeyterms = () => {
    setConfigureStatus(
      configure({ keyterms: parseKeyterms(keytermInput) })
        ? 'Sent — waiting for Deepgram…'
        : '⚠ Not connected'
    );
  };

  // Caption helpers need the raw prerecorded response (word timings,
  // utterances, speakers), so hit /v1/listen directly — same request the
  // hook makes, but with utterances + diarization enabled.
  const pickForCaptions = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (!result.assets || result.assets.length === 0) return;
      const asset = result.assets[0]!;
      setCaptionsFileName(asset.name ?? 'audio file');
      setCaptionsLoading(true);
      setCaptionsError(null);
      setCaptionSrt('');
      setCaptionVtt('');
      setSpeakerSegments([]);

      const base =
        process.env.EXPO_PUBLIC_DEEPGRAM_BASE_URL ||
        'https://api.deepgram.com/v1';
      const formData = new FormData();
      formData.append('audio', {
        uri: asset.uri,
        name: asset.name || 'audio-file',
        type: asset.mimeType || 'audio/mpeg',
      } as any);

      const res = await fetch(
        `${base}/listen?model=nova-3&smart_format=true&utterances=true&diarize_model=latest`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY}`,
          },
          body: formData,
        }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const json = await res.json();

      setCaptionSrt(toSRT(json, { speakerLabels: true }));
      setCaptionVtt(toWebVTT(json, { speakerLabels: true }));
      setSpeakerSegments(toSpeakerSegments(json));
      setCaptionView('srt');
    } catch (err) {
      setCaptionsError(err instanceof Error ? err.message : String(err));
    } finally {
      setCaptionsLoading(false);
    }
  };

  const tone = liveState?.error
    ? 'error'
    : isReconnecting
      ? 'connecting'
      : isPaused
        ? 'warning'
        : isListening
          ? 'live'
          : 'idle';
  const toneLabel = liveState?.error
    ? 'Error'
    : isReconnecting
      ? 'Reconnecting'
      : isPaused
        ? 'Paused'
        : isListening
          ? 'Listening'
          : 'Ready';

  const combinedLiveTranscript = [liveTranscript, liveInterimTranscript]
    .filter(Boolean)
    .join(' ');

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Live STT */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <StatusBadge tone={tone} label={toneLabel} />
            {engine === 'flux' && turnEvent && sessionActive ? (
              <View style={styles.turnChip}>
                <Text style={styles.turnChipText}>{TURN_LABEL[turnEvent]}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.micWrap}>
            {isCapturing && (
              <Animated.View
                style={[
                  styles.pulse,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
            )}
            <View
              style={[
                styles.micCircle,
                isCapturing && styles.micCircleActive,
                isPaused && styles.micCirclePaused,
              ]}
            >
              <Text style={styles.micIcon}>{isPaused ? '🔇' : '🎤'}</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>
            {isReconnecting
              ? 'Reconnecting…'
              : isPaused
                ? 'Paused'
                : isListening
                  ? 'Listening…'
                  : 'Live transcription'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {isReconnecting
              ? 'Connection dropped — retrying automatically.'
              : isListening
                ? isPaused
                  ? 'Mic muted — tap resume to continue.'
                  : 'Tap stop when you are done.'
                : 'Tap start and speak to see live transcripts.'}
          </Text>

          {isCapturing ? (
            <View style={styles.meterTrack}>
              <Animated.View
                style={[styles.meterFill, { width: meterWidth }]}
              />
            </View>
          ) : null}

          <View style={styles.pipeline}>
            <Text style={styles.pipelineText} numberOfLines={1}>
              {[
                activeEngine.label,
                'auto-reconnect',
                recordEnabled ? 'recording to WAV' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>

          <View style={styles.heroActions}>
            {sessionActive ? (
              <View style={styles.heroButtonRow}>
                {isListening ? (
                  <Button
                    title={isPaused ? 'Resume' : 'Pause'}
                    variant="secondary"
                    size="lg"
                    iconLeft={isPaused ? '▶' : '⏸'}
                    onPress={() => (isPaused ? resume() : pause())}
                    style={styles.flexButton}
                  />
                ) : null}
                <Button
                  title="Stop"
                  variant="danger"
                  size="lg"
                  onPress={stopLive}
                  style={styles.flexButton}
                />
              </View>
            ) : (
              <Button
                title="Start listening"
                variant="primary"
                size="lg"
                iconLeft="▶"
                onPress={startLive}
              />
            )}
          </View>
        </View>

        <Card
          title="Model"
          subtitle={sessionActive ? 'Stop to switch models' : activeEngine.hint}
        >
          <SegmentedControl
            segments={ENGINE_SEGMENTS}
            value={engine}
            onChange={setEngine}
            disabled={sessionActive}
          />
          <Field
            label="Keyterms"
            value={keytermInput}
            onChangeText={setKeytermInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Deepgram, Nova, Flux"
            hint="Comma-separated words to boost. While listening, Apply sends a Configure message — no reconnect."
          />
          {sessionActive ? (
            <View style={styles.heroButtonRow}>
              <Button
                title="Apply keyterms"
                size="sm"
                variant="secondary"
                onPress={applyKeyterms}
                style={styles.flexButton}
              />
              {engine === 'flux' ? (
                <Button
                  title="End turn now"
                  size="sm"
                  variant="secondary"
                  onPress={() => forceEndTurn()}
                  style={styles.flexButton}
                />
              ) : null}
            </View>
          ) : null}
          {configureStatus ? (
            <Text style={[styles.recordHint, styles.configureStatus]}>
              {configureStatus}
            </Text>
          ) : null}
        </Card>

        {/* Record-to-file: opt in and choose where to save */}
        <Card
          title="Record to file"
          subtitle="Optionally save the mic audio to a WAV while you stream"
        >
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Save this session to a file</Text>
            <Switch
              value={recordEnabled}
              onValueChange={setRecordEnabled}
              disabled={sessionActive}
              thumbColor={recordEnabled ? colors.success : '#888'}
              trackColor={{
                false: colors.surfaceMuted,
                true: colors.accentMuted,
              }}
            />
          </View>

          {recordEnabled ? (
            <>
              <OptionSelect
                label="Destination folder"
                value={recordFolder}
                onChange={(v) =>
                  setRecordFolder(v === 'cache' ? 'cache' : 'documents')
                }
                options={[
                  { label: 'App documents', value: 'documents' },
                  { label: 'App cache', value: 'cache' },
                ]}
              />
              <Field
                label="File name"
                value={recordFileName}
                onChangeText={setRecordFileName}
                editable={!sessionActive}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="deepgram-recording.wav"
                hint={`Saves to: ${recordPath}`}
              />
            </>
          ) : (
            <Text style={styles.recordHint}>
              Off by default — turn this on to keep a copy of the audio. You
              pick the folder and file name before you start listening.
            </Text>
          )}
        </Card>

        {isReconnecting ? (
          <View style={styles.reconnectBanner}>
            <Text style={styles.reconnectText}>
              ↻ Reconnecting… (attempt {reconnectAttempt})
            </Text>
          </View>
        ) : null}

        {liveState?.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              ⚠{' '}
              {liveState.error instanceof DeepgramError
                ? `[${liveState.error.code}] `
                : ''}
              {liveState.error.message}
            </Text>
          </View>
        ) : null}

        {recordingUri && !sessionActive ? (
          <View style={styles.recordingBanner}>
            <Text style={styles.recordingBannerTitle}>💾 Recording saved</Text>
            <Text style={styles.recordingBannerPath} numberOfLines={1}>
              {recordingUri}
            </Text>
          </View>
        ) : null}

        <Card title="Transcript" subtitle="Final + interim results">
          {combinedLiveTranscript ? (
            <Text style={styles.transcript}>
              {liveTranscript}
              {liveInterimTranscript ? (
                <Text style={styles.interim}>
                  {liveTranscript ? ' ' : ''}
                  {liveInterimTranscript}
                </Text>
              ) : null}
            </Text>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>👂</Text>
              <Text style={styles.emptyText}>
                Nothing yet. Start listening to see your speech transcribed.
              </Text>
            </View>
          )}
        </Card>

        {/* Session stats (2.4.0) */}
        <Card
          title="Session stats"
          subtitle="Live telemetry — updates at most once per second"
        >
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {formatBytes(stats?.bytesSent ?? 0)}
              </Text>
              <Text style={styles.statLabel}>Audio sent</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {formatBytes(stats?.bytesReceived ?? 0)}
              </Text>
              <Text style={styles.statLabel}>Received</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{stats?.framesDropped ?? 0}</Text>
              <Text style={styles.statLabel}>Frames dropped</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{stats?.reconnects ?? 0}</Text>
              <Text style={styles.statLabel}>Reconnects</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {stats?.firstResultMs != null
                  ? `${stats.firstResultMs} ms`
                  : '—'}
              </Text>
              <Text style={styles.statLabel}>First result</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>
                {stats?.connectedAtMs != null
                  ? new Date(stats.connectedAtMs).toLocaleTimeString()
                  : '—'}
              </Text>
              <Text style={styles.statLabel}>Connected at</Text>
            </View>
          </View>
          <Text style={styles.recordHint}>
            Counters reset on every start. Pause the mic to watch “frames
            dropped” climb.
          </Text>
        </Card>

        {/* File transcription */}
        <Card
          title="File transcription"
          subtitle="Upload audio for prerecorded transcription"
        >
          <Button
            title={
              isTranscribing
                ? 'Transcribing…'
                : pickedFileName
                  ? 'Pick another file'
                  : 'Pick audio file'
            }
            variant="secondary"
            onPress={pickAndTranscribe}
            loading={isTranscribing}
            disabled={isTranscribing}
            iconLeft="📂"
          />
          {pickedFileName ? (
            <Text style={styles.fileName}>{pickedFileName}</Text>
          ) : null}

          {fileState?.error ? (
            <View style={[styles.errorBanner, { marginTop: spacing.md }]}>
              <Text style={styles.errorText}>⚠ {fileState.error.message}</Text>
            </View>
          ) : null}

          <View style={styles.fileResultWrap}>
            {fileTranscript ? (
              <Text style={styles.transcript}>{fileTranscript}</Text>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📄</Text>
                <Text style={styles.emptyText}>
                  Pick an audio file to transcribe with Deepgram.
                </Text>
              </View>
            )}
          </View>
        </Card>

        {/* Captions & speaker segments (2.4.0) */}
        <Card
          title="Captions & speakers"
          subtitle="Export SRT / WebVTT subtitles and split by speaker"
        >
          <Button
            title={
              captionsLoading
                ? 'Transcribing…'
                : captionsFileName
                  ? 'Pick another file'
                  : 'Pick audio for captions'
            }
            variant="secondary"
            onPress={pickForCaptions}
            loading={captionsLoading}
            disabled={captionsLoading}
            iconLeft="🎬"
          />
          {captionsFileName ? (
            <Text style={styles.fileName}>{captionsFileName}</Text>
          ) : null}

          {captionsError ? (
            <View style={[styles.errorBanner, { marginTop: spacing.md }]}>
              <Text style={styles.errorText}>⚠ {captionsError}</Text>
            </View>
          ) : null}

          {captionSrt ? (
            <>
              <View style={styles.captionTabs}>
                <SegmentedControl
                  segments={CAPTION_SEGMENTS}
                  value={captionView}
                  onChange={setCaptionView}
                />
              </View>

              {captionView === 'speakers' ? (
                speakerSegments.length > 0 ? (
                  speakerSegments.map((segment, index) => (
                    <View
                      key={`${segment.speaker}-${index}`}
                      style={styles.speakerRow}
                    >
                      <View style={styles.speakerBadge}>
                        <Text style={styles.speakerBadgeText}>
                          S{segment.speaker}
                        </Text>
                      </View>
                      <View style={styles.speakerBody}>
                        <Text style={styles.speakerMeta}>
                          {formatClock(segment.start)} –{' '}
                          {formatClock(segment.end)} · conf{' '}
                          {(segment.confidence * 100).toFixed(0)}%
                        </Text>
                        <Text style={styles.transcript}>{segment.text}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.recordHint}>
                    No speaker data in this response.
                  </Text>
                )
              ) : (
                <ScrollView
                  style={styles.captionScroll}
                  nestedScrollEnabled
                  horizontal={false}
                >
                  <Text style={styles.captionMono}>
                    {captionView === 'srt' ? captionSrt : captionVtt}
                  </Text>
                </ScrollView>
              )}
            </>
          ) : !captionsLoading && !captionsError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🎬</Text>
              <Text style={styles.emptyText}>
                Pick an audio file to generate subtitles (SRT / WebVTT) and a
                speaker-attributed transcript.
              </Text>
            </View>
          ) : null}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroTop: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  turnChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  turnChipText: {
    ...type.smallMedium,
    color: colors.accent,
    fontSize: 12,
  },
  configureStatus: {
    marginTop: spacing.sm,
  },
  micWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  pulse: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
  },
  micCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  micCircleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  micCirclePaused: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.warning,
  },
  micIcon: { fontSize: 30 },
  heroTitle: {
    ...type.h2,
    color: colors.text,
  },
  heroSubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  meterTrack: {
    width: '70%',
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  meterFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  heroActions: { width: '100%' },
  heroButtonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  flexButton: {
    flexGrow: 1,
    flexBasis: '45%',
  },
  pipeline: {
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  pipelineText: {
    ...type.mono,
    color: colors.textMuted,
  },
  reconnectBanner: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  reconnectText: {
    color: colors.accent,
    ...type.smallMedium,
  },
  errorBanner: {
    backgroundColor: '#3a1418',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
    ...type.smallMedium,
  },
  recordingBanner: {
    backgroundColor: '#10241c',
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  recordingBannerTitle: {
    color: colors.success,
    ...type.smallMedium,
    marginBottom: 2,
  },
  recordingBannerPath: {
    ...type.mono,
    color: colors.textMuted,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  switchLabel: {
    ...type.body,
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
  recordHint: {
    ...type.small,
    color: colors.textDim,
  },
  transcript: {
    ...type.body,
    color: colors.text,
    lineHeight: 22,
  },
  interim: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  fileName: {
    ...type.small,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  fileResultWrap: {
    marginTop: spacing.md,
  },
  empty: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...type.small,
    color: colors.textMuted,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: {
    ...type.smallMedium,
    color: colors.text,
  },
  statLabel: {
    ...type.small,
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  captionTabs: {
    marginTop: spacing.md,
  },
  captionScroll: {
    maxHeight: 240,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  captionMono: {
    ...type.mono,
    color: colors.text,
    lineHeight: 18,
  },
  speakerRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  speakerBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerBadgeText: {
    ...type.smallMedium,
    color: colors.accent,
    fontSize: 12,
  },
  speakerBody: { flex: 1 },
  speakerMeta: {
    ...type.small,
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 2,
  },
});
