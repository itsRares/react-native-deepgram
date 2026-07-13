import { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import {
  useDeepgramTextToSpeech,
  arrayBufferToBase64,
  type DeepgramTextToSpeechStreamMetadataMessage,
  type DeepgramTextToSpeechStreamWarningMessage,
  type DeepgramTextToSpeechCallbackMethod,
  type DeepgramTextToSpeechHttpEncoding,
  type DeepgramTextToSpeechStreamEncoding,
  type DeepgramTextToSpeechSampleRate,
  type DeepgramTextToSpeechContainer,
  type DeepgramTextToSpeechBitRate,
} from 'react-native-deepgram';

import OptionSelect, { type Option } from './components/OptionSelect';
import Button from './components/Button';
import Card from './components/Card';
import Field from './components/Field';
import StatusBadge from './components/StatusBadge';
import { colors, radius, spacing, type } from './theme';

const POPULAR_TTS_MODELS = [
  'aura-2-asteria-en',
  'aura-2-athena-en',
  'aura-2-luna-en',
  'aura-2-orion-en',
  'aura-2-zeus-en',
  'aura-2-apollo-en',
  'aura-2-electra-en',
  'aura-2-celeste-es',
  'aura-2-diana-es',
  'aura-2-javier-es',
];

const HTTP_ENCODING_OPTIONS: Option[] = [
  { label: 'Linear PCM (linear16)', value: 'linear16' },
  { label: 'FLAC', value: 'flac' },
  { label: 'μ-law (mulaw)', value: 'mulaw' },
  { label: 'A-law (alaw)', value: 'alaw' },
  { label: 'MP3', value: 'mp3' },
  { label: 'Opus', value: 'opus' },
  { label: 'AAC', value: 'aac' },
];

const STREAM_ENCODING_OPTIONS: Option[] = [
  { label: 'Linear PCM (linear16)', value: 'linear16' },
  { label: 'μ-law (mulaw)', value: 'mulaw' },
  { label: 'A-law (alaw)', value: 'alaw' },
];

const SAMPLE_RATE_OPTIONS: Option[] = ['8000', '16000'].map((value) => ({
  label: `${value} Hz`,
  value,
}));

const CONTAINER_OPTIONS: Option[] = [
  { label: 'None', value: 'none' },
  { label: 'WAV', value: 'wav' },
  { label: 'OGG', value: 'ogg' },
];

const BITRATE_OPTIONS: Option[] = [
  { label: '32 kbps', value: '32000' },
  { label: '48 kbps', value: '48000' },
];

const CALLBACK_METHOD_OPTIONS: Option[] = [
  { label: 'POST', value: 'POST' },
  { label: 'PUT', value: 'PUT' },
];

const formatModelLabel = (model: string) => {
  const segments = model.split('-');
  if (segments.length < 2) return model;
  const language = segments.pop() ?? '';
  const readable = segments
    .map((segment) =>
      !segment || /^\d+$/.test(segment)
        ? segment
        : segment.charAt(0).toUpperCase() + segment.slice(1)
    )
    .join(' ');
  return `${readable} (${language.toUpperCase()})`;
};

const useModelOptions = (): Option[] =>
  useMemo(
    () =>
      POPULAR_TTS_MODELS.map((value) => ({
        label: formatModelLabel(value),
        value,
      })),
    []
  );

const parseNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const extensionForAudio = (
  mimeType: string,
  encoding?: string,
  container?: string
): string => {
  const mt = mimeType.toLowerCase();
  if (mt.includes('mpeg') || mt.includes('mp3')) return 'mp3';
  if (mt.includes('wav')) return 'wav';
  if (mt.includes('aac')) return 'aac';
  if (mt.includes('ogg') || mt.includes('opus')) return 'ogg';
  if (mt.includes('flac')) return 'flac';
  if (container === 'wav') return 'wav';
  if (container === 'ogg') return 'ogg';
  switch (encoding) {
    case 'mp3':
      return 'mp3';
    case 'aac':
      return 'aac';
    case 'opus':
      return 'ogg';
    case 'flac':
      return 'flac';
    case 'mulaw':
      return 'ulaw';
    case 'alaw':
      return 'alaw';
    case 'linear16':
      return 'pcm';
    default:
      return 'audio';
  }
};

export default function TextToSpeech() {
  const [text, setText] = useState('');
  const [streamText, setStreamText] = useState('');
  const [lastMetadata, setLastMetadata] =
    useState<DeepgramTextToSpeechStreamMetadataMessage | null>(null);
  const [lastFlushedSequence, setLastFlushedSequence] = useState<number | null>(
    null
  );
  const [lastClearedSequence, setLastClearedSequence] = useState<number | null>(
    null
  );
  const [warnings, setWarnings] = useState<
    DeepgramTextToSpeechStreamWarningMessage[]
  >([]);
  const [streamAutoFlush, setStreamAutoFlush] = useState(true);

  const [bytesResult, setBytesResult] = useState<{
    size: number;
    mimeType: string;
    ms: number;
    uri: string;
  } | null>(null);
  const [isFetchingBytes, setIsFetchingBytes] = useState(false);

  const [httpModel, setHttpModel] = useState('aura-2-asteria-en');
  const [httpEncoding, setHttpEncoding] = useState('linear16');
  const [httpSampleRate, setHttpSampleRate] = useState('16000');
  const [httpContainer, setHttpContainer] = useState('none');
  const [httpBitRate, setHttpBitRate] = useState('48000');
  const [httpCallbackUrl, setHttpCallbackUrl] = useState('');
  const [httpCallbackMethod, setHttpCallbackMethod] = useState('POST');
  const [httpSpeed, setHttpSpeed] = useState('1');
  const [httpMipOptOut, setHttpMipOptOut] = useState(false);

  const [streamModel, setStreamModel] = useState('aura-2-asteria-en');
  const [streamEncoding, setStreamEncoding] = useState('linear16');
  const [streamSampleRate, setStreamSampleRate] = useState('16000');
  const [streamSpeed, setStreamSpeed] = useState('1');
  const [streamMipOptOut, setStreamMipOptOut] = useState(false);
  const modelOptions = useModelOptions();

  const httpModelValue = httpModel.trim() || undefined;
  const httpEncodingValue = httpEncoding.trim()
    ? (httpEncoding.trim().toLowerCase() as DeepgramTextToSpeechHttpEncoding)
    : undefined;
  const httpSampleRateValue = parseNumber(httpSampleRate) as
    | DeepgramTextToSpeechSampleRate
    | undefined;
  const httpContainerValue = httpContainer.trim()
    ? (httpContainer.trim().toLowerCase() as DeepgramTextToSpeechContainer)
    : undefined;
  const httpBitRateValue =
    httpEncodingValue && httpEncodingValue !== 'linear16'
      ? (parseNumber(httpBitRate) as DeepgramTextToSpeechBitRate | undefined)
      : undefined;
  const httpCallbackValue = httpCallbackUrl.trim() || undefined;
  const httpCallbackMethodValue =
    httpCallbackValue && httpCallbackMethod.trim()
      ? (httpCallbackMethod
          .trim()
          .toUpperCase() as DeepgramTextToSpeechCallbackMethod)
      : undefined;

  const streamModelValue = streamModel.trim() || undefined;
  const streamEncodingValue = streamEncoding.trim()
    ? (streamEncoding
        .trim()
        .toLowerCase() as DeepgramTextToSpeechStreamEncoding)
    : undefined;
  const streamSampleRateValue = parseNumber(streamSampleRate) as
    | DeepgramTextToSpeechSampleRate
    | undefined;

  const {
    synthesize,
    synthesizeToBytes,
    state: httpState,
  } = useDeepgramTextToSpeech({
    trackState: true,
    options: {
      http: {
        model: httpModelValue,
        encoding: httpEncodingValue,
        sampleRate: httpSampleRateValue,
        container: httpContainerValue,
        bitRate: httpBitRateValue,
        callback: httpCallbackValue,
        callbackMethod: httpCallbackMethodValue,
        speed: parseNumber(httpSpeed),
        mipOptOut: httpMipOptOut,
      },
    },
  });

  const {
    startStreaming,
    sendText,
    flushStream,
    clearStream,
    closeStreamGracefully,
    stopStreaming,
    state: streamState,
  } = useDeepgramTextToSpeech({
    trackState: true,
    onBeforeStream: () => {
      setLastMetadata(null);
      setWarnings([]);
      setLastFlushedSequence(null);
      setLastClearedSequence(null);
    },
    onStreamMetadata: setLastMetadata,
    onStreamFlushed: (event) => setLastFlushedSequence(event.sequence_id),
    onStreamCleared: (event) => setLastClearedSequence(event.sequence_id),
    onStreamWarning: (warning) =>
      setWarnings((prev) => [warning, ...prev].slice(0, 3)),
    options: {
      stream: {
        model: streamModelValue,
        encoding: streamEncodingValue,
        sampleRate: streamSampleRateValue,
        speed: parseNumber(streamSpeed),
        mipOptOut: streamMipOptOut,
        autoFlush: streamAutoFlush,
      },
    },
  });

  const isSynthesizing = httpState?.status === 'loading';
  const isStreaming = streamState?.status === 'connected';

  const tone = streamState?.error ? 'error' : isStreaming ? 'live' : 'idle';
  const toneLabel = streamState?.error
    ? 'Error'
    : isStreaming
      ? 'Streaming'
      : 'Idle';

  const handleSynthesize = async () => {
    try {
      await synthesize(text);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.warn('Synthesize failed', err);
      }
    }
  };

  const handleSaveToFile = async () => {
    setIsFetchingBytes(true);
    try {
      const startedAt = Date.now();
      // The in-app HTTP player only decodes linear16 PCM, so this screen
      // defaults to raw PCM. Raw PCM isn't a self-contained file, so exports
      // upgrade it to MP3; a real container/codec is saved as-is.
      const isRawPcm =
        (!httpEncodingValue ||
          httpEncodingValue === 'linear16' ||
          httpEncodingValue === 'mulaw' ||
          httpEncodingValue === 'alaw') &&
        httpContainerValue !== 'wav';
      // synthesizeToBytes returns audio without playing it — right call for
      // saving/caching (identical prompts hit the in-memory LRU). mp3 takes
      // only encoding + bit_rate.
      const { data, mimeType } = await synthesizeToBytes(
        text,
        isRawPcm
          ? {
              encoding: 'mp3',
              bitRate: 48000,
              container: undefined,
              sampleRate: undefined,
            }
          : undefined
      );
      const ext = extensionForAudio(
        mimeType,
        httpEncodingValue,
        httpContainerValue
      );
      const base64 = arrayBufferToBase64(data);
      const stamp = Date.now();
      const ms = stamp - startedAt;

      if (Platform.OS === 'android') {
        // Let the user choose a destination folder via the Storage Access
        // Framework, then write the bytes into the file they picked.
        const perm =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) return;
        const baseMime = mimeType.split(';')[0] || 'application/octet-stream';
        const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          `deepgram-tts-${stamp}`,
          baseMime
        );
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setBytesResult({ size: data.byteLength, mimeType, ms, uri: destUri });
      } else {
        // iOS: write to a temp file, then open the share sheet so the user can
        // “Save to Files” (or send it to any app) and choose the location.
        const tmpUri = `${FileSystem.cacheDirectory}deepgram-tts-${stamp}.${ext}`;
        await FileSystem.writeAsStringAsync(tmpUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setBytesResult({ size: data.byteLength, mimeType, ms, uri: tmpUri });
        await Share.share({ url: tmpUri });
      }
    } catch (err) {
      console.warn('Save to file failed', err);
    } finally {
      setIsFetchingBytes(false);
    }
  };

  const handleStartStream = async () => {
    try {
      await startStreaming(text);
    } catch (err) {
      console.warn('Start stream failed', err);
    }
  };

  const handleSendText = () => {
    if (sendText(streamText, { flush: streamAutoFlush })) {
      setStreamText('');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <StatusBadge tone={tone} label={toneLabel} />
          </View>
          <Text style={styles.heroIcon}>🔊</Text>
          <Text style={styles.heroTitle}>Text-to-Speech</Text>
          <Text style={styles.heroSubtitle}>
            Synthesize via REST or stream tokens over a WebSocket. Audio plays
            through the device speaker automatically.
          </Text>
        </View>

        {/* Main input */}
        <Card title="Text" subtitle="What should the agent say?">
          <Field
            value={text}
            onChangeText={setText}
            placeholder="Type something to speak…"
            multiline
            numberOfLines={4}
          />
          <View style={styles.actionRow}>
            <Button
              title="Synthesize (HTTP)"
              variant="primary"
              onPress={handleSynthesize}
              loading={isSynthesizing}
              disabled={isSynthesizing || !text.trim()}
              iconLeft="📨"
            />
            {isStreaming ? (
              <Button
                title="Stop stream"
                variant="danger"
                onPress={stopStreaming}
              />
            ) : (
              <Button
                title="Start stream"
                variant="secondary"
                onPress={handleStartStream}
                disabled={!text.trim()}
                iconLeft="🎧"
              />
            )}
            <Button
              title="Save to file"
              variant="ghost"
              onPress={handleSaveToFile}
              loading={isFetchingBytes}
              disabled={isFetchingBytes || !text.trim()}
              iconLeft="💾"
            />
          </View>
          {bytesResult ? (
            <View style={styles.bytesBanner}>
              <Text style={styles.bytesTitle}>
                💾 {bytesResult.size.toLocaleString()} bytes ·{' '}
                {bytesResult.mimeType}
              </Text>
              <Text style={styles.bytesPath} selectable numberOfLines={2}>
                {bytesResult.uri}
              </Text>
              <Text style={styles.bytesHint}>
                Synthesized in {bytesResult.ms} ms via synthesizeToBytes (no
                playback).{' '}
                {bytesResult.mimeType.includes('mpeg')
                  ? 'Exported as MP3 so it plays anywhere. '
                  : ''}
                {Platform.OS === 'ios'
                  ? 'Pick “Save to Files” in the share sheet to choose where it lands.'
                  : 'Saved to the folder you selected.'}
              </Text>
            </View>
          ) : null}
          {httpState?.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠ {httpState.error.message}</Text>
            </View>
          ) : null}
          {streamState?.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>
                ⚠ Stream: {streamState.error.message}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Continuous stream */}
        {isStreaming && (
          <Card
            title="Continuous streaming"
            subtitle="Send more text to the open WebSocket"
          >
            <Field
              value={streamText}
              onChangeText={setStreamText}
              placeholder="Add more text…"
              multiline
              numberOfLines={3}
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Flush automatically</Text>
              <Switch
                value={streamAutoFlush}
                onValueChange={setStreamAutoFlush}
                thumbColor={streamAutoFlush ? colors.primary : '#888'}
                trackColor={{
                  false: colors.surfaceMuted,
                  true: colors.primaryMuted,
                }}
              />
            </View>
            <View style={styles.actionRow}>
              <Button
                title={streamAutoFlush ? 'Send' : 'Queue (no flush)'}
                variant="primary"
                onPress={handleSendText}
                disabled={!streamText.trim()}
              />
              <Button
                title="Flush"
                variant="secondary"
                onPress={() => flushStream()}
              />
              <Button
                title="Clear"
                variant="ghost"
                onPress={() => clearStream()}
              />
              <Button
                title="Close gracefully"
                variant="ghost"
                onPress={() => closeStreamGracefully()}
              />
            </View>
          </Card>
        )}

        {/* Stream debug */}
        {(lastMetadata ||
          lastFlushedSequence != null ||
          lastClearedSequence != null ||
          warnings.length > 0) && (
          <Card title="Stream events" collapsible defaultCollapsed>
            {lastMetadata ? (
              <View style={styles.kvBlock}>
                <Text style={styles.kvTitle}>Last metadata</Text>
                <KV label="Request" value={lastMetadata.request_id} />
                <KV label="Model" value={lastMetadata.model_name} />
                <KV label="Version" value={lastMetadata.model_version} />
              </View>
            ) : null}
            {lastFlushedSequence != null && (
              <KV
                label="Last flushed sequence"
                value={String(lastFlushedSequence)}
              />
            )}
            {lastClearedSequence != null && (
              <KV
                label="Last cleared sequence"
                value={String(lastClearedSequence)}
              />
            )}
            {warnings.length > 0 && (
              <View style={[styles.kvBlock, { marginTop: spacing.md }]}>
                <Text style={[styles.kvTitle, { color: colors.warning }]}>
                  Warnings
                </Text>
                {warnings.map((w, i) => (
                  <Text key={`${w.code}-${i}`} style={styles.warningItem}>
                    {w.code}: {w.description}
                  </Text>
                ))}
              </View>
            )}
          </Card>
        )}

        {/* HTTP options */}
        <Card
          title="HTTP options"
          subtitle="Single REST request configuration"
          collapsible
          defaultCollapsed
        >
          <OptionSelect
            label="Model"
            value={httpModel}
            onChange={setHttpModel}
            options={modelOptions}
            allowCustom
            customPlaceholder="Enter a Deepgram model id"
          />
          <OptionSelect
            label="Encoding"
            value={httpEncoding}
            onChange={setHttpEncoding}
            options={HTTP_ENCODING_OPTIONS}
            allowCustom
          />
          <OptionSelect
            label="Sample rate"
            value={httpSampleRate}
            onChange={setHttpSampleRate}
            options={SAMPLE_RATE_OPTIONS}
            allowCustom
            customKeyboardType="numeric"
          />
          <OptionSelect
            label="Container"
            value={httpContainer}
            onChange={setHttpContainer}
            options={CONTAINER_OPTIONS}
            allowCustom
          />
          <OptionSelect
            label="Bit rate"
            value={httpBitRate}
            onChange={setHttpBitRate}
            options={BITRATE_OPTIONS}
            allowCustom
            customKeyboardType="numeric"
          />
          <Field
            label="Callback URL"
            value={httpCallbackUrl}
            onChangeText={setHttpCallbackUrl}
            placeholder="Optional webhook URL"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <OptionSelect
            label="Callback method"
            value={httpCallbackMethod}
            onChange={setHttpCallbackMethod}
            options={CALLBACK_METHOD_OPTIONS}
            allowCustom
          />
          <Field
            label="Speed (0.7–1.5)"
            value={httpSpeed}
            onChangeText={setHttpSpeed}
            keyboardType="decimal-pad"
            placeholder="1"
          />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Opt out of MIP</Text>
            <Switch
              value={httpMipOptOut}
              onValueChange={setHttpMipOptOut}
              thumbColor={httpMipOptOut ? colors.primary : '#888'}
              trackColor={{
                false: colors.surfaceMuted,
                true: colors.primaryMuted,
              }}
            />
          </View>
        </Card>

        {/* Streaming options */}
        <Card
          title="Streaming options"
          subtitle="WebSocket configuration"
          collapsible
          defaultCollapsed
        >
          <OptionSelect
            label="Model"
            value={streamModel}
            onChange={setStreamModel}
            options={modelOptions}
            allowCustom
          />
          <OptionSelect
            label="Encoding"
            value={streamEncoding}
            onChange={setStreamEncoding}
            options={STREAM_ENCODING_OPTIONS}
            allowCustom
          />
          <OptionSelect
            label="Sample rate"
            value={streamSampleRate}
            onChange={setStreamSampleRate}
            options={SAMPLE_RATE_OPTIONS}
            allowCustom
            customKeyboardType="numeric"
          />
          <Field
            label="Speed (0.7–1.5)"
            value={streamSpeed}
            onChangeText={setStreamSpeed}
            keyboardType="decimal-pad"
            placeholder="1"
          />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Opt out of MIP</Text>
            <Switch
              value={streamMipOptOut}
              onValueChange={setStreamMipOptOut}
              thumbColor={streamMipOptOut ? colors.primary : '#888'}
              trackColor={{
                false: colors.surfaceMuted,
                true: colors.primaryMuted,
              }}
            />
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
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
    justifyContent: 'flex-start',
    marginBottom: spacing.md,
  },
  heroIcon: { fontSize: 40, marginBottom: spacing.sm },
  heroTitle: { ...type.h2, color: colors.text },
  heroSubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
  errorBanner: {
    backgroundColor: '#3a1418',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: { color: colors.danger, ...type.smallMedium },
  bytesBanner: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bytesTitle: { color: colors.text, ...type.smallMedium },
  bytesPath: {
    ...type.small,
    color: colors.accent,
    marginTop: 4,
  },
  bytesHint: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 4,
  },
  kvBlock: {},
  kvTitle: {
    ...type.smallMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  kvLabel: { ...type.small, color: colors.textMuted },
  kvValue: { ...type.small, color: colors.text, fontFamily: 'Menlo' },
  warningItem: { color: colors.warning, marginTop: 4 },
});
