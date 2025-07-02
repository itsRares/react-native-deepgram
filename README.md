# react-native-deepgram

Package to support deepgram

## Installation

```sh
npm install react-native-deepgram
```

## Usage


```js
import { useDeepgramConversation, configure } from 'react-native-deepgram';

configure({ apiKey: 'YOUR_DEEPGRAM_API_KEY' });
const { startSession, stopSession } = useDeepgramConversation({
  onMessage: console.log,
});
```

When using Expo, include the provided config plugin in your `app.json`:

```json
{
  "expo": {
    "plugins": ["react-native-deepgram"]
  }
}
```


## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
