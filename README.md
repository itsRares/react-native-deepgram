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
<summary>Example – single request (HTTP)</summary>

```tsx
const { synthesize } = useDeepgramTextToSpeech({
  options: {
    http: {
      model: 'aura-2-asteria-en',
      encoding: 'mp3',
      bitRate: 48000,
      container: 'none',
    },
  },
  onSynthesizeSuccess: (buffer) => {
    // Persist the returned ArrayBuffer or feed it into a custom player
    console.log('Received bytes', buffer.byteLength);
  },
});

await synthesize('Hello from Deepgram!');
```

</details>

<details>
<summary>Example – streaming (WebSocket)</summary>

```tsx
const {
  startStreaming,
  sendText,
  flushStream,
  clearStream,
  closeStreamGracefully,
  stopStreaming,
} = useDeepgramTextToSpeech({
  options: {
    stream: {
      encoding: 'linear16',
      sampleRate: 24000,
      autoFlush: false,
    },
  },
  onAudioChunk: (chunk) => console.log('Audio chunk', chunk.byteLength),
  onStreamMetadata: (meta) => console.log(meta.model_name),
});

await startStreaming('Booting stream…');
sendText('Queue another sentence', { sequenceId: 1 });
flushStream();
closeStreamGracefully();
```

</details>

#### Properties

| Name | Type | Description |
| --- | --- | --- |
| `onBeforeSynthesize` | `() => void` | Called before dispatching an HTTP synthesis request. |
| `onSynthesizeSuccess` | `(audio: ArrayBuffer) => void` | Called with the raw audio bytes when the HTTP request succeeds. |
| `onSynthesizeError` | `(error: unknown) => void` | Fired if the HTTP request fails. |
| `onBeforeStream` | `() => void` | Called prior to opening the WebSocket stream. |
| `onStreamStart` | `() => void` | Fired once the socket is open and the initial text has been queued. |
| `onAudioChunk` | `(chunk: ArrayBuffer) => void` | Called for each PCM chunk received from the stream. |
| `onStreamMetadata` | `(metadata: DeepgramTextToSpeechStreamMetadataMessage) => void` | Emits metadata describing the current stream. |
| `onStreamFlushed` | `(event: DeepgramTextToSpeechStreamFlushedMessage) => void` | Raised when Deepgram confirms a flush. |
| `onStreamCleared` | `(event: DeepgramTextToSpeechStreamClearedMessage) => void` | Raised when Deepgram confirms a clear operation. |
| `onStreamWarning` | `(warning: DeepgramTextToSpeechStreamWarningMessage) => void` | Raised when Deepgram emits a warning about the stream. |
| `onStreamError` | `(error: unknown) => void` | Fired when the WebSocket errors. |
| `onStreamEnd` | `() => void` | Fired when the stream closes (gracefully or otherwise). |
| `options` | `UseDeepgramTextToSpeechOptions` | Global/default configuration for HTTP and streaming parameters. |

#### Methods

| Name | Signature | Description |
| --- | --- | --- |
| `synthesize` | `(text: string) => Promise<ArrayBuffer>` | Send a single piece of text via REST and resolve with the returned audio bytes. |
| `startStreaming` | `(text: string) => Promise<void>` | Open the streaming WebSocket and queue the first message. |
| `sendText` | `(text: string, options?: { flush?: boolean; sequenceId?: number }) => boolean` | Push additional text frames into the active stream. Optionally suppress automatic flushing or supply a sequence id. |
| `flushStream` | `() => boolean` | Request Deepgram to emit all buffered audio immediately. |
| `clearStream` | `() => boolean` | Clear the buffered text/audio without closing the socket. |
| `closeStreamGracefully` | `() => boolean` | Ask Deepgram to finish outstanding audio then close the stream. |
| `stopStreaming` | `() => void` | Force-close the socket and reset playback. |

<details>
<summary>Types</summary>

```ts
import type {
  DeepgramTextToSpeechModel,
  DeepgramTextToSpeechHttpEncoding,
  DeepgramTextToSpeechStreamEncoding,
  DeepgramTextToSpeechSampleRate,
  DeepgramTextToSpeechCallbackMethod,
  DeepgramTextToSpeechContainer,
  DeepgramTextToSpeechBitRate,
  DeepgramTextToSpeechHttpOptions,
  DeepgramTextToSpeechStreamOptions,
  DeepgramTextToSpeechStreamMetadataMessage,
  DeepgramTextToSpeechStreamFlushedMessage,
  DeepgramTextToSpeechStreamClearedMessage,
  DeepgramTextToSpeechStreamWarningMessage,
  UseDeepgramTextToSpeechOptions,
} from 'react-native-deepgram';
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
