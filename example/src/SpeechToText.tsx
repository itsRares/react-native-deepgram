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

  const {
    startListening,
    stopListening,
    state: liveState,
  } = useDeepgramSpeechToText({
    trackState: true,
    onBeforeStart: () => {
      setLiveTranscript('');
      setLiveInterimTranscript('');
    },
    onTranscript: (text, info) => {
      if (info?.isFinal) {
        setLiveTranscript((prev) => (prev ? `${prev} ${text}` : text).trim());
        setLiveInterimTranscript('');
      } else {
        setLiveInterimTranscript(text);
      }
    },
    onEnd: () => setLiveInterimTranscript(''),
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

  const isListening = liveState?.status === 'listening';
  const isTranscribing = fileState?.status === 'transcribing';

  // Mic pulse
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isListening) {
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
  }, [isListening, pulse]);

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

  const tone = liveState?.error ? 'error' : isListening ? 'live' : 'idle';
  const toneLabel = liveState?.error
    ? 'Error'
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
            {isListening && (
              <Animated.View
                style={[
                  styles.pulse,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
            )}
            <View
              style={[styles.micCircle, isListening && styles.micCircleActive]}
            >
              <Text style={styles.micIcon}>🎤</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>
            {isListening ? 'Listening…' : 'Live transcription'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {isListening
              ? 'Tap stop when you are done.'
              : 'Tap start and speak to see live transcripts.'}
          </Text>

          <View style={styles.heroActions}>
            {isListening ? (
              <Button
                title="Stop"
                variant="danger"
                size="lg"
                onPress={stopListening}
              />
            ) : (
              <Button
                title="Start listening"
                variant="primary"
                size="lg"
                iconLeft="▶"
                onPress={() => startListening({ keywords: ['Deepgram'] })}
              />
            )}
          </View>
        </View>

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
