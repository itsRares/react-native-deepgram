import type { DeepgramCallbackMethod } from './shared';
import type { DeepgramInterruptionEvent } from '../../interruption';

/**
 * Deepgram Flux TTS voices (`/v2/speak`), named `flux-{voice}-{language}`.
 * The literals list the English catalog; the template literal accepts the
 * voices of the other 41 languages.
 * @see https://developers.deepgram.com/docs/flux-tts/voices
 */
export type DeepgramFluxTextToSpeechModel =
  | 'flux-hannah-en'
  | 'flux-kit-en'
  | 'flux-alexis-en'
  | 'flux-cliff-en'
  | 'flux-sienna-en'
  | 'flux-cole-en'
  | 'flux-brooke-en'
  | 'flux-colin-en'
  | 'flux-gemma-en'
  | 'flux-haley-en'
  | 'flux-heather-en'
  | 'flux-miles-en'
  | 'flux-sean-en'
  | 'flux-bree-en'
  | 'flux-brittany-en'
  | 'flux-bruce-en'
  | 'flux-conor-en'
  | 'flux-donovan-en'
  | 'flux-drew-en'
  | 'flux-elise-en'
  | 'flux-jack-en'
  | 'flux-kai-en'
  | 'flux-kelsey-en'
  | 'flux-maeve-en'
  | 'flux-marcelo-en'
  | 'flux-marcus-en'
  | 'flux-meena-en'
  | 'flux-meghan-en'
  | 'flux-naveen-en'
  | 'flux-paige-en'
  | 'flux-priya-en'
  | 'flux-rufus-en'
  | 'flux-sharon-en'
  | 'flux-tanner-en'
  | 'flux-wade-en'
  | 'flux-wes-en'
  | `flux-${string}`;

/**
 * Deepgram text-to-speech models: Aura (`/v1/speak`) and Flux TTS
 * (`/v2/speak`). The hook routes `flux-*` models to `/v2/speak`.
 * @see https://developers.deepgram.com/docs/tts-models
 */
export type DeepgramTextToSpeechModel =
  | 'aura-asteria-en'
  | 'aura-luna-en'
  | 'aura-stella-en'
  | 'aura-athena-en'
  | 'aura-hera-en'
  | 'aura-orion-en'
  | 'aura-arcas-en'
  | 'aura-perseus-en'
  | 'aura-angus-en'
  | 'aura-orpheus-en'
  | 'aura-helios-en'
  | 'aura-zeus-en'
  | 'aura-2-amalthea-en'
  | 'aura-2-andromeda-en'
  | 'aura-2-apollo-en'
  | 'aura-2-arcas-en'
  | 'aura-2-aries-en'
  | 'aura-2-asteria-en'
  | 'aura-2-athena-en'
  | 'aura-2-atlas-en'
  | 'aura-2-aurora-en'
  | 'aura-2-callista-en'
  | 'aura-2-cordelia-en'
  | 'aura-2-cora-en'
  | 'aura-2-delia-en'
  | 'aura-2-draco-en'
  | 'aura-2-electra-en'
  | 'aura-2-harmonia-en'
  | 'aura-2-helena-en'
  | 'aura-2-hera-en'
  | 'aura-2-hermes-en'
  | 'aura-2-hyperion-en'
  | 'aura-2-iris-en'
  | 'aura-2-janus-en'
  | 'aura-2-juno-en'
  | 'aura-2-jupiter-en'
  | 'aura-2-luna-en'
  | 'aura-2-mars-en'
  | 'aura-2-minerva-en'
  | 'aura-2-neptune-en'
  | 'aura-2-odysseus-en'
  | 'aura-2-ophelia-en'
  | 'aura-2-orion-en'
  | 'aura-2-orpheus-en'
  | 'aura-2-pandora-en'
  | 'aura-2-phoebe-en'
  | 'aura-2-pluto-en'
  | 'aura-2-saturn-en'
  | 'aura-2-selene-en'
  | 'aura-2-thalia-en'
  | 'aura-2-theia-en'
  | 'aura-2-vesta-en'
  | 'aura-2-zeus-en'
  | 'aura-2-sirio-es'
  | 'aura-2-nestor-es'
  | 'aura-2-carina-es'
  | 'aura-2-celeste-es'
  | 'aura-2-alvaro-es'
  | 'aura-2-diana-es'
  | 'aura-2-aquila-es'
  | 'aura-2-selena-es'
  | 'aura-2-estrella-es'
  | 'aura-2-javier-es'
  | 'aura-2-agustina-es'
  | 'aura-2-antonia-es'
  | 'aura-2-gloria-es'
  | 'aura-2-luciano-es'
  | 'aura-2-olivia-es'
  | 'aura-2-silvia-es'
  | 'aura-2-valerio-es'
  | 'aura-2-elara-de'
  | 'aura-2-aurelia-de'
  | 'aura-2-lara-de'
  | 'aura-2-julius-de'
  | 'aura-2-fabian-de'
  | 'aura-2-kara-de'
  | 'aura-2-viktoria-de'
  | 'aura-2-agathe-fr'
  | 'aura-2-hector-fr'
  | 'aura-2-beatrix-nl'
  | 'aura-2-daphne-nl'
  | 'aura-2-cornelia-nl'
  | 'aura-2-sander-nl'
  | 'aura-2-hestia-nl'
  | 'aura-2-lars-nl'
  | 'aura-2-roman-nl'
  | 'aura-2-rhea-nl'
  | 'aura-2-leda-nl'
  | 'aura-2-melia-it'
  | 'aura-2-elio-it'
  | 'aura-2-flavio-it'
  | 'aura-2-maia-it'
  | 'aura-2-cinzia-it'
  | 'aura-2-cesare-it'
  | 'aura-2-livia-it'
  | 'aura-2-dionisio-it'
  | 'aura-2-demetra-it'
  | 'aura-2-uzume-ja'
  | 'aura-2-ebisu-ja'
  | 'aura-2-fujin-ja'
  | 'aura-2-izanami-ja'
  | 'aura-2-ama-ja'
  | DeepgramFluxTextToSpeechModel
  | (string & {});

