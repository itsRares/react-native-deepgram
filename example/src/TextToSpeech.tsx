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
  const [httpStatus, setHttpStatus] = useState<'idle' | 'working' | 'error'>(
    'idle'
  );
  const [httpError, setHttpError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<
    'idle' | 'streaming' | 'error'
  >('idle');
  const [streamError, setStreamError] = useState<string | null>(null);

  const { synthesize, startStreaming, stopStreaming } = useDeepgramTextToSpeech(
    {
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
    }
  );

  const handleSynthesize = () => synthesize(text);
  const handleStream = () => startStreaming(text);

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
  outputContainer: { flex: 1, marginTop: 8 },
  note: { fontSize: 14, lineHeight: 20 },
});
