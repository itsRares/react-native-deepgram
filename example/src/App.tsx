import { useState } from 'react';
import { View, StyleSheet, Pressable, Text, StatusBar } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { configure } from 'react-native-deepgram';
import SpeechToText from './SpeechToText';
import TextIntelligence from './TextIntelligence';
import Management from './Management';
import TextToSpeech from './TextToSpeech';
import VoiceAgent from './VoiceAgent';
import { colors, radius, spacing, type } from './theme';

// Initialize Deepgram once at startup (key via EXPO_PUBLIC_DEEPGRAM_API_KEY).
// Custom endpoints are opt-in via EXPO_PUBLIC_DEEPGRAM_BASE_URL / BASE_WSS /
// AGENT_URL. For production, prefer ephemeral tokens: set
// EXPO_PUBLIC_DEEPGRAM_TOKEN_URL to a backend that proxies /v1/auth/grant and
// returns { access_token, expires_in } — getToken then takes precedence over
// apiKey so the key never ships in the app. See README → "Ephemeral / scoped tokens".
const tokenUrl = process.env.EXPO_PUBLIC_DEEPGRAM_TOKEN_URL;
const apiKey = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY;
const hasCredentials =
  Boolean(tokenUrl) ||
  (Boolean(apiKey) && apiKey !== 'your_deepgram_api_key_here');

configure({
  apiKey: apiKey || 'YOUR_DEEPGRAM_API_KEY',
  ...(tokenUrl
    ? {
        getToken: async () => {
          const res = await fetch(tokenUrl);
          const { access_token, expires_in } = await res.json();
          return { token: access_token, expiresInSeconds: expires_in };
        },
      }
    : {}),
  ...(process.env.EXPO_PUBLIC_DEEPGRAM_BASE_URL
    ? { baseUrl: process.env.EXPO_PUBLIC_DEEPGRAM_BASE_URL }
    : {}),
  ...(process.env.EXPO_PUBLIC_DEEPGRAM_BASE_WSS
    ? { baseWss: process.env.EXPO_PUBLIC_DEEPGRAM_BASE_WSS }
    : {}),
  ...(process.env.EXPO_PUBLIC_DEEPGRAM_AGENT_URL
    ? { agentUrl: process.env.EXPO_PUBLIC_DEEPGRAM_AGENT_URL }
    : {}),
});

type ScreenKey = 'voice' | 'speech' | 'tts' | 'text' | 'management';

const TABS: {
  key: ScreenKey;
  label: string;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    key: 'voice',
    label: 'Agent',
    title: 'Voice Agent',
    description: 'Full-duplex conversation with barge-in',
    icon: '🎙️',
  },
  {
    key: 'speech',
    label: 'Listen',
    title: 'Speech-to-Text',
    description: 'Live Nova / Flux streaming and file transcription',
    icon: '📝',
  },
  {
    key: 'tts',
    label: 'Speak',
    title: 'Text-to-Speech',
    description: 'Aura and Flux voices over REST or WebSocket',
    icon: '🔊',
  },
  {
    key: 'text',
    label: 'Intel',
    title: 'Text Intelligence',
    description: 'Summaries, topics, intents and sentiment',
    icon: '🧠',
  },
  {
    key: 'management',
    label: 'Manage',
    title: 'Management API',
    description: 'Projects, keys, usage and balances',
    icon: '⚙️',
  },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>('voice');
  const activeTab = TABS.find((t) => t.key === activeScreen) ?? TABS[0]!;
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.brandSub}>Deepgram · React Native playground</Text>
        <Text style={styles.brand}>{activeTab.title}</Text>
        <Text style={styles.description}>{activeTab.description}</Text>
      </View>

      {!hasCredentials ? (
        <View style={styles.keyBanner}>
          <Text style={styles.keyBannerTitle}>No Deepgram API key</Text>
          <Text style={styles.keyBannerText}>
            Copy example/.env.example to example/.env, set
            EXPO_PUBLIC_DEEPGRAM_API_KEY, then restart Metro with `yarn start`
            (Expo reads .env when it bundles).
          </Text>
        </View>
      ) : null}

      <View style={styles.content}>
        {activeScreen === 'voice' && <VoiceAgent />}
        {activeScreen === 'speech' && <SpeechToText />}
        {activeScreen === 'text' && <TextIntelligence />}
        {activeScreen === 'tts' && <TextToSpeech />}
        {activeScreen === 'management' && <Management />}
      </View>

      <View
        style={[
          styles.tabBar,
          { paddingBottom: Math.max(insets.bottom, spacing.sm) },
        ]}
      >
        {TABS.map(({ key, label, icon }) => {
          const isActive = key === activeScreen;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={label}
              onPress={() => setActiveScreen(key)}
              style={({ pressed }) => [
                styles.tabItem,
                pressed && styles.tabItemPressed,
              ]}
            >
              <View style={styles.tabIconWrap}>
                {isActive ? <View style={styles.tabIconActive} /> : null}
                <Text style={styles.tabIcon}>{icon}</Text>
              </View>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  brand: {
    ...type.h1,
    color: colors.text,
  },
  brandSub: {
    ...type.smallMedium,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    marginBottom: 2,
  },
  description: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  tabBar: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  tabItemPressed: {
    opacity: 0.7,
  },
  tabIconWrap: {
    width: 48,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActive: {
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    backgroundColor: colors.primaryMuted,
  },
  tabIcon: {
    fontSize: 16,
  },
  tabText: {
    ...type.smallMedium,
    fontSize: 11,
    color: colors.textDim,
  },
  tabTextActive: {
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  keyBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: '#2b2410',
  },
  keyBannerTitle: {
    ...type.smallMedium,
    color: colors.warning,
    marginBottom: 2,
  },
  keyBannerText: {
    ...type.small,
    color: colors.textMuted,
  },
});