export type DeepgramTextToSpeechHttpEncoding =
  | 'linear16'
  | 'flac'
  | 'mulaw'
  | 'alaw'
  | 'mp3'
  | 'opus'
  | 'aac'
  | (string & {});

export type DeepgramTextToSpeechStreamEncoding =
  'linear16' | 'mulaw' | 'alaw' | (string & {});

export type DeepgramTextToSpeechSampleRate =
  8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000 | (number & {});

export type DeepgramTextToSpeechCallbackMethod = DeepgramCallbackMethod;

export type DeepgramTextToSpeechContainer =
  'none' | 'wav' | 'ogg' | (string & {});

export type DeepgramTextToSpeechBitRate = 32000 | 48000 | (number & {});

/**
 * Options for HTTP (REST) text-to-speech requests. `flux-*` models are sent
 * to `/v2/speak`, everything else to `/v1/speak`.
 * @example
 * ```typescript
 * const options: DeepgramTextToSpeechHttpOptions = {
 *   model: 'aura-2-thalia-en',
 *   encoding: 'mp3'
 * };
 * ```
 */
export interface DeepgramTextToSpeechHttpOptions {
  model?: DeepgramTextToSpeechModel;
  encoding?: DeepgramTextToSpeechHttpEncoding;
  sampleRate?: DeepgramTextToSpeechSampleRate;
  container?: DeepgramTextToSpeechContainer;
  bitRate?: DeepgramTextToSpeechBitRate;
  /**
   * Speaking rate multiplier: `0.7`–`1.5` for Aura-2, `0.5`–`1.5` in
   * `0.05` steps for Flux. Defaults to `1` server-side.
   */
  speed?: number;
  /**
   * Flux only (beta): delivery register from `-2` (calm) to `2`
   * (animated). Defaults to `0` server-side.
   */
  expressivity?: number;
  callback?: string;
  callbackMethod?: DeepgramTextToSpeechCallbackMethod;
  mipOptOut?: boolean;
  /** Label(s) attached to the request for usage reporting/identification. */
  tag?: string | string[];
  queryParams?: Record<string, string | number | boolean>;
}

