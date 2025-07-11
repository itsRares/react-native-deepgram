import { useState } from 'react';
import { View, Button, Text, ScrollView, StyleSheet } from 'react-native';
import { UseDeepgramSpeechToText } from 'react-native-deepgram';

export default function SpeechToText() {
  const [transcript, setTranscript] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'listening' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const { startListening, stopListening } = UseDeepgramSpeechToText({
    onBeforeStart: () => {
      setStatus('listening');
      setTranscript('');
      setError(null);
    },
    onStart: () => {
      // WebSocket opened
    },
    onTranscript: (text) => {
      setTranscript((prev) => prev + ' ' + text);
    },
    onError: (err) => {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    },
    onEnd: () => {
      setStatus('idle');
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.buttonRow}>
        <Button
          title="Start Listening"
          onPress={startListening}
          disabled={status === 'listening'}
        />
        <Button
          title="Stop Listening"
          onPress={stopListening}
          disabled={status !== 'listening'}
        />
      </View>

      {status === 'listening' && (
        <Text style={styles.status}>Listening...</Text>
      )}
      {error && <Text style={styles.error}>Error: {error}</Text>}

      <ScrollView style={styles.outputContainer}>
        <Text style={styles.transcript}>
          {transcript || 'No transcript yet.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  status: {
    marginVertical: 8,
    fontStyle: 'italic',
  },
  error: {
    marginVertical: 8,
    color: 'red',
  },
  outputContainer: {
    flex: 1,
    marginTop: 8,
  },
  transcript: {
    fontSize: 14,
    lineHeight: 20,
  },
});
