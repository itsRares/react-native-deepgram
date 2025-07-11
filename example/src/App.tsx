import { useState } from 'react';
import {
  SafeAreaView,
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
} from 'react-native';
import { configure } from 'react-native-deepgram';
import SpeechToText from './SpeechToText';
import TextIntelligence from './TextIntelligence';
import Management from './Management';

/**
 * Entry point for the Deepgram demo app.
 * Toggles between SpeechToText and TextIntelligence screens.
 */

// Initialize Deepgram with your API key once (can also be moved to a config file)
// Use an environment variable or placeholder for the API key
configure({ apiKey: process.env.DEEPGRAM_API_KEY || 'YOUR_DEEPGRAM_API_KEY' });

type ScreenKey = 'speech' | 'text' | 'management';
const TABS: { key: ScreenKey; label: string }[] = [
  { key: 'speech', label: 'Speech to Text' },
  { key: 'text', label: 'Text Intelligence' },
  { key: 'management', label: 'Management' },
];

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>('speech');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabContent}
        >
          {TABS.map(({ key, label }) => {
            const isActive = key === activeScreen;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setActiveScreen(key)}
                style={[styles.tabItem, isActive && styles.tabItemActive]}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.tabText, isActive && styles.tabTextActive]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.content}>
        {activeScreen === 'speech' && <SpeechToText />}
        {activeScreen === 'text' && <TextIntelligence />}
        {activeScreen === 'management' && <Management />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  tabWrapper: {
    height: 56,
    backgroundColor: '#f2f2f2',
    justifyContent: 'center',
  },
  tabContent: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  tabItem: {
    marginHorizontal: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#ddd',
    borderRadius: 20,
  },
  tabItemActive: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    color: '#333',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
});
