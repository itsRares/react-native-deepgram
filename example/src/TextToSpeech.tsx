import { useState } from 'react';
import {
  View,
  Button,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useDeepgramTextToSpeech } from 'react-native-deepgram';

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

  const { synthesize, startStreaming, sendText, stopStreaming } =
    useDeepgramTextToSpeech({
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
      },
      onStreamError: (err) => {
        setStreamStatus('error');
        setStreamError(err instanceof Error ? err.message : String(err));
      },
      onStreamEnd: () => {
        setStreamStatus('idle');
      },
    });

  const handleSynthesize = () => synthesize(text);
  const handleStream = () => startStreaming(text);
  const handleSendText = () => {
    if (sendText(streamText)) {
      setStreamText(''); // Clear the input after sending
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Enter text to speak"
        style={styles.input}
        multiline
      />

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
      <View style={[styles.buttonRow, { marginTop: 24 }]}>
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
        <View style={[styles.continuousSection, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>Continuous Streaming</Text>
          <TextInput
            value={streamText}
            onChangeText={setStreamText}
            placeholder="Send more text to the active stream..."
            style={styles.streamInput}
            multiline
          />
          <View style={styles.buttonRow}>
            <Button
              title="Send Text"
              onPress={handleSendText}
              disabled={!streamText.trim()}
            />
          </View>
        </View>
      )}

      <ScrollView style={styles.outputContainer}>
        <Text style={styles.note}>
          Audio is played automatically by the built-in native player; there’s
          no transcript to display.
        </Text>
      </ScrollView>
    </View>
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
  outputContainer: { flex: 1, marginTop: 8 },
  note: { fontSize: 14, lineHeight: 20 },
});
