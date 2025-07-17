/** ------------------- UseDeepgramSpeechToText --------------- */

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

export type UseDeepgramSpeechToTextReturn = {
  /** Begin capturing mic audio and streaming to Deepgram STT */
  startListening: () => void;
  /** Stop the mic capture & close connection */
  stopListening: () => void;
  /** Transcribe a file (e.g. audio file) using Deepgram */
  transcribeFile: (
    file: Blob | { uri: string; name?: string; type?: string }
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
