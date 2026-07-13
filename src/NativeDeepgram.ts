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
   * Container format for the recording. Only uncompressed `wav` (PCM16 mono
   * at the active capture rate) is currently supported; this mirrors the
   * audio that is streamed to Deepgram.
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
  /**
   * Capture sample rate in Hz. Supported values: `16000` (default), `24000`
   * and `48000`. Other values are rejected with the `invalid_data` code. If
   * the device cannot capture at the requested rate the native module falls
   * back to 16 kHz rather than failing the session — the rate actually in
   * effect is reported via {@link DeepgramStartRecordingResult.sampleRate}
   * and tagged on every emitted audio chunk event.
   */
  sampleRate?: 16000 | 24000 | 48000;
}

/**
 * Resolved value of {@link DeepgramNative.startRecording}.
 */
export interface DeepgramStartRecordingResult {
  /** The capture sample rate (Hz) actually in effect for the session. */
  sampleRate?: number;
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
 * Requestable audio output routes for {@link DeepgramNative.setAudioRoute}.
 * `auto` clears any preference and lets the OS manage the route.
 */
export type DeepgramAudioRoute = 'speaker' | 'earpiece' | 'bluetooth' | 'auto';

/**
 * The output route the system is actually using, as reported by
 * {@link DeepgramNative.getAudioRoute} and the route-change event. `wired`
 * covers headphones / USB / car audio — outputs the OS routes to
 * automatically and that cannot be requested explicitly.
 */
export type DeepgramActiveAudioRoute =
  | 'speaker'
  | 'earpiece'
  | 'bluetooth'
  | 'wired';

interface DeepgramNative {
  startRecording(
    options?: StartRecordingOptions
  ): Promise<DeepgramStartRecordingResult | null | void>;
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
    return Promise.resolve();
  },
  getAudioRoute() {
    if (typeof NativeDeepgramModule.getAudioRoute === 'function') {
      return NativeDeepgramModule.getAudioRoute();
    }
    return Promise.resolve('speaker' as DeepgramActiveAudioRoute);
  },
};