/**
 * Options for WebSocket streaming text-to-speech. `flux-*` models stream
 * from `/v2/speak` (turn-based: `Flush` ends a turn, `interrupt()` cancels
 * it), everything else from `/v1/speak`.
 * @example
 * ```typescript
 * const options: DeepgramTextToSpeechStreamOptions = {
 *   model: 'flux-haley-en',
 *   encoding: 'linear16',
 *   sampleRate: 24000
 * };
 * ```
 */
export interface DeepgramTextToSpeechStreamOptions {
  model?: DeepgramTextToSpeechModel;
  encoding?: DeepgramTextToSpeechStreamEncoding;
  sampleRate?: DeepgramTextToSpeechSampleRate;
  /**
   * Speaking rate multiplier: `0.7`–`1.5` for Aura-2, `0.5`–`1.5` in
   * `0.05` steps for Flux (also adjustable mid-stream with
   * `configureStream`). Defaults to `1` server-side.
   */
  speed?: number;
  /** Flux only (beta): delivery register from `-2` (calm) to `2` (animated). */
  expressivity?: number;
  /** Flux only: label(s) attached to the session for usage reporting. */
  tag?: string | string[];
  mipOptOut?: boolean;
  /** Additional query parameters appended to the streaming URL. */
  queryParams?: Record<string, string | number | boolean>;
  /**
   * Whether to automatically flush after `sendText` (defaults to `true`).
   * On Flux a flush ends the turn, so turn it off when streaming LLM tokens
   * and call `flushStream()` once the reply is complete.
   */
  autoFlush?: boolean;
}

/**
 * Configuration for the `useDeepgramTextToSpeech` hook.
 */
export interface UseDeepgramTextToSpeechOptions {
  /** Query parameters merged into both HTTP and WebSocket requests. */
  queryParams?: Record<string, string | number | boolean>;
  /** Configuration for HTTP synthesis. */
  http?: DeepgramTextToSpeechHttpOptions;
  /** Configuration for streaming synthesis. */
  stream?: DeepgramTextToSpeechStreamOptions;
}

/**
 * Messages sent to the TTS WebSocket. `sequence_id` and `Clear` are Aura
 * (`/v1/speak`) only; `Interrupt` and `Configure` are Flux (`/v2/speak`) only.
 */
export type DeepgramTextToSpeechStreamSpeakMessage = {
  type: 'Speak';
  text: string;
  /** Aura only: identifier echoed back in `Flushed` / `Cleared`. */
  sequence_id?: number;
};

export type DeepgramTextToSpeechStreamFlushMessage = {
  type: 'Flush';
};

export type DeepgramTextToSpeechStreamClearMessage = {
  type: 'Clear';
};

export type DeepgramTextToSpeechStreamCloseMessage = {
  type: 'Close';
};

export type DeepgramTextToSpeechStreamInterruptMessage = {
  type: 'Interrupt';
  /** Playback position from the start of the session's audio. */
  playback_offset?: { type: 'time_ms'; value: number };
};

export type DeepgramTextToSpeechStreamConfigureMessage = {
  type: 'Configure';
  speed?: number;
};

/**
 * Union of all possible messages sent to the TTS WebSocket.
 */
export type DeepgramTextToSpeechStreamInputMessage =
  | DeepgramTextToSpeechStreamSpeakMessage
  | DeepgramTextToSpeechStreamFlushMessage
  | DeepgramTextToSpeechStreamClearMessage
  | DeepgramTextToSpeechStreamCloseMessage
  | DeepgramTextToSpeechStreamInterruptMessage
  | DeepgramTextToSpeechStreamConfigureMessage;

/** Aura (`/v1/speak`) connection metadata. */
export interface DeepgramTextToSpeechStreamMetadataMessage {
  type: 'Metadata';
  request_id: string;
  model_name: string;
  model_version: string;
  model_uuid: string;
}

/** Flux (`/v2/speak`) connection metadata, sent first on every session. */
export interface DeepgramTextToSpeechStreamConnectedMessage {
  type: 'Connected';
  request_id: string;
  model_name?: string;
  model_version?: string;
  model_uuids?: string[];
}

export interface DeepgramTextToSpeechStreamFlushedMessage {
  type: 'Flushed';
  /** Aura only. */
  sequence_id?: number;
  /** Flux only. */
  speech_id?: string;
}

export interface DeepgramTextToSpeechStreamClearedMessage {
  type: 'Cleared';
  sequence_id: number;
}

