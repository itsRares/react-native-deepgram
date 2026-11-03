import type { EventSubscription } from 'react-native';
import NativeDeepgram from './NativeDeepgram';
import type {
  AudioInterruptionEvent,
  AudioLevelEvent,
  AudioPCMEvent,
  Spec,
} from './NativeDeepgram';

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
   * the generated `file://` URI from {@link Deepgram.stopRecording}.
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
   * {@link Deepgram.stopRecording}.
   */
  recordToFile?: RecordToFileOptions;
}

/**
 * Resolved value of {@link Deepgram.stopRecording}. Contains the captured
 * file URI when `recordToFile` was enabled for the session; otherwise `null`.
 */
export interface DeepgramRecordingResult {
  /** `file://` URI of the recorded audio file, when one was produced. */
  recordingUri?: string;
}

/**
 * Requestable audio output routes for {@link Deepgram.setAudioRoute}.
 * `auto` clears any preference and lets the OS manage the route.
 */
export type DeepgramAudioRoute = 'speaker' | 'earpiece' | 'bluetooth' | 'auto';

/**
 * The output route the system is actually using, as reported by
 * {@link Deepgram.getAudioRoute} and the route-change event. `wired`
 * covers headphones / USB / car audio — outputs the OS routes to
 * automatically and that cannot be requested explicitly.
 */
export type DeepgramActiveAudioRoute =
  'speaker' | 'earpiece' | 'bluetooth' | 'wired';

export type { AudioInterruptionEvent, AudioLevelEvent, AudioPCMEvent };

const LINKING_ERROR =
  'react-native-deepgram: the native module is not linked. Rebuild the app ' +
  '(run "pod install" on iOS) and make sure the New Architecture is enabled.';

const getNative = (): Spec => {
  if (!NativeDeepgram) {
    throw new Error(LINKING_ERROR);
  }
  return NativeDeepgram;
};

/** Low-level access to the native audio module used by the hooks. */
export const Deepgram = {
  requestRecordPermission(): Promise<boolean> {
    return getNative().requestRecordPermission();
  },
  startRecording(options: StartRecordingOptions = {}): Promise<void> {
    return getNative().startRecording(options);
  },
  stopRecording(): Promise<DeepgramRecordingResult | null> {
    return getNative().stopRecording();
  },
  setMeteringEnabled(enabled: boolean, intervalMs = 0): void {
    getNative().setMeteringEnabled(enabled, intervalMs);
  },
  startAudio(): Promise<void> {
    return getNative().startAudio();
  },
  stopAudio(): Promise<void> {
    return getNative().stopAudio();
  },
  startPlayer(sampleRate: number, channels = 1): void {
    getNative().startPlayer(sampleRate, channels);
  },
  setAudioConfig(sampleRate: number, channels = 1): void {
    getNative().setAudioConfig(sampleRate, channels);
  },
  feedAudio(base64Chunk: string): void {
    getNative().feedAudio(base64Chunk);
  },
  playAudioChunk(base64Chunk: string): Promise<void> {
    return getNative().playAudioChunk(base64Chunk);
  },
  interruptAudio(): void {
    getNative().interruptAudio();
  },
  stopPlayer(): Promise<void> {
    return getNative().stopPlayer();
  },
  setAudioRoute(route: DeepgramAudioRoute): Promise<void> {
    return getNative().setAudioRoute(route);
  },
  getAudioRoute(): Promise<DeepgramActiveAudioRoute> {
    return getNative().getAudioRoute() as Promise<DeepgramActiveAudioRoute>;
  },
  /** Microphone PCM16 frames (base64) while recording. */
  onAudioPCM(listener: (event: AudioPCMEvent) => void): EventSubscription {
    return getNative().onAudioPCM(listener);
  },
  /** Normalized (0..1) microphone level while metering is enabled. */
  onAudioLevel(listener: (event: AudioLevelEvent) => void): EventSubscription {
    return getNative().onAudioLevel(listener);
  },
  onAudioRouteChange(
    listener: (route: DeepgramActiveAudioRoute) => void
  ): EventSubscription {
    return getNative().onAudioRouteChange((event) =>
      listener(event.route as DeepgramActiveAudioRoute)
    );
  },
  onAudioInterruption(
    listener: (event: AudioInterruptionEvent) => void
  ): EventSubscription {
    return getNative().onAudioInterruption(listener);
  },
};
