import type {
  DeepgramVoiceAgentListenProvider,
  DeepgramVoiceAgentSettings,
} from '../types';

export function createAgentSettings(
  opts: {
    /** Listen language for Nova models (Flux takes it from the model name). */
    language?: string;
    greeting?: string;
    /** `flux-*` models use the v2 listen provider. */
    listenModel?: string;
    thinkModel?: string;
    /**
     * Deepgram voice; `flux-*` uses Flux TTS (v2), `aura-*` Aura (v1).
     * Omit to use Deepgram's default (`flux-kit-en`).
     */
    speakModel?: string;
    prompt?: string;
    temperature?: number | string;
    tags?: string | string[];
    sampleRate?: number | string;
  } = {}
): DeepgramVoiceAgentSettings {
  const temperature = (() => {
    if (typeof opts.temperature === 'string') {
      const parsed = parseFloat(opts.temperature);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(2, parsed)) : 0.7;
    }
    if (typeof opts.temperature === 'number') {
      return Math.max(0, Math.min(2, opts.temperature));
    }
    return 0.7;
  })();

  const tags = (() => {
    if (typeof opts.tags === 'string') {
      return opts.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    return opts.tags ?? [];
  })();

  const sampleRate = (() => {
    if (typeof opts.sampleRate === 'string') {
      const parsed = parseInt(opts.sampleRate, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 16000;
    }
    if (typeof opts.sampleRate === 'number' && opts.sampleRate > 0) {
      return opts.sampleRate;
    }
    return 16000;
  })();

  const listenModel = opts.listenModel?.trim() || 'nova-3';
  // Flux rejects smart_format and reads the language from the model name.
  const listenProvider: DeepgramVoiceAgentListenProvider =
    listenModel.startsWith('flux-')
      ? { type: 'deepgram', version: 'v2', model: listenModel }
      : {
          type: 'deepgram',
          version: 'v1',
          model: listenModel,
          language: opts.language?.trim() || 'en',
          smart_format: true,
        };
  const speakModel = opts.speakModel?.trim();

  const settings: DeepgramVoiceAgentSettings = {
    audio: {
      input: { encoding: 'linear16', sample_rate: sampleRate },
      output: {
        encoding: 'linear16',
        sample_rate: sampleRate,
        container: 'none',
      },
    },
    agent: {
      greeting: opts.greeting?.trim() || 'Hello! How can I help you today?',
      listen: { provider: listenProvider },
      think: {
        provider: {
          type: 'open_ai',
          model: opts.thinkModel?.trim() || 'gpt-4o',
          temperature,
        },
        prompt: opts.prompt?.trim() || 'You are a helpful assistant.',
      },
      ...(speakModel
        ? {
            speak: {
              provider: {
                type: 'deepgram',
                version: speakModel.startsWith('flux-') ? 'v2' : 'v1',
                model: speakModel,
              },
            },
          }
        : {}),
    },
  };

  if (tags.length > 0) {
    settings.tags = tags;
  }

  return settings;
}
