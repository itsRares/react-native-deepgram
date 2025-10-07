# react-native-deepgram

[![npm version](https://badge.fury.io/js/react-native-deepgram.svg)](https://badge.fury.io/js/react-native-deepgram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**react-native-deepgram** brings Deepgram’s AI to React Native & Expo:

- 🔊 **Live Speech-to-Text** – capture PCM audio and stream over WebSocket.
- 📄 **File Transcription** – POST audio blobs/URIs and receive a transcript.
- 🎤 **Text-to-Speech** – generate natural speech with HTTP synthesis + WebSocket streaming.
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
| `useDeepgramTextToSpeech`     | Text-to-Speech synthesis + streaming                 |
| `useDeepgramTextIntelligence` | NLP analysis (summaries, topics, sentiment, intents) |
| `useDeepgramManagement`       | Full Management REST wrapper                         |

---

### `useDeepgramSpeechToText`

<details>
<summary>Example – live streaming</summary>

```tsx
const { startListening, stopListening } = useDeepgramSpeechToText({
  onTranscript: console.log,
  live: {
    model: 'nova-2',
    interimResults: true,
    punctuate: true,
  },
});

<Button
  title="Start"
  onPress={() => startListening({ keywords: ['Deepgram'] })}
/>
<Button title="Stop"  onPress={stopListening} />
```

</details>

<details>
<summary>Example – file transcription</summary>

```tsx
const { transcribeFile } = useDeepgramSpeechToText({
  onTranscribeSuccess: (text) => console.log(text),
  prerecorded: {
    punctuate: true,
    summarize: 'v2',
  },
});

const pickFile = async () => {
  const f = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
  if (f.type === 'success') {
    await transcribeFile(f, { topics: true, intents: true });
  }
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
| `live`                | `DeepgramLiveListenOptions`    | Default Live transcription params (query string)    | –       |
| `prerecorded`         | `DeepgramPrerecordedOptions`   | Default options for pre-recorded transcription      | –       |

#### Methods

| Name             | Signature                                                                        | Description                                                                       |
| ---------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `startListening` | `(options?: DeepgramLiveListenOptions) => Promise<void>`                         | Begin mic capture and stream audio to Deepgram (override defaults with `options`) |
| `stopListening`  | `() => void`                                                                     | Stop capture and close WebSocket                                                  |
| `transcribeFile` | `(file: DeepgramPrerecordedSource, options?: DeepgramPrerecordedOptions) => Promise<void>` | Upload a local blob/URI or remote URL and receive its transcript via callbacks |

<details>
<summary>Types</summary>

```ts
export type DeepgramLiveListenRedaction =
  | 'pci'
  | 'numbers'
  | 'dates'
  | 'names'
  | 'addresses'
  | 'all'
  | (string & {});

export type DeepgramLiveListenOptions = {
  callback?: string;
  callbackMethod?: 'POST' | 'GET' | 'PUT' | 'DELETE';
  channels?: number;
  diarize?: boolean;
  dictation?: boolean;
  encoding?:
    | 'linear16'
    | 'linear32'
    | 'flac'
    | 'alaw'
    | 'mulaw'
    | 'amr-nb'
    | 'amr-wb'
    | 'opus'
    | 'ogg-opus'
    | 'speex'
    | 'g729'
    | (string & {});
  endpointing?: number | boolean;
  extra?: Record<string, string | number | boolean>;
  fillerWords?: boolean;
  interimResults?: boolean;
  keyterm?: string | string[];
  keywords?: string | string[];
  language?: string;
  mipOptOut?: boolean;
  model?:
    | 'nova-3'
    | 'nova-3-general'
    | 'nova-3-medical'
    | 'nova-2'
    | 'nova-2-general'
    | 'nova-2-meeting'
    | 'nova-2-finance'
    | 'nova-2-conversationalai'
    | 'nova-2-voicemail'
    | 'nova-2-video'
    | 'nova-2-medical'
    | 'nova-2-drivethru'
    | 'nova-2-automotive'
    | 'nova'
    | 'nova-general'
    | 'nova-phonecall'
    | 'nova-medical'
    | 'enhanced'
    | 'enhanced-general'
    | 'enhanced-meeting'
    | 'enhanced-phonecall'
    | 'enhanced-finance'
    | 'base'
    | 'meeting'
    | 'phonecall'
    | 'finance'
    | 'conversationalai'
    | 'voicemail'
    | 'video'
    | 'custom'
    | (string & {});
  multichannel?: boolean;
  numerals?: boolean;
  profanityFilter?: boolean;
  punctuate?: boolean;
  redact?: DeepgramLiveListenRedaction | DeepgramLiveListenRedaction[];
  replace?: string | string[];
  sampleRate?: number;
  search?: string | string[];
  smartFormat?: boolean;
  tag?: string;
  utteranceEndMs?: number;
  vadEvents?: boolean;
  version?: string;
};

export type DeepgramPrerecordedCallbackMethod = 'POST' | 'PUT' | (string & {});

export type DeepgramPrerecordedEncoding =
  | 'linear16'
  | 'flac'
  | 'mulaw'
  | 'amr-nb'
  | 'amr-wb'
  | 'opus'
  | 'speex'
  | 'g729'
  | (string & {});

export type DeepgramPrerecordedRedaction =
  | 'pci'
  | 'pii'
  | 'numbers'
  | (string & {});

export type DeepgramPrerecordedOptions = {
  callback?: string;
  callbackMethod?: DeepgramPrerecordedCallbackMethod;
  extra?: string | string[] | Record<string, string | number | boolean>;
  sentiment?: boolean;
  summarize?: boolean | 'v1' | 'v2' | (string & {});
  tag?: string | string[];
  topics?: boolean;
  customTopic?: string | string[];
  customTopicMode?: 'extended' | 'strict';
  intents?: boolean;
  customIntent?: string | string[];
  customIntentMode?: 'extended' | 'strict';
  detectEntities?: boolean;
  detectLanguage?: boolean | string | string[];
  diarize?: boolean;
  dictation?: boolean;
  encoding?: DeepgramPrerecordedEncoding;
  fillerWords?: boolean;
  keyterm?: string | string[];
  keywords?: string | string[];
  language?: string;
  measurements?: boolean;
  model?: DeepgramLiveListenOptions['model'] | (string & {});
  multichannel?: boolean;
  numerals?: boolean;
  paragraphs?: boolean;
  profanityFilter?: boolean;
  punctuate?: boolean;
  redact?: DeepgramPrerecordedRedaction | DeepgramPrerecordedRedaction[];
  replace?: string | string[];
  search?: string | string[];
  smartFormat?: boolean;
  utterances?: boolean;
  uttSplit?: number;
  version?: 'latest' | (string & {});
};

export type DeepgramPrerecordedSource =
  | Blob
  | { uri: string; name?: string; type?: string }
  | { url: string }
  | string;

export type UseDeepgramSpeechToTextProps = /* …see above table… */
export type UseDeepgramSpeechToTextReturn = {
  startListening: (options?: DeepgramLiveListenOptions) => Promise<void>;
  stopListening: () => void;
  transcribeFile: (
    file: DeepgramPrerecordedSource,
    options?: DeepgramPrerecordedOptions
  ) => Promise<void>;
};
```

</details>

---

### `useDeepgramTextToSpeech`

<details>
<summary>Example – one-shot synthesis</summary>

```tsx
const { synthesize } = useDeepgramTextToSpeech({
  onSynthesizeSuccess: () => console.log('Audio played successfully'),
  onSynthesizeError: (error) => console.error('TTS error:', error),
});

<Button
  title="Speak Text"
  onPress={() => synthesize('Hello from Deepgram!')}
/>;
```

</details>

<details>
<summary>Example – streaming with continuous text</summary>

```tsx
const { startStreaming, sendText, stopStreaming } = useDeepgramTextToSpeech({
  onStreamStart: () => console.log('Stream started'),
  onStreamEnd: () => console.log('Stream ended'),
  onStreamError: (error) => console.error('Stream error:', error),
});

// Start streaming with initial text
<Button
  title="Start Stream"
  onPress={() => startStreaming('This is the first message.')}
/>

// Send additional text to the same stream
<Button
  title="Send More Text"
  onPress={() => sendText('And this is a follow-up message.')}
/>

// Stop the stream
<Button title="Stop Stream" onPress={stopStreaming} />
```

</details>

#### Properties

| Name                  | Type                             | Description                                        | Default |
| --------------------- | -------------------------------- | -------------------------------------------------- | ------- |
| `onBeforeSynthesize`  | `() => void`                     | Called before HTTP synthesis begins                | –       |
| `onSynthesizeSuccess` | `(audio: ArrayBuffer) => void`   | Called when HTTP synthesis completes successfully  | –       |
| `onSynthesizeError`   | `(error: unknown) => void`       | Called if HTTP synthesis fails                     | –       |
| `onBeforeStream`      | `() => void`                     | Called before WebSocket stream starts              | –       |
| `onStreamStart`       | `() => void`                     | Called when WebSocket connection opens             | –       |
| `onAudioChunk`        | `(chunk: ArrayBuffer) => void`   | Called for each audio chunk received via WebSocket | –       |
| `onStreamError`       | `(error: unknown) => void`       | Called on WebSocket streaming errors               | –       |
| `onStreamEnd`         | `() => void`                     | Called when WebSocket stream ends                  | –       |
| `options`             | `UseDeepgramTextToSpeechOptions` | TTS configuration options                          | `{}`    |

#### Methods

| Name             | Signature                         | Description                                                |
| ---------------- | --------------------------------- | ---------------------------------------------------------- |
| `synthesize`     | `(text: string) => Promise<void>` | Generate and play audio for text using HTTP API (one-shot) |
| `startStreaming` | `(text: string) => Promise<void>` | Start WebSocket stream and send initial text               |
| `sendText`       | `(text: string) => boolean`       | Send additional text to active WebSocket stream            |
| `stopStreaming`  | `() => void`                      | Close WebSocket stream and stop audio playback             |

#### Options

| Name             | Type              | Description                                  | Default              |
| ---------------- | ----------------- | -------------------------------------------- | -------------------- |
| `model`          | `string`          | TTS model to use                             | `'aura-2-thalia-en'` |
| `sampleRate`     | `number`          | Audio sample rate (8000, 16000, 24000, etc.) | `16000`              |
| `bitRate`        | `number`          | Audio bit rate                               | –                    |
| `callback`       | `string`          | Webhook URL for completion notifications     | –                    |
| `callbackMethod` | `'POST' \| 'PUT'` | HTTP method for webhook                      | –                    |
| `mipOptOut`      | `boolean`         | Opt out of Model Improvement Program         | –                    |

<details>
<summary>Types</summary>

```ts
export interface UseDeepgramTextToSpeechOptions {
  model?: string;
  sampleRate?: number;
  bitRate?: number;
  callback?: string;
  callbackMethod?: 'POST' | 'PUT' | string;
  mipOptOut?: boolean;
}

export interface UseDeepgramTextToSpeechProps {
  onBeforeSynthesize?: () => void;
  onSynthesizeSuccess?: (audio: ArrayBuffer) => void;
  onSynthesizeError?: (error: unknown) => void;
  onBeforeStream?: () => void;
  onStreamStart?: () => void;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  onStreamError?: (error: unknown) => void;
  onStreamEnd?: () => void;
  options?: UseDeepgramTextToSpeechOptions;
}

export interface UseDeepgramTextToSpeechReturn {
  synthesize: (text: string) => Promise<void>;
  startStreaming: (text: string) => Promise<void>;
  sendText: (text: string) => boolean;
  stopStreaming: () => void;
}
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
- ✅ Text-to-Speech (HTTP synthesis + WebSocket streaming)
- ✅ Text Intelligence (summaries, topics, sentiment, intents)
- ✅ Management API wrapper
- 🚧 Detox E2E tests for the example app

---

## Contributing

Issues / PRs welcome—see **CONTRIBUTING.md**.

---

## License

MIT
