import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

export type RecordingResult = {
  recordingUri?: string;
};

export type AudioPCMEvent = {
  b64: string;
  sampleRate: number;
};

export type AudioLevelEvent = {
  level: number;
};

export type AudioRouteChangeEvent = {
  route: string;
};

export type AudioInterruptionEvent = {
  type: string;
  reason?: string;
  shouldResume?: boolean;
};

export interface Spec extends TurboModule {
  requestRecordPermission(): Promise<boolean>;

  /** `options` mirrors `StartRecordingOptions` in `native.ts`. */
  startRecording(options: CodegenTypes.UnsafeObject): Promise<void>;
  stopRecording(): Promise<RecordingResult | null>;
  setMeteringEnabled(enabled: boolean, intervalMs: number): void;

  startAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  startPlayer(sampleRate: number, channels: number): void;
  setAudioConfig(sampleRate: number, channels: number): void;
  feedAudio(base64Chunk: string): void;
  playAudioChunk(base64Chunk: string): Promise<void>;
  interruptAudio(): void;
  stopPlayer(): Promise<void>;

  setAudioRoute(route: string): Promise<void>;
  getAudioRoute(): Promise<string>;

  readonly onAudioPCM: CodegenTypes.EventEmitter<AudioPCMEvent>;
  readonly onAudioLevel: CodegenTypes.EventEmitter<AudioLevelEvent>;
  readonly onAudioRouteChange: CodegenTypes.EventEmitter<AudioRouteChangeEvent>;
  readonly onAudioInterruption: CodegenTypes.EventEmitter<AudioInterruptionEvent>;
}

export default TurboModuleRegistry.get<Spec>('Deepgram');
