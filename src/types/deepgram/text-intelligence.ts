import type { DeepgramCallbackMethod, DeepgramCustomMode } from './shared';

export type DeepgramTextIntelligenceCallbackMethod = DeepgramCallbackMethod;

export type DeepgramTextIntelligenceCustomMode = DeepgramCustomMode;

/**
 * Supported languages for text intelligence analysis.
 * @see https://developers.deepgram.com/docs/language-support
 */
export type DeepgramTextIntelligenceLanguage =
  | 'bg'
  | 'ca'
  | 'zh'
  | 'zh-CN'
  | 'zh-TW'
  | 'zh-HK'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'cs'
  | 'da'
  | 'da-DK'
  | 'nl'
  | 'nl-BE'
  | 'en'
  | 'en-US'
  | 'en-AU'
  | 'en-GB'
  | 'en-NZ'
  | 'en-IN'
  | 'et'
  | 'fi'
  | 'fr'
  | 'fr-CA'
  | 'de'
  | 'de-CH'
  | 'el'
  | 'hi'
  | 'hi-Latn'
  | 'hu'
  | 'id'
  | 'it'
  | 'ja'
  | 'ko'
  | 'ko-KR'
  | 'lv'
  | 'lt'
  | 'ms'
  | 'no'
  | 'pl'
  | 'pt'
  | 'pt-BR'
  | 'pt-PT'
  | 'ro'
  | 'ru'
  | 'sk'
  | 'es'
  | 'es-419'
  | 'es-LATAM'
  | 'sv'
  | 'sv-SE'
  | 'taq'
  | 'th'
  | 'th-TH'
  | 'tr'
  | 'uk'
  | 'vi'
  | (string & {});

/**
 * Input for text intelligence analysis.
 * Can be raw text or a URL to a text resource.
 */
export type DeepgramTextIntelligenceInput =
  | { text: string; url?: string }
  | { text?: string; url: string };

/**
 * Configuration options for text intelligence analysis.
 * @example
 * ```typescript
 * const options: UseDeepgramTextIntelligenceOptions = {
 *   summarize: true,
 *   topics: true,
 *   sentiment: true,
 *   language: 'en'
 * };
 * ```
 */
export interface UseDeepgramTextIntelligenceOptions {
  /** Whether to run summarization on the input */
  summarize?: boolean;
  /** Whether to detect topics in the text */
  topics?: boolean;
  /** Custom topics to detect (single or list of strings) */
  customTopic?: string | string[];
  /** How to interpret `customTopic` ('extended' includes DL-detected topics too) */
  customTopicMode?: DeepgramTextIntelligenceCustomMode;
  /** Whether to detect speaker intents */
  intents?: boolean;
  /** Provide custom intents to bias detection. */
  customIntent?: string | string[];
  /** How custom intents are interpreted (extended includes Deepgram detected intents). */
  customIntentMode?: DeepgramTextIntelligenceCustomMode;
  /** Whether to analyze sentiment */
  sentiment?: boolean;
  /** BCP-47 language tag hint (defaults to 'en') */
  language?: DeepgramTextIntelligenceLanguage;
  /** Label your requests for the purpose of identification during usage reporting */
  tag?: string | string[];
  /** URL to receive a webhook callback with the analysis */
  callback?: string;
  /** HTTP method to use for the callback (defaults to 'POST') */
  callbackMethod?: DeepgramTextIntelligenceCallbackMethod;
}

/** Sentiment label returned by the sentiment analysis feature. */
export type DeepgramTextIntelligenceSentimentLabel =
  | 'positive'
  | 'neutral'
  | 'negative';

/** Token usage / model info reported for an individual analysis feature. */
export interface DeepgramTextIntelligenceModelInfo {
  model_uuid: string;
  input_tokens: number;
  output_tokens: number;
}

