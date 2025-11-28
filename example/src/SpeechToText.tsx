import { useState } from 'react';
import {
  View,
  Button,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useDeepgramSpeechToText } from 'react-native-deepgram';

export default function SpeechToText() {
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');
  const [fileTranscript, setFileTranscript] = useState('');

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
        setLiveTranscript((prev) => {
          const next = prev ? `${prev} ${text}` : text;
          return next.trim();
        });
        setLiveInterimTranscript('');
      } else {
        setLiveInterimTranscript(text);
      }
    },
    onEnd: () => setLiveInterimTranscript(''),
    live: {
      model: 'nova-2',
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
    },
  });

  const pickAndTranscribe = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (result.assets && result.assets.length > 0) {
        await transcribeFile(
          {
            uri: result.assets[0].uri,
            name: result.assets[0].name || 'audio-file',
            type: result.assets[0].mimeType || 'audio/mpeg',
          },
          {
            topics: true,
            intents: true,
          }
        );
      }
    } catch (err) {
      Alert.alert('File picker error', String(err));
    }
  };

  const combinedLiveTranscript = [liveTranscript, liveInterimTranscript]
    .filter(Boolean)
    .join(' ');

  return (
    <View style={styles.container}>
      {/* Live mic controls */}
      <View style={styles.buttonRow}>
        <Button
          title="Start Listening"
          onPress={() => startListening({ keywords: ['Deepgram'] })}
          disabled={liveState?.status === 'listening'}
        />
        <Button
          title="Stop Listening"
          onPress={stopListening}
          disabled={liveState?.status !== 'listening'}
        />
      </View>
      {liveState?.status === 'listening' && (
        <Text style={styles.status}>Listening…</Text>
      )}
      {liveState?.error && (
        <Text style={styles.error}>Error: {liveState.error.message}</Text>
      )}
      <ScrollView style={styles.outputContainer}>
        <Text style={styles.transcript}>
          🎤 Live: {combinedLiveTranscript || 'No live transcript yet.'}
        </Text>
      </ScrollView>

      {/* File transcription controls */}
      <View style={[styles.buttonRow, styles.streamingSection]}>
        <Button
          title="Pick & Transcribe File"
          onPress={pickAndTranscribe}
          disabled={fileState?.status === 'transcribing'}
        />
      </View>
      {fileState?.status === 'transcribing' && (
        <Text style={styles.status}>Transcribing file…</Text>
      )}
      {fileState?.error && (
        <Text style={styles.error}>File error: {fileState.error.message}</Text>
      )}
      <ScrollView style={styles.outputContainer}>
        <Text style={styles.transcript}>
          📄 File: {fileTranscript || 'No file transcript yet.'}
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
  streamingSection: {
    marginTop: 24,
  },
});