/** Flux: the first audio of a turn is about to arrive. */
export interface DeepgramTextToSpeechSpeechStartedMessage {
  type: 'SpeechStarted';
  speech_id: string;
}

/** Flux: billing and timing for a completed turn. */
export interface DeepgramTextToSpeechSpeechMetadataMessage {
  type: 'SpeechMetadata';
  speech_id: string;
  audio_duration_ms?: number;
  input_character_count?: number;
  billable_character_count?: number;
  [key: string]: unknown;
}

/** Flux: answer to `Interrupt`. */
export interface DeepgramTextToSpeechSpeechInterruptedMessage {
  type: 'SpeechInterrupted';
  speech_id?: string;
  audio_played_ms: number;
  /** Present when `interrupt()` was given a playback offset. */
  text_spoken?: string;
  text_remaining?: string;
  metadata?: Record<string, unknown>;
}

export type DeepgramTextToSpeechStreamWarningCode =
  | 'TEXT_LENGTH_WARNING'
  | 'NO_ACTIVE_SPEECH'
  | 'INPUT_MARKUP_STRIPPED'
  | (string & {});

export interface DeepgramTextToSpeechStreamWarningMessage {
  type: 'Warning';
  description: string;
  code: DeepgramTextToSpeechStreamWarningCode;
}

export interface DeepgramTextToSpeechStreamErrorMessage {
  type: 'Error';
  description?: string;
  code?: string;
}

/**
 * Union of all possible messages received from the TTS WebSocket
 * (Flux also sends `ConfigureSuccess`, `ConfigureFailure` and
 * `SessionMetadata`).
 */
export type DeepgramTextToSpeechStreamResponseMessage =
  | DeepgramTextToSpeechStreamMetadataMessage
  | DeepgramTextToSpeechStreamConnectedMessage
  | DeepgramTextToSpeechStreamFlushedMessage
  | DeepgramTextToSpeechStreamClearedMessage
  | DeepgramTextToSpeechSpeechStartedMessage
  | DeepgramTextToSpeechSpeechMetadataMessage
  | DeepgramTextToSpeechSpeechInterruptedMessage
  | DeepgramTextToSpeechStreamWarningMessage
  | DeepgramTextToSpeechStreamErrorMessage
  | ({ type: string } & Record<string, unknown>);

/**
 * Synthesized audio returned by `synthesizeToBytes`: the raw audio bytes plus
 * the MIME type describing their container/encoding (from the response
 * `Content-Type`, or derived from the requested format).
 */
export type DeepgramTextToSpeechBytes = {
  /** The synthesized audio as raw bytes. */
  data: ArrayBuffer;
  /** MIME type describing the audio container/encoding (e.g. `audio/mpeg`). */
  mimeType: string;
};

/**
 * Props for the `useDeepgramTextToSpeech` hook.
 */
