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

  const { analyze, state } = useDeepgramTextIntelligence({
    trackState: true,
    options: {
      summarize: true,
      topics: true,
      customTopic: ['Spacewalk', 'Podcast'],
      customTopicMode: 'extended',
      intents: true,
      customIntent: ['Encourage podcasting'],
      customIntentMode: 'extended',
      sentiment: true,
      language: 'en-US',
    },
    onBeforeAnalyze: () => setResult(null),
    onAnalyzeSuccess: setResult,
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

      {state?.status === 'analyzing' && (
        <Text style={styles.status}>Analyzing...</Text>
      )}
      {state?.error && (
        <Text style={styles.error}>Error: {state.error.message}</Text>
      )}

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
