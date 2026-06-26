import { NativeModules } from 'react-native';

/**
 * Options for persisting the captured microphone audio to a file while it is
 * simultaneously streamed to Deepgram.
 */
export interface RecordToFileOptions {
  /** Enable writing the live microphone capture to a file. */
  enabled: boolean;
  /**
   * Absolute destination path (with or without a `file://` prefix). When
   * omitted, the native module writes to an app-specific location and returns
   * the generated `file://` URI from {@link DeepgramNative.stopRecording}.
   */
  path?: string;
  /**
   * Container format for the recording. Only uncompressed `wav` (16 kHz PCM16
   * mono) is currently supported; this mirrors the audio that is streamed to
   * Deepgram.
   */
  format?: 'wav';
}

export interface StartRecordingOptions {
  /**
   * When `true`, the native module configures the platform's hardware echo
   * cancellation (Apple VPIO on iOS, AudioSource.VOICE_COMMUNICATION +
   * MODE_IN_COMMUNICATION on Android). Use this for full-duplex Voice Agent
   * sessions where the speaker output would otherwise be picked up by the
   * microphone and re-transcribed.
   *
   * Defaults to `false` — pure speech-to-text usage benefits from raw
   * (un-AEC'd) audio because Deepgram's models perform their own noise
   * handling and prefer the unprocessed signal.
   */
  enableVoiceProcessing?: boolean;
  /**
   * When provided with `enabled: true`, the native module tees every captured
   * PCM buffer into an audio file alongside the live Deepgram stream. The
   * resulting `file://` URI is returned when recording stops via
   * {@link DeepgramNative.stopRecording}.
   */
  recordToFile?: RecordToFileOptions;
}

/**
 * Resolved value of {@link DeepgramNative.stopRecording}. Contains the captured
 * file URI when `recordToFile` was enabled for the session; otherwise `null`.
 */
export interface DeepgramRecordingResult {
  /** `file://` URI of the recorded audio file, when one was produced. */
  recordingUri?: string;
}

/**
 * Preferred audio output route requested via {@link DeepgramNative.setAudioRoute}.
 *
 * - `speaker` — force the loudspeaker.
 * - `earpiece` — force the phone earpiece/receiver (quiet, held-to-ear).
 * - `bluetooth` — prefer a connected Bluetooth headset (HFP) when available.
 * - `auto` — clear any override and let the OS pick the default route.
 *
 * Routing is best-effort: the operating system can override a request (e.g. a
 * wired headset always wins) and availability is device-dependent.
 */
export type DeepgramAudioRoute = 'speaker' | 'earpiece' | 'bluetooth' | 'auto';

/**
 * Actual audio output route reported by {@link DeepgramNative.getAudioRoute} and
 * the `onRouteChange` listener. `wired` covers headphones / USB / HDMI / car
 * audio, none of which can be selected explicitly (the OS routes to them
 * automatically when connected).
 */
export type DeepgramActiveAudioRoute =
  | 'speaker'
  | 'earpiece'
  | 'bluetooth'
  | 'wired';

/**
 * A single selectable audio output device reported by
 * {@link DeepgramNative.getAudioDevices} and the `DeepgramAudioDevices` change
 * event.
 *
 * Unlike the coarse {@link DeepgramAudioRoute} categories, each connected
 * Bluetooth headset is reported as its own device, so a UI can list (and let
 * the user pick) between several of them by name.
 */
export interface DeepgramAudioDevice {
  /**
   * Stable platform identifier for the device. On iOS this is the audio port
   * `UID`; on Android it is the `AudioDeviceInfo` id (as a string). Pass this
   * value to {@link DeepgramNative.selectAudioDevice}.
   */
  id: string;
  /** Human-readable name, e.g. `"AirPods Pro"`, `"Speaker"`, `"Earpiece"`. */
  name: string;
  /** Coarse category the device belongs to. */
  type: DeepgramActiveAudioRoute;
  /** Whether this device is the one audio is currently routed through. */
  selected: boolean;
}

