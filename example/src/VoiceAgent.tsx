import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  useDeepgramVoiceAgent,
  createAgentSettings,
} from 'react-native-deepgram';
import OptionSelect from './components/OptionSelect';
import Button from './components/Button';
import Card from './components/Card';
import Field from './components/Field';
import StatusBadge from './components/StatusBadge';
import { colors, radius, spacing, type } from './theme';

const LANGUAGE_OPTIONS = [
  { label: 'English (US)', value: 'en' },
  { label: 'Spanish (ES)', value: 'es' },
  { label: 'French (FR)', value: 'fr' },
];

const LISTEN_MODEL_OPTIONS = [
  { label: 'nova-3 (default)', value: 'nova-3' },
  { label: 'nova-3 general', value: 'nova-3-general-nova' },
  { label: 'nova-2', value: 'nova-2' },
];

const THINK_MODEL_OPTIONS = [
  { label: 'OpenAI gpt-4o', value: 'gpt-4o' },
  { label: 'OpenAI gpt-4o-mini', value: 'gpt-4o-mini' },
  { label: 'OpenAI gpt-4o-audio-preview', value: 'gpt-4o-audio-preview' },
];

const SAMPLE_RATE_OPTIONS = [
  { label: '16 kHz (recommended)', value: '16000' },
  { label: '8 kHz (lower quality)', value: '8000' },
];

