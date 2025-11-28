/**
 * HTTP methods supported for callback URLs.
 */
export type DeepgramCallbackMethod = 'POST' | 'PUT' | (string & {});

/**
 * Mode for handling custom vocabulary/topics/intents.
 * - `extended`: Augments the base model's knowledge.
 * - `strict`: Limits the model to only the provided vocabulary.
 */
export type DeepgramCustomMode = 'extended' | 'strict';
