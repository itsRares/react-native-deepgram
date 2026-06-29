export { useDeepgramSpeechToText } from './useDeepgramSpeechToText';
export { useDeepgramTextIntelligence } from './useDeepgramTextIntelligence';
export { useDeepgramManagement } from './useDeepgramManagement';
export { useDeepgramTextToSpeech } from './useDeepgramTextToSpeech';
export { useDeepgramVoiceAgent } from './useDeepgramVoiceAgent';
export { Deepgram } from './NativeDeepgram';
import type { DeepgramGetToken } from './helpers';
import { clearCachedAuthToken } from './helpers';
export {
  arrayBufferToBase64,
  createAudioPlayerController,
  useAsyncCall,
  createAgentSettings,
} from './helpers';
export type { DeepgramGetToken, DeepgramTokenResult } from './helpers';
export { DeepgramError } from './types/errors';
export type * from './types';

/**
 * Options accepted by {@link configure}.
 */
export type DeepgramConfigureOptions = {
  /**
   * Deepgram API key used to authenticate REST and WebSocket requests. Optional
   * when {@link DeepgramConfigureOptions.getToken} is provided.
   */
  apiKey?: string;
  /**
   * Override the REST base URL (must include the version segment, e.g.
   * `https://api.beta.deepgram.com/v1` or a self-hosted host). Used for
   * regional, Dedicated, and self-hosted deployments.
   * @see https://developers.deepgram.com/reference/custom-endpoints
   */
  baseUrl?: string;
  /**
   * Override the streaming (WebSocket) base URL, e.g. `wss://my-host:8080/v1`.
   */
  baseWss?: string;
  /** Override the Voice Agent socket URL. */
  agentUrl?: string;
  /**
   * Provide short-lived tokens instead of embedding a long-lived API key in the
   * app. Called on demand; the returned token is cached and refreshed before
   * expiry. Takes precedence over `apiKey` when set.
   *
   * Typically fetches a token from your backend, which proxies Deepgram's
   * `/auth/grant` endpoint. Note: the Management API does not accept temporary
   * tokens, so `useDeepgramManagement` still requires `apiKey`.
   * @see https://developers.deepgram.com/guides/fundamentals/token-based-authentication
   */
  getToken?: DeepgramGetToken;
};

export const configure = (opts: DeepgramConfigureOptions) => {
  const g = globalThis as any;
  g.__DEEPGRAM_API_KEY__ = opts.apiKey;
  g.__DEEPGRAM_BASE_URL__ = opts.baseUrl;
  g.__DEEPGRAM_BASE_WSS__ = opts.baseWss;
  g.__DEEPGRAM_AGENT_URL__ = opts.agentUrl;
  g.__DEEPGRAM_GET_TOKEN__ = opts.getToken;
  clearCachedAuthToken();
};
