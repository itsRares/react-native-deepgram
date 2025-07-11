import { useState } from 'react';
import { SafeAreaView, View, Button, StyleSheet } from 'react-native';
import { configure } from 'react-native-deepgram';
import SpeechToText from './SpeechToText';
import TextIntelligence from './TextIntelligence';

/**
 * Entry point for the Deepgram demo app.
 * Toggles between SpeechToText and TextIntelligence screens.
 */

// Initialize Deepgram with your API key once (can also be moved to a config file)
// Use an environment variable or placeholder for the API key
configure({ apiKey: process.env.DEEPGRAM_API_KEY || 'YOUR_DEEPGRAM_API_KEY' });

export default function App() {
  const [activeScreen, setActiveScreen] = useState<'speech' | 'text'>('speech');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.menu}>
        <Button
          title="Speech to Text"
          onPress={() => setActiveScreen('speech')}
        />
        <Button
          title="Text Intelligence"
          onPress={() => setActiveScreen('text')}
        />
      </View>

      <View style={styles.content}>
        {activeScreen === 'speech' && <SpeechToText />}
        {activeScreen === 'text' && <TextIntelligence />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  menu: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    backgroundColor: '#eee',
  },
  content: {
    flex: 1,
  },
});