interface DeepgramNative {
  startRecording(options?: StartRecordingOptions): Promise<void>;
  stopRecording(): Promise<DeepgramRecordingResult | null>;
  startAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  playAudioChunk(chunk: string): Promise<void>;
  setAudioConfig(sampleRate: number, channels?: number): void;
  feedAudio(base64Chunk: string): void;
  interruptAudio?: () => void;
  stopPlayer(): void;
  startPlayer(sampleRate: number, channels?: number): void;
  setMeteringEnabled?: (enabled: boolean, intervalMs?: number) => void;
  setAudioRoute?: (route: DeepgramAudioRoute) => Promise<void>;
  getAudioRoute?: () => Promise<DeepgramActiveAudioRoute>;
  getAudioDevices?: () => Promise<DeepgramAudioDevice[]>;
  selectAudioDevice?: (deviceId: string) => Promise<void>;
}

const LINKING_ERROR = `react-native-deepgram: Native code not linked—did you run “pod install” & rebuild?`;

const NativeDeepgramModule: DeepgramNative =
  NativeModules.Deepgram ??
  (new Proxy(
    {},
    {
      get() {
        throw new Error(LINKING_ERROR);
      },
    }
  ) as any);

export const Deepgram: DeepgramNative = {
  startRecording(options: StartRecordingOptions = {}) {
    return NativeDeepgramModule.startRecording(options);
  },
  stopRecording() {
    return NativeDeepgramModule.stopRecording();
  },
  startAudio() {
    return NativeDeepgramModule.startAudio();
  },
  stopAudio() {
    return NativeDeepgramModule.stopAudio();
  },
  playAudioChunk(chunk: string) {
    return NativeDeepgramModule.playAudioChunk(chunk);
  },
  setAudioConfig(sampleRate: number, channels?: number) {
    return NativeDeepgramModule.setAudioConfig(sampleRate, channels);
  },
  feedAudio(base64Chunk: string) {
    return NativeDeepgramModule.feedAudio(base64Chunk);
  },
  interruptAudio() {
    if (typeof NativeDeepgramModule.interruptAudio === 'function') {
      return NativeDeepgramModule.interruptAudio();
    }
    return NativeDeepgramModule.stopPlayer();
  },
  stopPlayer() {
    return NativeDeepgramModule.stopPlayer();
  },
  startPlayer(sampleRate: number, channels?: number) {
    return NativeDeepgramModule.startPlayer(sampleRate, channels);
  },
  setMeteringEnabled(enabled: boolean, intervalMs?: number) {
    if (typeof NativeDeepgramModule.setMeteringEnabled === 'function') {
      return NativeDeepgramModule.setMeteringEnabled(enabled, intervalMs);
    }
  },
  setAudioRoute(route: DeepgramAudioRoute) {
    if (typeof NativeDeepgramModule.setAudioRoute === 'function') {
      return NativeDeepgramModule.setAudioRoute(route);
    }
    // Older native build without route control — treat as a no-op so callers
    // don't have to feature-detect.
    return Promise.resolve();
  },
  getAudioRoute() {
    if (typeof NativeDeepgramModule.getAudioRoute === 'function') {
      return NativeDeepgramModule.getAudioRoute();
    }
    return Promise.resolve('speaker' as DeepgramActiveAudioRoute);
  },
  getAudioDevices() {
    if (typeof NativeDeepgramModule.getAudioDevices === 'function') {
      return NativeDeepgramModule.getAudioDevices();
    }
    // Older native build without device enumeration — report nothing so
    // callers can fall back to the coarse setAudioRoute() API.
    return Promise.resolve([] as DeepgramAudioDevice[]);
  },
  selectAudioDevice(deviceId: string) {
    if (typeof NativeDeepgramModule.selectAudioDevice === 'function') {
      return NativeDeepgramModule.selectAudioDevice(deviceId);
    }
    return Promise.resolve();
  },
};
