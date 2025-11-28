import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Button,
  ScrollView,
  StyleSheet,
  TextInput,
  Switch,
} from 'react-native';
import {
  useDeepgramVoiceAgent,
  createAgentSettings,
} from 'react-native-deepgram';
import OptionSelect from './components/OptionSelect';

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

  const agentSettings = useMemo(() => {
    return createAgentSettings({
      language,
      greeting,
      listenModel,
      thinkModel,
      prompt,
      temperature,
      tags: tagsInput,
      sampleRate: inputSampleRate,
    });
  }, [
    greeting,
    inputSampleRate,
    language,
    listenModel,
    prompt,
    tagsInput,
    temperature,
    thinkModel,
  ]);

  const {
    connect,
    disconnect,
    injectUserMessage,
    sendFunctionCallResponse,
    updatePrompt,
    sendKeepAlive,
    isConnected,
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

  const startAgent = async () => {
    try {
      await connect();
    } catch (err) {
      // Error handled by hook state
      console.error('Start agent failed', err);
    }
  };

  const stopAgent = () => {
    disconnect();
  };

  const sendGreeting = () => {
    const message = greeting.trim() || 'Hello! How can I help you today?';
    injectUserMessage(message);
  };

  const sendToolResponse = () => {
    sendFunctionCallResponse({
      id: 'func_12345',
      name: 'get_weather',
      client_side: true,
      content: JSON.stringify({ temperature: 72, condition: 'sunny' }),
    });
  };

  const applyPromptUpdate = () => {
    const newPrompt = prompt.trim();
    if (!newPrompt) return;
    updatePrompt(newPrompt);
  };

  const keepAlive = () => {
    sendKeepAlive();
  };

  const sendCustomUserMessage = () => {
    const message = customMessage.trim();
    if (!message) return;
    injectUserMessage(message);
    setCustomMessage('');
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.buttonRow}>
          <Button
            title={
              state?.connectionState === 'connected'
                ? 'Connected'
                : 'Start Agent'
            }
            onPress={startAgent}
            disabled={state?.connectionState === 'connecting' || isConnected()}
          />
          <Button title="Stop" onPress={stopAgent} disabled={!isConnected()} />
        </View>

        <View style={styles.buttonRow}>
          <Button
            title="Send greeting"
            onPress={sendGreeting}
            disabled={!isConnected()}
          />
          <Button
            title="Tool response"
            onPress={sendToolResponse}
            disabled={!isConnected()}
          />
        </View>

        <View style={styles.buttonRow}>
          <Button
            title="Update prompt"
            onPress={applyPromptUpdate}
            disabled={!isConnected()}
          />
          <Button
            title="Keep alive"
            onPress={keepAlive}
            disabled={!isConnected()}
          />
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Agent Persona</Text>
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
          <Text style={styles.inputLabel}>Greeting</Text>
          <TextInput
            value={greeting}
            onChangeText={setGreeting}
            style={styles.textInput}
            placeholder="Agent greeting"
          />
          <Text style={styles.inputLabel}>Prompt</Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            style={[styles.textInput, styles.textArea]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            placeholder="Prompt that guides the agent personality"
          />
          <Text style={styles.inputLabel}>Temperature (0-2)</Text>
          <TextInput
            value={temperature}
            onChangeText={setTemperature}
            style={styles.textInput}
            keyboardType="decimal-pad"
            placeholder="0.7"
          />
          <Text style={styles.inputLabel}>Tags (comma separated)</Text>
          <TextInput
            value={tagsInput}
            onChangeText={setTagsInput}
            style={styles.textInput}
            placeholder="demo, playground"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Capture Settings</Text>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              🎧 The agent will respond with voice. Make sure your volume is up!
            </Text>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Auto-start microphone</Text>
            <Switch value={autoStartMic} onValueChange={setAutoStartMic} />
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
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Manual Messages</Text>
          <TextInput
            value={customMessage}
            onChangeText={setCustomMessage}
            style={[styles.textInput, styles.textArea]}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            placeholder="Type a message to inject into the conversation"
          />
          <Button
            title="Send message"
            onPress={sendCustomUserMessage}
            disabled={!isConnected() || customMessage.trim().length === 0}
          />
        </View>

        {state?.connectionState === 'connecting' && (
          <Text style={styles.status}>Connecting to Deepgram…</Text>
        )}
        {agentStatus?.thinking && (
          <Text style={styles.status}>🤔 {agentStatus.thinking}</Text>
        )}
        {agentStatus?.latency && (
          <Text style={styles.status}>
            Latency: total {agentStatus.latency.total?.toFixed(2) ?? '–'}s · TTS{' '}
            {agentStatus.latency.tts?.toFixed(2) ?? '–'}s · TTT{' '}
            {agentStatus.latency.ttt?.toFixed(2) ?? '–'}s
          </Text>
        )}
        {state?.warning && (
          <Text style={styles.warning}>Warning: {state.warning}</Text>
        )}
        {state?.error && <Text style={styles.error}>Error: {state.error}</Text>}

        <Text style={styles.sectionTitle}>Conversation</Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            💬 Text transcripts of the conversation appear here alongside audio
            playback.
          </Text>
        </View>
        <View style={styles.conversation}>
          {conversation?.map((entry, index) => (
            <View key={`${entry.role}-${index}`} style={styles.messageRow}>
              <Text style={styles.messageRole}>{entry.role}:</Text>
              <Text style={styles.messageContent}>{entry.content}</Text>
            </View>
          ))}
          {(conversation?.length ?? 0) === 0 && (
            <Text style={styles.placeholder}>
              Conversation will appear here once the agent responds.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    alignItems: 'center',
  },
  settingsCard: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  textArea: {
    minHeight: 96,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginRight: 12,
  },
  infoBox: {
    backgroundColor: '#d1ecf1',
    borderWidth: 1,
    borderColor: '#bee5eb',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 13,
    color: '#0c5460',
    lineHeight: 18,
  },
  status: {
    marginBottom: 8,
    fontStyle: 'italic',
  },
  warning: {
    marginBottom: 8,
    color: '#b35d00',
  },
  error: {
    marginBottom: 8,
    color: '#d22',
  },
  conversation: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
    marginBottom: 24,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  messageRole: {
    fontWeight: '600',
    marginRight: 8,
  },
  messageContent: {
    flex: 1,
    flexWrap: 'wrap',
  },
  placeholder: {
    fontStyle: 'italic',
    color: '#666',
  },
});
