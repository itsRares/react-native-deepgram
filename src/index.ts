export { UseDeepgramSpeechToText } from './UseDeepgramSpeechToText';
export { useDeepgramTextIntelligence } from './useDeepgramTextIntelligence';
export { Deepgram } from './NativeDeepgram';

export const configure = (opts: { apiKey: string }) => {
  (globalThis as any).__DEEPGRAM_API_KEY__ = opts.apiKey;
};
