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
import { useDeepgramVoiceAgent } from 'react-native-deepgram';
import OptionSelect from './components/OptionSelect';

type ConversationEntry = {
  role: string;
  content: string;
};

type AgentLatency = {
  total?: number;
  tts?: number;
  ttt?: number;
};

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
  { label: '48 kHz', value: '48000' },
  { label: '24 kHz', value: '24000' },
  { label: '16 kHz', value: '16000' },
];

export default function VoiceAgent() {
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'error'
  >('idle');
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [thinking, setThinking] = useState<string | null>(null);
  const [latency, setLatency] = useState<AgentLatency | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState('en');
  const [listenModel, setListenModel] = useState('nova-3');
  const [thinkModel, setThinkModel] = useState('gpt-4o');
  const [greeting, setGreeting] = useState('Hello! How can I help you today?');
  const [prompt, setPrompt] = useState(
    'You are a friendly concierge for a travel agency.'
  );
  const [tagsInput, setTagsInput] = useState('demo');
  const [autoStartMic, setAutoStartMic] = useState(true);
  const [inputSampleRate, setInputSampleRate] = useState('24000');
  const [temperature, setTemperature] = useState('0.7');
  const [customMessage, setCustomMessage] = useState('');

  const agentSettings = useMemo(() => {
    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const resolvedListenModel = listenModel.trim() || 'nova-3';
    const resolvedThinkModel = thinkModel.trim() || 'gpt-4o';
    const inputRate = Number(inputSampleRate) || 24_000;
    const parsedTemperature = parseFloat(temperature);
    const boundedTemperature = Number.isFinite(parsedTemperature)
      ? Math.max(0, Math.min(2, parsedTemperature))
      : 0.7;

    return {
      audio: {
        input: { encoding: 'linear16', sample_rate: inputRate },
      },
      agent: {
        language: language.trim() || 'en',
        greeting: greeting.trim() || 'Hello! How can I help you today?',
        listen: {
          provider: {
            type: 'deepgram',
            model: resolvedListenModel,
            smart_format: true,
          },
        },
        think: {
          provider: {
            type: 'open_ai',
            model: resolvedThinkModel,
            temperature: boundedTemperature,
          },
          prompt: prompt.trim(),
        },
      },
      ...(tags.length ? { tags } : {}),
    };
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

  const downsampleFactor = useMemo(() => {
    const rate = Number(inputSampleRate) || 24_000;
    return Math.max(1, Math.round(48_000 / rate));
  }, [inputSampleRate]);

  const {
    connect,
    disconnect,
    injectUserMessage,
    sendFunctionCallResponse,
    updatePrompt,
    sendKeepAlive,
    isConnected,
  } = useDeepgramVoiceAgent({
    defaultSettings: agentSettings,
    autoStartMicrophone: autoStartMic,
    downsampleFactor,
    onBeforeConnect: () => {
      setStatus('connecting');
      setError(null);
      setWarning(null);
      setConversation([]);
    },
    onConnect: () => setStatus('connected'),
    onClose: () => {
      setStatus('idle');
      setThinking(null);
      setLatency(null);
    },
    onError: (err) => {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    },
    onConversationText: (message) => {
      setConversation((prev) => [
        ...prev,
        { role: message.role, content: message.content },
      ]);
    },
    onAgentThinking: (message) => setThinking(message.content),
    onAgentStartedSpeaking: (message) =>
      setLatency({
        total: message.total_latency,
        tts: message.tts_latency,
        ttt: message.ttt_latency,
      }),
    onAgentAudioDone: () => {
      setThinking(null);
      setLatency(null);
    },
    onUserStartedSpeaking: () => setThinking('User is speaking…'),
    onWarning: (message) => setWarning(message.description),
    onServerError: (message) => {
      setStatus('error');
      setError(message.description || message.code || 'Voice agent error');
    },
  });

  const startAgent = async () => {
    try {
      await connect();
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
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
            title={status === 'connected' ? 'Connected' : 'Start Agent'}
            onPress={startAgent}
            disabled={status === 'connecting' || isConnected()}
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
              🎧 Agent replies are delivered as text only. Speak into the
              microphone and read the responses below.
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

        {status === 'connecting' && (
          <Text style={styles.status}>Connecting to Deepgram…</Text>
        )}
        {thinking && <Text style={styles.status}>🤔 {thinking}</Text>}
        {latency && (
          <Text style={styles.status}>
            Latency: total {latency.total?.toFixed(2) ?? '–'}s · TTS{' '}
            {latency.tts?.toFixed(2) ?? '–'}s · TTT{' '}
            {latency.ttt?.toFixed(2) ?? '–'}s
          </Text>
        )}
        {warning && <Text style={styles.warning}>Warning: {warning}</Text>}
        {error && <Text style={styles.error}>Error: {error}</Text>}

        <Text style={styles.sectionTitle}>Conversation (Text Only)</Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            💬 The agent responds with text transcripts so playback can't echo
            back into the microphone.
          </Text>
        </View>
        <View style={styles.conversation}>
          {conversation.map((entry, index) => (
            <View key={`${entry.role}-${index}`} style={styles.messageRow}>
              <Text style={styles.messageRole}>{entry.role}:</Text>
              <Text style={styles.messageContent}>{entry.content}</Text>
            </View>
          ))}
          {conversation.length === 0 && (
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
