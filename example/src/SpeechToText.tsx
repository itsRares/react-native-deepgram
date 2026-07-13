import { useEffect, useRef, useState } from 'react';
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
import * as FileSystem from 'expo-file-system';
import {
  DeepgramError,
  toSRT,
  toSpeakerSegments,
  toWebVTT,
  useDeepgramSpeechToText,
  type SpeakerSegment,
} from 'react-native-deepgram';
import Button from './components/Button';
import Card from './components/Card';
import Field from './components/Field';
import OptionSelect from './components/OptionSelect';
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

export default function SpeechToText() {
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');
  const [fileTranscript, setFileTranscript] = useState('');
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null);

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

  // Silence gating & auto-stop
  const [silenceGateEnabled, setSilenceGateEnabled] = useState(false);
  const [autoStopEnabled, setAutoStopEnabled] = useState(false);
  const [isSilent, setIsSilent] = useState(false);

  // Capture sample rate
  const [captureRate, setCaptureRate] = useState<16000 | 24000 | 48000>(16000);

  // Record-to-file is opt-in: the user chooses whether to save and where.
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [recordFolder, setRecordFolder] = useState<'documents' | 'cache'>(
    'documents'
  );
  const [recordFileName, setRecordFileName] = useState(
    'deepgram-recording.wav'
  );

  const recordDir =
    recordFolder === 'cache'
      ? FileSystem.cacheDirectory
      : FileSystem.documentDirectory;
  const safeRecordName =
    recordFileName.trim().replace(/[/\\]/g, '') || 'deepgram-recording.wav';
  const recordPath = `${recordDir ?? ''}${safeRecordName}`;

  const {
    startListening,
    stopListening,
    pause,
    resume,
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
    silence: {
      gate: silenceGateEnabled,
      ...(autoStopEnabled ? { autoStopMs: 10_000 } : {}),
    },
    onSilenceChange: setIsSilent,
    onBeforeStart: () => {
      setLiveTranscript('');
      setLiveInterimTranscript('');
      setReconnectAttempt(null);
      setIsSilent(false);
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
      setIsSilent(false);
    },
    onRecordingComplete: (uri) => {
      console.log('Saved mic recording to', uri);
    },
    live: {
      model: 'nova-3',
      interimResults: true,
      punctuate: true,
      sampleRate: captureRate,
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

  // Caption helpers need the raw prerecorded response (word timings,
  // utterances, speakers), so hit /v1/listen directly — same request the
  // hook makes, but with utterances + diarize enabled.
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
        `${base}/listen?model=nova-3&smart_format=true&utterances=true&diarize=true`,
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

          <View style={styles.capabilityRow}>
            <View style={styles.capabilityChip}>
              <Text style={styles.capabilityChipText}>⏸ Pause / resume</Text>
            </View>
            <View
              style={[
                styles.capabilityChip,
                isReconnecting && styles.capabilityChipActive,
              ]}
            >
              <Text
                style={[
                  styles.capabilityChipText,
                  isReconnecting && styles.capabilityChipTextActive,
                ]}
              >
                ↻ Auto-reconnect
              </Text>
            </View>
            <View
              style={[
                styles.capabilityChip,
                isCapturing && styles.capabilityChipActive,
              ]}
            >
              <Text
                style={[
                  styles.capabilityChipText,
                  isCapturing && styles.capabilityChipTextActive,
                ]}
              >
                🎚 Live level
              </Text>
            </View>
            <View
              style={[
                styles.capabilityChip,
                recordEnabled && styles.capabilityChipActive,
              ]}
            >
              <Text
                style={[
                  styles.capabilityChipText,
                  recordEnabled && styles.capabilityChipTextActive,
                ]}
              >
                💾 Record to file
              </Text>
            </View>
            {silenceGateEnabled || autoStopEnabled ? (
              <View
                style={[
                  styles.capabilityChip,
                  isSilent && styles.capabilityChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.capabilityChipText,
                    isSilent && styles.capabilityChipTextActive,
                  ]}
                >
                  🤫 {isSilent ? 'Silent' : 'Silence watch'}
                </Text>
              </View>
            ) : null}
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
                  />
                ) : null}
                <Button
                  title="Stop"
                  variant="danger"
                  size="lg"
                  onPress={stopLive}
                />
              </View>
            ) : (
              <Button
                title="Start listening"
                variant="primary"
                size="lg"
                iconLeft="▶"
                onPress={() => startListening({ keyterm: ['Deepgram'] })}
              />
            )}
          </View>
        </View>

        {/* Silence gating & capture sample rate */}
        <Card
          title="Silence & capture"
          subtitle="Gate silent audio, auto-stop idle sessions, pick a capture rate"
        >
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              Gate silent frames (saves bandwidth)
            </Text>
            <Switch
              value={silenceGateEnabled}
              onValueChange={setSilenceGateEnabled}
              disabled={sessionActive}
              thumbColor={silenceGateEnabled ? colors.success : '#888'}
              trackColor={{
                false: colors.surfaceMuted,
                true: colors.accentMuted,
              }}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Auto-stop after 10s silence</Text>
            <Switch
              value={autoStopEnabled}
              onValueChange={setAutoStopEnabled}
              disabled={sessionActive}
              thumbColor={autoStopEnabled ? colors.success : '#888'}
              trackColor={{
                false: colors.surfaceMuted,
                true: colors.accentMuted,
              }}
            />
          </View>
          <OptionSelect
            label="Capture sample rate"
            value={String(captureRate)}
            onChange={(v) =>
              setCaptureRate(
                v === '48000' ? 48000 : v === '24000' ? 24000 : 16000
              )
            }
            options={[
              { label: '16 kHz', value: '16000' },
              { label: '24 kHz', value: '24000' },
              { label: '48 kHz', value: '48000' },
            ]}
          />
          <Text style={styles.recordHint}>
            Gating keeps the socket alive with KeepAlives while you are silent.
            Higher capture rates improve accuracy at the cost of bandwidth —
            devices that can’t capture at the requested rate fall back to 16 kHz
            automatically.
          </Text>
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
                {(
                  [
                    { key: 'srt', label: 'SRT' },
                    { key: 'vtt', label: 'WebVTT' },
                    { key: 'speakers', label: 'Speakers' },
                  ] as const
                ).map(({ key, label }) => (
                  <Button
                    key={key}
                    title={label}
                    size="sm"
                    variant={captionView === key ? 'primary' : 'secondary'}
                    onPress={() => setCaptionView(key)}
                  />
                ))}
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
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroTop: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  micWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  pulse: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary,
  },
  micCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
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
  micIcon: { fontSize: 36 },
  heroTitle: {
    ...type.h2,
    color: colors.text,
  },
  heroSubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: spacing.lg,
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
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  capabilityChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  capabilityChipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  capabilityChipText: {
    ...type.small,
    color: colors.textMuted,
    fontSize: 12,
  },
  capabilityChipTextActive: {
    color: colors.accent,
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
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.md,
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