export default function VoiceAgent() {
  const [language, setLanguage] = useState('en');
  const [listenModel, setListenModel] = useState('nova-3');
  const [thinkModel, setThinkModel] = useState('gpt-4o');
  const [greeting, setGreeting] = useState('Hello! How can I help you today?');
  const [prompt, setPrompt] = useState(
    'You are a friendly concierge for a travel agency.'
  );
  const [tagsInput, setTagsInput] = useState('demo');
  const [autoStartMic, setAutoStartMic] = useState(true);
  const [inputSampleRate, setInputSampleRate] = useState('16000');
  const [temperature, setTemperature] = useState('0.7');
  const [customMessage, setCustomMessage] = useState('');

  const agentSettings = useMemo(
    () =>
      createAgentSettings({
        language,
        greeting,
        listenModel,
        thinkModel,
        prompt,
        temperature,
        tags: tagsInput,
        sampleRate: inputSampleRate,
      }),
    [
      greeting,
      inputSampleRate,
      language,
      listenModel,
      prompt,
      tagsInput,
      temperature,
      thinkModel,
    ]
  );

  const {
    connect,
    disconnect,
    injectUserMessage,
    sendFunctionCallResponse,
    updatePrompt,
    sendKeepAlive,
    state,
    conversation,
    agentStatus,
  } = useDeepgramVoiceAgent({
    defaultSettings: agentSettings,
    autoStartMicrophone: autoStartMic,
    autoPlayAudio: true,
    trackState: true,
    trackConversation: true,
    trackAgentStatus: true,
  });

  const connectionState = state?.connectionState ?? 'idle';
  const connecting = connectionState === 'connecting';
  const connected = connectionState === 'connected';
  const conversationRef = useRef<ScrollView | null>(null);

  // Mic pulse animation
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!connected) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [connected, pulse]);

  // Auto-scroll to newest message
  useEffect(() => {
    if (conversationRef.current && (conversation?.length ?? 0) > 0) {
      conversationRef.current.scrollToEnd({ animated: true });
    }
  }, [conversation?.length]);

  const startAgent = async () => {
    try {
      await connect();
    } catch (err) {
      console.error('Start agent failed', err);
    }
  };

  const stopAgent = () => disconnect();

  const sendCustomUserMessage = () => {
    const message = customMessage.trim();
    if (!message) return;
    injectUserMessage(message);
    setCustomMessage('');
  };

  const sendToolResponse = () =>
    sendFunctionCallResponse({
      id: 'func_12345',
      name: 'get_weather',
      client_side: true,
      content: JSON.stringify({ temperature: 72, condition: 'sunny' }),
    });

  const applyPromptUpdate = () => {
    const trimmed = prompt.trim();
    if (trimmed) updatePrompt(trimmed);
  };

  const tone = state?.error
    ? 'error'
    : connecting
      ? 'connecting'
      : connected
        ? 'live'
        : 'idle';
  const toneLabel = state?.error
    ? 'Error'
    : connecting
      ? 'Connecting'
      : connected
        ? 'Live'
        : 'Disconnected';

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero / mic */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <StatusBadge tone={tone} label={toneLabel} />
            {agentStatus?.latency?.total != null && (
              <Text style={styles.latency}>
                {agentStatus.latency.total.toFixed(2)}s latency
              </Text>
            )}
          </View>

          <View style={styles.micWrap}>
            {connected && (
              <Animated.View
                style={[
                  styles.pulse,
                  {
                    transform: [{ scale: pulseScale }],
                    opacity: pulseOpacity,
                  },
                ]}
              />
            )}
            <View
              style={[
                styles.micCircle,
                connected && styles.micCircleActive,
                connecting && styles.micCircleConnecting,
              ]}
            >
              <Text style={styles.micIcon}>🎙️</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>
            {connected
              ? 'Listening — talk to the agent'
              : connecting
                ? 'Connecting…'
                : 'Voice Agent'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {connected
              ? `Model · ${thinkModel}`
              : 'Configure below and tap Start'}
          </Text>

          <View style={styles.heroActions}>
            {connected ? (
              <Button
                title="Disconnect"
                variant="danger"
                size="lg"
                onPress={stopAgent}
              />
            ) : (
              <Button
                title={connecting ? 'Connecting…' : 'Start agent'}
                variant="primary"
                size="lg"
                loading={connecting}
                disabled={connecting}
                onPress={startAgent}
                iconLeft="▶"
              />
            )}
          </View>
        </View>

        {state?.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠ {state.error}</Text>
          </View>
        ) : null}
        {state?.warning ? (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>{state.warning}</Text>
          </View>
        ) : null}
        {agentStatus?.thinking ? (
          <View style={styles.thinkingPill}>
            <Text style={styles.thinkingText}>🤔 {agentStatus.thinking}</Text>
          </View>
        ) : null}

        {/* Conversation */}
        <Card title="Conversation" subtitle="Transcripts of you and the agent">
          <ScrollView
            ref={conversationRef}
            style={styles.conversation}
            contentContainerStyle={styles.conversationContent}
            nestedScrollEnabled
          >
            {(conversation?.length ?? 0) === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySubtitle}>
                  Start the agent and say hello.
                </Text>
              </View>
            ) : (
              conversation?.map((entry, index) => {
                const isUser = entry.role === 'user';
                return (
                  <View
                    key={`${entry.role}-${index}`}
                    style={[
                      styles.bubbleRow,
                      isUser ? styles.bubbleRowRight : styles.bubbleRowLeft,
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        isUser ? styles.userBubble : styles.agentBubble,
                      ]}
                    >
                      <Text style={styles.bubbleRole}>
                        {isUser ? 'You' : 'Agent'}
                      </Text>
                      <Text style={styles.bubbleText}>{entry.content}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Card>

        {/* Send a manual message */}
        <Card
          title="Inject a message"
          subtitle="Send text into the live conversation"
        >
          <Field
            value={customMessage}
            onChangeText={setCustomMessage}
            placeholder="Type something for the user…"
            multiline
            numberOfLines={3}
          />
          <View style={styles.actionRow}>
            <Button
              title="Send as user"
              variant="primary"
              onPress={sendCustomUserMessage}
              disabled={!connected || customMessage.trim().length === 0}
            />
            <Button
              title="Tool reply"
              variant="secondary"
              onPress={sendToolResponse}
              disabled={!connected}
            />
            <Button
              title="Keep alive"
              variant="ghost"
              onPress={sendKeepAlive}
              disabled={!connected}
            />
          </View>
        </Card>

        {/* Persona — collapsible */}
        <Card
          title="Agent persona"
          subtitle="Greeting, prompt, language, model"
          collapsible
          defaultCollapsed
        >
          <OptionSelect
            label="Language"
            value={language}
            onChange={setLanguage}
            options={LANGUAGE_OPTIONS}
            allowCustom
            customPlaceholder="Language code"
          />
          <OptionSelect
            label="Thought model"
            value={thinkModel}
            onChange={setThinkModel}
            options={THINK_MODEL_OPTIONS}
            allowCustom
            customPlaceholder="Provider model id"
          />
          <Field
            label="Greeting"
            value={greeting}
            onChangeText={setGreeting}
            placeholder="Agent greeting"
          />
          <Field
            label="Prompt"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            numberOfLines={4}
            placeholder="System prompt that guides the agent"
          />
          <Button
            title="Update prompt now"
            variant="secondary"
            size="sm"
            onPress={applyPromptUpdate}
            disabled={!connected}
          />
          <View style={{ height: spacing.md }} />
          <Field
            label="Temperature (0–2)"
            value={temperature}
            onChangeText={setTemperature}
            keyboardType="decimal-pad"
            placeholder="0.7"
          />
          <Field
            label="Tags"
            value={tagsInput}
            onChangeText={setTagsInput}
            placeholder="demo, playground"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Card>

        {/* Capture — collapsible */}
        <Card
          title="Capture settings"
          subtitle="Microphone & ASR"
          collapsible
          defaultCollapsed
        >
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Auto-start microphone</Text>
            <Switch
              value={autoStartMic}
              onValueChange={setAutoStartMic}
              thumbColor={autoStartMic ? colors.primary : '#888'}
              trackColor={{
                false: colors.surfaceMuted,
                true: colors.primaryMuted,
              }}
            />
          </View>
          <OptionSelect
            label="Listen model"
            value={listenModel}
            onChange={setListenModel}
            options={LISTEN_MODEL_OPTIONS}
            allowCustom
            customPlaceholder="ASR model id"
          />
          <OptionSelect
            label="Input sample rate"
            value={inputSampleRate}
            onChange={setInputSampleRate}
            options={SAMPLE_RATE_OPTIONS}
            allowCustom
            customPlaceholder="e.g. 16000"
            customKeyboardType="number-pad"
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing.md,
  },
  latency: {
    ...type.small,
    color: colors.textMuted,
  },
  micWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  pulse: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary,
  },
  micCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  micCircleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  micCircleConnecting: {
    borderColor: colors.warning,
  },
  micIcon: {
    fontSize: 36,
  },
  heroTitle: {
    ...type.h2,
    color: colors.text,
    textAlign: 'center',
  },
  heroSubtitle: {
    ...type.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  heroActions: {
    width: '100%',
    alignItems: 'stretch',
  },
  errorBanner: {
    backgroundColor: '#3a1418',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
    ...type.smallMedium,
  },
  warningBanner: {
    backgroundColor: '#3a2c10',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warningText: {
    color: colors.warning,
    ...type.smallMedium,
  },
  thinkingPill: {
    backgroundColor: colors.accentMuted,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  thinkingText: {
    color: colors.accent,
    ...type.smallMedium,
  },
  conversation: {
    maxHeight: 320,
  },
  conversationContent: {
    paddingVertical: spacing.xs,
  },
  bubbleRow: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 4,
  },
  agentBubble: {
    backgroundColor: colors.agentBubble,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleRole: {
    ...type.small,
    color: colors.textMuted,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  bubbleText: {
    color: colors.text,
    ...type.body,
  },
  emptyState: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...type.h3,
    color: colors.text,
  },
  emptySubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  switchLabel: {
    ...type.body,
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
});
