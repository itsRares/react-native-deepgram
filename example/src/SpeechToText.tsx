import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useDeepgramSpeechToText } from 'react-native-deepgram';
import Button from './components/Button';
import Card from './components/Card';
import StatusBadge from './components/StatusBadge';
import { colors, radius, spacing, type } from './theme';

export default function SpeechToText() {
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');
  const [fileTranscript, setFileTranscript] = useState('');
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null);

  const {
    startListening,
    stopListening,
    pause,
    resume,
    state: liveState,
    isPaused,
  } = useDeepgramSpeechToText({
    trackState: true,
    reconnect: { enabled: true },
    onBeforeStart: () => {
      setLiveTranscript('');
      setLiveInterimTranscript('');
      setReconnectAttempt(null);
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

        {isReconnecting ? (
          <View style={styles.reconnectBanner}>
            <Text style={styles.reconnectText}>
              ↻ Reconnecting… (attempt {reconnectAttempt})
            </Text>
          </View>
        ) : null}

        {liveState?.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠ {liveState.error.message}</Text>
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
});
