import { getBaseUrl, getBaseWss } from '../constants';
import { buildParams, type QueryParams } from '../helpers/url';
import type {
  DeepgramTextToSpeechHttpEncoding,
  DeepgramTextToSpeechHttpOptions,
  UseDeepgramTextToSpeechOptions,
  DeepgramTextToSpeechStreamEncoding,
} from '../types';

export const DEFAULT_TTS_MODEL = 'aura-2-asteria-en';
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;
const DEFAULT_HTTP_ENCODING: DeepgramTextToSpeechHttpEncoding = 'linear16';
const DEFAULT_STREAM_ENCODING: DeepgramTextToSpeechStreamEncoding = 'linear16';
const DEFAULT_MP3_BITRATE = 48_000;
const TELEPHONY_SAMPLE_RATE = 8_000;

const isRawPcm = (encoding?: string) =>
  encoding === 'linear16' || encoding === 'mulaw' || encoding === 'alaw';

export function deriveTtsMimeType(
  encoding?: string,
  container?: string
): string {
  if (container === 'wav') return 'audio/wav';
  if (container === 'ogg') return 'audio/ogg';
  switch (encoding) {
    case 'mp3':
      return 'audio/mpeg';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'opus':
      return 'audio/ogg';
    default:
      // linear16 / mulaw / alaw and other raw PCM payloads have no container.
      return 'application/octet-stream';
  }
}

export type ResolvedHttpOptions = ReturnType<typeof resolveHttpOptions>;
export type ResolvedStreamOptions = ReturnType<typeof resolveStreamOptions>;

/** Merge the HTTP-specific options over the shared (deprecated) ones. */
export function resolveHttpOptions(options: UseDeepgramTextToSpeechOptions) {
  const http = options.http ?? {};
  const encoding = http.encoding ?? options.encoding ?? DEFAULT_HTTP_ENCODING;

  const explicitRate = http.sampleRate ?? options.sampleRate;
  let sampleRate = explicitRate;
  if (sampleRate == null && encoding === 'linear16') {
    sampleRate = DEFAULT_TTS_SAMPLE_RATE;
  } else if (sampleRate == null && isRawPcm(encoding)) {
    sampleRate = TELEPHONY_SAMPLE_RATE;
  }

  let container = http.container ?? options.container;
  if (!container && encoding === 'opus') container = 'ogg';
  if (!container && isRawPcm(encoding)) container = 'none';

  const bitRate =
    http.bitRate ??
    options.bitRate ??
    (encoding === 'mp3' ? DEFAULT_MP3_BITRATE : undefined);

  return {
    model: http.model ?? options.model ?? DEFAULT_TTS_MODEL,
    sampleRate,
    encoding,
    container,
    format: http.format ?? options.format,
    bitRate,
    speed: http.speed ?? options.speed,
    tag: http.tag ?? options.tag,
    callback: http.callback ?? options.callback,
    callbackMethod: http.callbackMethod ?? options.callbackMethod,
    mipOptOut: http.mipOptOut ?? options.mipOptOut,
    queryParams: {
      ...(options.queryParams ?? {}),
      ...(http.queryParams ?? {}),
    } as QueryParams,
  };
}

/** Merge the streaming-specific options over the shared (deprecated) ones. */
export function resolveStreamOptions(options: UseDeepgramTextToSpeechOptions) {
  const stream = options.stream ?? {};
  const requested = stream.encoding ?? options.encoding;
  const encoding: DeepgramTextToSpeechStreamEncoding =
    requested === 'linear16' || requested === 'mulaw' || requested === 'alaw'
      ? requested
      : DEFAULT_STREAM_ENCODING;

  return {
    model: stream.model ?? options.model ?? DEFAULT_TTS_MODEL,
    sampleRate:
      stream.sampleRate ??
      options.sampleRate ??
      (encoding === 'linear16'
        ? DEFAULT_TTS_SAMPLE_RATE
        : TELEPHONY_SAMPLE_RATE),
    encoding,
    speed: stream.speed ?? options.speed,
    mipOptOut: stream.mipOptOut ?? options.mipOptOut,
    queryParams: {
      ...(options.queryParams ?? {}),
      ...(stream.queryParams ?? {}),
    } as QueryParams,
    autoFlush: stream.autoFlush ?? true,
  };
}

/** Explicit `queryParams` entries win over the typed options. */
function withTypedParams(
  queryParams: QueryParams,
  typed: QueryParams
): QueryParams {
  const params: QueryParams = { ...queryParams };
  for (const [key, value] of Object.entries(typed)) {
    if (value != null && params[key] == null) {
      params[key] = value;
    }
  }
  return params;
}

export function buildSpeakHttpParams(
  options: ResolvedHttpOptions,
  overrides?: DeepgramTextToSpeechHttpOptions
): QueryParams {
  const merged = { ...options, ...(overrides ?? {}) };
  return withTypedParams(
    { ...options.queryParams, ...(overrides?.queryParams ?? {}) },
    {
      model: merged.model,
      encoding: merged.encoding,
      sample_rate: merged.sampleRate,
      container: merged.container,
      format: merged.format,
      bit_rate: merged.bitRate,
      speed: merged.speed,
      tag: merged.tag,
      callback: merged.callback,
      callback_method: merged.callbackMethod,
      mip_opt_out: merged.mipOptOut,
    }
  );
}

export function buildSpeakStreamUrl(options: ResolvedStreamOptions): string {
  const params = buildParams(
    withTypedParams(options.queryParams, {
      model: options.model,
      encoding: options.encoding,
      sample_rate: options.sampleRate,
      speed: options.speed,
      mip_opt_out: options.mipOptOut,
    })
  );
  const base = `${getBaseWss()}/speak`;
  return params ? `${base}?${params}` : base;
}

export function buildSpeakHttpUrl(params: QueryParams): string {
  const query = buildParams(params);
  const base = `${getBaseUrl()}/speak`;
  return query ? `${base}?${query}` : base;
}
