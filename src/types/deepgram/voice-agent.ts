/**
 * Message in the conversation history.
 */
export interface DeepgramVoiceAgentContextMessage {
  /** Message type discriminator (e.g. `'History'`). */
  type: string;
  /** Role of the speaker for the message. */
  role?: 'user' | 'assistant' | 'system';
  /** Text content of the message. */
  content?: string;
  [key: string]: unknown;
}

/**
 * Feature flags for the Voice Agent session.
 */
export interface DeepgramVoiceAgentFlags {
  /**
   * Whether to include function call history in the conversation context.
   * Defaults to `true`; set to `false` to disable function call history.
   */
  history?: boolean;
  [key: string]: unknown;
}

/**
 * Encoding/format configuration for a single audio stream (input or output).
 */
export interface DeepgramVoiceAgentAudioConfig {
  /** Audio encoding format (e.g. `'linear16'`, `'mp3'`). */
  encoding?: string;
  /** Sample rate in Hz. */
  sample_rate?: number;
  /** Bitrate in bits per second (output audio only). */
  bitrate?: number;
  /** Container format for the output audio (e.g. `'none'`, `'wav'`). */
  container?: string;
  [key: string]: unknown;
}

/**
 * Input and output audio media configuration for the agent.
 */
export interface DeepgramVoiceAgentAudioSettings {
  /** Speech-to-text audio media input configuration. */
  input?: DeepgramVoiceAgentAudioConfig;
  /** Text-to-speech audio media output configuration. */
  output?: DeepgramVoiceAgentAudioConfig;
  [key: string]: unknown;
}

/**
 * Speech-to-text provider configuration for the agent's `listen` stage.
 */
export interface DeepgramVoiceAgentListenProvider {
  /** Speech-to-text provider type. Currently only `'deepgram'` is supported. */
  type?: string;
  /** Deepgram speech-to-text model to use. */
  model?: string;
  /** Listen API version, e.g. `'v2'` for Flux models (`'v1'` otherwise). */
  version?: string;
  /** Key terms to increase recognition accuracy for. */
  keyterms?: string[];
  /**
   * Array of BCP-47 language codes that bias detection toward specific
   * languages. Only supported with the `flux-general-multi` model.
   */
  language_hints?: string[];
  /**
   * Confidence threshold required to trigger an end-of-turn event. Higher
   * values reduce false positives but increase latency. Valid range
   * `0.5`–`0.9`, defaults to `0.7`. Flux models only.
   */
  eot_threshold?: number;
  /**
   * Confidence threshold for eager end-of-turn detection, triggering events
   * before the user fully finishes speaking. Must be ≤ `eot_threshold`. Valid
   * range `0.3`–`0.9`. Flux models only.
   */
  eager_eot_threshold?: number;
  /**
   * Hard timeout in milliseconds — a turn finishes once this much time passes
   * after speech, regardless of EOT confidence. Defaults to `5000`. Flux only.
   */
  eot_timeout_ms?: number;
  /**
   * Apply smart formatting to improve transcript readability (Deepgram
   * providers only). Defaults to `false`. Not available with Flux.
   */
  smart_format?: boolean;
  [key: string]: unknown;
}

/**
 * LLM provider configuration for the agent's `think` stage.
 */
export interface DeepgramVoiceAgentThinkProvider {
  /** LLM provider type (e.g. `'open_ai'`, `'anthropic'`). */
  type?: string;
  /** LLM model to use. */
  model?: string;
  /** Controls randomness of the LLM output. Range depends on the provider. */
  temperature?: number;
  [key: string]: unknown;
}

/**
 * A function the agent may call, as referenced in a function call request.
 */
export interface DeepgramVoiceAgentFunctionDefinition {
  /** Unique identifier for this function call. */
  id?: string;
  /** Name of the function. */
  name: string;
  /** Human-readable description of what the function does. */
  description?: string;
  /** JSON-encoded arguments for the function call. */
  arguments?: string;
  /** Whether the function is executed on the client rather than via endpoint. */
  client_side?: boolean;
  [key: string]: unknown;
}

/**
 * HTTP endpoint Deepgram calls to execute a server-side function.
 */
