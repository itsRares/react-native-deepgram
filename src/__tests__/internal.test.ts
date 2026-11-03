import {
  cloneValue,
  mergePlainObjects,
  sanitizeSettings,
} from '../internal/agentSettings';
import { createKeepAlive } from '../internal/keepAlive';
import {
  buildLiveConfigureMessage,
  buildLiveListenUrl,
  buildPrerecordedUrl,
  resolveLiveOptions,
} from '../internal/listenQuery';
import {
  computeDownsampleFactor,
  decodePcmFrame,
  resolveDownsampleFactor,
  toArrayBuffer,
} from '../internal/pcm';
import {
  buildSpeakHttpParams,
  resolveHttpOptions,
  resolveStreamOptions,
} from '../internal/speakOptions';

const toB64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const query = (url: string) => new URL(url).searchParams;

describe('pcm', () => {
  it('computes downsample factors from sample rates', () => {
    expect(computeDownsampleFactor(16000, 16000)).toBe(1);
    expect(computeDownsampleFactor(8000, 16000)).toBe(2);
    expect(computeDownsampleFactor(24000, 16000)).toBe(1);
    expect(computeDownsampleFactor(undefined, 48000)).toBe(1);
    expect(resolveDownsampleFactor(3, 8000, 48000)).toBe(3);
    expect(resolveDownsampleFactor(3, 48000, 16000)).toBe(1);
    expect(resolveDownsampleFactor(undefined, 8000, 48000)).toBe(6);
  });

  it('decodes and downsamples PCM16 frames, ignoring a trailing odd byte', () => {
    const samples = new Int16Array([10, 20, 30, 40]);
    const bytes = Array.from(new Uint8Array(samples.buffer));

    const full = decodePcmFrame(toB64(bytes), 1);
    expect(Array.from(new Int16Array(full.audio))).toEqual([10, 20, 30, 40]);
    expect(full.decodedBytes).toBe(8);

    const half = decodePcmFrame(toB64(bytes), 2);
    expect(Array.from(new Int16Array(half.audio))).toEqual([10, 30]);

    const odd = decodePcmFrame(toB64([...bytes, 7]), 1);
    expect(odd.decodedBytes).toBe(8);
  });

  it('normalizes binary payloads to exact ArrayBuffers', () => {
    const view = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
    expect(Array.from(new Uint8Array(toArrayBuffer(view)!))).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(toArrayBuffer([4, 5])!))).toEqual([4, 5]);
    const buffer = new ArrayBuffer(2);
    expect(toArrayBuffer(buffer)).toBe(buffer);
    expect(toArrayBuffer('text')).toBeNull();
  });
});

