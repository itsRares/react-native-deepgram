import type { DeepgramVoiceAgentSettings } from '../types';

export function createAgentSettings(opts: {
  language?: string;
  greeting?: string;
  listenModel?: string;
  thinkModel?: string;
  prompt?: string;
  temperature?: number | string;
  tags?: string | string[];
  sampleRate?: number | string;
} = {}): DeepgramVoiceAgentSettings {
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
      const parsed = parseInt(opts.sampleRate);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 16000;
    }
    if (typeof opts.sampleRate === 'number' && opts.sampleRate > 0) {
      return opts.sampleRate;
    }
    return 16000;
  })();

  const settings: DeepgramVoiceAgentSettings = {
    audio: {
      input: { encoding: 'linear16', sample_rate: sampleRate },
      output: { encoding: 'linear16', sample_rate: sampleRate, container: 'none' },
    },
    agent: {
      language: opts.language?.trim() || 'en',
      greeting: opts.greeting?.trim() || 'Hello! How can I help you today?',
      listen: {
        provider: {
          type: 'deepgram',
          model: opts.listenModel?.trim() || 'nova-3',
          smart_format: true,
        },
      },
      think: {
        provider: {
          type: 'open_ai',
          model: opts.thinkModel?.trim() || 'gpt-4o',
          temperature,
        },
        prompt: opts.prompt?.trim() || 'You are a helpful assistant.',
      },
    },
  };

  if (tags.length > 0) {
    settings.tags = tags;
  }

  return settings;
}
