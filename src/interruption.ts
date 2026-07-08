import { NativeEventEmitter, NativeModules } from 'react-native';

// Shared native → JS event name on both platforms (DeepgramRouteChange pattern).
const INTERRUPTION_EVENT = 'DeepgramInterruption';

let cachedEmitter: NativeEventEmitter | null = null;
const getEmitter = (): NativeEventEmitter => {
  if (!cachedEmitter) {
    cachedEmitter = new NativeEventEmitter(NativeModules.Deepgram);
  }
  return cachedEmitter;
};

/**
 * An audio interruption reported by the native layer.
 *
 * - `began` — capture/playback was paused by the system (incoming phone call,
 *   Siri, another app taking audio focus, …). The native side already pauses
 *   the audio pipeline; this event is purely observability.
 * - `ended` — the interruption is over. `shouldResume` reflects the system's
 *   hint (iOS `AVAudioSessionInterruptionOptionShouldResume` / Android focus
 *   regain); when `true` the native side has already resumed automatically.
 * - `stopped` — the session was torn down (Android permanent focus loss).
 *   Recording/playback must be restarted explicitly.
 */
export type DeepgramInterruptionEvent =
  | {
      type: 'began';
      reason: 'phoneCall' | 'focusLoss' | 'routeChange' | 'unknown';
    }
  | { type: 'ended'; shouldResume: boolean }
  | { type: 'stopped'; reason: 'focusLossPermanent' };

/**
 * Subscription returned by {@link addInterruptionListener}. Call
 * {@link InterruptionSubscription.remove} to stop receiving events.
 */
export interface InterruptionSubscription {
  remove: () => void;
}

/**
 * Subscribe to audio interruption / focus events (phone calls, Siri, another
 * app taking audio focus). Use it to drive "paused — on a call" UI or to
 * restart a session after a permanent focus loss.
 *
 * The native layer already pauses/resumes/tears down the audio pipeline by
 * itself — these events only *report* what happened.
 *
 * @example
 * const sub = addInterruptionListener((e) => {
 *   if (e.type === 'began') showPausedBanner(e.reason);
 *   else if (e.type === 'ended') hidePausedBanner();
 *   else restartSessionPrompt(); // 'stopped'
 * });
 * // later
 * sub.remove();
 */
export function addInterruptionListener(
  listener: (event: DeepgramInterruptionEvent) => void
): InterruptionSubscription {
  const subscription = getEmitter().addListener(
    INTERRUPTION_EVENT,
    (payload: Partial<DeepgramInterruptionEvent> | undefined) => {
      if (!payload?.type) return;
      listener(payload as DeepgramInterruptionEvent);
    }
  );
  return { remove: () => subscription.remove() };
}
