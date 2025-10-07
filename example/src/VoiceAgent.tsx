import { useMemo, useState } from 'react';
import { View, Text, Button, ScrollView, StyleSheet } from 'react-native';
import { useDeepgramVoiceAgent } from 'react-native-deepgram';

type ConversationEntry = {
  role: string;
  content: string;
};

type AgentLatency = {
  total?: number;
  tts?: number;
  ttt?: number;
};

export default function VoiceAgent() {
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'error'
  >('idle');
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [thinking, setThinking] = useState<string | null>(null);
  const [latency, setLatency] = useState<AgentLatency | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const demoSettings = useMemo(
    () => ({
      audio: {
        input: { encoding: 'linear16', sample_rate: 24_000 },
        output: {
          encoding: 'linear16',
          sample_rate: 24_000,
          container: 'none',
        },
      },
      agent: {
        language: 'en',
        greeting: 'Hello! How can I help you today?',
        listen: {
          provider: { type: 'deepgram', model: 'nova-3', smart_format: true },
        },
        think: {
          provider: { type: 'open_ai', model: 'gpt-4o', temperature: 0.7 },
          prompt: 'You are a friendly concierge for a travel agency.',
        },
        speak: {
          provider: { type: 'deepgram', model: 'aura-2-asteria-en' },
        },
      },
      tags: ['demo'],
    }),
    []
  );

  const {
    connect,
    disconnect,
    injectUserMessage,
    sendFunctionCallResponse,
    updatePrompt,
    sendKeepAlive,
    isConnected,
  } = useDeepgramVoiceAgent({
    defaultSettings: demoSettings,
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
    injectUserMessage('Hi there! Can you help me plan a trip to Paris?');
  };

  const sendToolResponse = () => {
    sendFunctionCallResponse({
      id: 'func_12345',
      name: 'get_weather',
      client_side: true,
      content: JSON.stringify({ temperature: 72, condition: 'sunny' }),
    });
  };

  const changePrompt = () => {
    updatePrompt('You are now a helpful foodie assistant.');
  };

  const keepAlive = () => {
    sendKeepAlive();
  };

  return (
    <View style={styles.container}>
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
          title="Change prompt"
          onPress={changePrompt}
          disabled={!isConnected()}
        />
        <Button
          title="Keep alive"
          onPress={keepAlive}
          disabled={!isConnected()}
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

      <ScrollView style={styles.log}>
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
  log: {
    flex: 1,
    marginTop: 12,
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
