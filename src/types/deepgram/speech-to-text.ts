import type {
  DeepgramCallbackMethod,
  DeepgramCustomMode,
  DeepgramReconnectOptions,
} from './shared';

/**
 * Audio encoding formats supported by Deepgram's Live Listen API.
 * @see https://developers.deepgram.com/docs/encoding
 */
export type DeepgramLiveListenEncoding =
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

/**
 * Deepgram speech-to-text models for live streaming.
 * Includes Nova (fast, accurate), Enhanced (better accuracy), and Base models.
 * @see https://developers.deepgram.com/docs/models-overview
 */
export type DeepgramLiveListenModel =
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
  | 'flux-general-en'
  | 'flux-general-multi'
  | (string & {});

/**
 * Types of sensitive information that can be redacted from transcripts.
 */
export type DeepgramLiveListenRedaction =
  | 'pci'
  | 'numbers'
  | 'dates'
  | 'names'
  | 'addresses'
  | 'all'
  | (string & {});

export type DeepgramLiveListenCallbackMethod =
  | 'POST'
  | 'GET'
  | 'PUT'
  | 'DELETE';

/**
 * Diarization model versions available for live streaming. Setting this
 * enables diarization without also passing `diarize`. Streaming supports
 * `v1` and `latest`.
 */
export type DeepgramLiveListenDiarizeModel = 'latest' | 'v1' | (string & {});

/**
 * Configuration options for Deepgram Live Listen (Streaming) sessions.
 * @example
 * ```typescript
 * const options: DeepgramLiveListenOptions = {
 *   model: 'nova-2',
 *   smartFormat: true,
 *   interimResults: true,
 *   language: 'en-US'
 * };
 * ```
 */
export type DeepgramLiveListenOptions = {
  /** Deepgram real-time API version to use. Defaults to v1. */
  apiVersion?: 'v1' | 'v2';
  /** URL to receive Deepgram's callback. */
  callback?: string;
  /** HTTP method for the callback. Defaults to POST. */
  callbackMethod?: DeepgramLiveListenCallbackMethod;
  /** Number of audio channels in the input. */
  channels?: number;
  /**
   * Enable speaker diarization.
   * @deprecated Use `diarizeModel` instead.
   */
  diarize?: boolean;
  /**
   * Select a diarization model version. Setting this enables diarization
   * without also passing `diarize`. Streaming supports `v1` and `latest`.
   */
  diarizeModel?: DeepgramLiveListenDiarizeModel;
  /**
   * Identify and extract key entities from the submitted audio. Entities
   * appear in final results. Enables punctuation by default.
   */
  detectEntities?: boolean;
  /** Enable dictation intelligence. */
  dictation?: boolean;
  /** Expected encoding for the submitted audio. */
  encoding?: DeepgramLiveListenEncoding;
  /**
   * Controls the endpointing behaviour. Provide a millisecond duration or
   * `false` to disable endpointing entirely.
   */
  endpointing?: number | boolean;
  /** Arbitrary metadata to attach to the response. */
  extra?: Record<string, string | number | boolean>;
  /** Include filler words such as “um” and “uh”. */
  fillerWords?: boolean;
  /** Emit interim transcripts while audio is streaming. */
  interimResults?: boolean;
  /** Key term prompting for Nova-3 and Flux. */
  keyterm?: string | string[];
  /** Keyword boosting/suppression for legacy/non-Nova-3 models. */
  keywords?: string | string[];
  /** Primary spoken language hint (BCP-47). */
  language?: string;
  /**
   * Language hints that constrain and prioritize language detection. Only
   * valid with the `flux-general-multi` model on the v2/Flux API. Pass an
   * array to specify multiple language codes.
   */
  languageHint?: string | string[];
  /** Opt out of the Model Improvement Program. */
  mipOptOut?: boolean;
  /** Convert spoken measurements into abbreviated forms. */
  measurements?: boolean;
  /** Model to use for live transcription. */
  model?: DeepgramLiveListenModel;
  /** Transcribe each channel independently. */
  multichannel?: boolean;
  /** Convert written numbers into numerals. */
  numerals?: boolean;
  /** Enable or disable the profanity filter. */
  profanityFilter?: boolean;
  /** Automatically add punctuation and capitalization. */
  punctuate?: boolean;
  /** Remove sensitive content from transcripts. */
  redact?: DeepgramLiveListenRedaction | DeepgramLiveListenRedaction[];
  /** Replace terms or phrases within the audio. */
  replace?: string | string[];
  /** Sample rate of the submitted audio. */
  sampleRate?: number;
  /** Search for specific terms or phrases. */
  search?: string | string[];
  /** Apply Deepgram smart formatting. */
  smartFormat?: boolean;
  /** Label requests for downstream reporting. */
  tag?: string;
  /**
   * End-of-turn confidence threshold required to emit an eager turn event.
   * Only applies when using the v2/Flux turn-based API.
   */
  eagerEotThreshold?: number;
  /**
   * End-of-turn confidence required to finish a turn when using the v2 API.
   */
  eotThreshold?: number;
  /**
   * Maximum time to wait after speech stops before closing a turn (v2 API).
   */
  eotTimeoutMs?: number;
  /** Delay before emitting an utterance end message, in milliseconds. */
  utteranceEndMs?: number;
  /** Receive speech started events. */
  vadEvents?: boolean;
  /** Request a specific model version. */
  version?: string;
};

