import { useState } from 'react';
import {
  SafeAreaView,
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Text,
  StatusBar,
} from 'react-native';
import { configure } from 'react-native-deepgram';
import SpeechToText from './SpeechToText';
import TextIntelligence from './TextIntelligence';
import Management from './Management';
import TextToSpeech from './TextToSpeech';
import VoiceAgent from './VoiceAgent';
import { colors, radius, spacing, type } from './theme';

// Initialize Deepgram once at startup. Provide your key via .env (EXPO_PUBLIC_DEEPGRAM_API_KEY).
configure({
  apiKey: process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY || 'YOUR_DEEPGRAM_API_KEY',
});

type ScreenKey = 'voice' | 'speech' | 'tts' | 'text' | 'management';

const TABS: { key: ScreenKey; label: string; icon: string }[] = [
  { key: 'voice', label: 'Voice Agent', icon: '🎙️' },
  { key: 'speech', label: 'Speech-to-Text', icon: '📝' },
  { key: 'tts', label: 'Text-to-Speech', icon: '🔊' },
  { key: 'text', label: 'Text Intel', icon: '🧠' },
  { key: 'management', label: 'Management', icon: '⚙️' },
];

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>('voice');
  const activeTab = TABS.find((t) => t.key === activeScreen) ?? TABS[0]!;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Deepgram</Text>
            <Text style={styles.brandSub}>React Native SDK · Playground</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeIcon}>{activeTab.icon}</Text>
            <Text style={styles.headerBadgeLabel}>{activeTab.label}</Text>
          </View>
        </View>

        {/* Tab bar */}
        <View style={styles.tabBarWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabContent}
          >
            {TABS.map(({ key, label, icon }) => {
              const isActive = key === activeScreen;
              return (
                <Pressable
                  key={key}
                  onPress={() => setActiveScreen(key)}
                  style={({ pressed }) => [
                    styles.tabItem,
                    isActive && styles.tabItemActive,
                    pressed && styles.tabItemPressed,
                  ]}
                >
                  <Text style={styles.tabIcon}>{icon}</Text>
                  <Text
                    style={[styles.tabText, isActive && styles.tabTextActive]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.content}>
          {activeScreen === 'voice' && <VoiceAgent />}
          {activeScreen === 'speech' && <SpeechToText />}
          {activeScreen === 'text' && <TextIntelligence />}
          {activeScreen === 'tts' && <TextToSpeech />}
          {activeScreen === 'management' && <Management />}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: {
    ...type.h1,
    color: colors.text,
  },
  brandSub: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    gap: 6,
  },
  headerBadgeIcon: {
    fontSize: 14,
  },
  headerBadgeLabel: {
    ...type.smallMedium,
    color: colors.textMuted,
  },
  tabBarWrap: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  tabContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  tabItemActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabItemPressed: {
    opacity: 0.85,
  },
  tabIcon: {
    fontSize: 14,
  },
  tabText: {
    ...type.smallMedium,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },
});
