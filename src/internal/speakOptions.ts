import {
  getBaseUrl,
  getBaseWss,
  getV2BaseUrl,
  getV2BaseWss,
} from '../constants';
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

/** Flux TTS voices are served only by `/v2/speak`. */
export const isFluxTtsModel = (model: unknown): boolean =>
  typeof model === 'string' && model.startsWith('flux-');

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

/** Apply the HTTP defaults derived from the encoding. */
export function resolveHttpOptions(options: UseDeepgramTextToSpeechOptions) {
  const http = options.http ?? {};
  const encoding = http.encoding ?? DEFAULT_HTTP_ENCODING;

  let sampleRate = http.sampleRate;
  if (sampleRate == null && encoding === 'linear16') {
    sampleRate = DEFAULT_TTS_SAMPLE_RATE;
  } else if (sampleRate == null && isRawPcm(encoding)) {
    sampleRate = TELEPHONY_SAMPLE_RATE;
  }

  let container = http.container;
  if (!container && encoding === 'opus') container = 'ogg';
  if (!container && isRawPcm(encoding)) container = 'none';

  return {
    model: http.model ?? DEFAULT_TTS_MODEL,
    sampleRate,
    encoding,
    container,
    bitRate:
      http.bitRate ?? (encoding === 'mp3' ? DEFAULT_MP3_BITRATE : undefined),
    speed: http.speed,
    expressivity: http.expressivity,
    tag: http.tag,
    callback: http.callback,
    callbackMethod: http.callbackMethod,
    mipOptOut: http.mipOptOut,
    queryParams: {
      ...(options.queryParams ?? {}),
      ...(http.queryParams ?? {}),
    } as QueryParams,
  };
}

/** Apply the streaming defaults (raw PCM only). */
export function resolveStreamOptions(options: UseDeepgramTextToSpeechOptions) {
  const stream = options.stream ?? {};
  const requested = stream.encoding;
  const encoding: DeepgramTextToSpeechStreamEncoding =
    requested === 'linear16' || requested === 'mulaw' || requested === 'alaw'
      ? requested
      : DEFAULT_STREAM_ENCODING;
  const model = stream.model ?? DEFAULT_TTS_MODEL;
  const queryParams = {
    ...(options.queryParams ?? {}),
    ...(stream.queryParams ?? {}),
  } as QueryParams;

  return {
    model,
    // An explicit `queryParams.model` wins in the URL, so it picks the route.
    flux: isFluxTtsModel(queryParams.model ?? model),
    sampleRate:
      stream.sampleRate ??
      (encoding === 'linear16'
        ? DEFAULT_TTS_SAMPLE_RATE
        : TELEPHONY_SAMPLE_RATE),
    encoding,
    speed: stream.speed,
    expressivity: stream.expressivity,
    tag: stream.tag,
    mipOptOut: stream.mipOptOut,
    queryParams,
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
      bit_rate: merged.bitRate,
      speed: merged.speed,
      expressivity: merged.expressivity,
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
      ...(options.flux
        ? { expressivity: options.expressivity, tag: options.tag }
        : {}),
      mip_opt_out: options.mipOptOut,
    })
  );
  const base = `${options.flux ? getV2BaseWss() : getBaseWss()}/speak`;
  return params ? `${base}?${params}` : base;
}

/** The `model` param picks `/v2/speak` (Flux) or `/v1/speak` (Aura). */
export function buildSpeakHttpUrl(params: QueryParams): string {
  const query = buildParams(params);
  const root = isFluxTtsModel(params.model) ? getV2BaseUrl() : getBaseUrl();
  const base = `${root}/speak`;
  return query ? `${base}?${query}` : base;
}