export type DeepgramPrerecordedCallbackMethod = DeepgramCallbackMethod;

/**
 * Audio encoding formats supported by Deepgram's Pre-recorded API.
 */
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

export type DeepgramPrerecordedModel = DeepgramLiveListenModel | (string & {});

export type DeepgramPrerecordedRedaction =
  | 'pci'
  | 'pii'
  | 'numbers'
  | (string & {});

/**
 * Diarization model versions available for pre-recorded transcription.
 * Setting this enables diarization without also passing `diarize`. Batch
 * supports `latest`, `v1`, and `v2`.
 */
export type DeepgramPrerecordedDiarizeModel =
  | 'latest'
  | 'v1'
  | 'v2'
  | (string & {});

export type DeepgramPrerecordedCustomMode = DeepgramCustomMode;

export type DeepgramPrerecordedSummarize =
  | boolean
  | 'v1'
  | 'v2'
  | (string & {});

export type DeepgramPrerecordedVersion = 'latest' | (string & {});

export type DeepgramPrerecordedExtra =
  | string
  | string[]
  | Record<string, string | number | boolean>;

/**
 * Configuration options for Deepgram Pre-recorded (File) Transcription.
 * @example
 * ```typescript
 * const options: DeepgramPrerecordedOptions = {
 *   model: 'nova-2',
 *   smartFormat: true,
 *   diarize: true,
 *   summarize: 'v2'
 * };
 * ```
 */
export type DeepgramPrerecordedOptions = {
  /** URL to receive a webhook callback with the completed transcription. */
  callback?: string;
  /** HTTP method to use for the callback request. Defaults to POST. */
  callbackMethod?: DeepgramPrerecordedCallbackMethod;
  /** Arbitrary metadata to attach to the response. */
  extra?: DeepgramPrerecordedExtra;
  /** Analyze sentiment throughout the transcript. */
  sentiment?: boolean;
  /** Summarize the content (accepts boolean or specific summarizer version). */
  summarize?: DeepgramPrerecordedSummarize;
  /** Label requests for downstream usage reporting. */
  tag?: string | string[];
  /** Detect topics within the transcript. */
  topics?: boolean;
  /** Custom topics to detect in addition to Deepgram's defaults. */
  customTopic?: string | string[];
  /** How custom topics are interpreted. */
  customTopicMode?: DeepgramPrerecordedCustomMode;
  /** Detect speaker intents throughout the transcript. */
  intents?: boolean;
  /** Provide custom intents to bias detection. */
  customIntent?: string | string[];
  /** How custom intents are interpreted. */
  customIntentMode?: DeepgramPrerecordedCustomMode;
  /** Extract entities from the supplied audio. */
  detectEntities?: boolean;
  /** Detect the dominant language (or limit detection to specific languages). */
  detectLanguage?: boolean | string | string[];
  /**
   * Enable speaker diarization.
   * @deprecated Use `diarizeModel` instead.
   */
  diarize?: boolean;
  /**
   * Select a diarization model version. Setting this enables diarization
   * without also passing `diarize`. Batch supports `latest`, `v1`, and `v2`.
   */
  diarizeModel?: DeepgramPrerecordedDiarizeModel;
  /** Enable dictation intelligence. */
  dictation?: boolean;
  /** Expected encoding for the submitted audio. */
  encoding?: DeepgramPrerecordedEncoding;
  /** Include filler words such as “um” and “uh”. */
  fillerWords?: boolean;
  /** Key term prompting for Nova-3 and Flux. */
  keyterm?: string | string[];
  /** Keyword boosting/suppression for legacy/non-Nova-3 models. */
  keywords?: string | string[];
  /** Primary spoken language hint (BCP-47). */
  language?: string;
  /** Convert spoken measurements into abbreviations. */
  measurements?: boolean;
  /** Opt out of the Deepgram Model Improvement Program. */
  mipOptOut?: boolean;
  /** Model to use for the transcription. */
  model?: DeepgramPrerecordedModel;
  /** Transcribe each channel independently. */
  multichannel?: boolean;
  /** Convert written numbers into numerals. */
  numerals?: boolean;
  /** Split transcripts into paragraphs. */
  paragraphs?: boolean;
  /** Enable or disable the profanity filter. */
  profanityFilter?: boolean;
  /** Automatically add punctuation and capitalization. */
  punctuate?: boolean;
  /** Remove sensitive content from transcripts. */
  redact?: DeepgramPrerecordedRedaction | DeepgramPrerecordedRedaction[];
  /** Replace specific terms or phrases in the transcript. */
  replace?: string | string[];
  /** Search for specific terms or phrases. */
  search?: string | string[];
  /** Apply Deepgram smart formatting. */
  smartFormat?: boolean;
  /** Return utterance level timestamps. */
  utterances?: boolean;
  /** Configure pause duration for utterance splitting (in seconds). */
  uttSplit?: number;
  /** Request a specific model version. */
  version?: DeepgramPrerecordedVersion;
};

