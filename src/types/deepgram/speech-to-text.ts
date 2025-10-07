import type { DeepgramCallbackMethod, DeepgramCustomMode } from './shared';

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
  | (string & {});

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

export type DeepgramLiveListenOptions = {
  /** Deepgram real-time API version to use. Defaults to v1. */
  apiVersion?: 'v1' | 'v2';
  /** URL to receive Deepgram's callback. */
  callback?: string;
  /** HTTP method for the callback. Defaults to POST. */
  callbackMethod?: DeepgramLiveListenCallbackMethod;
  /** Number of audio channels in the input. */
  channels?: number;
  /** Enable speaker diarization. */
  diarize?: boolean;
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
  /** Key term prompting (Nova-3 only). */
  keyterm?: string | string[];
  /** Keyword boosting/suppression. */
  keywords?: string | string[];
  /** Primary spoken language hint (BCP-47). */
  language?: string;
  /** Opt out of the Model Improvement Program. */
  mipOptOut?: boolean;
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
  /** Enable speaker diarization. */
  diarize?: boolean;
  /** Enable dictation intelligence. */
  dictation?: boolean;
  /** Expected encoding for the submitted audio. */
  encoding?: DeepgramPrerecordedEncoding;
  /** Include filler words such as “um” and “uh”. */
  fillerWords?: boolean;
  /** Key term prompting (Nova-3 only). */
  keyterm?: string | string[];
  /** Keyword boosting/suppression. */
  keywords?: string | string[];
  /** Primary spoken language hint (BCP-47). */
  language?: string;
  /** Convert spoken measurements into abbreviations. */
  measurements?: boolean;
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

export type DeepgramPrerecordedSource =
  | Blob
  | { uri: string; name?: string; type?: string }
  | { url: string }
  | string;

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
  /** Default query parameters for live streaming sessions. */
  live?: DeepgramLiveListenOptions;
  /** Default options for pre-recorded transcription requests. */
  prerecorded?: DeepgramPrerecordedOptions;
};

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
};
