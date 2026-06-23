import { NativeModules } from 'react-native';

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
}

interface DeepgramNative {
  startRecording(options?: StartRecordingOptions): Promise<void>;
  stopRecording(): Promise<void>;
  startAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  playAudioChunk(chunk: string): Promise<void>;
  setAudioConfig(sampleRate: number, channels?: number): void;
  feedAudio(base64Chunk: string): void;
  interruptAudio?: () => void;
  stopPlayer(): void;
  startPlayer(sampleRate: number, channels?: number): void;
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
};