describe('keepAlive', () => {
  afterEach(() => jest.useRealTimers());

  it('runs one timer while any reason holds it', () => {
    jest.useFakeTimers();
    const send = jest.fn();
    const keepAlive = createKeepAlive(send, 1000);

    keepAlive.hold('mute');
    keepAlive.hold('interruption');
    jest.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(2);

    keepAlive.release('mute');
    jest.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(3);

    keepAlive.release('interruption');
    jest.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('agent settings', () => {
  it('deep-merges objects while arrays and primitives replace', () => {
    const base = {
      agent: { think: { prompt: 'a', functions: [{ name: 'x' }] } },
      tags: ['one'],
    };
    const merged = mergePlainObjects<Record<string, unknown>>(base, {
      agent: { think: { prompt: 'b' } },
      tags: ['two'],
    });
    expect(merged).toEqual({
      agent: { think: { prompt: 'b', functions: [{ name: 'x' }] } },
      tags: ['two'],
    });
    expect((merged as typeof base).agent.think.functions).not.toBe(
      base.agent.think.functions
    );
  });

  it('copies settings, keeps speak provider arrays and drops empty sections', () => {
    const speak = [
      { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
      { provider: { type: 'open_ai', model: 'tts-1' } },
    ];
    const settings = { audio: {}, agent: { speak } } as never;
    const sanitized = sanitizeSettings(settings) as {
      agent: { speak: unknown };
    };

    expect(sanitized).toEqual({ agent: { speak } });
    expect(sanitized.agent.speak).not.toBe(speak);
    expect(sanitizeSettings({ audio: {}, agent: {} })).toBeUndefined();
    expect(cloneValue(null)).toBeNull();
  });
});

describe('listen query', () => {
  it('keeps v1-only parameters out of Flux URLs', () => {
    const options = resolveLiveOptions(
      { apiVersion: 'v2', punctuate: true, keywords: ['Deepgram'] },
      {}
    );
    const url = buildLiveListenUrl(options);
    expect(url.startsWith('wss://api.deepgram.com/v2/listen?')).toBe(true);
    expect(query(url).get('model')).toBe('flux-general-en');
    expect(query(url).get('punctuate')).toBeNull();
    expect(query(url).getAll('keyterm')).toEqual(['Deepgram']);
  });

  it('maps keywords to keyterm only for nova-3', () => {
    const nova3 = buildLiveListenUrl(
      resolveLiveOptions({ keywords: ['a'] }, {})
    );
    expect(query(nova3).getAll('keyterm')).toEqual(['a']);
    expect(query(nova3).get('keywords')).toBeNull();

    const nova2 = buildLiveListenUrl(
      resolveLiveOptions({ model: 'nova-2', keywords: ['a'] }, {})
    );
    expect(query(nova2).getAll('keywords')).toEqual(['a']);
  });

  it('serializes redact, extra and per-call overrides', () => {
    const live = buildLiveListenUrl(
      resolveLiveOptions(
        { redact: 'pci', extra: { team: 'mobile' } },
        { sampleRate: 8000 }
      )
    );
    expect(query(live).getAll('redact')).toEqual(['pci']);
    expect(query(live).get('extra.team')).toBe('mobile');
    expect(query(live).get('sample_rate')).toBe('8000');

    const prerecorded = buildPrerecordedUrl({
      model: 'nova-3',
      customTopic: '',
      detectLanguage: true,
      extra: { a: '1' },
    });
    expect(query(prerecorded).get('custom_topic')).toBeNull();
    expect(query(prerecorded).get('detect_language')).toBe('true');
    expect(query(prerecorded).get('extra.a')).toBe('1');
  });

  it('passes Flux numerals/redact and Nova-3 multilingual language hints', () => {
    const flux = buildLiveListenUrl(
      resolveLiveOptions(
        {
          apiVersion: 'v2',
          numerals: true,
          redact: 'numbers',
          languageHint: ['en', 'es'],
        },
        {}
      )
    );
    expect(query(flux).get('numerals')).toBe('true');
    expect(query(flux).getAll('redact')).toEqual(['numbers']);
    expect(query(flux).getAll('language_hint')).toEqual(['en', 'es']);

    const nova = buildLiveListenUrl(
      resolveLiveOptions(
        { language: 'multi', languageHint: ['en', 'es'], diarizeModel: 'v1' },
        {}
      )
    );
    expect(query(nova).getAll('language_hint')).toEqual(['en', 'es']);
    expect(query(nova).get('diarize_model')).toBe('v1');
    expect(query(nova).get('diarize')).toBeNull();

    const prerecorded = buildPrerecordedUrl({
      language: 'multi',
      languageHint: 'fr',
    });
    expect(query(prerecorded).getAll('language_hint')).toEqual(['fr']);
  });

  it('builds Configure messages for Nova and Flux', () => {
    expect(buildLiveConfigureMessage({ numerals: true }, 'v1')).toEqual({
      type: 'Configure',
      features: { numerals: true },
    });
    expect(
      buildLiveConfigureMessage({ eagerEotThreshold: 0.5, keyterms: [] }, 'v2')
    ).toEqual({
      type: 'Configure',
      keyterms: [],
      thresholds: { eager_eot_threshold: 0.5 },
    });
  });
});

describe('speak options', () => {
  it('derives HTTP defaults from the encoding', () => {
    expect(resolveHttpOptions({})).toMatchObject({
      model: 'aura-2-asteria-en',
      encoding: 'linear16',
      sampleRate: 24000,
      container: 'none',
    });
    expect(resolveHttpOptions({ http: { encoding: 'mp3' } })).toMatchObject({
      sampleRate: undefined,
      container: undefined,
      bitRate: 48000,
    });
    expect(resolveHttpOptions({ http: { encoding: 'opus' } }).container).toBe(
      'ogg'
    );
    expect(
      resolveStreamOptions({ stream: { encoding: 'mulaw' } })
    ).toMatchObject({ encoding: 'mulaw', sampleRate: 8000, autoFlush: true });
  });

  it('lets explicit queryParams win over typed options', () => {
    const params = buildSpeakHttpParams(
      resolveHttpOptions({ queryParams: { model: 'custom-voice' } })
    );
    expect(params.model).toBe('custom-voice');
    expect(params.encoding).toBe('linear16');
  });
});
