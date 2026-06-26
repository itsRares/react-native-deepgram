export type DeepgramTokenResult = {
  token: string;
  expiresInSeconds?: number;
};

export type DeepgramGetToken = () => Promise<DeepgramTokenResult>;

const DEFAULT_TOKEN_TTL_SECONDS = 30;
const REFRESH_RATIO = 0.8;

type CachedToken = { header: string; expiresAt: number };

let cachedToken: CachedToken | null = null;
let inflight: Promise<string> | null = null;

const withScheme = (raw: string, defaultScheme: 'Token' | 'Bearer'): string => {
  const trimmed = raw.trim();
  if (/^(Token|Bearer)\s+/i.test(trimmed)) {
    return trimmed;
  }
  return `${defaultScheme} ${trimmed}`;
};

const readGetToken = (): DeepgramGetToken | undefined => {
  const fn = (globalThis as any).__DEEPGRAM_GET_TOKEN__;
  return typeof fn === 'function' ? (fn as DeepgramGetToken) : undefined;
};

const readApiKey = (): string | undefined => {
  const key = (globalThis as any).__DEEPGRAM_API_KEY__;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
};

export const hasAuthConfigured = (): boolean =>
  readGetToken() != null || readApiKey() != null;

export const clearCachedAuthToken = (): void => {
  cachedToken = null;
};

export const resolveAuthHeader = async (): Promise<string> => {
  const getToken = readGetToken();
  if (getToken) {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now) {
      return cachedToken.header;
    }
    // Single-flight: concurrent callers share one in-flight token refresh.
    if (!inflight) {
      inflight = (async () => {
        const result = await getToken();
        const token = result?.token;
        if (typeof token !== 'string' || token.length === 0) {
          throw new Error('getToken did not return a token');
        }
        const ttlSeconds =
          typeof result.expiresInSeconds === 'number' &&
          result.expiresInSeconds > 0
            ? result.expiresInSeconds
            : DEFAULT_TOKEN_TTL_SECONDS;
        const header = withScheme(token, 'Bearer');
        // Refresh at 80% of the TTL to absorb clock skew / latency.
        cachedToken = {
          header,
          expiresAt: Date.now() + ttlSeconds * REFRESH_RATIO * 1000,
        };
        return header;
      })();
    }
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error('Deepgram API key missing');
  }
  return withScheme(apiKey, 'Token');
};
