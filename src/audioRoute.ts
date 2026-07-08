import { NativeEventEmitter, NativeModules } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import type {
  DeepgramAudioRoute,
  DeepgramActiveAudioRoute,
} from './NativeDeepgram';
import { toDeepgramError } from './types/errors';

// Shared native → JS event name on both platforms.
const ROUTE_CHANGE_EVENT = 'DeepgramRouteChange';

let cachedEmitter: NativeEventEmitter | null = null;
const getEmitter = (): NativeEventEmitter => {
  if (!cachedEmitter) {
    cachedEmitter = new NativeEventEmitter(NativeModules.Deepgram);
  }
  return cachedEmitter;
};

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
    await Deepgram.setAudioRoute?.(route);
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
    const route = await Deepgram.getAudioRoute?.();
    return route ?? 'speaker';
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
  const subscription = getEmitter().addListener(
    ROUTE_CHANGE_EVENT,
    (payload: { route?: DeepgramActiveAudioRoute } | undefined) => {
      listener(payload?.route ?? 'speaker');
    }
  );
  return { remove: () => subscription.remove() };
}
