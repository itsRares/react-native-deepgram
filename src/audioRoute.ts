import { Deepgram } from './native';
import type { DeepgramAudioRoute, DeepgramActiveAudioRoute } from './native';
import { toDeepgramError } from './types/errors';

/**
 * Subscription returned by {@link addAudioRouteChangeListener}. Call
 * {@link AudioRouteSubscription.remove} to stop receiving route-change events.
 */
export interface AudioRouteSubscription {
  remove: () => void;
}

/**
 * Request a preferred audio output route for playback (Voice Agent calls,
 * TTS, etc.). Routing is best-effort and device-dependent: the OS can
 * override the request (a wired headset always wins), and `bluetooth` only
 * takes effect when a compatible headset is connected.
 *
 * The preference survives playback/recording restarts until you change it,
 * pass `'auto'` to clear it, or the user switches the output themselves
 * (their pick is then adopted rather than fought).
 *
 * @param route Preferred route. See {@link DeepgramAudioRoute}.
 * @throws {import('./types/errors').DeepgramError} with a typed `code` if the
 *   native layer rejects the change.
 */
export async function setAudioRoute(route: DeepgramAudioRoute): Promise<void> {
  try {
    await Deepgram.setAudioRoute(route);
  } catch (err) {
    throw toDeepgramError(err);
  }
}

/**
 * Resolve the audio output route the system is currently using. Reflects the
 * *actual* route, which may differ from the last {@link setAudioRoute} request
 * (e.g. the user plugged in headphones).
 */
export async function getAudioRoute(): Promise<DeepgramActiveAudioRoute> {
  try {
    return await Deepgram.getAudioRoute();
  } catch (err) {
    throw toDeepgramError(err);
  }
}

/**
 * Subscribe to output-route changes (headphone plug/unplug, Bluetooth
 * connect/disconnect, speaker ↔ earpiece switches). The callback receives the
 * new active route.
 *
 * @example
 * const sub = addAudioRouteChangeListener((route) => {
 *   console.log('audio now playing through', route);
 * });
 * // later
 * sub.remove();
 */
export function addAudioRouteChangeListener(
  listener: (route: DeepgramActiveAudioRoute) => void
): AudioRouteSubscription {
  return Deepgram.onAudioRouteChange(listener);
}
