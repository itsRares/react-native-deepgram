export type UseDeepgramSpeechToTextProps = {
  /** Called before any setup (e.g. before permission prompt) */
  onBeforeStart?: () => void;
  /** Called once the WebSocket is open */
  onStart?: () => void;
  /** Called on every transcript update */
  onTranscript?: (transcript: string) => void;
  /** Called on any error */
  onError?: (error: unknown) => void;
  /** Called when the session ends or WebSocket closes */
  onEnd?: () => void;
  /** Called before starting file transcription (e.g. show spinner) */
  onBeforeTranscribe?: () => void;
  /** Called when file transcription completes with the final transcript */
  onTranscribeSuccess?: (transcript: string) => void;
  /** Called if file transcription fails */
  onTranscribeError?: (error: unknown) => void;
};

export type UseDeepgramSpeechToTextReturn = {
  /** Begin capturing mic audio and streaming to Deepgram STT */
  startListening: () => void;
  /** Stop the mic capture & close connection */
  stopListening: () => void;
  /** Transcribe a file (e.g. audio file) using Deepgram */
  transcribeFile: (
    file: Blob | { uri: string; name?: string; type?: string }
  ) => Promise<void>;
};
