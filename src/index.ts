export { useDeepgramConversation } from './useDeepgramConversation';
export { UseDeepgramSpeechToText } from './UseDeepgramSpeechToText';
export { Deepgram } from './NativeDeepgram';

export const configure = (opts: { apiKey: string }) => {
  (globalThis as any).__DEEPGRAM_API_KEY__ = opts.apiKey;
};