export type UseDeepgramTextToSpeechProps = {
  /* ---------- Synchronous HTTP (`synthesize`) ---------- */

  /** Called right before the HTTP request is dispatched (e.g. show a spinner). */
  onBeforeSynthesize?: () => void;
  /** Fires when the complete audio file is received. */
  onSynthesizeSuccess?: (audio: ArrayBuffer) => void;
  /** Fires if the HTTP request fails. */
  onSynthesizeError?: (error: unknown) => void;

  /* ---------- Streaming WebSocket (`startStreaming` / `stopStreaming`) ---------- */

  /** Called before opening the WebSocket connection. */
  onBeforeStream?: () => void;
  /** Called once the socket is open and the server is ready. */
  onStreamStart?: () => void;
  /** Called for every binary audio chunk that arrives. */
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  /** Called on any WebSocket or streaming error. */
  onStreamError?: (error: unknown) => void;
  /** Called when the stream ends or the socket closes. */
  onStreamEnd?: () => void;
  /** Emitted when Deepgram sends Aura stream metadata (`Metadata`). */
  onStreamMetadata?: (
    metadata: DeepgramTextToSpeechStreamMetadataMessage
  ) => void;
  /** Emitted after a flush completes. */
  onStreamFlushed?: (event: DeepgramTextToSpeechStreamFlushedMessage) => void;
  /** Emitted after an Aura buffer clear completes. */
  onStreamCleared?: (event: DeepgramTextToSpeechStreamClearedMessage) => void;
  /** Emitted when Deepgram warns about the current request. */
  onStreamWarning?: (warning: DeepgramTextToSpeechStreamWarningMessage) => void;
  /** Flux: a turn's audio starts. */
  onSpeechStarted?: (event: DeepgramTextToSpeechSpeechStartedMessage) => void;
  /** Flux: a turn finished synthesizing (billing and timing). */
  onSpeechMetadata?: (event: DeepgramTextToSpeechSpeechMetadataMessage) => void;
  /**
   * Flux: answer to `interrupt()`, with `text_spoken` / `text_remaining`
   * when a playback offset was passed.
   */
  onSpeechInterrupted?: (
    event: DeepgramTextToSpeechSpeechInterruptedMessage
  ) => void;
  /**
   * Every JSON message from the stream (e.g. Flux `Connected`,
   * `ConfigureSuccess`, `ConfigureFailure`, `SessionMetadata`).
   */
  onStreamMessage?: (
    message: DeepgramTextToSpeechStreamResponseMessage
  ) => void;

  /** Shared options that apply to both HTTP and WebSocket flows. */
  options?: UseDeepgramTextToSpeechOptions;

  /** Automatically handle audio playback (speaker output). @default true */
  autoPlayAudio?: boolean;

  /**
   * Called when the system interrupts audio playback (phone call, Siri,
   * another app taking audio focus). Observability only — the native layer
   * already pauses/resumes playback itself.
   */
  onInterruption?: (event: DeepgramInterruptionEvent) => void;

  /** Enable internal state tracking. @default false */
  trackState?: boolean;
};

/**
 * Return value of the `useDeepgramTextToSpeech` hook.
 */
export type UseDeepgramTextToSpeechReturn = {
  /** One-shot HTTP request that resolves when the full audio is ready. */
  synthesize: (text: string) => Promise<ArrayBuffer>;
  /**
   * Synthesize speech and return the raw audio bytes (plus MIME type) without
   * playing them — useful for persisting/caching audio. Results are cached
   * in-memory (LRU) keyed by the text + resolved format, so repeated identical
   * prompts avoid a duplicate network request. Pass `options` to override the
   * hook's HTTP format per call.
   */
  synthesizeToBytes: (
    text: string,
    options?: DeepgramTextToSpeechHttpOptions
  ) => Promise<DeepgramTextToSpeechBytes>;
  /** Opens a WebSocket and begins streaming audio chunks in real-time. */
  startStreaming: (text: string) => Promise<void>;
  /** Send arbitrary control messages to the active WebSocket stream. */
  sendMessage: (message: DeepgramTextToSpeechStreamInputMessage) => boolean;
  /**
   * Send additional text to an existing WebSocket stream.
   * Optionally override auto-flush behaviour or provide a sequence id
   * (Aura only). Flux text is sent verbatim so streamed tokens keep their
   * spacing; Aura text is trimmed.
   */
  sendText: (
    text: string,
    options?: { flush?: boolean; sequenceId?: number }
  ) => boolean;
  /** Flush buffered text (Aura) or end the current turn (Flux). */
  flushStream: () => boolean;
  /**
   * Discard buffered text without closing the socket. On Flux this is
   * {@link interrupt} without a playback offset.
   */
  clearStream: () => boolean;
  /**
   * Flux only: barge-in. Stops local playback, cancels the active turn and
   * drops audio already in flight. Pass the playback position (from the
   * start of the session's audio) to receive `text_spoken` /
   * `text_remaining` in `onSpeechInterrupted`. Returns `false` on Aura or
   * when not connected.
   */
  interrupt: (options?: { playbackOffsetMs?: number }) => boolean;
  /** Flux only: change `speed` mid-stream (applies at the next segment). */
  configureStream: (options: { speed?: number }) => boolean;
  /** Ask Deepgram to gracefully close the stream after finishing audio. */
  closeStreamGracefully: () => boolean;
  /** Forcefully close the WebSocket stream and release resources. */
  stopStreaming: () => void;

  /** Current state of the TTS session (if trackState is enabled) */
  state?: {
    status: 'idle' | 'loading' | 'connecting' | 'connected' | 'error';
    error: Error | null;
  };
};
