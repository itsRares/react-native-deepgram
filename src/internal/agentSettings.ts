import type { DeepgramVoiceAgentSettings } from '../types';

export const isPlainObject = (
  value: unknown
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const hasKeys = (value: unknown, keys: string[]): boolean =>
  isPlainObject(value) && keys.every((key) => key in value);

/** Deep-copy plain objects and arrays; other values are shared. */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneValue(entry);
    }
    return cloned as T;
  }
  return value;
}

/**
 * Deep-merge `override` into a copy of `base`. Nested plain objects merge,
 * arrays and primitives replace, and an explicit `undefined` clears a key.
 */
export function mergePlainObjects<T extends Record<string, unknown>>(
  base?: T,
  override?: T
): T | undefined {
  if (!base) {
    return override ? cloneValue(override) : undefined;
  }
  const result: Record<string, unknown> = cloneValue(base);
  if (!override) {
    return result as T;
  }
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value)) {
      const existing = result[key];
      result[key] = mergePlainObjects(
        isPlainObject(existing) ? existing : undefined,
        value
      );
    } else {
      result[key] = cloneValue(value);
    }
  }
  return result as T;
}

/**
 * Copy agent settings so later caller mutations can't leak into the stored
 * session settings; empty `audio` / `agent` sections are dropped.
 */
export function sanitizeSettings(
  settings?: DeepgramVoiceAgentSettings
): DeepgramVoiceAgentSettings | undefined {
  if (!settings) {
    return undefined;
  }
  const copy = cloneValue(settings);
  for (const key of ['audio', 'agent'] as const) {
    const section = copy[key];
    if (
      section === undefined ||
      (isPlainObject(section) && Object.keys(section).length === 0)
    ) {
      delete copy[key];
    }
  }
  return Object.keys(copy).length > 0 ? copy : undefined;
}
