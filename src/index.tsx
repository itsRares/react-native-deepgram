export { default as useDeepgramConversation } from './useDeepgramConversation';
export { Deepgram } from './NativeDeepgram';

export const configure = (opts: { apiKey: string }) => {
  globalThis.__DEEPGRAM_API_KEY__ = opts.apiKey;
};
