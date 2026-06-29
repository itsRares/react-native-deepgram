/**
 * Stable error-code contract shared by the native module (iOS + Android) and
 * the JS hooks. Every native promise rejection uses one of these codes, so
 * consumers can branch on a typed `code` instead of string-matching messages.
 *
 * Keep this union in lock-step with the native reject codes:
 *   - iOS:     `DGRejectPromise(reject, "<code>", ...)` (ios/DGSupport.h)
 *   - Android: `promise.reject("<code>", ...)` (DeepgramModule.kt / AudioPlayer.kt)
 *
 * @see https://developers.deepgram.com/docs/errors
 */
export type DeepgramErrorCode =
  | 'permission_denied'
  | 'init_failed'
  | 'start_error'
  | 'stop_error'
  | 'audio_start_error'
  | 'audio_stop_error'
  | 'stop_player_error'
  | 'invalid_data'
  | 'playback_error';

const DEEPGRAM_ERROR_CODES: ReadonlySet<string> = new Set<DeepgramErrorCode>([
  'permission_denied',
  'init_failed',
  'start_error',
  'stop_error',
  'audio_start_error',
  'audio_stop_error',
  'stop_player_error',
  'invalid_data',
  'playback_error',
]);

/**
 * Error surfaced by the Deepgram hooks. Wraps native promise rejections, fetch
 * failures and WebSocket errors with a typed {@link DeepgramErrorCode} so apps
 * can handle failures programmatically. The original failure is preserved on
 * {@link DeepgramError.cause}.
 *
 * @example
 * ```ts
 * onError: (err) => {
 *   if (err instanceof DeepgramError && err.code === 'permission_denied') {
 *     // prompt the user to grant microphone access
 *   }
 * }
 * ```
 */
export class DeepgramError extends Error {
  /** Typed reject code, or `'unknown'` when it can't be mapped to the contract. */
  readonly code: DeepgramErrorCode | 'unknown';

  constructor(
    message: string,
    code: DeepgramErrorCode | 'unknown' = 'unknown',
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'DeepgramError';
    this.code = code;
    // Restore the prototype chain so `instanceof DeepgramError` holds even when
    // the library is transpiled below ES2015 (react-native-builder-bob/Babel).
    Object.setPrototypeOf(this, DeepgramError.prototype);
  }
}

const isDeepgramErrorCode = (value: unknown): value is DeepgramErrorCode =>
  typeof value === 'string' && DEEPGRAM_ERROR_CODES.has(value);

/**
 * Normalize an unknown error into a {@link DeepgramError}. React Native surfaces
 * native promise rejections as an `Error`-like object carrying the reject
 * `code` (e.g. `'start_error'`); this reads that code when present, otherwise
 * falls back to `'unknown'`. The original value is preserved as `cause`.
 *
 * Idempotent: passing an existing {@link DeepgramError} returns it unchanged.
 */
export const toDeepgramError = (err: unknown): DeepgramError => {
  if (err instanceof DeepgramError) {
    return err;
  }

  if (err != null && typeof err === 'object') {
    const maybe = err as { code?: unknown; message?: unknown };
    const code = isDeepgramErrorCode(maybe.code) ? maybe.code : 'unknown';
    const message =
      typeof maybe.message === 'string' && maybe.message.length > 0
        ? maybe.message
        : String(err);
    return new DeepgramError(message, code, { cause: err });
  }

  const message = typeof err === 'string' && err.length > 0 ? err : String(err);
  return new DeepgramError(message, 'unknown', { cause: err });
};
