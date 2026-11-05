import { DeviceEventEmitter } from 'react-native';
import type { Spec } from '../src/NativeDeepgram';

type Listener = (event: never) => void;

const eventEmitter = (name: string) => (listener: Listener) =>
  DeviceEventEmitter.addListener(name, listener);

/**
 * Manual mock of the TurboModule. Tests drive native events with
 * `DeviceEventEmitter.emit('<spec event name>', payload)`, e.g. `'onAudioPCM'`.
 */
const NativeDeepgramMock = {
  requestRecordPermission: jest.fn(() => Promise.resolve(true)),
  startRecording: jest.fn(() => Promise.resolve()),
  stopRecording: jest.fn(() => Promise.resolve(null)),
  setMeteringEnabled: jest.fn(),
  startAudio: jest.fn(() => Promise.resolve()),
  stopAudio: jest.fn(() => Promise.resolve()),
  startPlayer: jest.fn(),
  setAudioConfig: jest.fn(),
  feedAudio: jest.fn(),
  playAudioChunk: jest.fn(() => Promise.resolve()),
  interruptAudio: jest.fn(),
  stopPlayer: jest.fn(() => Promise.resolve()),
  setAudioRoute: jest.fn((_route: string) => Promise.resolve()),
  getAudioRoute: jest.fn(() => Promise.resolve('speaker')),
  onAudioPCM: eventEmitter('onAudioPCM'),
  onAudioLevel: eventEmitter('onAudioLevel'),
  onAudioRouteChange: eventEmitter('onAudioRouteChange'),
  onAudioInterruption: eventEmitter('onAudioInterruption'),
};

export default NativeDeepgramMock as unknown as Spec &
  typeof NativeDeepgramMock;
