import { useState } from 'react';
import {
  View,
  TextInput,
  Button,
  ScrollView,
  Text,
  StyleSheet,
} from 'react-native';
import { useDeepgramTextIntelligence } from 'react-native-deepgram';

export default function TextIntelligence() {
  const [input, setInput] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const { analyze } = useDeepgramTextIntelligence({
    options: {
      summarize: true,
      topics: true,
      intents: true,
      sentiment: true,
      language: 'en',
    },
    onBeforeAnalyze: () => {
      setLoading(true);
      setError(null);
      setResult(null);
    },
    onAnalyzeSuccess: (res) => {
      setLoading(false);
      setResult(res);
    },
    onAnalyzeError: (err) => {
      setLoading(false);
      setError(err.message);
    },
  });

  const handleAnalyze = () => {
    analyze({ text: input });
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        multiline
        placeholder="Paste text to analyze..."
        value={input}
        onChangeText={setInput}
      />

      <Button title="Analyze Text" onPress={handleAnalyze} />

      {loading && <Text style={styles.status}>Analyzing...</Text>}
      {error && <Text style={styles.error}>Error: {error}</Text>}

      {result && (
        <ScrollView style={styles.outputContainer}>
          <Text style={styles.output}>{JSON.stringify(result, null, 2)}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  input: {
    height: 150,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  status: { marginTop: 12, fontStyle: 'italic' },
  error: { marginTop: 12, color: 'red' },
  outputContainer: { marginTop: 16, flex: 1 },
  output: { fontFamily: 'monospace', fontSize: 12 },
});
