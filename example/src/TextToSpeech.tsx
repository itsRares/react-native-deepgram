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
import { Directory, File, Paths } from 'expo-file-system';
import {
  useDeepgramTextToSpeech,
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
import { colors, monoFont, radius, spacing, type } from './theme';

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
  'flux-haley-en',
  'flux-kit-en',
  'flux-alexis-en',
  'flux-miles-en',
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

const SAMPLE_RATE_OPTIONS: Option[] = ['8000', '16000', '24000', '48000'].map(
  (value) => ({
    label: `${value} Hz`,
    value,
  })
);

const EXPRESSIVITY_OPTIONS: Option[] = [
  { label: '-2 · calm', value: '-2' },
  { label: '-1', value: '-1' },
  { label: '0 · voice default', value: '0' },
  { label: '1', value: '1' },
  { label: '2 · animated', value: '2' },
];

const isFluxModel = (model: string) => model.trim().startsWith('flux-');

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
  const [speechEvents, setSpeechEvents] = useState<string[]>([]);
  const logSpeechEvent = (entry: string) =>
    setSpeechEvents((prev) => [entry, ...prev].slice(0, 6));

  const [bytesResult, setBytesResult] = useState<{
    size: number;
    mimeType: string;
    ms: number;
    uri: string;
  } | null>(null);
  const [isFetchingBytes, setIsFetchingBytes] = useState(false);

  const [httpModel, setHttpModel] = useState('aura-2-asteria-en');
  const [httpEncoding, setHttpEncoding] = useState('linear16');
  const [httpSampleRate, setHttpSampleRate] = useState('24000');
  const [httpContainer, setHttpContainer] = useState('none');
  const [httpBitRate, setHttpBitRate] = useState('48000');
  const [httpCallbackUrl, setHttpCallbackUrl] = useState('');
  const [httpCallbackMethod, setHttpCallbackMethod] = useState('POST');
  const [httpSpeed, setHttpSpeed] = useState('1');
  const [httpExpressivity, setHttpExpressivity] = useState('0');
  const [httpMipOptOut, setHttpMipOptOut] = useState(false);

  const [streamModel, setStreamModel] = useState('flux-haley-en');
  const [streamEncoding, setStreamEncoding] = useState('linear16');
  const [streamSampleRate, setStreamSampleRate] = useState('24000');
  const [streamSpeed, setStreamSpeed] = useState('1');
  const [streamExpressivity, setStreamExpressivity] = useState('0');
  const [streamMipOptOut, setStreamMipOptOut] = useState(false);
  const modelOptions = useModelOptions();
  const fluxHttp = isFluxModel(httpModel);
  const fluxStream = isFluxModel(streamModel);

  const httpModelValue = httpModel.trim() || undefined;
  const httpEncodingValue = httpEncoding.trim()
    ? (httpEncoding.trim().toLowerCase() as DeepgramTextToSpeechHttpEncoding)
    : undefined;
  const httpSampleRateValue = parseNumber(httpSampleRate) as
    DeepgramTextToSpeechSampleRate | undefined;
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
    DeepgramTextToSpeechSampleRate | undefined;

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
        expressivity: fluxHttp ? parseNumber(httpExpressivity) : undefined,
        mipOptOut: httpMipOptOut,
      },
    },
  });

  const {
    startStreaming,
    sendText,
    flushStream,
    clearStream,
    interrupt,
    configureStream,
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
      setSpeechEvents([]);
    },
    onSpeechStarted: ({ speech_id }) =>
      logSpeechEvent(`▶ Turn ${speech_id.slice(0, 8)} started`),
    onSpeechMetadata: (turn) =>
      logSpeechEvent(
        `✔ Turn ${turn.speech_id.slice(0, 8)} done · ${
          turn.audio_duration_ms ?? '?'
        } ms audio · ${turn.billable_character_count ?? '?'} chars billed`
      ),
    onSpeechInterrupted: (event) =>
      logSpeechEvent(
        `⏹ Interrupted after ${event.audio_played_ms} ms${
          event.text_remaining ? ` · unspoken: “${event.text_remaining}”` : ''
        }`
      ),
    onStreamMessage: (message) => {
      if (message.type === 'ConfigureSuccess') {
        logSpeechEvent('⚙ Speed change accepted');
      } else if (message.type === 'ConfigureFailure') {
        logSpeechEvent(`⚠ Configure rejected: ${String(message.description)}`);
      }
    },
    onStreamMetadata: setLastMetadata,
    onStreamFlushed: (event) =>
      setLastFlushedSequence(event.sequence_id ?? null),
    onStreamCleared: (event) => setLastClearedSequence(event.sequence_id),
    onStreamWarning: (warning) =>
      setWarnings((prev) => [warning, ...prev].slice(0, 3)),
    options: {
      stream: {
        model: streamModelValue,
        encoding: streamEncodingValue,
        sampleRate: streamSampleRateValue,
        speed: parseNumber(streamSpeed),
        expressivity: fluxStream ? parseNumber(streamExpressivity) : undefined,
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
      const stamp = Date.now();
      const ms = stamp - startedAt;

      if (Platform.OS === 'android') {
        // Let the user choose a destination folder via the Storage Access
        // Framework, then write the bytes into the file they picked.
        const directory = await Directory.pickDirectoryAsync();
        const baseMime = mimeType.split(';')[0] || 'application/octet-stream';
        const dest = directory.createFile(`deepgram-tts-${stamp}`, baseMime);
        await dest.write(data);
        setBytesResult({ size: data.byteLength, mimeType, ms, uri: dest.uri });
      } else {
        // iOS: write to a temp file, then open the share sheet so the user can
        // “Save to Files” (or send it to any app) and choose the location.
        const tmp = new File(Paths.cache, `deepgram-tts-${stamp}.${ext}`);
        await tmp.write(data);
        setBytesResult({ size: data.byteLength, mimeType, ms, uri: tmp.uri });
        await Share.share({ url: tmp.uri });
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
        {/* Main input */}
        <Card
          title="Text"
          subtitle={`HTTP · ${httpModel}   Stream · ${streamModel}`}
          right={<StatusBadge tone={tone} label={toneLabel} />}
        >
          <Field
            value={text}
            onChangeText={setText}
            placeholder="Type something to speak…"
            multiline
            numberOfLines={4}
            hint="Aura voices use /v1/speak; Flux voices use turn-based /v2/speak with barge-in."
          />
          <View style={styles.actionRow}>
            <Button
              title="Synthesize"
              variant="primary"
              onPress={handleSynthesize}
              loading={isSynthesizing}
              disabled={isSynthesizing || !text.trim()}
              iconLeft="📨"
              style={styles.flexButton}
            />
            {isStreaming ? (
              <Button
                title="Stop stream"
                variant="danger"
                onPress={stopStreaming}
                style={styles.flexButton}
              />
            ) : (
              <Button
                title="Stream"
                variant="secondary"
                onPress={handleStartStream}
                disabled={!text.trim()}
                iconLeft="🎧"
                style={styles.flexButton}
              />
            )}
            <Button
              title="Save to file"
              variant="secondary"
              onPress={handleSaveToFile}
              loading={isFetchingBytes}
              disabled={isFetchingBytes || !text.trim()}
              iconLeft="💾"
              style={styles.flexButton}
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
            subtitle={
              fluxStream
                ? 'Flux: each flush ends a turn; Interrupt cancels it'
                : 'Send more text to the open WebSocket'
            }
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
                style={styles.flexButton}
              />
              <Button
                title={fluxStream ? 'End turn' : 'Flush'}
                variant="secondary"
                onPress={() => flushStream()}
                style={styles.flexButton}
              />
              {fluxStream ? (
                <>
                  <Button
                    title="Interrupt"
                    variant="danger"
                    onPress={() => interrupt()}
                    style={styles.flexButton}
                  />
                  <Button
                    title={`Speed → ${streamSpeed || '1'}`}
                    variant="secondary"
                    onPress={() =>
                      configureStream({ speed: parseNumber(streamSpeed) ?? 1 })
                    }
                    style={styles.flexButton}
                  />
                </>
              ) : (
                <Button
                  title="Clear"
                  variant="secondary"
                  onPress={() => clearStream()}
                  style={styles.flexButton}
                />
              )}
              <Button
                title="Close gracefully"
                variant="secondary"
                onPress={() => closeStreamGracefully()}
                style={styles.flexButton}
              />
            </View>
            {fluxStream ? (
              <Text style={styles.bytesHint}>
                Change Speed in Streaming options, then tap the Speed button to
                apply it mid-stream (takes effect at the next sentence).
              </Text>
            ) : null}
          </Card>
        )}

        {/* Stream debug */}
        {(lastMetadata ||
          lastFlushedSequence != null ||
          lastClearedSequence != null ||
          warnings.length > 0 ||
          speechEvents.length > 0) && (
          <Card title="Stream events" collapsible defaultCollapsed>
            {speechEvents.length > 0 ? (
              <View style={[styles.kvBlock, { marginBottom: spacing.md }]}>
                <Text style={styles.kvTitle}>Flux turns</Text>
                {speechEvents.map((entry, i) => (
                  <Text key={`${i}-${entry}`} style={styles.eventItem}>
                    {entry}
                  </Text>
                ))}
              </View>
            ) : null}
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
            label="Speed (Aura 0.7–1.5 · Flux 0.5–1.5)"
            value={httpSpeed}
            onChangeText={setHttpSpeed}
            keyboardType="decimal-pad"
            placeholder="1"
          />
          {fluxHttp ? (
            <OptionSelect
              label="Expressivity (Flux, beta)"
              value={httpExpressivity}
              onChange={setHttpExpressivity}
              options={EXPRESSIVITY_OPTIONS}
            />
          ) : null}
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
            label="Speed (Aura 0.7–1.5 · Flux 0.5–1.5)"
            value={streamSpeed}
            onChangeText={setStreamSpeed}
            keyboardType="decimal-pad"
            placeholder="1"
          />
          {fluxStream ? (
            <OptionSelect
              label="Expressivity (Flux, beta)"
              value={streamExpressivity}
              onChange={setStreamExpressivity}
              options={EXPRESSIVITY_OPTIONS}
            />
          ) : null}
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
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flexButton: {
    flexGrow: 1,
    flexBasis: '45%',
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
  kvValue: { ...type.small, color: colors.text, fontFamily: monoFont },
  warningItem: { color: colors.warning, marginTop: 4 },
  eventItem: { ...type.small, color: colors.text, marginTop: 4 },
});
