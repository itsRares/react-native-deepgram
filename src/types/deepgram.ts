/** ------------------- UseDeepgramSpeechToText --------------- */

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
  /** Delay before emitting an utterance end message, in milliseconds. */
  utteranceEndMs?: number;
  /** Receive speech started events. */
  vadEvents?: boolean;
  /** Request a specific model version. */
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

export type DeepgramPrerecordedModel = DeepgramLiveListenModel | (string & {});

export type DeepgramPrerecordedRedaction =
  | 'pci'
  | 'pii'
  | 'numbers'
  | (string & {});

export type DeepgramPrerecordedCustomMode = 'extended' | 'strict';

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

/** ------------------- UseDeepgramTextIntelligence --------------- */

export interface UseDeepgramTextIntelligenceOptions {
  /** Whether to run summarization on the input */
  summarize?: boolean;
  /** Whether to detect topics in the text */
  topics?: boolean;
  /** Whether to detect speaker intents */
  intents?: boolean;
  /** Whether to analyze sentiment */
  sentiment?: boolean;
  /** BCP-47 language tag hint (defaults to 'en') */
  language?: string;
  /** Custom topics to detect (single or list of strings) */
  customTopic?: string | string[];
  /** How to interpret `customTopic` ('extended' includes DL-detected topics too) */
  customTopicMode?: 'extended' | 'strict';
  /** URL to receive a webhook callback with the analysis */
  callback?: string;
  /** HTTP method to use for the callback (defaults to 'POST') */
  callbackMethod?: 'POST' | 'PUT' | string;
}

export interface UseDeepgramTextIntelligenceProps {
  /** Called before analysis begins (e.g. show spinner) */
  onBeforeAnalyze?: () => void;
  /** Called with the analysis results on success */
  onAnalyzeSuccess?: (results: any) => void;
  /** Called if the analysis request fails */
  onAnalyzeError?: (error: Error) => void;
  /** Configuration for which analyses to run */
  options?: UseDeepgramTextIntelligenceOptions;
}

export interface UseDeepgramTextIntelligenceReturn {
  /**
   * Analyze the provided input.
   * Pass an object with either `text` (raw string) or `url` (link to text resource).
   */
  analyze: (input: { text?: string; url?: string }) => Promise<void>;
}

/** ------------------- useDeepgramManagement --------------- */

/* ---------- models ---------- */
export interface DeepgramSttModel {
  name: string;
  canonical_name: string;
  architecture: string;
  languages: string[];
  version: string;
  uuid: string;
  batch: boolean;
  streaming: boolean;
  formatted_output: boolean;
}

export interface DeepgramTtsModel {
  name: string;
  canonical_name: string;
  architecture: string;
  languages: string[];
  version: string;
  uuid: string;
  metadata: {
    accent: string;
    age: string;
    color: string;
    image: string;
    sample: string;
    tags: string[];
    use_cases: string[];
  };
}

export interface DeepgramListModelsResponse {
  stt: DeepgramSttModel[] | null;
  tts: DeepgramTtsModel[] | null;
}

export interface DeepgramProject {
  project_id: string;
  name: string;
  created?: string;
  balance?: number;
}

export interface DeepgramKey {
  key_id: string;
  project_id: string;
  comment?: string;
  scopes?: string[];
  created?: string;
}

export interface DeepgramMember {
  member_id: string;
  email: string;
  role: string;
  invited?: boolean;
}

export type DeepgramScope = string;

export interface DeepgramInvitation {
  invitation_id: string;
  project_id: string;
  email: string;
  status?: string;
  created?: string;
}

export interface DeepgramRequest {
  request_id: string;
  project_id: string;
  model_id?: string;
  created?: string;
}

export interface DeepgramUsageField {
  field: string;
  description?: string;
}

export interface DeepgramUsageBreakdown {
  total: number;
  breakdown: Record<string, number>;
}

export interface DeepgramPurchase {
  purchase_id: string;
  project_id: string;
  amount: number;
  created?: string;
}

export interface DeepgramBalance {
  balance_id: string;
  project_id: string;
  balance: number;
  currency?: string;
}

export interface UseDeepgramManagementReturn {
  models: {
    list(includeOutdated?: boolean): Promise<DeepgramListModelsResponse>;
    get(modelId: string): Promise<DeepgramSttModel | DeepgramTtsModel>;
  };
  projects: {
    list(): Promise<DeepgramProject[]>;
    get(id: string): Promise<DeepgramProject>;
    delete(id: string): Promise<void>;
    patch(id: string, body: Record<string, unknown>): Promise<DeepgramProject>;
    listModels(id: string): Promise<DeepgramListModelsResponse>;
    getModel(
      projectId: string,
      modelId: string
    ): Promise<DeepgramSttModel | DeepgramTtsModel>;
  };
  keys: {
    list(projectId: string): Promise<DeepgramKey[]>;
    create(
      projectId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramKey>;
    get(projectId: string, keyId: string): Promise<DeepgramKey>;
    delete(projectId: string, keyId: string): Promise<void>;
  };
  members: {
    list(projectId: string): Promise<DeepgramMember[]>;
    delete(projectId: string, memberId: string): Promise<void>;
  };
  scopes: {
    list(projectId: string, memberId: string): Promise<DeepgramScope[]>;
    update(
      projectId: string,
      memberId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramScope[]>;
  };
  invitations: {
    list(projectId: string): Promise<DeepgramInvitation[]>;
    create(
      projectId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramInvitation>;
    delete(projectId: string, invitationId: string): Promise<void>;
    leave(projectId: string): Promise<void>;
  };
  usage: {
    listRequests(projectId: string): Promise<DeepgramRequest[]>;
    getRequest(projectId: string, requestId: string): Promise<DeepgramRequest>;
    listFields(projectId: string): Promise<DeepgramUsageField[]>;
    getBreakdown(projectId: string): Promise<DeepgramUsageBreakdown>;
  };
  purchases: {
    list(projectId: string): Promise<DeepgramPurchase[]>;
  };
  balances: {
    list(projectId: string): Promise<DeepgramBalance[]>;
    get(projectId: string, balanceId: string): Promise<DeepgramBalance>;
  };
}

/** ------------------- UseDeepgramTextToSpeech --------------- */
export interface UseDeepgramTextToSpeechOptions {
  model?: string; // 'aura-2-thalia-en', etc.
  format?: 'wav' | 'mp3' | 'pcm' | 'opus';
  sampleRate?: number; // e.g. 44100
  bitRate?: number; // e.g. 64000
  callback?: string;
  callbackMethod?: 'POST' | 'PUT';
  mipOptOut?: boolean;
}

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

  /** Shared options that apply to both HTTP and WebSocket flows. */
  options?: UseDeepgramTextToSpeechOptions;
};

export type UseDeepgramTextToSpeechReturn = {
  /** One-shot HTTP request that resolves when the full audio is ready. */
  synthesize: (text: string) => Promise<void>;
  /** Opens a WebSocket and begins streaming audio chunks in real-time. */
  startStreaming: (text: string) => Promise<void>;
  /** Send additional text to an existing WebSocket stream. */
  sendText: (text: string) => boolean;
  /** Gracefully closes the WebSocket stream. */
  stopStreaming: () => void;
};
