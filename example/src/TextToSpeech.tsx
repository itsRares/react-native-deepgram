import { useMemo, useState } from 'react';
import {
  View,
  Button,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Switch,
} from 'react-native';
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

const SAMPLE_RATE_OPTIONS: Option[] = [
  '8000',
  '16000',
  '22050',
  '24000',
  '32000',
  '44100',
  '48000',
].map((value) => ({ label: `${value} Hz`, value }));

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
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return segment;
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
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

export default function TextToSpeech() {
  const [text, setText] = useState('');
  const [streamText, setStreamText] = useState('');
  const [httpStatus, setHttpStatus] = useState<'idle' | 'working' | 'error'>(
    'idle'
  );
  const [httpError, setHttpError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<
    'idle' | 'streaming' | 'error'
  >('idle');
  const [streamError, setStreamError] = useState<string | null>(null);
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

  const [httpModel, setHttpModel] = useState('aura-2-asteria-en');
  const [httpEncoding, setHttpEncoding] = useState('linear16');
  const [httpSampleRate, setHttpSampleRate] = useState('24000');
  const [httpContainer, setHttpContainer] = useState('none');
  const [httpBitRate, setHttpBitRate] = useState('48000');
  const [httpCallbackUrl, setHttpCallbackUrl] = useState('');
  const [httpCallbackMethod, setHttpCallbackMethod] = useState('POST');
  const [httpMipOptOut, setHttpMipOptOut] = useState(false);

  const [streamModel, setStreamModel] = useState('aura-2-asteria-en');
  const [streamEncoding, setStreamEncoding] = useState('linear16');
  const [streamSampleRate, setStreamSampleRate] = useState('24000');
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
      : undefined; // Deepgram rejects bitRate when encoding=linear16
  const httpCallbackValue = httpCallbackUrl.trim() || undefined;
  const httpCallbackMethodValue =
    httpCallbackValue && httpCallbackMethod.trim()
      ? (httpCallbackMethod
          .trim()
          .toUpperCase() as DeepgramTextToSpeechCallbackMethod)
      : undefined; // Deepgram requires callbackMethod only if callback is set

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
    startStreaming,
    sendText,
    flushStream,
    clearStream,
    closeStreamGracefully,
    stopStreaming,
  } = useDeepgramTextToSpeech({
    onBeforeSynthesize: () => {
      setHttpStatus('working');
      setHttpError(null);
    },
    onSynthesizeSuccess: () => {
      setHttpStatus('idle');
    },
    onSynthesizeError: (err) => {
      setHttpStatus('error');
      setHttpError(err instanceof Error ? err.message : String(err));
    },
    onBeforeStream: () => {
      setStreamStatus('streaming');
      setStreamError(null);
      setLastMetadata(null);
      setWarnings([]);
      setLastFlushedSequence(null);
      setLastClearedSequence(null);
    },
    onStreamError: (err) => {
      setStreamStatus('error');
      setStreamError(err instanceof Error ? err.message : String(err));
    },
    onStreamEnd: () => {
      setStreamStatus('idle');
    },
    onStreamMetadata: setLastMetadata,
    onStreamFlushed: (event) => setLastFlushedSequence(event.sequence_id),
    onStreamCleared: (event) => setLastClearedSequence(event.sequence_id),
    onStreamWarning: (warning) =>
      setWarnings((prev) => [warning, ...prev].slice(0, 3)),
    options: {
      http: {
        model: httpModelValue,
        encoding: httpEncodingValue,
        sampleRate: httpSampleRateValue,
        container: httpContainerValue,
        bitRate: httpBitRateValue,
        callback: httpCallbackValue,
        callbackMethod: httpCallbackMethodValue,
        mipOptOut: httpMipOptOut,
      },
      stream: {
        model: streamModelValue,
        encoding: streamEncodingValue,
        sampleRate: streamSampleRateValue,
        mipOptOut: streamMipOptOut,
        autoFlush: streamAutoFlush,
      },
    },
  });

  const handleSynthesize = async () => {
    try {
      await synthesize(text);
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') {
        console.warn('Synthesize failed', err);
      }
    }
  };
  const handleStream = async () => {
    try {
      await startStreaming(text);
    } catch (err) {
      console.warn('Start stream failed', err);
    }
  };
  const handleSendText = () => {
    if (sendText(streamText, { flush: streamAutoFlush })) {
      setStreamText(''); // Clear the input after sending
    }
  };
  const handleFlush = () => flushStream();
  const handleClear = () => clearStream();
  const handleCloseGracefully = () => closeStreamGracefully();

  return (
    <ScrollView>
      <View style={styles.container}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Enter text to speak"
          style={styles.input}
          multiline
        />

        <View style={styles.optionsSection}>
          <Text style={styles.sectionTitle}>HTTP options</Text>
          <Text style={styles.optionHint}>
            Configure parameters for single text-to-speech requests.
          </Text>
          <OptionSelect
            label="Model"
            value={httpModel}
            onChange={setHttpModel}
            options={modelOptions}
            placeholder="Select a voice model"
            allowCustom
            customPlaceholder="Enter a Deepgram model id"
          />
          <OptionSelect
            label="Encoding"
            value={httpEncoding}
            onChange={setHttpEncoding}
            options={HTTP_ENCODING_OPTIONS}
            placeholder="Select encoding"
            allowCustom
            customPlaceholder="Enter an encoding"
          />
          <OptionSelect
            label="Sample rate"
            value={httpSampleRate}
            onChange={setHttpSampleRate}
            options={SAMPLE_RATE_OPTIONS}
            placeholder="Select sample rate"
            allowCustom
            customPlaceholder="Enter sample rate (Hz)"
            customKeyboardType="numeric"
          />
          <OptionSelect
            label="Container"
            value={httpContainer}
            onChange={setHttpContainer}
            options={CONTAINER_OPTIONS}
            placeholder="Select container"
            allowCustom
            customPlaceholder="Enter container format"
          />
          <OptionSelect
            label="Bit rate"
            value={httpBitRate}
            onChange={setHttpBitRate}
            options={BITRATE_OPTIONS}
            placeholder="Select bit rate"
            allowCustom
            customPlaceholder="Enter bit rate (bps)"
            customKeyboardType="numeric"
          />
          <Text style={styles.fieldLabel}>Callback URL</Text>
          <TextInput
            value={httpCallbackUrl}
            onChangeText={setHttpCallbackUrl}
            placeholder="Optional webhook URL"
            style={styles.optionInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <OptionSelect
            label="Callback method"
            value={httpCallbackMethod}
            onChange={setHttpCallbackMethod}
            options={CALLBACK_METHOD_OPTIONS}
            placeholder="Select HTTP method"
            allowCustom
            customPlaceholder="Enter HTTP method"
          />
          <View style={styles.toggleRow}>
            <Text style={styles.switchLabel}>Opt out of the MIP</Text>
            <Switch value={httpMipOptOut} onValueChange={setHttpMipOptOut} />
          </View>
        </View>

        <View style={[styles.optionsSection, styles.optionsSectionSpacing]}>
          <Text style={styles.sectionTitle}>Streaming options</Text>
          <Text style={styles.optionHint}>
            These apply to the WebSocket streaming connection.
          </Text>
          <OptionSelect
            label="Model"
            value={streamModel}
            onChange={setStreamModel}
            options={modelOptions}
            placeholder="Select a voice model"
            allowCustom
            customPlaceholder="Enter a Deepgram model id"
          />
          <OptionSelect
            label="Encoding"
            value={streamEncoding}
            onChange={setStreamEncoding}
            options={STREAM_ENCODING_OPTIONS}
            placeholder="Select encoding"
            allowCustom
            customPlaceholder="Enter an encoding"
          />
          <OptionSelect
            label="Sample rate"
            value={streamSampleRate}
            onChange={setStreamSampleRate}
            options={SAMPLE_RATE_OPTIONS}
            placeholder="Select sample rate"
            allowCustom
            customPlaceholder="Enter sample rate (Hz)"
            customKeyboardType="numeric"
          />
          <View style={styles.toggleRow}>
            <Text style={styles.switchLabel}>Opt out of the MIP</Text>
            <Switch
              value={streamMipOptOut}
              onValueChange={setStreamMipOptOut}
            />
          </View>
        </View>

        {/* HTTP synthesis */}
        <View style={styles.buttonRow}>
          <Button
            title="Synthesize (HTTP)"
            onPress={handleSynthesize}
            disabled={httpStatus === 'working' || !text.trim()}
          />
        </View>
        {httpStatus === 'working' && (
          <Text style={styles.status}>Synthesizing…</Text>
        )}
        {httpError && <Text style={styles.error}>Error: {httpError}</Text>}

        {/* streaming */}
        <View style={[styles.buttonRow, styles.streamingSection]}>
          <Button
            title="Start Stream"
            onPress={handleStream}
            disabled={streamStatus === 'streaming' || !text.trim()}
          />
          <Button
            title="Stop Stream"
            onPress={stopStreaming}
            disabled={streamStatus !== 'streaming'}
          />
        </View>
        {streamStatus === 'streaming' && (
          <Text style={styles.status}>Streaming…</Text>
        )}
        {streamError && (
          <Text style={styles.error}>Stream error: {streamError}</Text>
        )}

        {/* Continuous streaming - send additional text to active stream */}
        {streamStatus === 'streaming' && (
          <View style={[styles.continuousSection, styles.continuousMargin]}>
            <Text style={styles.sectionTitle}>Continuous Streaming</Text>
            <TextInput
              value={streamText}
              onChangeText={setStreamText}
              placeholder="Send more text to the active stream..."
              style={styles.streamInput}
              multiline
            />
            <View style={styles.toggleRow}>
              <Text style={styles.switchLabel}>Flush automatically</Text>
              <Switch
                value={streamAutoFlush}
                onValueChange={setStreamAutoFlush}
              />
            </View>
            <View style={styles.buttonRow}>
              <Button
                title={streamAutoFlush ? 'Send Text' : 'Queue Text (no flush)'}
                onPress={handleSendText}
                disabled={!streamText.trim()}
              />
              <Button title="Flush" onPress={handleFlush} />
            </View>
            <View style={styles.buttonRow}>
              <Button title="Clear Buffer" onPress={handleClear} />
              <Button
                title="Close Gracefully"
                onPress={handleCloseGracefully}
              />
            </View>
          </View>
        )}

        <ScrollView style={styles.outputContainer}>
          <Text style={styles.note}>
            Audio is played automatically by the built-in native player; there’s
            no transcript to display.
          </Text>
          {lastMetadata && (
            <View style={styles.debugPanel}>
              <Text style={styles.debugTitle}>Last metadata</Text>
              <Text style={styles.debugText}>
                Request: {lastMetadata.request_id}
              </Text>
              <Text style={styles.debugText}>
                Model: {lastMetadata.model_name}
              </Text>
              <Text style={styles.debugText}>
                Version: {lastMetadata.model_version}
              </Text>
            </View>
          )}
          {(lastFlushedSequence != null || lastClearedSequence != null) && (
            <View style={styles.debugPanel}>
              <Text style={styles.debugTitle}>Stream events</Text>
              {lastFlushedSequence != null && (
                <Text style={styles.debugText}>
                  Last flushed sequence: {lastFlushedSequence}
                </Text>
              )}
              {lastClearedSequence != null && (
                <Text style={styles.debugText}>
                  Last cleared sequence: {lastClearedSequence}
                </Text>
              )}
            </View>
          )}
          {warnings.length > 0 && (
            <View style={[styles.debugPanel, styles.warningPanel]}>
              <Text style={[styles.debugTitle, styles.warningTitle]}>
                Warnings
              </Text>
              {warnings.map((warning, index) => (
                <Text
                  key={`${warning.code}-${index}`}
                  style={styles.warningText}
                >
                  {warning.code}: {warning.description}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  input: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  status: { marginVertical: 8, fontStyle: 'italic' },
  error: { marginVertical: 8, color: 'red' },
  optionsSection: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  optionsSectionSpacing: {
    marginTop: 8,
  },
  optionHint: {
    fontSize: 13,
    color: '#555',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 4,
  },
  optionInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  continuousSection: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  streamInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    textAlignVertical: 'top',
    backgroundColor: '#f9f9f9',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  switchLabel: {
    fontSize: 14,
    color: '#333',
  },
  streamingSection: {
    marginTop: 24,
  },
  continuousMargin: {
    marginTop: 24,
  },
  outputContainer: { flex: 1, marginTop: 8 },
  note: { fontSize: 14, lineHeight: 20 },
  debugPanel: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  debugTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  debugText: {
    fontSize: 13,
    color: '#444',
    marginBottom: 2,
  },
  warningPanel: {
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  warningTitle: {
    color: '#c62828',
  },
  warningText: {
    fontSize: 13,
    color: '#c62828',
    marginBottom: 2,
  },
});
