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
  // live stream state
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'listening' | 'error'>(
    'idle'
  );
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');

  // file transcription state
  const [fileTranscript, setFileTranscript] = useState('');
  const [fileStatus, setFileStatus] = useState<
    'idle' | 'transcribing' | 'error'
  >('idle');
  const [fileError, setFileError] = useState<string | null>(null);

  const { startListening, stopListening, transcribeFile } =
    useDeepgramSpeechToText({
      onBeforeStart: () => {
        setLiveStatus('listening');
        setLiveTranscript('');
        setLiveInterimTranscript('');
        setLiveError(null);
      },
      onStart: () => {
        // WebSocket opened
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
      onError: (err) => {
        setLiveStatus('error');
        setLiveError(err instanceof Error ? err.message : String(err));
        setLiveInterimTranscript('');
      },
      onEnd: () => {
        setLiveStatus('idle');
        setLiveInterimTranscript('');
      },
      // file callbacks
      onBeforeTranscribe: () => {
        setFileStatus('transcribing');
        setFileTranscript('');
        setFileError(null);
      },
      onTranscribeSuccess: (text) => {
        setFileStatus('idle');
        setFileTranscript(text);
      },
      onTranscribeError: (err) => {
        setFileStatus('error');
        setFileError(err instanceof Error ? err.message : String(err));
      },
      live: {
        model: 'nova-2',
        interimResults: true,
        punctuate: true,
      },
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
          disabled={liveStatus === 'listening'}
        />
        <Button
          title="Stop Listening"
          onPress={stopListening}
          disabled={liveStatus !== 'listening'}
        />
      </View>
      {liveStatus === 'listening' && (
        <Text style={styles.status}>Listening…</Text>
      )}
      {liveError && <Text style={styles.error}>Error: {liveError}</Text>}
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
          disabled={fileStatus === 'transcribing'}
        />
      </View>
      {fileStatus === 'transcribing' && (
        <Text style={styles.status}>Transcribing file…</Text>
      )}
      {fileError && <Text style={styles.error}>File error: {fileError}</Text>}
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