export interface DeepgramVoiceAgentFunctionEndpoint {
  /** URL of the function endpoint. */
  url: string;
  /** HTTP method to use for the request. */
  method?: string;
  /** HTTP headers to include with the request. */
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Definition of a function the agent can call during the conversation.
 */
export interface DeepgramVoiceAgentFunctionConfig {
  /** Name of the function. */
  name: string;
  /** Human-readable description of what the function does. */
  description?: string;
  /** JSON Schema describing the function's parameters. */
  parameters?: Record<string, unknown>;
  /** Endpoint to call; if omitted, the function is executed client-side. */
  endpoint?: DeepgramVoiceAgentFunctionEndpoint;
  [key: string]: unknown;
}

/**
 * Speech-to-text configuration for the agent's `listen` stage.
 */
export interface DeepgramVoiceAgentListenConfig {
  /** Speech-to-text provider configuration. */
  provider?: DeepgramVoiceAgentListenProvider;
  [key: string]: unknown;
}

/**
 * LLM configuration for the agent's `think` stage.
 */
export interface DeepgramVoiceAgentThinkConfig {
  /** LLM provider configuration. */
  provider?: DeepgramVoiceAgentThinkProvider;
  /** Functions the agent can call during the conversation. */
  functions?: DeepgramVoiceAgentFunctionConfig[];
  /** System prompt that defines the agent's behavior and personality. */
  prompt?: string;
  /**
   * Number of characters retained in context between messages, responses, and
   * function calls. Use `'max'` for the provider's maximum context length.
   */
  context_length?: number;
  [key: string]: unknown;
}

/**
 * Text-to-speech configuration for the agent's `speak` stage.
 */
export interface DeepgramVoiceAgentSpeakConfig {
  /** Text-to-speech provider configuration. */
  provider?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Core agent configuration covering language, context, and the
 * listen/think/speak provider pipeline.
 */
export interface DeepgramVoiceAgentAgentConfig {
  /**
   * Language code for the agent. Defaults to `'en'`.
   * @deprecated Use `listen.provider.language` and `speak.provider.language`.
   */
  language?: string;
  /** Optional conversation context, including prior messages and function calls. */
  context?: {
    /** Previous conversation messages and function calls for agent context. */
    messages?: DeepgramVoiceAgentContextMessage[];
    [key: string]: unknown;
  };
  /** Speech-to-text configuration. */
  listen?: DeepgramVoiceAgentListenConfig;
  /** LLM (reasoning) configuration. */
  think?: DeepgramVoiceAgentThinkConfig;
  /** Text-to-speech configuration. */
  speak?: DeepgramVoiceAgentSpeakConfig;
  /** Initial message the agent speaks when the conversation starts. */
  greeting?: string;
  [key: string]: unknown;
}

/**
 * Configuration for the Voice Agent.
 * @example
 * ```typescript
 * const settings: DeepgramVoiceAgentSettings = {
 *   agent: {
 *     think: {
 *       provider: { type: 'open_ai' },
 *       model: 'gpt-4o'
 *     }
 *   }
 * };
 * ```
 * @see https://developers.deepgram.com/docs/voice-agent
 */
export interface DeepgramVoiceAgentSettings {
  /** Tags to associate with the request for filtered searching. */
  tags?: string[];
  /** Enables experimental features. Defaults to `false`. */
  experimental?: boolean;
  /** Feature flags for the session. */
  flags?: DeepgramVoiceAgentFlags;
  /** Opt out of the Model Improvement Program. Defaults to `false`. */
  mip_opt_out?: boolean;
  /** Input and output audio media configuration. */
  audio?: DeepgramVoiceAgentAudioSettings;
  /** Core agent (listen/think/speak) configuration. */
  agent?: DeepgramVoiceAgentAgentConfig;
  [key: string]: unknown;
}

/**
 * Settings message sent immediately after connecting to initialize the agent.
 */
export interface DeepgramVoiceAgentSettingsMessage
  extends DeepgramVoiceAgentSettings {
  type: 'Settings';
}

/**
 * Update the `listen` (speech-to-text) configuration mid-conversation.
 */
export interface DeepgramVoiceAgentUpdateListenMessage {
  type: 'UpdateListen';
  /** New speech-to-text configuration to apply. */
  listen: DeepgramVoiceAgentListenConfig;
  [key: string]: unknown;
}

/**
 * Update the `think` (LLM) configuration mid-conversation.
 */
export interface DeepgramVoiceAgentUpdateThinkMessage {
  type: 'UpdateThink';
  /** New LLM configuration to apply. */
  think: DeepgramVoiceAgentThinkConfig;
  [key: string]: unknown;
}

/**
 * Update the `speak` (text-to-speech) configuration mid-conversation.
 */
export interface DeepgramVoiceAgentUpdateSpeakMessage {
  type: 'UpdateSpeak';
  /** New text-to-speech configuration to apply. */
  speak: DeepgramVoiceAgentSpeakConfig;
  [key: string]: unknown;
}

/**
 * Inject a text-based user message into the conversation.
 */
export interface DeepgramVoiceAgentInjectUserMessage {
  type: 'InjectUserMessage';
  /** Text content to inject as if spoken by the user. */
  content: string;
  [key: string]: unknown;
}

/**
 * Immediately trigger an agent statement mid-conversation.
 */
export interface DeepgramVoiceAgentInjectAgentMessage {
  type: 'InjectAgentMessage';
  /** The statement the agent should say. */
  message: string;
  /**
   * How the injection interacts with the current turn. `'default'` speaks only
   * when neither party is mid-turn (otherwise the server replies with
   * `InjectionRefused`); `'queue'` appends after any queued speech without
   * interrupting. Defaults to `'default'`.
   */
  behavior?: string;
  [key: string]: unknown;
}

/**
 * Client-sent response to a server `FunctionCallRequest`.
 */
export interface DeepgramVoiceAgentFunctionCallResponseMessage {
  type: 'FunctionCallResponse';
  /** Identifier matching the originating function call request. */
  id: string;
  /** Name of the function that was called. */
  name: string;
  /** Result of the function call. */
  content: string;
  /** Whether the function was executed on the client. */
  client_side?: boolean;
  [key: string]: unknown;
}

/**
 * Keep-alive ping to prevent the WebSocket from timing out.
 */
export interface DeepgramVoiceAgentKeepAliveMessage {
  type: 'KeepAlive';
  [key: string]: unknown;
}

/**
 * Update the agent's system prompt mid-conversation.
 */
export interface DeepgramVoiceAgentUpdatePromptMessage {
  type: 'UpdatePrompt';
  /** New system prompt for the agent. */
  prompt: string;
  [key: string]: unknown;
}

/**
 * Union of all messages that can be sent from the Client to the Voice Agent.
 */
export type DeepgramVoiceAgentClientMessage =
  | DeepgramVoiceAgentSettingsMessage
  | DeepgramVoiceAgentUpdateListenMessage
  | DeepgramVoiceAgentUpdateThinkMessage
  | DeepgramVoiceAgentUpdateSpeakMessage
  | DeepgramVoiceAgentInjectUserMessage
  | DeepgramVoiceAgentInjectAgentMessage
  | DeepgramVoiceAgentFunctionCallResponseMessage
  | DeepgramVoiceAgentKeepAliveMessage
  | DeepgramVoiceAgentUpdatePromptMessage;

/**
 * First message from the server confirming the connection is established.
 */
export interface DeepgramVoiceAgentWelcomeMessage {
  type: 'Welcome';
  /** Unique identifier for the agent session. */
  request_id: string;
  [key: string]: unknown;
}

/**
 * Confirms the `Settings` message was received and applied.
 */
export interface DeepgramVoiceAgentSettingsAppliedMessage {
  type: 'SettingsApplied';
  [key: string]: unknown;
}

/**
 * A finalized line of conversation text from either party.
 */
export interface DeepgramVoiceAgentConversationTextMessage {
  type: 'ConversationText';
  /** Role of the speaker (e.g. `'user'`, `'assistant'`). */
  role: string;
  /** Text content of the conversation turn. */
  content: string;
  [key: string]: unknown;
}

/**
 * Emitted while the agent is generating a response.
 */
export interface DeepgramVoiceAgentAgentThinkingMessage {
  type: 'AgentThinking';
  /** Intermediate reasoning content from the agent. */
  content: string;
  [key: string]: unknown;
}

/**
 * Emitted when the agent begins speaking, with latency diagnostics.
 */
export interface DeepgramVoiceAgentAgentStartedSpeakingMessage {
  type: 'AgentStartedSpeaking';
  /** Total end-to-end latency before speech started, in seconds. */
  total_latency?: number;
  /** Text-to-speech latency component, in seconds. */
  tts_latency?: number;
  /** Time-to-think (LLM) latency component, in seconds. */
  ttt_latency?: number;
  [key: string]: unknown;
}

/**
 * Emitted after the agent has finished sending all audio for a turn.
 */
export interface DeepgramVoiceAgentAgentAudioDoneMessage {
  type: 'AgentAudioDone';
  [key: string]: unknown;
}

/**
 * Emitted when the server detects the user has started speaking.
 */
export interface DeepgramVoiceAgentUserStartedSpeakingMessage {
  type: 'UserStartedSpeaking';
  [key: string]: unknown;
}

/**
 * Server request asking the client to execute one or more functions.
 */
export interface DeepgramVoiceAgentFunctionCallRequestMessage {
  type: 'FunctionCallRequest';
  /** Functions the client should execute. */
  functions: DeepgramVoiceAgentFunctionDefinition[];
  [key: string]: unknown;
}

/**
 * Server echo of a function call response (received form).
 */
export interface DeepgramVoiceAgentReceiveFunctionCallResponseMessage {
  type: 'FunctionCallResponse';
  /** Identifier matching the originating function call request. */
  id: string;
  /** Name of the function that was called. */
  name: string;
  /** Result of the function call. */
  content: string;
  /** Whether the function was executed on the client. */
  client_side?: boolean;
  [key: string]: unknown;
}

/**
 * Confirms an `UpdatePrompt` message was applied.
 */
export interface DeepgramVoiceAgentPromptUpdatedMessage {
  type: 'PromptUpdated';
  [key: string]: unknown;
}

/**
 * Confirms an `UpdateListen` message was applied.
 */
export interface DeepgramVoiceAgentListenUpdatedMessage {
  type: 'ListenUpdated';
  [key: string]: unknown;
}

/**
 * Confirms an `UpdateThink` message was applied.
 */
export interface DeepgramVoiceAgentThinkUpdatedMessage {
  type: 'ThinkUpdated';
  [key: string]: unknown;
}

/**
 * Confirms an `UpdateSpeak` message was applied.
 */
export interface DeepgramVoiceAgentSpeakUpdatedMessage {
  type: 'SpeakUpdated';
  [key: string]: unknown;
}

/**
 * Emitted when an `InjectAgentMessage` is refused because a turn is in progress.
 */
export interface DeepgramVoiceAgentInjectionRefusedMessage {
  type: 'InjectionRefused';
  /** Explanation of why the injection was refused. */
  message: string;
  [key: string]: unknown;
}

/**
 * Error message from the server.
 */
export interface DeepgramVoiceAgentErrorMessage {
  type: 'Error';
  /** Human-readable description of the error. */
  description: string;
  /** Machine-readable error code, when available. */
  code?: string;
  [key: string]: unknown;
}

/**
 * Warning message from the server.
 */
export interface DeepgramVoiceAgentWarningMessage {
  type: 'Warning';
  /** Human-readable description of the warning. */
  description: string;
  /** Machine-readable warning code, when available. */
  code?: string;
  [key: string]: unknown;
}

/**
 * Audio configuration descriptor accompanying the audio stream.
 */
export interface DeepgramVoiceAgentAudioConfigMessage {
  type: 'AudioConfig';
  /** Sample rate in Hz. */
  sample_rate?: number;
  /** Number of audio channels. */
  channels?: number;
  /** Audio encoding format. */
  encoding?: string;
  [key: string]: unknown;
}

/**
 * Wrapper for a binary audio payload received over the WebSocket.
 */
export interface DeepgramVoiceAgentAudioMessage {
  type: 'Audio';
  // Binary audio data will be in the WebSocket message payload
  [key: string]: unknown;
}

/**
 * A single function call record inside a History message.
 */
export interface DeepgramVoiceAgentHistoryFunctionCall {
  /** Unique identifier for the function call. */
  id?: string;
  /** Name of the function that was called. */
  name?: string;
  /** Whether the function was executed on the client. */
  client_side?: boolean;
  /** JSON-encoded arguments passed to the function. */
  arguments?: string;
  /** Result returned by the function. */
  response?: string;
  [key: string]: unknown;
}

/**
 * Conversation history replay message. Each entry is either a conversation text
 * (with role and content) or a function call record (with function_calls).
 */
export interface DeepgramVoiceAgentHistoryMessage {
  type: 'History';
  /** Role of the speaker for a conversation text entry. */
  role?: string;
  /** Text content for a conversation text entry. */
  content?: string;
  /** Function call records for a function call entry. */
  function_calls?: DeepgramVoiceAgentHistoryFunctionCall[];
  [key: string]: unknown;
}

/**
 * Union of all messages that can be received from the Voice Agent Server.
 */
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
  | DeepgramVoiceAgentListenUpdatedMessage
  | DeepgramVoiceAgentThinkUpdatedMessage
  | DeepgramVoiceAgentSpeakUpdatedMessage
  | DeepgramVoiceAgentInjectionRefusedMessage
  | DeepgramVoiceAgentErrorMessage
  | DeepgramVoiceAgentWarningMessage
  | DeepgramVoiceAgentHistoryMessage
  | DeepgramVoiceAgentAudioConfigMessage
  | DeepgramVoiceAgentAudioMessage
  | DeepgramVoiceAgentSettingsMessage
  | DeepgramVoiceAgentUpdateSpeakMessage
  | DeepgramVoiceAgentInjectUserMessage
  | DeepgramVoiceAgentInjectAgentMessage
  | DeepgramVoiceAgentFunctionCallResponseMessage
  | DeepgramVoiceAgentKeepAliveMessage
  | DeepgramVoiceAgentUpdatePromptMessage
  | { type: string; [key: string]: unknown };
