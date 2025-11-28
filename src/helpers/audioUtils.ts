import { Buffer } from 'buffer';

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Buffer.from(bytes).toString('base64');
}

export function createAudioPlayerController() {
  let isActive = false;

  return {
    start: async (sampleRate = 16000, channels: 1 | 2 = 1) => {
      const { Deepgram } = await import('../NativeDeepgram');
      Deepgram.startPlayer?.(sampleRate, channels);
      isActive = true;
    },

    feed: async (audio: ArrayBuffer | string) => {
      const { Deepgram } = await import('../NativeDeepgram');
      const b64 = typeof audio === 'string' ? audio : arrayBufferToBase64(audio);
      await Deepgram.feedAudio?.(b64);
    },

    stop: async () => {
      const { Deepgram } = await import('../NativeDeepgram');
      Deepgram.stopPlayer?.();
      isActive = false;
    },

    isActive: () => isActive,
  };
}
