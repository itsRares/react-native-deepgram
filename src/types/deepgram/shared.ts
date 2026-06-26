/**
 * HTTP methods supported for callback URLs.
 */
export type DeepgramCallbackMethod = 'POST' | 'PUT' | (string & {});

/**
 * Mode for handling custom vocabulary/topics/intents.
 * - `extended`: Augments the base model's knowledge.
 * - `strict`: Limits the model to only the provided vocabulary.
 */
export type DeepgramCustomMode = 'extended' | 'strict';

/**
 * Auto-reconnect configuration for live streaming sockets (STT & Voice Agent).
 * Opt-in and non-breaking: reconnect is disabled unless `enabled` is set.
 * @see https://developers.deepgram.com/docs/recovering-from-connection-errors-and-timeouts-when-live-streaming-audio
 */
export type DeepgramReconnectOptions = {
  /** Enable automatic reconnect on unexpected socket close. @default false */
  enabled?: boolean;
  /** Maximum number of reconnect attempts before giving up. @default 5 */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds. @default 500 */
  initialDelayMs?: number;
  /** Maximum backoff delay in milliseconds. @default 10000 */
  maxDelayMs?: number;
};
