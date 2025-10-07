# react-native-deepgram

[![npm version](https://badge.fury.io/js/react-native-deepgram.svg)](https://badge.fury.io/js/react-native-deepgram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**react-native-deepgram** brings Deepgram's AI platform to React Native & Expo.

> ✅ Supports **Speech-to-Text v1** and the new **Speech-to-Text v2 (Flux)** streaming API alongside Text-to-Speech, Text Intelligence, and the Management API.

## Table of contents

1. [Features](#features)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Usage overview](#usage-overview)
5. [Speech-to-Text](#speech-to-text-usedeepragramspeechtotext)
6. [Text-to-Speech](#text-to-speech-usedeepragramtexttospeech)
7. [Text Intelligence](#text-intelligence-usedeepragramtextintelligence)
8. [Management API](#management-api-usedeepragrammanagement)
9. [Example app](#example-app)
10. [Roadmap](#roadmap)
11. [Contributing](#contributing)
12. [License](#license)

---

## Features

- 🔊 **Live Speech-to-Text** – capture PCM audio and stream it over WebSocket (STT v1 or v2/Flux).
- 📄 **File Transcription** – send audio files/URIs to Deepgram and receive transcripts.
- 🎤 **Text-to-Speech** – synthesize speech with HTTP requests or WebSocket streaming controls.
- 🧠 **Text Intelligence** – summarisation, topic detection, intents, sentiment and more.
- 🛠️ **Management API** – list models, keys, usage, projects, balances, etc.
- ⚙️ **Expo config plugin** – automatic native configuration for managed and bare workflows.

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
> Do not ship production keys in source control—prefer environment variables, Expo secrets, or a backend proxy.

---

## Usage overview

| Hook                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `useDeepgramSpeechToText`     | Live microphone streaming and file transcription     |
| `useDeepgramTextToSpeech`     | Text-to-Speech synthesis (HTTP + WebSocket streaming) |
| `useDeepgramTextIntelligence` | Text analysis (summaries, topics, intents, sentiment) |
| `useDeepgramManagement`       | Typed wrapper around the Management REST API         |

---

## Speech-to-Text (`useDeepgramSpeechToText`)

The speech hook streams microphone audio using WebSockets and can also transcribe prerecorded audio sources. It defaults to STT v1 but automatically boots into Flux when `apiVersion: 'v2'` is supplied (defaulting the model to `flux-general-en`).

### Live streaming quick start

```tsx
const { startListening, stopListening } = useDeepgramSpeechToText({
  onTranscript: console.log,
  live: {
    apiVersion: 'v2',
    model: 'flux-general-en',
    punctuate: true,
    eotThreshold: 0.55,
  },
});

<Button
  title="Start"
  onPress={() => startListening({ keywords: ['Deepgram'] })}
/>
<Button title="Stop" onPress={stopListening} />
```

> 💡 When you opt into `apiVersion: 'v2'` the hook automatically selects `flux-general-en` if you do not provide a model.

### File transcription quick start

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

### API reference

#### Hook props

| Prop                   | Type                           | Description                                                     |
| ---------------------- | ------------------------------ | --------------------------------------------------------------- |
| `onBeforeStart`        | `() => void`                   | Invoked before requesting mic permissions or starting a stream. |
| `onStart`              | `() => void`                   | Fired once the WebSocket opens.                                 |
| `onTranscript`         | `(transcript: string) => void` | Called for every transcript update (partial and final).         |
| `onError`              | `(error: unknown) => void`     | Receives streaming errors.                                      |
| `onEnd`                | `() => void`                   | Fired when the socket closes.                                   |
| `onBeforeTranscribe`   | `() => void`                   | Called before posting a prerecorded transcription request.      |
| `onTranscribeSuccess`  | `(transcript: string) => void` | Receives the final transcript for prerecorded audio.            |
| `onTranscribeError`    | `(error: unknown) => void`     | Fired if prerecorded transcription fails.                       |
| `live`                 | `DeepgramLiveListenOptions`    | Default options merged into every live stream.                  |
| `prerecorded`          | `DeepgramPrerecordedOptions`   | Default options merged into every file transcription.           |

#### Returned methods

| Method             | Signature                                                                        | Description                                                                 |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `startListening`   | `(options?: DeepgramLiveListenOptions) => Promise<void>`                         | Requests mic access, starts recording, and streams audio to Deepgram.       |
| `stopListening`    | `() => void`                                                                     | Stops recording and closes the active WebSocket.                            |
| `transcribeFile`   | `(file: DeepgramPrerecordedSource, options?: DeepgramPrerecordedOptions) => Promise<void>` | Uploads a file/URI/URL and resolves via the success/error callbacks. |

#### Live transcription options (`DeepgramLiveListenOptions`)

<details>
<summary>Expand all live streaming parameters</summary>

| Option               | Type                                                     | Purpose                                                                                     | Default                            |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| `apiVersion`         | `'v1' \| 'v2'`                                           | Selects the realtime API generation (`'v2'` unlocks Flux streaming).                        | `'v1'`                             |
| `callback`           | `string`                                                 | Webhook URL invoked when the stream finishes.                                               | –                                  |
| `callbackMethod`     | `'POST' \| 'GET' \| 'PUT' \| 'DELETE'`                   | HTTP verb Deepgram should use for `callback`.                                               | `'POST'`                           |
| `channels`           | `number`                                                 | Number of audio channels in the input.                                                      | –                                  |
| `diarize`            | `boolean`                                                | Separate speakers into individual tracks.                                                   | Disabled                           |
| `dictation`          | `boolean`                                                | Enable dictation features (punctuation, formatting).                                        | Disabled                           |
| `encoding`           | `DeepgramLiveListenEncoding`                             | Audio codec supplied to Deepgram.                                                           | `'linear16'`                       |
| `endpointing`        | `number \| boolean`                                     | Control endpoint detection (`false` disables).                                              | –                                  |
| `extra`              | `Record<string, string \| number \| boolean>`           | Attach custom metadata returned with the response.                                          | –                                  |
| `fillerWords`        | `boolean`                                                | Include filler words such as "um"/"uh".                                                    | Disabled                           |
| `interimResults`     | `boolean`                                                | Emit interim (non-final) transcripts.                                                       | Disabled                           |
| `keyterm`            | `string \| string[]`                                    | Provide key terms to bias Nova-3 transcription.                                             | –                                  |
| `keywords`           | `string \| string[]`                                    | Boost or suppress keywords.                                                                 | –                                  |
| `language`           | `string`                                                 | BCP-47 language hint (e.g. `en-US`).                                                        | Auto                               |
| `mipOptOut`          | `boolean`                                                | Opt out of the Model Improvement Program.                                                   | Disabled                           |
| `model`              | `DeepgramLiveListenModel`                               | Streaming model to request.                                                                 | `'nova-2'` (v1) / `'flux-general-en'` (v2) |
| `multichannel`       | `boolean`                                                | Transcribe each channel independently.                                                      | Disabled                           |
| `numerals`           | `boolean`                                                | Convert spoken numbers into digits.                                                         | Disabled                           |
| `profanityFilter`    | `boolean`                                                | Remove profanity from transcripts.                                                          | Disabled                           |
| `punctuate`          | `boolean`                                                | Auto-insert punctuation and capitalization.                                                 | Disabled                           |
| `redact`             | `DeepgramLiveListenRedaction \| DeepgramLiveListenRedaction[]` | Remove sensitive content such as PCI data.                                           | –                                  |
| `replace`            | `string \| string[]`                                    | Replace specific terms in the output.                                                       | –                                  |
| `sampleRate`         | `number`                                                 | Sample rate of the PCM audio being sent.                                                    | `16000`                            |
| `search`             | `string \| string[]`                                    | Return timestamps for search terms.                                                         | –                                  |
| `smartFormat`        | `boolean`                                                | Apply Deepgram smart formatting.                                                            | Disabled                           |
| `tag`                | `string`                                                 | Label the request for reporting.                                                            | –                                  |
| `eagerEotThreshold`  | `number`                                                 | Confidence required to emit an eager turn (Flux only).                                      | –                                  |
| `eotThreshold`       | `number`                                                 | Confidence required to finalise a turn (Flux only).                                         | –                                  |
| `eotTimeoutMs`       | `number`                                                 | Silence timeout before closing a turn (Flux only).                                          | –                                  |
| `utteranceEndMs`     | `number`                                                 | Delay before emitting an utterance end event.                                               | –                                  |
| `vadEvents`          | `boolean`                                                | Emit voice activity detection events.                                                       | Disabled                           |
| `version`            | `string`                                                 | Request a specific model version.                                                           | –                                  |

</details>

#### Prerecorded transcription options (`DeepgramPrerecordedOptions`)

<details>
<summary>Expand all prerecorded transcription parameters</summary>

| Option             | Type                                              | Purpose                                                                 | Default                 |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| `callback`         | `string`                                          | Webhook URL invoked once transcription finishes.                       | –                       |
| `callbackMethod`   | `DeepgramPrerecordedCallbackMethod`               | HTTP verb used for `callback`.                                         | `'POST'`                |
| `extra`            | `DeepgramPrerecordedExtra`                        | Metadata returned with the response.                                   | –                       |
| `sentiment`        | `boolean`                                         | Run sentiment analysis.                                                | Disabled                |
| `summarize`        | `DeepgramPrerecordedSummarize`                    | Request AI summaries (`true`, `'v1'`, or `'v2'`).                       | Disabled                |
| `tag`              | `string \| string[]`                             | Label the request.                                                     | –                       |
| `topics`           | `boolean`                                         | Detect topics.                                                         | Disabled                |
| `customTopic`      | `string \| string[]`                             | Provide additional topics to monitor.                                  | –                       |
| `customTopicMode`  | `DeepgramPrerecordedCustomMode`                  | Interpret `customTopic` as `'extended'` or `'strict'`.                 | `'extended'`            |
| `intents`          | `boolean`                                         | Detect intents.                                                        | Disabled                |
| `customIntent`     | `string \| string[]`                             | Provide custom intents to bias detection.                              | –                       |
| `customIntentMode` | `DeepgramPrerecordedCustomMode`                  | Interpret `customIntent` as `'extended'` or `'strict'`.                | `'extended'`            |
| `detectEntities`   | `boolean`                                         | Extract entities (names, places, etc.).                                | Disabled                |
| `detectLanguage`   | `boolean \| string \| string[]`                 | Auto-detect language or limit detection.                               | Disabled                |
| `diarize`          | `boolean`                                         | Enable speaker diarisation.                                            | Disabled                |
| `dictation`        | `boolean`                                         | Enable dictation formatting.                                           | Disabled                |
| `encoding`         | `DeepgramPrerecordedEncoding`                     | Encoding/codec of the uploaded audio.                                  | –                       |
| `fillerWords`      | `boolean`                                         | Include filler words.                                                  | Disabled                |
| `keyterm`          | `string \| string[]`                             | Provide key terms to bias Nova-3.                                      | –                       |
| `keywords`         | `string \| string[]`                             | Boost or suppress keywords.                                            | –                       |
| `language`         | `string`                                          | Primary spoken language hint (BCP-47).                                 | Auto                    |
| `measurements`     | `boolean`                                         | Convert measurements into abbreviations.                               | Disabled                |
| `model`            | `DeepgramPrerecordedModel`                        | Model to use for transcription.                                        | API default             |
| `multichannel`     | `boolean`                                         | Transcribe each channel independently.                                 | Disabled                |
| `numerals`         | `boolean`                                         | Convert spoken numbers into digits.                                    | Disabled                |
| `paragraphs`       | `boolean`                                         | Split transcript into paragraphs.                                      | Disabled                |
| `profanityFilter`  | `boolean`                                         | Remove profanity from the transcript.                                  | Disabled                |
| `punctuate`        | `boolean`                                         | Auto-insert punctuation and capitalisation.                            | Disabled                |
| `redact`           | `DeepgramPrerecordedRedaction \| DeepgramPrerecordedRedaction[]` | Remove sensitive content (PCI/PII).                                    | –                       |
| `replace`          | `string \| string[]`                             | Replace specific terms in the output.                                  | –                       |
| `search`           | `string \| string[]`                             | Return timestamps for search terms.                                    | –                       |
| `smartFormat`      | `boolean`                                         | Apply Deepgram smart formatting.                                       | Disabled                |
| `utterances`       | `boolean`                                         | Return utterance-level timestamps.                                     | Disabled                |
| `uttSplit`         | `number`                                          | Pause duration (seconds) used to split utterances.                     | –                       |
| `version`          | `DeepgramPrerecordedVersion`                      | Request a specific model version (e.g. `'latest'`).                    | API default (`'latest'`) |

</details>

---

## Text-to-Speech (`useDeepgramTextToSpeech`)

Generate audio via a single HTTP call or stream interactive responses over WebSocket. The hook exposes granular configuration for both request paths.

### HTTP synthesis quick start

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
    console.log('Received bytes', buffer.byteLength);
  },
});

await synthesize('Hello from Deepgram!');
```

### Streaming quick start

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
      model: 'aura-2-asteria-en',
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

### API reference

#### Hook props

| Prop                 | Type                                                                  | Description                                                                 |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `onBeforeSynthesize` | `() => void`                                                          | Called before dispatching an HTTP synthesis request.                        |
| `onSynthesizeSuccess`| `(audio: ArrayBuffer) => void`                                        | Receives the raw audio bytes when the HTTP request succeeds.                |
| `onSynthesizeError`  | `(error: unknown) => void`                                            | Fired if the HTTP request fails.                                            |
| `onBeforeStream`     | `() => void`                                                          | Called prior to opening the WebSocket stream.                               |
| `onStreamStart`      | `() => void`                                                          | Fired once the socket is open and ready.                                    |
| `onAudioChunk`       | `(chunk: ArrayBuffer) => void`                                        | Called for each PCM chunk received from the stream.                         |
| `onStreamMetadata`   | `(metadata: DeepgramTextToSpeechStreamMetadataMessage) => void`       | Emits metadata describing the current stream.                               |
| `onStreamFlushed`    | `(event: DeepgramTextToSpeechStreamFlushedMessage) => void`           | Raised when Deepgram confirms a flush.                                      |
| `onStreamCleared`    | `(event: DeepgramTextToSpeechStreamClearedMessage) => void`           | Raised when Deepgram confirms a clear.                                      |
| `onStreamWarning`    | `(warning: DeepgramTextToSpeechStreamWarningMessage) => void`         | Raised when Deepgram warns about the stream.                                |
| `onStreamError`      | `(error: unknown) => void`                                            | Fired when the WebSocket errors.                                            |
| `onStreamEnd`        | `() => void`                                                          | Fired when the stream closes (gracefully or otherwise).                     |
| `options`            | `UseDeepgramTextToSpeechOptions`                                     | Default configuration merged into HTTP and streaming requests.              |

#### Returned methods

| Method                | Signature                                                                 | Description                                                                                     |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `synthesize`          | `(text: string) => Promise<ArrayBuffer>`                                  | Sends a single piece of text via REST and resolves with the full audio buffer.                  |
| `startStreaming`      | `(text: string) => Promise<void>`                                         | Opens the streaming WebSocket and queues the first message.                                     |
| `sendMessage`         | `(message: DeepgramTextToSpeechStreamInputMessage) => boolean`            | Sends a raw control message (`Text`, `Flush`, `Clear`, `Close`) to the active stream.           |
| `sendText`            | `(text: string, options?: { flush?: boolean; sequenceId?: number }) => boolean` | Queues additional text frames, optionally suppressing auto-flush or setting a sequence id. |
| `flushStream`         | `() => boolean`                                                           | Requests Deepgram to emit all buffered audio immediately.                                      |
| `clearStream`         | `() => boolean`                                                           | Clears buffered text/audio without closing the socket.                                         |
| `closeStreamGracefully` | `() => boolean`                                                         | Asks Deepgram to finish outstanding audio then close the stream.                               |
| `stopStreaming`       | `() => void`                                                              | Force-closes the socket and releases resources.                                                |

#### Configuration (`UseDeepgramTextToSpeechOptions`)

`UseDeepgramTextToSpeechOptions` mirrors the SDK's structure and is merged into both HTTP and WebSocket requests.

<details>
<summary>Global options</summary>

| Option        | Type                                             | Applies to       | Purpose                                                                       |
| ------------- | ------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `model`*      | `DeepgramTextToSpeechModel \| (string & {})`     | Both             | Legacy shortcut for selecting a model (prefer per-transport `model`).         |
| `encoding`*   | `DeepgramTextToSpeechEncoding`                   | Both             | Legacy shortcut for selecting encoding (prefer `http.encoding` / `stream.encoding`). |
| `sampleRate`* | `DeepgramTextToSpeechSampleRate`                 | Both             | Legacy shortcut for sample rate (prefer transport-specific overrides).        |
| `bitRate`*    | `DeepgramTextToSpeechBitRate`                    | HTTP             | Legacy shortcut for bit rate.                                                 |
| `container`*  | `DeepgramTextToSpeechContainer`                  | HTTP             | Legacy shortcut for container.                                                |
| `format`*     | `'mp3' \| 'wav' \| 'opus' \| 'pcm' \| (string & {})` | HTTP         | Legacy shortcut for container/format.                                        |
| `callback`*   | `string`                                         | HTTP             | Legacy shortcut for callback URL.                                             |
| `callbackMethod`* | `DeepgramTextToSpeechCallbackMethod`         | HTTP             | Legacy shortcut for callback method.                                          |
| `mipOptOut`*  | `boolean`                                        | Both             | Legacy shortcut for Model Improvement Program opt-out.                        |
| `queryParams` | `Record<string, string \| number \| boolean>`   | Both             | Shared query string parameters appended to all requests.                      |
| `http`        | `DeepgramTextToSpeechHttpOptions`                | HTTP             | Fine-grained HTTP synthesis configuration.                                    |
| `stream`      | `DeepgramTextToSpeechStreamOptions`              | Streaming        | Fine-grained streaming configuration.                                         |

<small>*Marked fields are supported for backwards compatibility but the transport-specific `http`/`stream` options are recommended.</small>

</details>

<details>
<summary>`options.http` (REST synthesis)</summary>

| Option         | Type                                               | Purpose                                                                       |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `model`        | `DeepgramTextToSpeechModel \| (string & {})`       | Select the TTS voice/model.                                                   |
| `encoding`     | `DeepgramTextToSpeechHttpEncoding`                 | Output audio codec.                                                           |
| `sampleRate`   | `DeepgramTextToSpeechSampleRate`                   | Output sample rate in Hz.                                                     |
| `container`    | `DeepgramTextToSpeechContainer`                    | Wrap audio in a container (`'none'`, `'wav'`, `'ogg'`).                       |
| `format`       | `'mp3' \| 'wav' \| 'opus' \| 'pcm' \| (string & {})` | Deprecated alias for `container`.                                             |
| `bitRate`      | `DeepgramTextToSpeechBitRate`                      | Bit rate for compressed formats (e.g. MP3).                                   |
| `callback`     | `string`                                           | Webhook URL invoked after synthesis completes.                                |
| `callbackMethod` | `DeepgramTextToSpeechCallbackMethod`             | HTTP verb used for the callback.                                              |
| `mipOptOut`    | `boolean`                                          | Opt out of the Model Improvement Program.                                     |
| `queryParams`  | `Record<string, string \| number \| boolean>`     | Extra query parameters appended to the request.                               |

</details>

<details>
<summary>`options.stream` (WebSocket streaming)</summary>

| Option       | Type                                               | Purpose                                                                 |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `model`      | `DeepgramTextToSpeechModel \| (string & {})`       | Select the streaming voice/model.                                      |
| `encoding`   | `DeepgramTextToSpeechStreamEncoding`               | Output PCM encoding for streamed chunks.                               |
| `sampleRate` | `DeepgramTextToSpeechSampleRate`                   | Output sample rate in Hz.                                              |
| `mipOptOut`  | `boolean`                                          | Opt out of the Model Improvement Program.                              |
| `queryParams`| `Record<string, string \| number \| boolean>`     | Extra query parameters appended to the streaming URL.                  |
| `autoFlush`  | `boolean`                                          | Automatically flush after each `sendText` call (defaults to `true`).   |

</details>

---

## Text Intelligence (`useDeepgramTextIntelligence`)

Run summarisation, topic detection, intent detection, sentiment analysis, and more over plain text or URLs.

```tsx
const { analyze } = useDeepgramTextIntelligence({
  onAnalyzeSuccess: (result) => console.log(result.summary),
  options: {
    summarize: true,
    topics: true,
    intents: true,
    language: 'en-US',
  },
});

await analyze({ text: 'Deepgram makes voice data useful.' });
```

### Options (`UseDeepgramTextIntelligenceOptions`)

| Option             | Type                                         | Purpose                                                                      |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `summarize`        | `boolean`                                    | Run summarisation on the input.                                              |
| `topics`           | `boolean`                                    | Detect topics.                                                               |
| `customTopic`      | `string \| string[]`                        | Supply additional topics to monitor.                                        |
| `customTopicMode`  | `'extended' \| 'strict'`                    | Interpret custom topics as additive (`extended`) or exact (`strict`).        |
| `intents`          | `boolean`                                    | Detect intents.                                                              |
| `customIntent`     | `string \| string[]`                        | Provide custom intents to bias detection.                                   |
| `customIntentMode` | `'extended' \| 'strict'`                    | Interpret custom intents as additive (`extended`) or exact (`strict`).       |
| `sentiment`        | `boolean`                                    | Run sentiment analysis.                                                      |
| `language`         | `DeepgramTextIntelligenceLanguage`          | BCP-47 language hint (defaults to `'en'`).                                   |
| `callback`         | `string`                                    | Webhook URL invoked after processing completes.                              |
| `callbackMethod`   | `'POST' \| 'PUT' \| (string & {})`          | HTTP method used for the callback.                                           |

---

## Management API (`useDeepgramManagement`)

Receive a fully typed REST client for the Deepgram Management API. No props are required.

```tsx
const dg = useDeepgramManagement();

const projects = await dg.projects.list();
console.log('Projects:', projects.map((p) => p.name));
```

### Snapshot of available groups

| Group      | Representative methods                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| `models`   | `list(includeOutdated?)`, `get(modelId)`                                               |
| `projects` | `list()`, `get(id)`, `delete(id)`, `patch(id, body)`, `listModels(id)`                  |
| `keys`     | `list(projectId)`, `create(projectId, body)`, `get(projectId, keyId)`, `delete(...)`   |
| `usage`    | `listRequests(projectId)`, `getRequest(projectId, requestId)`, `getBreakdown(projectId)` |
| `balances` | `list(projectId)`, `get(projectId, balanceId)`                                         |

_(Plus helpers for `members`, `scopes`, `invitations`, and `purchases`.)_

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
- ✅ Speech-to-Text v2 / Flux streaming support
- ✅ Text-to-Speech (HTTP synthesis + WebSocket streaming)
- ✅ Text Intelligence (summaries, topics, sentiment, intents)
- ✅ Management API wrapper
- 🚧 Detox E2E tests for the example app

---

## Contributing

Issues and PRs are welcome—see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT
