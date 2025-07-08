# react-native-deepgram

> **Work in progress** – currently only the **Listen (Speech-to-Text)** API is supported.

Bindings that allow a React Native application to communicate with [Deepgram’s Speech-to-Text API](https://developers.deepgram.com/docs/listen) via WebSocket **and** HTTP POST for pre-recorded audio. This library handles:

- 🔊 **Live streaming**: captures raw PCM audio from the microphone, down-samples, and streams over WebSocket to Deepgram.
- 📄 **File transcription**: uploads audio files (blobs or device URIs) via HTTP POST to Deepgram’s REST endpoint.

> ⚠️ Future support for Deepgram’s Voice Agent (text-to-speech responses) and additional REST endpoints is planned.

---

## Features

- **Live Speech-to-Text (WebSocket)**
  - `startListening()` / `stopListening()` hooks for real-time transcription.
  - Partial and final results via callback.
- **Pre-Recorded File Transcription (HTTP POST)**
  - `transcribeFile(file)` method accepts a `Blob` or `{ uri, name, type }`.
  - Returns final transcript in a single callback.
- **React Native + Expo ready**
  - Includes Expo Config Plugin for automatic native setup.
  - Compatible with both managed and bare workflows.

---

## Installation

```bash
npm install react-native-deepgram
# or
yarn add react-native-deepgram
```

### iOS (CocoaPods)

After installing, from the `ios/` directory run:

```bash
pod install
```

### Expo

If you’re using Expo, add the plugin to your `app.config.js` or `app.json`:

```js
// app.config.js
module.exports = {
  expo: {
    plugins: [
      [
        'react-native-deepgram',
        {
          microphonePermission:
            'Allow $(PRODUCT_NAME) to access your microphone.',
        },
      ],
    ],
  },
};
```

Then generate native projects (managed workflow) and run:

```bash
npx expo prebuild
npx expo run:ios   # or expo run:android
```

---

## Quick Start

### 1. Configure your API Key

In your application entry point (e.g. `App.tsx`):

```ts
import { configure } from 'react-native-deepgram';

configure({ apiKey: 'YOUR_DEEPGRAM_API_KEY' });
```

### 2. Live Streaming (WebSocket)

```ts
import { UseDeepgramSpeechToText } from 'react-native-deepgram';

const { startListening, stopListening } = UseDeepgramSpeechToText({
  onBeforeStart: () => console.log('Preparing...'),
  onStart: () => console.log('WebSocket open'),
  onTranscript: (text) => console.log('Transcript:', text),
  onError: (err) => console.error('Live error', err),
  onEnd: () => console.log('Session ended'),
});

// ...
<Button title="Start Live" onPress={startListening} />
<Button title="Stop Live" onPress={stopListening} />
```

### 3. File Transcription (HTTP POST)

```ts
import * as DocumentPicker from 'expo-document-picker';

async function pickAndTranscribe() {
  const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
  if (res.type === 'success') {
    await transcribeFile({
      uri: res.uri,
      name: res.name,
      type: res.mimeType || 'audio/wav',
    });
  }
}
```

```ts
const { transcribeFile } = useDeepgramListen({
  onBeforeTranscribe: () => console.log('Uploading file...'),
  onTranscribeSuccess: (text) => console.log('File transcript:', text),
  onTranscribeError: (err) => console.error('File error', err),
});
```

---

## Configuration Options

When calling `useDeepgramListen`, you can pass any of the following callbacks:

```ts
export type UseDeepgramSpeechToTextProps = {
  /** Called before any setup (e.g. before permission prompt) */
  onBeforeStart?: () => void;
  /** Called once the WebSocket is open */
  onStart?: () => void;
  /** Called on every transcript update */
  onTranscript?: (transcript: string) => void;
  /** Called on any error */
  onError?: (error: unknown) => void;
  /** Called when the session ends or WebSocket closes */
  onEnd?: () => void;
  /** Called before starting file transcription (e.g. show spinner) */
  onBeforeTranscribe?: () => void;
  /** Called when file transcription completes with the final transcript */
  onTranscribeSuccess?: (transcript: string) => void;
  /** Called if file transcription fails */
  onTranscribeError?: (error: unknown) => void;
};
```

---

## Example App

See the [`example/`](example) folder for a complete demo showcasing both live and file transcription.

---

## Roadmap & Work In Progress

- ✅ **Implemented**: Speech-to-Text (Listen API) over WebSocket and REST.
- 🚧 **Next**: Voice Agent (Text-to-Speech) WebSocket support.
- 🚧 **Upcoming**: Custom intents, topics, summarization, and deeper REST endpoint wrappers.

Contributions, issues, and feature requests are welcome! Please follow the [contributing guide](CONTRIBUTING.md).

---

## License

MIT
