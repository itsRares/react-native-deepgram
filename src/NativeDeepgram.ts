import { NativeModules } from 'react-native';

interface DeepgramNative {
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  startAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  playAudioChunk(chunk: string): Promise<void>;
}

const LINKING_ERROR = `react-native-deepgram: Native code not linked—did you run “pod install” & rebuild?`;

export const Deepgram: DeepgramNative =
  NativeModules.DeepgramNative ??
  (new Proxy(
    {},
    {
      get() {
        throw new Error(LINKING_ERROR);
      },
    }
  ) as any);
