import { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Button,
  FlatList,
  StyleSheet,
} from 'react-native';
import { configure, useDeepgramConversation } from 'react-native-deepgram';

configure({ apiKey: 'YOUR_API_KEY' });

type Message = {
  role: string;
  content: string;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const { startSession, stopSession } = useDeepgramConversation({
    onMessage: (m: Message) => setMessages((cur) => [...cur, m]),
    onError: console.warn,
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.buttons}>
        <Button title="Start" onPress={startSession} />
        <Button title="Stop" onPress={stopSession} />
      </View>
      <FlatList
        style={styles.list}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <Text>{`${item.role}: ${item.content}`}</Text>
        )}
      />
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
