import type { DeepgramReconnectOptions } from './shared';
import type { SessionStats } from './stats';
import type { DeepgramInterruptionEvent } from '../../interruption';

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
  /** Listen API version: `'v2'` for Flux models, `'v1'` otherwise. */
  version?: 'v1' | 'v2' | (string & {});
  /**
   * Transcription language for Nova models (`'multi'` for multilingual).
   * Flux models take the language from the model name.
   */
  language?: string;
  /** Key terms to increase recognition accuracy for. */
  keyterms?: string[];
  /**
   * Array of BCP-47 language codes that bias detection toward specific
   * languages. Only supported with the `flux-general-multi` model.
   */
  language_hints?: string[];
  /**
   * Confidence threshold required to trigger an end-of-turn event. Valid
   * range `0.5`–`1.0`, defaults to `0.7`; `1.0` disables natural
   * end-of-turn so turns end via `forceEndTurn()`. Flux models only.
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
  /**
   * Provider API version, e.g. `'ai-studio-v1beta'` or
   * `'gemini-enterprise-agent-v1'` for `google`.
   */
  version?: string;
  /** Controls randomness of the LLM output. Range depends on the provider. */
  temperature?: number;
  /** OpenAI reasoning models: `'low'`, `'medium'` or `'high'`. */
  reasoning_mode?: 'low' | 'medium' | 'high' | (string & {});
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
  /** Opaque provider value; echo it back unchanged if present. */
  thought_signature?: string;
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
  /**
   * Hold the call until the user's turn is confirmed instead of dispatching
   * it speculatively. Use for side effects that cannot be undone.
   */
  defer_until_eot?: boolean;
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
 * Text-to-speech provider for the agent's `speak` stage.
 */
export interface DeepgramVoiceAgentSpeakProvider {
  /** e.g. `'deepgram'`, `'eleven_labs'`, `'cartesia'`, `'open_ai'`, `'aws_polly'`. */
  type?: string;
  /**
   * Deepgram only: `'v2'` for Flux TTS (`flux-*` models), `'v1'` (default)
   * for Aura. Change `version` and `model` together.
   */
  version?: 'v1' | 'v2' | (string & {});
  /** Deepgram or OpenAI model, e.g. `'flux-kit-en'` or `'aura-2-thalia-en'`. */
  model?: string;
  /** Aura `0.7`–`1.5`, Flux `0.5`–`1.5` in `0.05` steps. */
  speed?: number | string;
  /** Flux TTS only (beta): whole numbers `-2` (calm) to `2` (animated). */
  expressivity?: number;
  /**
   * Cartesia / Eleven Labs only. Deepgram voices reject this field (their
   * language is part of the model name).
   */
  language?: string;
  [key: string]: unknown;
}

/**
 * Text-to-speech configuration for the agent's `speak` stage.
 */
export interface DeepgramVoiceAgentSpeakConfig {
  /** Text-to-speech provider configuration. */
  provider?: DeepgramVoiceAgentSpeakProvider;
  /** Required for non-Deepgram providers. */
  endpoint?: DeepgramVoiceAgentFunctionEndpoint;
  [key: string]: unknown;
}

/**
 * Core agent configuration covering context and the listen/think/speak
 * provider pipeline.
 */
