export { useDeepgramSpeechToText } from './useDeepgramSpeechToText';
export { useDeepgramTextIntelligence } from './useDeepgramTextIntelligence';
export { Deepgram } from './NativeDeepgram';

export const configure = (opts: { apiKey: string }) => {
  (globalThis as any).__DEEPGRAM_API_KEY__ = opts.apiKey;
};
