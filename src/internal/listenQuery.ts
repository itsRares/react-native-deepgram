import { getBaseUrl, getBaseWss, getV2BaseWss } from '../constants';
import { buildParams, type QueryParams } from '../helpers/url';
import type {
  DeepgramLiveConfigureOptions,
  DeepgramLiveListenOptions,
  DeepgramPrerecordedOptions,
} from '../types';

export const DEFAULT_LIVE_SAMPLE_RATE = 16_000;

const withQuery = (base: string, query: QueryParams) => {
  const params = buildParams(query);
  return params ? `${base}?${params}` : base;
};

const asArray = <T>(value: T | T[]) => (Array.isArray(value) ? value : [value]);

/** Apply the hook defaults (linear16 @ 16 kHz, nova-3 / flux-general-en). */
export function resolveLiveOptions(
  hookOptions: DeepgramLiveListenOptions,
  overrides: DeepgramLiveListenOptions
): DeepgramLiveListenOptions {
  const apiVersion = overrides.apiVersion ?? hookOptions.apiVersion ?? 'v1';
  return {
    encoding: 'linear16',
    sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
    model: apiVersion === 'v2' ? 'flux-general-en' : 'nova-3',
    apiVersion,
    ...hookOptions,
    ...overrides,
  };
}

/** Build the `/listen` WebSocket URL for Nova (v1) or Flux (v2). */
export function buildLiveListenUrl(options: DeepgramLiveListenOptions): string {
  const isV2 = options.apiVersion === 'v2';
  // nova-3 and Flux take `keyterm`; older models still take `keywords`.
  const usesKeyterm =
    isV2 ||
    (typeof options.model === 'string' && options.model.startsWith('nova-3'));
  const keyterm =
    options.keyterm ?? (usesKeyterm ? options.keywords : undefined);

  // Flux accepts only a small set of query params; v1-only params can make
  // the server reject the connection.
  const query: QueryParams = isV2
    ? {
        model: options.model,
        encoding: options.encoding,
        sample_rate: options.sampleRate,
        eager_eot_threshold: options.eagerEotThreshold,
        eot_threshold: options.eotThreshold,
        eot_timeout_ms: options.eotTimeoutMs,
        keyterm,
        language_hint: options.languageHint,
        numerals: options.numerals,
        profanity_filter: options.profanityFilter,
        redact: options.redact ? asArray(options.redact) : undefined,
        mip_opt_out: options.mipOptOut,
        measurements: options.measurements,
        tag: options.tag,
      }
    : {
        callback: options.callback,
        callback_method: options.callbackMethod,
        channels: options.channels,
        detect_entities: options.detectEntities,
        diarize_model: options.diarizeModel,
        dictation: options.dictation,
        encoding: options.encoding,
        endpointing: options.endpointing,
        filler_words: options.fillerWords,
        interim_results: options.interimResults,
        keyterm,
        keywords: usesKeyterm ? undefined : options.keywords,
        language: options.language,
        language_hint: options.languageHint,
        mip_opt_out: options.mipOptOut,
        measurements: options.measurements,
        model: options.model,
        multichannel: options.multichannel,
        numerals: options.numerals,
        profanity_filter: options.profanityFilter,
        punctuate: options.punctuate,
        redact: options.redact ? asArray(options.redact) : undefined,
        replace: options.replace,
        sample_rate: options.sampleRate,
        search: options.search,
        smart_format: options.smartFormat,
        tag: options.tag,
        utterance_end_ms: options.utteranceEndMs,
        vad_events: options.vadEvents,
        version: options.version,
      };

  for (const [key, value] of Object.entries(options.extra ?? {})) {
    query[`extra.${key}`] = value;
  }

  const base = isV2 ? getV2BaseWss() : getBaseWss();
  return withQuery(`${base}/listen`, query);
}

/**
 * Build a mid-stream `Configure` message. Nova (v1) nests numerals under
 * `features`; Flux (v2) takes them top-level next to `thresholds`.
 */
export function buildLiveConfigureMessage(
  options: DeepgramLiveConfigureOptions,
  apiVersion: 'v1' | 'v2'
): Record<string, unknown> {
  const message: Record<string, unknown> = { type: 'Configure' };
  if (options.keyterms) message.keyterms = options.keyterms;

  if (apiVersion === 'v1') {
    if (options.numerals !== undefined) {
      message.features = { numerals: options.numerals };
    }
    return message;
  }

  const thresholds: Record<string, number> = {};
  if (options.eotThreshold !== undefined) {
    thresholds.eot_threshold = options.eotThreshold;
  }
  if (options.eagerEotThreshold !== undefined) {
    thresholds.eager_eot_threshold = options.eagerEotThreshold;
  }
  if (options.eotTimeoutMs !== undefined) {
    thresholds.eot_timeout_ms = options.eotTimeoutMs;
  }
  if (Object.keys(thresholds).length > 0) message.thresholds = thresholds;
  if (options.languageHints) message.language_hints = options.languageHints;
  if (options.numerals !== undefined) message.numerals = options.numerals;
  return message;
}

/** Build the pre-recorded `/listen` REST URL. */
export function buildPrerecordedUrl(
  options: DeepgramPrerecordedOptions
): string {
  const query: QueryParams = {
    callback: options.callback,
    callback_method: options.callbackMethod,
    sentiment: options.sentiment,
    summarize: options.summarize,
    tag: options.tag,
    topics: options.topics,
    custom_topic: options.customTopic || undefined,
    custom_topic_mode: options.customTopicMode,
    intents: options.intents,
    custom_intent: options.customIntent || undefined,
    custom_intent_mode: options.customIntentMode,
    detect_entities: options.detectEntities,
    detect_language: options.detectLanguage,
    diarize_model: options.diarizeModel,
    dictation: options.dictation,
    encoding: options.encoding,
    filler_words: options.fillerWords,
    keyterm: options.keyterm,
    keywords: options.keywords,
    language: options.language,
    language_hint: options.languageHint,
    measurements: options.measurements,
    mip_opt_out: options.mipOptOut,
    model: options.model,
    multichannel: options.multichannel,
    numerals: options.numerals,
    paragraphs: options.paragraphs,
    profanity_filter: options.profanityFilter,
    punctuate: options.punctuate,
    redact: options.redact ? asArray(options.redact) : undefined,
    replace: options.replace,
    search: options.search,
    smart_format: options.smartFormat,
    utterances: options.utterances,
    utt_split: options.uttSplit,
    version: options.version,
  };

  const { extra } = options;
  if (typeof extra === 'string' || Array.isArray(extra)) {
    query.extra = extra;
  } else if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value != null) {
        query[`extra.${key}`] = value;
      }
    }
  }

  return withQuery(`${getBaseUrl()}/listen`, query);
}
