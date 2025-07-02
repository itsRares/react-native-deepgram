import { Text, View, StyleSheet } from 'react-native';
import { configure } from 'react-native-deepgram';

configure({ apiKey: 'YOUR_API_KEY' });

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Deepgram Example</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