/** Metadata describing the analysis request and per-feature model usage. */
export interface DeepgramTextIntelligenceMetadata {
  request_id: string;
  created: string;
  language: string;
  summary_info?: DeepgramTextIntelligenceModelInfo;
  sentiment_info?: DeepgramTextIntelligenceModelInfo;
  topics_info?: DeepgramTextIntelligenceModelInfo;
  intents_info?: DeepgramTextIntelligenceModelInfo;
}

/** Result of the `summarize` feature. */
export interface DeepgramTextIntelligenceSummary {
  text: string;
}

/** A single detected topic with its confidence score. */
export interface DeepgramTextIntelligenceTopic {
  topic: string;
  confidence_score: number;
}

/** A segment of the input annotated with detected topics. */
export interface DeepgramTextIntelligenceTopicSegment {
  text: string;
  start_word: number;
  end_word: number;
  topics: DeepgramTextIntelligenceTopic[];
}

/** Result of the `topics` feature. */
export interface DeepgramTextIntelligenceTopics {
  segments: DeepgramTextIntelligenceTopicSegment[];
}

/** A single detected intent with its confidence score. */
export interface DeepgramTextIntelligenceIntent {
  intent: string;
  confidence_score: number;
}

/** A segment of the input annotated with detected intents. */
export interface DeepgramTextIntelligenceIntentSegment {
  text: string;
  start_word: number;
  end_word: number;
  intents: DeepgramTextIntelligenceIntent[];
}

/** Result of the `intents` feature. */
export interface DeepgramTextIntelligenceIntents {
  segments: DeepgramTextIntelligenceIntentSegment[];
}

/** A segment of the input annotated with a sentiment label and score. */
export interface DeepgramTextIntelligenceSentimentSegment {
  text: string;
  start_word: number;
  end_word: number;
  sentiment: DeepgramTextIntelligenceSentimentLabel;
  sentiment_score: number;
}

/** Result of the `sentiment` feature. */
export interface DeepgramTextIntelligenceSentiments {
  segments: DeepgramTextIntelligenceSentimentSegment[];
  average: {
    sentiment: DeepgramTextIntelligenceSentimentLabel;
    sentiment_score: number;
  };
}

/** The `results` object of an analysis response. Each field is present only when the corresponding feature was requested. */
export interface DeepgramTextIntelligenceResults {
  summary?: DeepgramTextIntelligenceSummary;
  topics?: DeepgramTextIntelligenceTopics;
  intents?: DeepgramTextIntelligenceIntents;
  sentiments?: DeepgramTextIntelligenceSentiments;
}

/** Full response returned by the Deepgram Read (Text Intelligence) API. */
export interface DeepgramTextIntelligenceResponse {
  metadata: DeepgramTextIntelligenceMetadata;
  results: DeepgramTextIntelligenceResults;
}

/**
 * Props for the `useDeepgramTextIntelligence` hook.
 */
export interface UseDeepgramTextIntelligenceProps {
  /** Called before analysis begins (e.g. show spinner) */
  onBeforeAnalyze?: () => void;
  /** Called with the analysis results on success */
  onAnalyzeSuccess?: (results: DeepgramTextIntelligenceResponse) => void;
  /** Called if the analysis request fails */
  onAnalyzeError?: (error: Error) => void;
  /** Configuration for which analyses to run */
  options?: UseDeepgramTextIntelligenceOptions;
  /** Whether to track the internal state of the analysis */
  trackState?: boolean;
}

/**
 * Return value of the `useDeepgramTextIntelligence` hook.
 */
export interface UseDeepgramTextIntelligenceReturn {
  /**
   * Analyze the provided input.
   * Pass an object with either `text` (raw string) or `url` (link to text resource).
   */
  analyze: (input: DeepgramTextIntelligenceInput) => Promise<void>;
  /**
   * Current state of the analysis (only if trackState is true).
   */
  state?: {
    status: 'idle' | 'loading' | 'analyzing' | 'error';
    error: Error | null;
  };
}
