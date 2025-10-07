export interface DeepgramVoiceAgentContextMessage {
  type: string;
  role?: 'user' | 'assistant' | 'system';
  content?: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentFlags {
  history?: boolean;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentAudioConfig {
  encoding?: string;
  sample_rate?: number;
  bitrate?: number;
  container?: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentAudioSettings {
  input?: DeepgramVoiceAgentAudioConfig;
  output?: DeepgramVoiceAgentAudioConfig;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentListenProvider {
  type?: string;
  model?: string;
  keyterms?: string[];
  smart_format?: boolean;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentThinkProvider {
  type?: string;
  model?: string;
  temperature?: number;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentFunctionDefinition {
  id?: string;
  name: string;
  description?: string;
  arguments?: string;
  client_side?: boolean;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentFunctionEndpoint {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentFunctionConfig {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  endpoint?: DeepgramVoiceAgentFunctionEndpoint;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentListenConfig {
  provider?: DeepgramVoiceAgentListenProvider;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentThinkConfig {
  provider?: DeepgramVoiceAgentThinkProvider;
  functions?: DeepgramVoiceAgentFunctionConfig[];
  prompt?: string;
  context_length?: number;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentSpeakConfig {
  provider?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentAgentConfig {
  language?: string;
  context?: {
    messages?: DeepgramVoiceAgentContextMessage[];
    [key: string]: unknown;
  };
  listen?: DeepgramVoiceAgentListenConfig;
  think?: DeepgramVoiceAgentThinkConfig;
  speak?: DeepgramVoiceAgentSpeakConfig;
  greeting?: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentSettings {
  tags?: string[];
  experimental?: boolean;
  flags?: DeepgramVoiceAgentFlags;
  mip_opt_out?: boolean;
  audio?: DeepgramVoiceAgentAudioSettings;
  agent?: DeepgramVoiceAgentAgentConfig;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentSettingsMessage
  extends DeepgramVoiceAgentSettings {
  type: 'Settings';
}

export interface DeepgramVoiceAgentUpdateSpeakMessage {
  type: 'UpdateSpeak';
  speak: DeepgramVoiceAgentSpeakConfig;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentInjectUserMessage {
  type: 'InjectUserMessage';
  content: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentInjectAgentMessage {
  type: 'InjectAgentMessage';
  message: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentFunctionCallResponseMessage {
  type: 'FunctionCallResponse';
  id: string;
  name: string;
  content: string;
  client_side?: boolean;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentKeepAliveMessage {
  type: 'KeepAlive';
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentUpdatePromptMessage {
  type: 'UpdatePrompt';
  prompt: string;
  [key: string]: unknown;
}

export type DeepgramVoiceAgentClientMessage =
  | DeepgramVoiceAgentSettingsMessage
  | DeepgramVoiceAgentUpdateSpeakMessage
  | DeepgramVoiceAgentInjectUserMessage
  | DeepgramVoiceAgentInjectAgentMessage
  | DeepgramVoiceAgentFunctionCallResponseMessage
  | DeepgramVoiceAgentKeepAliveMessage
  | DeepgramVoiceAgentUpdatePromptMessage;

export interface DeepgramVoiceAgentWelcomeMessage {
  type: 'Welcome';
  request_id: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentSettingsAppliedMessage {
  type: 'SettingsApplied';
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentConversationTextMessage {
  type: 'ConversationText';
  role: string;
  content: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentAgentThinkingMessage {
  type: 'AgentThinking';
  content: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentAgentStartedSpeakingMessage {
  type: 'AgentStartedSpeaking';
  total_latency?: number;
  tts_latency?: number;
  ttt_latency?: number;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentAgentAudioDoneMessage {
  type: 'AgentAudioDone';
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentUserStartedSpeakingMessage {
  type: 'UserStartedSpeaking';
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentFunctionCallRequestMessage {
  type: 'FunctionCallRequest';
  functions: DeepgramVoiceAgentFunctionDefinition[];
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentReceiveFunctionCallResponseMessage {
  type: 'FunctionCallResponse';
  id: string;
  name: string;
  content: string;
  client_side?: boolean;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentPromptUpdatedMessage {
  type: 'PromptUpdated';
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentSpeakUpdatedMessage {
  type: 'SpeakUpdated';
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentInjectionRefusedMessage {
  type: 'InjectionRefused';
  message: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentErrorMessage {
  type: 'Error';
  description: string;
  code?: string;
  [key: string]: unknown;
}

export interface DeepgramVoiceAgentWarningMessage {
  type: 'Warning';
  description: string;
  code?: string;
  [key: string]: unknown;
}

export type DeepgramVoiceAgentServerMessage =
  | DeepgramVoiceAgentWelcomeMessage
  | DeepgramVoiceAgentSettingsAppliedMessage
  | DeepgramVoiceAgentConversationTextMessage
  | DeepgramVoiceAgentAgentThinkingMessage
  | DeepgramVoiceAgentAgentStartedSpeakingMessage
  | DeepgramVoiceAgentAgentAudioDoneMessage
  | DeepgramVoiceAgentUserStartedSpeakingMessage
  | DeepgramVoiceAgentFunctionCallRequestMessage
  | DeepgramVoiceAgentReceiveFunctionCallResponseMessage
  | DeepgramVoiceAgentPromptUpdatedMessage
  | DeepgramVoiceAgentSpeakUpdatedMessage
  | DeepgramVoiceAgentInjectionRefusedMessage
  | DeepgramVoiceAgentErrorMessage
  | DeepgramVoiceAgentWarningMessage
  | DeepgramVoiceAgentSettingsMessage
  | DeepgramVoiceAgentUpdateSpeakMessage
  | DeepgramVoiceAgentInjectUserMessage
  | DeepgramVoiceAgentInjectAgentMessage
  | DeepgramVoiceAgentFunctionCallResponseMessage
  | DeepgramVoiceAgentKeepAliveMessage
  | DeepgramVoiceAgentUpdatePromptMessage
  | { type: string; [key: string]: unknown };
