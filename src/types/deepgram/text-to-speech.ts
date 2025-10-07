import type { DeepgramCallbackMethod } from './shared';

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
  | 'linear16'
  | 'mulaw'
  | 'alaw'
  | (string & {});

/** @deprecated Use `DeepgramTextToSpeechHttpEncoding` or `DeepgramTextToSpeechStreamEncoding`. */
export type DeepgramTextToSpeechEncoding = DeepgramTextToSpeechHttpEncoding;

export type DeepgramTextToSpeechSampleRate =
  | 8000
  | 16000
  | 22050
  | 24000
  | 32000
  | 44100
  | 48000
  | (number & {});

export type DeepgramTextToSpeechCallbackMethod = DeepgramCallbackMethod;

export type DeepgramTextToSpeechContainer =
  | 'none'
  | 'wav'
  | 'ogg'
  | (string & {});

export type DeepgramTextToSpeechBitRate = 32000 | 48000 | (number & {});

export interface DeepgramTextToSpeechHttpOptions {
  model?: DeepgramTextToSpeechModel | (string & {});
  encoding?: DeepgramTextToSpeechHttpEncoding;
  sampleRate?: DeepgramTextToSpeechSampleRate;
  container?: DeepgramTextToSpeechContainer;
  /** @deprecated Use `container`. */
  format?: 'mp3' | 'wav' | 'opus' | 'pcm' | (string & {});
  bitRate?: DeepgramTextToSpeechBitRate;
  callback?: string;
  callbackMethod?: DeepgramTextToSpeechCallbackMethod;
  mipOptOut?: boolean;
  queryParams?: Record<string, string | number | boolean>;
}

export interface DeepgramTextToSpeechStreamOptions {
  model?: DeepgramTextToSpeechModel | (string & {});
  encoding?: DeepgramTextToSpeechStreamEncoding;
  sampleRate?: DeepgramTextToSpeechSampleRate;
  mipOptOut?: boolean;
  /** Additional query parameters appended to the streaming URL. */
  queryParams?: Record<string, string | number | boolean>;
  /** Whether to automatically flush after `sendText` (defaults to `true`). */
  autoFlush?: boolean;
}

export interface UseDeepgramTextToSpeechOptions {
  /** @deprecated Use `http.model` / `stream.model` for granular control. */
  model?: DeepgramTextToSpeechModel | (string & {});
  /** @deprecated Use `stream.encoding` for streaming control. */
  encoding?: DeepgramTextToSpeechEncoding;
  /** @deprecated Use `http.sampleRate` / `stream.sampleRate`. */
  sampleRate?: DeepgramTextToSpeechSampleRate;
  /** @deprecated Use `http.bitRate`. */
  bitRate?: DeepgramTextToSpeechBitRate;
  /** @deprecated Use `http.container`. */
  container?: DeepgramTextToSpeechContainer;
  /** @deprecated Use `http.format`. */
  format?: 'mp3' | 'wav' | 'opus' | 'pcm' | (string & {});
  /** @deprecated Use `http.callback`. */
  callback?: string;
  /** @deprecated Use `http.callbackMethod`. */
  callbackMethod?: DeepgramTextToSpeechCallbackMethod;
  /** @deprecated Use `http.mipOptOut` / `stream.mipOptOut`. */
  mipOptOut?: boolean;
  /** Global query parameters merged into both HTTP and WebSocket requests. */
  queryParams?: Record<string, string | number | boolean>;
  /** Fine grained configuration for HTTP synthesis. */
  http?: DeepgramTextToSpeechHttpOptions;
  /** Fine grained configuration for streaming synthesis. */
  stream?: DeepgramTextToSpeechStreamOptions;
}

export type DeepgramTextToSpeechStreamTextMessage = {
  type: 'Text';
  text: string;
  /** Optional identifier for advanced sequencing use cases. */
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

export type DeepgramTextToSpeechStreamInputMessage =
  | DeepgramTextToSpeechStreamTextMessage
  | DeepgramTextToSpeechStreamFlushMessage
  | DeepgramTextToSpeechStreamClearMessage
  | DeepgramTextToSpeechStreamCloseMessage;

export interface DeepgramTextToSpeechStreamMetadataMessage {
  type: 'Metadata';
  request_id: string;
  model_name: string;
  model_version: string;
  model_uuid: string;
}

export interface DeepgramTextToSpeechStreamFlushedMessage {
  type: 'Flushed';
  sequence_id: number;
}

export interface DeepgramTextToSpeechStreamClearedMessage {
  type: 'Cleared';
  sequence_id: number;
}

export type DeepgramTextToSpeechStreamWarningCode =
  | 'TEXT_LENGTH_WARNING'
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

export type DeepgramTextToSpeechStreamResponseMessage =
  | DeepgramTextToSpeechStreamMetadataMessage
  | DeepgramTextToSpeechStreamFlushedMessage
  | DeepgramTextToSpeechStreamClearedMessage
  | DeepgramTextToSpeechStreamWarningMessage
  | DeepgramTextToSpeechStreamErrorMessage
  | ({ type: string } & Record<string, unknown>);

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
  /** Emitted when Deepgram sends metadata for the stream. */
  onStreamMetadata?: (
    metadata: DeepgramTextToSpeechStreamMetadataMessage
  ) => void;
  /** Emitted after a flush completes with its corresponding sequence id. */
  onStreamFlushed?: (event: DeepgramTextToSpeechStreamFlushedMessage) => void;
  /** Emitted after a buffer clear completes with its corresponding sequence id. */
  onStreamCleared?: (event: DeepgramTextToSpeechStreamClearedMessage) => void;
  /** Emitted when Deepgram warns about the current request. */
  onStreamWarning?: (warning: DeepgramTextToSpeechStreamWarningMessage) => void;

  /** Shared options that apply to both HTTP and WebSocket flows. */
  options?: UseDeepgramTextToSpeechOptions;
};

export type UseDeepgramTextToSpeechReturn = {
  /** One-shot HTTP request that resolves when the full audio is ready. */
  synthesize: (text: string) => Promise<ArrayBuffer>;
  /** Opens a WebSocket and begins streaming audio chunks in real-time. */
  startStreaming: (text: string) => Promise<void>;
  /** Send arbitrary control messages to the active WebSocket stream. */
  sendMessage: (message: DeepgramTextToSpeechStreamInputMessage) => boolean;
  /**
   * Send additional text to an existing WebSocket stream.
   * Optionally override auto-flush behaviour or provide a sequence id.
   */
  sendText: (
    text: string,
    options?: { flush?: boolean; sequenceId?: number }
  ) => boolean;
  /** Manually flush the buffered text and receive generated audio. */
  flushStream: () => boolean;
  /** Clear buffered text without closing the socket. */
  clearStream: () => boolean;
  /** Ask Deepgram to gracefully close the stream after finishing audio. */
  closeStreamGracefully: () => boolean;
  /** Forcefully close the WebSocket stream and release resources. */
  stopStreaming: () => void;
};
