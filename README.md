# react-native-deepgram

[![npm version](https://badge.fury.io/js/react-native-deepgram.svg)](https://badge.fury.io/js/react-native-deepgram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Work‑in‑progress** – Listen (Speech‑to‑Text) **and** Text Intelligence APIs are live. Voice Agent (TTS) support is next on the list.

**react-native-deepgram** brings Deepgram’s AI to React Native & Expo:

- 🔊 **Live Speech-to-Text** – capture PCM audio and stream over WebSocket.
- 📄 **File Transcription** – POST audio blobs/URIs and receive a transcript.
- 🧠 **Text Intelligence** – summarise, detect topics, intents & sentiment.
- 🛠️ **Management API** – list models, keys, usage, projects & more.
- ⚙️ **Expo config plugin** – automatic native setup (managed or bare workflow).

---

## Installation

```bash
yarn add react-native-deepgram
# or
npm install react-native-deepgram
```

### iOS (CocoaPods)

```bash
cd ios && pod install
```

### Expo

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

```bash
npx expo prebuild
npx expo run:ios   # or expo run:android
```

---

## Configuration

```ts
import { configure } from 'react-native-deepgram';

configure({ apiKey: 'YOUR_DEEPGRAM_API_KEY' });
```

> **Heads‑up 🔐** The Management API needs a key with management scopes.  
> Don’t ship production keys in a public repo—use environment variables, Expo secrets, or your own backend.

---

## Hooks at a glance

| Hook                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `useDeepgramSpeechToText`     | Live mic streaming + file transcription              |
| `useDeepgramTextIntelligence` | NLP analysis (summaries, topics, sentiment, intents) |
| `useDeepgramManagement`       | Full Management REST wrapper                         |

---

### `useDeepgramSpeechToText`

<details>
<summary>Example – live streaming</summary>

```tsx
const { startListening, stopListening } = useDeepgramSpeechToText({
  onTranscript: console.log,
});

<Button title="Start" onPress={startListening} />
<Button title="Stop"  onPress={stopListening} />
```

</details>

<details>
<summary>Example – file transcription</summary>

```tsx
const { transcribeFile } = useDeepgramSpeechToText({
  onTranscribeSuccess: console.log,
});

const pickFile = async () => {
  const f = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
  if (f.type === 'success') await transcribeFile(f);
};
```

</details>

#### Properties

| Name                  | Type                           | Description                                         | Default |
| --------------------- | ------------------------------ | --------------------------------------------------- | ------- |
| `onBeforeStart`       | `() => void`                   | Called before any setup (e.g. permission prompt)    | –       |
| `onStart`             | `() => void`                   | Fires once the WebSocket connection opens           | –       |
| `onTranscript`        | `(transcript: string) => void` | Called on every transcript update (partial & final) | –       |
| `onError`             | `(error: unknown) => void`     | Called on any streaming error                       | –       |
| `onEnd`               | `() => void`                   | Fires when the session ends / WebSocket closes      | –       |
| `onBeforeTranscribe`  | `() => void`                   | Called before file transcription begins             | –       |
| `onTranscribeSuccess` | `(transcript: string) => void` | Called with the final transcript of the file        | –       |
| `onTranscribeError`   | `(error: unknown) => void`     | Called if file transcription fails                  | –       |

#### Methods

| Name             | Signature                                                                        | Description                                                   |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `startListening` | `() => Promise<void>`                                                            | Begin mic capture and stream audio to Deepgram                |
| `stopListening`  | `() => Promise<void>`                                                            | Stop capture and close WebSocket                              |
| `transcribeFile` | `(file: Blob \| { uri: string; name?: string; type?: string }) => Promise<void>` | Upload an audio file and receive its transcript via callbacks |

<details>
<summary>Types</summary>

```ts
export type UseDeepgramSpeechToTextProps = /* …see above table… */
export type UseDeepgramSpeechToTextReturn = {
  startListening: () => void;
  stopListening: () => void;
  transcribeFile: (
    file: Blob | { uri: string; name?: string; type?: string }
  ) => Promise<void>;
};
```

</details>

---

### `useDeepgramTextIntelligence`

<details>
<summary>Example</summary>

```tsx
const { analyze } = useDeepgramTextIntelligence({
  options: { summarize: true, topics: true, sentiment: true },
  onAnalyzeSuccess: console.log,
});

await analyze({ text: 'React Native makes mobile easy.' });
```

</details>

#### Properties

| Name               | Type                                 | Description                                       | Default |
| ------------------ | ------------------------------------ | ------------------------------------------------- | ------- |
| `onBeforeAnalyze`  | `() => void`                         | Called before analysis begins (e.g. show spinner) | –       |
| `onAnalyzeSuccess` | `(results: any) => void`             | Called with the analysis results on success       | –       |
| `onAnalyzeError`   | `(error: Error) => void`             | Called if the analysis request fails              | –       |
| `options`          | `UseDeepgramTextIntelligenceOptions` | Which NLP tasks to run                            | `{}`    |

#### Methods

| Name      | Signature                                                   | Description                                         |
| --------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `analyze` | `(input: { text?: string; url?: string }) => Promise<void>` | Send raw text (or a URL) to Deepgram for processing |

<details id="usedeepgramtextintelligence-types">
<summary>Types</summary>

```ts
export interface UseDeepgramTextIntelligenceOptions {
  summarize?: boolean;
  topics?: boolean;
  intents?: boolean;
  sentiment?: boolean;
  language?: string;
  customTopic?: string | string[];
  customTopicMode?: 'extended' | 'strict';
  callback?: string;
  callbackMethod?: 'POST' | 'PUT' | string;
}

export interface UseDeepgramTextIntelligenceReturn {
  analyze: (input: { text?: string; url?: string }) => Promise<void>;
}
```

</details>

---

### `useDeepgramManagement`

<details>
<summary>Example</summary>

```tsx
const dg = useDeepgramManagement();

// List all projects linked to the key
const projects = await dg.projects.list();
console.log(
  'Projects:',
  projects.map((p) => p.name)
);
```

</details>

#### Properties

This hook accepts **no props** – simply call it to receive a typed client.

#### Methods (snapshot)

| Group      | Representative methods                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `models`   | `list(includeOutdated?)`, `get(modelId)`                                                                          |
| `projects` | `list()`, `get(id)`, `delete(id)`, `patch(id, body)`, `listModels(id)`, `getModel(projectId, modelId)`            |
| `keys`     | `list(projectId)`, `create(projectId, body)`, `get(projectId, keyId)`, `delete(projectId, keyId)`                 |
| `usage`    | `listRequests(projectId)`, `getRequest(projectId, requestId)`, `listFields(projectId)`, `getBreakdown(projectId)` |
| `balances` | `list(projectId)`, `get(projectId, balanceId)`                                                                    |

_(Plus helpers for `members`, `scopes`, `invitations`, and `purchases`.)_

<details>
<summary>Types</summary>

```ts
export interface UseDeepgramManagementReturn {
  models: {
    list(includeOutdated?: boolean): Promise<DeepgramListModelsResponse>;
    get(modelId: string): Promise<DeepgramSttModel | DeepgramTtsModel>;
  };
  projects: {
    list(): Promise<DeepgramProject[]>;
    // …see source for full surface
  };
  // …keys, members, scopes, invitations, usage, balances, purchases
}
```

</details>

---

## Example app

```bash
git clone https://github.com/itsRares/react-native-deepgram
cd react-native-deepgram/example
yarn && yarn start   # or expo start
```

---

## Roadmap

- ✅ Speech-to-Text (WebSocket + REST)
- ✅ Text Intelligence (summaries, topics, sentiment, intents)
- ✅ Management API wrapper
- 🚧 Voice Agent (TTS) WebSocket endpoint
- 🚧 Detox E2E tests for the example app

---

## Contributing

Issues / PRs welcome—see **CONTRIBUTING.md**.

---

## License

MIT
