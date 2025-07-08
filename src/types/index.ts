export type ConversationPhrase = {
  role: string;
  text: string;
};

export interface VoiceAgentController {
  sendInitialIntructions(instructions: string): Promise<void>;
  setInitialConversationPhrases(phrases: ConversationPhrase[]): Promise<void>;
  makeAgentSay(text: string): Promise<void>;
  startConversation(): Promise<void>;
}

export * from './deepgram';
