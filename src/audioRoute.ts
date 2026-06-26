import { NativeEventEmitter, NativeModules } from 'react-native';
import { Deepgram } from './NativeDeepgram';
import type {
  DeepgramAudioRoute,
  DeepgramActiveAudioRoute,
  DeepgramAudioDevice,
} from './NativeDeepgram';
import { toDeepgramError } from './types';

// Shared native → JS event names on both platforms.
const ROUTE_CHANGE_EVENT = 'DeepgramRouteChange';
const DEVICES_CHANGE_EVENT = 'DeepgramAudioDevices';

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
 * Request a preferred audio output route for playback (Voice Agent calls, TTS,
 * etc.). Routing is best-effort and device-dependent: the OS can override the
 * request (a wired headset always wins), and `bluetooth` only takes effect when
 * a compatible headset is connected.
 *
 * The override is sticky for the audio session — it survives playback/recording
 * restarts until you change it again or pass `'auto'` to clear it.
 *
 * @param route Preferred route. See {@link DeepgramAudioRoute}.
 * @throws {import('./types').DeepgramError} with a typed `code` if the native
 *   layer rejects the change.
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
 * connect/disconnect, speaker↔earpiece switches). The callback receives the new
 * active route.
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

/**
 * Enumerate the audio output devices currently available for routing. Each
 * connected Bluetooth headset is listed as its own {@link DeepgramAudioDevice},
 * so a UI can present (and let the user pick between) several of them by name.
 *
 * The list reflects the live hardware state — call it again, or subscribe with
 * {@link addAudioDevicesChangeListener}, after a headset connects/disconnects.
 *
 * @returns the available devices, with exactly one marked `selected`.
 */
export async function getAudioDevices(): Promise<DeepgramAudioDevice[]> {
  try {
    const devices = await Deepgram.getAudioDevices?.();
    return devices ?? [];
  } catch (err) {
    throw toDeepgramError(err);
  }
}

/**
 * Route audio to a specific device by its {@link DeepgramAudioDevice.id}. Use
 * this (rather than {@link setAudioRoute}) when several devices share a coarse
 * category — e.g. two Bluetooth headsets — and the user picked one explicitly.
 *
 * The selection is sticky for the audio session: it survives playback/recording
 * restarts and is re-applied after route reconfigurations until you select a
 * different device or call `setAudioRoute('auto')`.
 *
 * @param deviceId An `id` from {@link getAudioDevices}.
 * @throws {import('./types').DeepgramError} with a typed `code` if the device is
 *   unknown/unavailable or the native layer rejects the change.
 */
export async function selectAudioDevice(deviceId: string): Promise<void> {
  try {
    await Deepgram.selectAudioDevice?.(deviceId);
  } catch (err) {
    throw toDeepgramError(err);
  }
}

/**
 * Payload delivered to {@link addAudioDevicesChangeListener} subscribers
 * whenever the set of available devices, or the active device, changes.
 */
export interface AudioDevicesChangeEvent {
  /** The devices currently available for routing. */
  devices: DeepgramAudioDevice[];
  /** `id` of the active device, or `null` if none is selected yet. */
  selectedId: string | null;
}

/**
 * Subscribe to audio-device changes (headset connect/disconnect, route
 * switches). The callback receives the full device list plus the active
 * device's id — ideal for driving a live output-device picker.
 *
 * @example
 * const sub = addAudioDevicesChangeListener(({ devices, selectedId }) => {
 *   setDevices(devices);
 *   setSelected(selectedId);
 * });
 * // later
 * sub.remove();
 */
export function addAudioDevicesChangeListener(
  listener: (event: AudioDevicesChangeEvent) => void
): AudioRouteSubscription {
  const subscription = getEmitter().addListener(
    DEVICES_CHANGE_EVENT,
    (payload: Partial<AudioDevicesChangeEvent> | undefined) => {
      listener({
        devices: payload?.devices ?? [],
        selectedId: payload?.selectedId ?? null,
      });
    }
  );
  return { remove: () => subscription.remove() };
}
