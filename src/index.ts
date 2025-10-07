export { useDeepgramSpeechToText } from './useDeepgramSpeechToText';
export { useDeepgramTextIntelligence } from './useDeepgramTextIntelligence';
export { useDeepgramManagement } from './useDeepgramManagement';
export { useDeepgramTextToSpeech } from './useDeepgramTextToSpeech';
export { useDeepgramVoiceAgent } from './useDeepgramVoiceAgent';
export { Deepgram } from './NativeDeepgram';
export type {
  DeepgramTextToSpeechModel,
  DeepgramTextToSpeechEncoding,
  DeepgramTextToSpeechHttpEncoding,
  DeepgramTextToSpeechStreamEncoding,
  DeepgramTextToSpeechSampleRate,
  DeepgramTextToSpeechCallbackMethod,
  DeepgramTextToSpeechContainer,
  DeepgramTextToSpeechBitRate,
  DeepgramTextToSpeechHttpOptions,
  DeepgramTextToSpeechStreamOptions,
  DeepgramTextToSpeechStreamInputMessage,
  DeepgramTextToSpeechStreamMetadataMessage,
  DeepgramTextToSpeechStreamFlushedMessage,
  DeepgramTextToSpeechStreamClearedMessage,
  DeepgramTextToSpeechStreamWarningMessage,
  DeepgramTextToSpeechStreamResponseMessage,
  UseDeepgramTextToSpeechOptions,
  UseDeepgramTextToSpeechProps,
  UseDeepgramTextToSpeechReturn,
} from './types';

export const configure = (opts: { apiKey: string }) => {
  (globalThis as any).__DEEPGRAM_API_KEY__ = opts.apiKey;
};
