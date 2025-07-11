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
