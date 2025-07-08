import { SafeAreaView, View, Button, StyleSheet } from 'react-native';
import { configure, UseDeepgramSpeechToText } from 'react-native-deepgram';

configure({ apiKey: 'ca1bccd0f5dcde6b3a4696859a7d2d4a42bea083' });

export default function App() {
  const { startListening, stopListening } = UseDeepgramSpeechToText({
    onStart: () => {
      console.log('Listening started');
    },
    onTranscript: (e) => {
      console.log('m', e);
    },
    onError: (error) => {
      console.error('Error:', error);
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.buttons}>
        <Button title="Start" onPress={startListening} />
        <Button title="Stop" onPress={stopListening} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  list: {
    flex: 1,
  },
});
