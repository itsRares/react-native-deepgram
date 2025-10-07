import type { DeepgramCallbackMethod, DeepgramCustomMode } from './shared';

export type DeepgramTextIntelligenceCallbackMethod = DeepgramCallbackMethod;

export type DeepgramTextIntelligenceCustomMode = DeepgramCustomMode;

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

export type DeepgramTextIntelligenceInput =
  | { text: string; url?: string }
  | { text?: string; url: string };

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
  /** URL to receive a webhook callback with the analysis */
  callback?: string;
  /** HTTP method to use for the callback (defaults to 'POST') */
  callbackMethod?: DeepgramTextIntelligenceCallbackMethod;
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
  analyze: (input: DeepgramTextIntelligenceInput) => Promise<void>;
}