/**
 * Source input for pre-recorded transcription.
 * Can be a File/Blob, a local file URI, or a remote URL.
 */
export type DeepgramPrerecordedSource =
  | Blob
  | { uri: string; name?: string; type?: string }
  | { url: string }
  | string;

/**
 * Event data accompanying a transcript update.
 */
export type DeepgramTranscriptEvent = {
  /** Indicates whether the transcript represents a finalized utterance. */
  isFinal?: boolean;
  /** Raw payload received from Deepgram for custom handling or inspection. */
  raw?: unknown;
  /** Metadata about the transcript (e.g. confidence, timing). */
  metadata?: Record<string, unknown>;
};

/**
 * Props for the `useDeepgramSpeechToText` hook.
 */
export type UseDeepgramSpeechToTextProps = {
  /** Called before any setup (e.g. before permission prompt) */
  onBeforeStart?: () => void;
  /** Called once the WebSocket is open */
  onStart?: () => void;
  /** Called on every transcript update */
  onTranscript?: (transcript: string, event?: DeepgramTranscriptEvent) => void;
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
  /** Default query parameters for live streaming sessions. */
  live?: DeepgramLiveListenOptions;
  /** Default options for pre-recorded transcription requests. */
  prerecorded?: DeepgramPrerecordedOptions;

  /** Enable internal state tracking. @default false */
  trackState?: boolean;

  /** Automatically accumulate transcript results. @default false */
  trackTranscript?: boolean;

  /**
   * Microphone audio-level (metering) configuration. When enabled the native
   * module emits a normalized RMS amplitude (0..1) while recording, surfaced
   * via {@link UseDeepgramSpeechToTextReturn.audioLevel} (when `trackState` is
   * on) and the {@link onAudioLevel} callback. Disabled by default.
   */
  metering?: {
    /** Enable audio-level events while listening. @default false */
    enabled?: boolean;
    /** Minimum interval between level events, in ms. @default 100 */
    intervalMs?: number;
  };
  /**
   * Called with the latest microphone audio level (normalized RMS, 0..1) while
   * listening. Only invoked when `metering.enabled` is true.
   */
  onAudioLevel?: (level: number) => void;

  /**
   * Auto-reconnect configuration for the live streaming socket. Disabled by
   * default; set `reconnect.enabled` to opt in.
   */
  reconnect?: DeepgramReconnectOptions;
  /** Called when a reconnect attempt begins (1-based attempt number). */
  onReconnecting?: (attempt: number) => void;
  /** Called once the live socket has successfully reconnected. */
  onReconnected?: () => void;
};

/**
 * Return value of the `useDeepgramSpeechToText` hook.
 */
export type UseDeepgramSpeechToTextReturn = {
  /** Begin capturing mic audio and streaming to Deepgram STT */
  startListening: (options?: DeepgramLiveListenOptions) => Promise<void>;
  /** Stop the mic capture & close connection */
  stopListening: () => void;
  /** Transcribe a file (e.g. audio file) using Deepgram */
  transcribeFile: (
    file: DeepgramPrerecordedSource,
    options?: DeepgramPrerecordedOptions
  ) => Promise<void>;
  /**
   * Pause streaming: stop forwarding mic frames without tearing down the
   * socket. Sends `Finalize` once (v1) to flush buffered audio and starts a
   * periodic `KeepAlive` so the connection survives the pause.
   */
  pause: () => void;
  /** Resume streaming after {@link pause}: forward mic frames again. */
  resume: () => void;
  /** Current state of the transcription session (if trackState is enabled) */
  state?: {
    status: 'idle' | 'loading' | 'listening' | 'transcribing' | 'error';
    error: Error | null;
  };
  /** Whether streaming is currently paused (only returned when trackState is enabled) */
  isPaused?: boolean;
  /**
   * Latest microphone audio level (normalized RMS, 0..1). Only returned when
   * both `trackState` and `metering.enabled` are on; updates at most once per
   * `metering.intervalMs` while listening.
   */
  audioLevel?: number;
  /** Final accumulated transcript (only returned when trackTranscript is enabled) */
  transcript?: string;
  /** Interim/partial transcript (only returned when trackTranscript is enabled for live) */
  interimTranscript?: string;
};
