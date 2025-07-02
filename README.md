# react-native-deepgram

Bindings that allow a React Native app to talk to
[Deepgram's Voice Agent](https://developers.deepgram.com)
service. The library handles recording raw PCM audio, connecting to the
Deepgram WebSocket and playing back the agent's audio responses.

## Installation

```sh
npm install react-native-deepgram
# or
yarn add react-native-deepgram
```

### Expo

When using Expo you can let the config plugin set up the native code for you.
Create an `app.config.js` and include the plugin:

```js
module.exports = {
  expo: {
    plugins: [
      ["react-native-deepgram", {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone."
      }]
    ]
  }
};
```

After installing, remember to run `pod install` inside the `ios` directory when
developing for iOS.

If you're using Expo, generate the native projects first and then run them:

```sh
npx expo prebuild
npx expo run:ios       # or expo run:android
```

## Usage

Configure the API key once, then use the `useDeepgramConversation` hook to start
and stop a voice session.

```tsx
import React, { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { configure, useDeepgramConversation } from 'react-native-deepgram';

configure({ apiKey: 'YOUR_DEEPGRAM_API_KEY' });

export default function Example() {
  const [messages, setMessages] = useState([]);
  const { startSession, stopSession } = useDeepgramConversation({
    onMessage: (m) => setMessages((cur) => [...cur, m]),
    onError: console.warn,
  });

  return (
    <View>
      <Button title="Start" onPress={startSession} />
      <Button title="Stop" onPress={stopSession} />
      {messages.map((m, i) => (
        <Text key={i}>{`${m.role}: ${m.content}`}</Text>
      ))}
    </View>
  );
}
```

See the [`example`](example) folder for a fully working application.


## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