export interface DeepgramVoiceAgentAgentConfig {
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
  /**
   * Text-to-speech configuration; pass an array for fallback providers.
   * Deepgram uses Flux TTS `flux-kit-en` when omitted.
   */
  speak?: DeepgramVoiceAgentSpeakConfig | DeepgramVoiceAgentSpeakConfig[];
  /** Initial message the agent speaks when the conversation starts. */
  greeting?: string;
  /**
   * Conversational behaviours such as backchannels, presence checks and
   * frustration detection. Update with `updateThinkLive()`.
   * @see https://developers.deepgram.com/reference/voice-agent/voice-agent
   */
  think_live?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Configuration for the Voice Agent.
 * @example
 * ```typescript
 * const settings: DeepgramVoiceAgentSettings = {
 *   agent: {
 *     think: {
 *       provider: { type: 'open_ai', model: 'gpt-4o-mini' }
 *     },
 *     speak: {
 *       provider: { type: 'deepgram', version: 'v2', model: 'flux-kit-en' }
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
  /**
   * Core agent (listen/think/speak) configuration, or the UUID of a
   * reusable agent configuration stored in your Deepgram project.
   */
  agent?: DeepgramVoiceAgentAgentConfig | string;
  [key: string]: unknown;
}

/**
 * Settings message sent immediately after connecting to initialize the agent.
 */
export interface DeepgramVoiceAgentSettingsMessage extends DeepgramVoiceAgentSettings {
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
  speak: DeepgramVoiceAgentSpeakConfig | DeepgramVoiceAgentSpeakConfig[];
  [key: string]: unknown;
}

/**
 * Update the agent's `think_live` behaviours mid-conversation.
 */
export interface DeepgramVoiceAgentUpdateThinkLiveMessage {
  type: 'UpdateThink_Live';
  think_live: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * End the user's turn now (e.g. push-to-talk release). Useful with
 * `eot_threshold: 1.0` on a Flux listen provider.
 */
export interface DeepgramVoiceAgentForceEndTurnMessage {
  type: 'ForceEndTurn';
  [key: string]: unknown;
}

/** Forward an arbitrary payload to a custom think provider. */
export interface DeepgramVoiceAgentCustomToThinkProviderMessage {
  type: '__customToThinkProvider';
  content: unknown;
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
 * How an injected agent message interacts with the current turn.
 * `'default'` speaks only when neither party is mid-turn (otherwise the
 * server replies with `InjectionRefused`), `'queue'` appends after queued
 * speech and `'interrupt'` cuts off the agent's current speech.
 */
export type DeepgramVoiceAgentInjectBehavior =
  'default' | 'queue' | 'interrupt' | (string & {});

/**
 * Immediately trigger an agent statement mid-conversation.
 */
export interface DeepgramVoiceAgentInjectAgentMessage {
  type: 'InjectAgentMessage';
  /** The statement the agent should say (or, when dynamic, an instruction). */
  message: string;
  /** Defaults to `'default'`. */
  behavior?: DeepgramVoiceAgentInjectBehavior;
  /** Let the LLM phrase the reply from `message` instead of speaking it verbatim. */
  is_dynamic?: boolean;
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
  | DeepgramVoiceAgentUpdatePromptMessage
  | DeepgramVoiceAgentUpdateThinkLiveMessage
  | DeepgramVoiceAgentForceEndTurnMessage
  | DeepgramVoiceAgentCustomToThinkProviderMessage;

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
  /** Detected languages (multilingual listen models). */
  languages?: string[];
  languages_hinted?: string[];
  /** Set on non-reply agent speech such as backchannels or presence checks. */
  conversational_behavior?: string;
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
 * Confirms an `UpdateThink_Live` message was applied.
 */
export interface DeepgramVoiceAgentThinkLiveUpdatedMessage {
  type: 'ThinkLiveUpdated';
  [key: string]: unknown;
}

/**
 * Per-turn latency breakdown, in seconds.
 */
export interface DeepgramVoiceAgentLatencyReportMessage {
  type: 'LatencyReport';
  stt_latency?: number;
  ttt_token_latency?: number;
  ttt_text_latency?: number;
  ttt_tool_latency?: number;
  ttt_thinking_latency?: number;
  tts_latency?: number;
  total_latency?: number;
  [key: string]: unknown;
}

/**
 * Pending function calls were cancelled (e.g. the user kept speaking).
 * Drop their results instead of sending `FunctionCallResponse`.
 */
export interface DeepgramVoiceAgentFunctionCallCancelledMessage {
  type: 'FunctionCallCancelled';
  functions: Array<{ id: string; name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * `think_live` detected user frustration.
 */
export interface DeepgramVoiceAgentFrustrationDetectedMessage {
  type: 'FrustrationDetected';
  [key: string]: unknown;
}

/**
 * Payload forwarded from a custom think provider.
 */
export interface DeepgramVoiceAgentCustomFromThinkProviderMessage {
  type: '__customFromThinkProvider';
  content?: unknown;
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
  | DeepgramVoiceAgentThinkLiveUpdatedMessage
  | DeepgramVoiceAgentLatencyReportMessage
  | DeepgramVoiceAgentFunctionCallCancelledMessage
  | DeepgramVoiceAgentFrustrationDetectedMessage
  | DeepgramVoiceAgentCustomFromThinkProviderMessage
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

export interface UseDeepgramVoiceAgentProps {
  endpoint?: string;
  defaultSettings?: DeepgramVoiceAgentSettings;
  autoStartMicrophone?: boolean;
  downsampleFactor?: number;
  autoPlayAudio?: boolean;
  trackState?: boolean;
  trackConversation?: boolean;
  trackAgentStatus?: boolean;
  /**
   * Publish live session telemetry via `stats`, throttled to ≤1 update/s.
   * @default false
   */
  trackStats?: boolean;
  /**
   * Auto-reconnect configuration for the agent socket. Disabled by default;
   * set `reconnect.enabled` to opt in. On reconnect the stored `Settings`
   * message is automatically re-sent.
   */
  reconnect?: DeepgramReconnectOptions;
  /** Called when a reconnect attempt begins (1-based attempt number). */
  onReconnecting?: (attempt: number) => void;
  /** Called once the agent socket has successfully reconnected. */
  onReconnected?: () => void;
  /**
   * Flush queued agent audio on `UserStartedSpeaking` so the agent stops
   * talking when the user interrupts. Requires `autoPlayAudio`.
   * @default false
   */
  bargeIn?: boolean;
  /** Called after a barge-in flush actually happened. */
  onBargeIn?: () => void;
  onBeforeConnect?: () => void;
  onConnect?: () => void;
  onClose?: (event?: any) => void;
  onError?: (error: unknown) => void;
  /**
   * Called when the system interrupts audio (phone call, Siri, another app
   * taking audio focus). While a session is connected the hook also keeps
   * the agent socket alive with KeepAlive frames until the interruption
   * ends, and disconnects gracefully on a permanent focus loss.
   */
  onInterruption?: (event: DeepgramInterruptionEvent) => void;
  onMessage?: (message: DeepgramVoiceAgentServerMessage) => void;
  onWelcome?: (message: DeepgramVoiceAgentWelcomeMessage) => void;
  onSettingsApplied?: (
    message: DeepgramVoiceAgentSettingsAppliedMessage
  ) => void;
  onConversationText?: (
    message: DeepgramVoiceAgentConversationTextMessage
  ) => void;
  onAgentThinking?: (message: DeepgramVoiceAgentAgentThinkingMessage) => void;
  onAgentStartedSpeaking?: (
    message: DeepgramVoiceAgentAgentStartedSpeakingMessage
  ) => void;
  onAgentAudioDone?: (message: DeepgramVoiceAgentAgentAudioDoneMessage) => void;
  onUserStartedSpeaking?: (
    message: DeepgramVoiceAgentUserStartedSpeakingMessage
  ) => void;
  onFunctionCallRequest?: (
    message: DeepgramVoiceAgentFunctionCallRequestMessage
  ) => void;
  onFunctionCallResponse?: (
    message: DeepgramVoiceAgentReceiveFunctionCallResponseMessage
  ) => void;
  onPromptUpdated?: (message: DeepgramVoiceAgentPromptUpdatedMessage) => void;
  onListenUpdated?: (message: DeepgramVoiceAgentListenUpdatedMessage) => void;
  onThinkUpdated?: (message: DeepgramVoiceAgentThinkUpdatedMessage) => void;
  onSpeakUpdated?: (message: DeepgramVoiceAgentSpeakUpdatedMessage) => void;
  onThinkLiveUpdated?: (
    message: DeepgramVoiceAgentThinkLiveUpdatedMessage
  ) => void;
  onLatencyReport?: (message: DeepgramVoiceAgentLatencyReportMessage) => void;
  onFunctionCallCancelled?: (
    message: DeepgramVoiceAgentFunctionCallCancelledMessage
  ) => void;
  onFrustrationDetected?: (
    message: DeepgramVoiceAgentFrustrationDetectedMessage
  ) => void;
  onCustomFromThinkProvider?: (
    message: DeepgramVoiceAgentCustomFromThinkProviderMessage
  ) => void;
  onInjectionRefused?: (
    message: DeepgramVoiceAgentInjectionRefusedMessage
  ) => void;
  onHistory?: (message: DeepgramVoiceAgentHistoryMessage) => void;
  onWarning?: (message: DeepgramVoiceAgentWarningMessage) => void;
  onServerError?: (message: DeepgramVoiceAgentErrorMessage) => void;
  onAudioConfig?: (message: DeepgramVoiceAgentAudioConfigMessage) => void;
  onAudio?: (audioData: ArrayBuffer) => void;
}

export interface UseDeepgramVoiceAgentReturn {
  connect: (settings?: DeepgramVoiceAgentSettings) => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: DeepgramVoiceAgentClientMessage) => boolean;
  sendSettings: (settings: DeepgramVoiceAgentSettings) => boolean;
  injectUserMessage: (content: string) => boolean;
  /**
   * Make the agent speak `message`. With `{ dynamic: true }` the LLM
   * phrases the reply from `message` (an instruction) instead.
   */
  injectAgentMessage: (
    message: string,
    options?:
      | DeepgramVoiceAgentInjectBehavior
      | { behavior?: DeepgramVoiceAgentInjectBehavior; dynamic?: boolean }
  ) => boolean;
  /** End the user's turn now (e.g. push-to-talk release). */
  forceEndTurn: () => boolean;
  sendFunctionCallResponse: (
    response: Omit<DeepgramVoiceAgentFunctionCallResponseMessage, 'type'>
  ) => boolean;
  sendKeepAlive: () => boolean;
  updatePrompt: (prompt: string) => boolean;
  updateListen: (listen: DeepgramVoiceAgentListenConfig) => boolean;
  updateThink: (think: DeepgramVoiceAgentThinkConfig) => boolean;
  updateSpeak: (
    speak: DeepgramVoiceAgentSpeakConfig | DeepgramVoiceAgentSpeakConfig[]
  ) => boolean;
  updateThinkLive: (thinkLive: Record<string, unknown>) => boolean;
  sendMedia: (chunk: ArrayBuffer | Uint8Array | number[]) => boolean;
  /** Stop forwarding mic frames; keep the socket alive with KeepAlive. */
  mute: () => void;
  /** Resume forwarding mic frames after {@link mute}. */
  unmute: () => void;
  /** Imperative snapshot of the session telemetry counters. */
  getStats: () => SessionStats;
  isConnected: () => boolean;
  state?: {
    connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected';
    error: string | null;
    warning: string | null;
  };
  /** Whether the microphone is currently muted (only when trackState is enabled). */
  isMuted?: boolean;
  conversation?: Array<{ role: string; content: string }>;
  clearConversation?: () => void;
  agentStatus?: {
    thinking: string | null;
    latency: { total?: number; tts?: number; ttt?: number } | null;
  };
  /** Live session telemetry (only when `trackStats` is enabled). */
  stats?: SessionStats;
}
