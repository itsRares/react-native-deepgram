import { toSRT, toWebVTT } from '../helpers/captions';
import type { DeepgramPrerecordedResponse } from '../types';

/** Word-only fixture (no utterances): two sentences, ~9 s of audio. */
const wordsResponse: DeepgramPrerecordedResponse = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript:
              'Hello and welcome to the show. Today we talk about captions.',
            words: [
              { word: 'hello', punctuated_word: 'Hello', start: 0, end: 0.5 },
              { word: 'and', punctuated_word: 'and', start: 0.5, end: 0.8 },
              {
                word: 'welcome',
                punctuated_word: 'welcome',
                start: 0.8,
                end: 1.2,
              },
              { word: 'to', punctuated_word: 'to', start: 1.2, end: 1.4 },
              { word: 'the', punctuated_word: 'the', start: 1.4, end: 1.6 },
              {
                word: 'show',
                punctuated_word: 'show.',
                start: 1.6,
                end: 2.1,
              },
              { word: 'today', punctuated_word: 'Today', start: 3, end: 3.4 },
              { word: 'we', punctuated_word: 'we', start: 3.4, end: 3.6 },
              { word: 'talk', punctuated_word: 'talk', start: 3.6, end: 4 },
              { word: 'about', punctuated_word: 'about', start: 4, end: 4.4 },
              {
                word: 'captions',
                punctuated_word: 'captions.',
                start: 4.4,
                end: 5,
              },
            ],
          },
        ],
      },
    ],
  },
};

/** Utterance fixture: same channel words plus `results.utterances`. */
const utterancesResponse: DeepgramPrerecordedResponse = {
  results: {
    ...wordsResponse.results,
    utterances: [
      {
        start: 0,
        end: 2.1,
        transcript: 'Hello and welcome to the show.',
        words: [
          { word: 'hello', punctuated_word: 'Hello', start: 0, end: 0.5 },
          { word: 'and', punctuated_word: 'and', start: 0.5, end: 0.8 },
          {
            word: 'welcome',
            punctuated_word: 'welcome',
            start: 0.8,
            end: 1.2,
          },
          { word: 'to', punctuated_word: 'to', start: 1.2, end: 1.4 },
          { word: 'the', punctuated_word: 'the', start: 1.4, end: 1.6 },
          { word: 'show', punctuated_word: 'show.', start: 1.6, end: 2.1 },
        ],
      },
      {
        start: 3,
        end: 5,
        transcript: 'Today we talk about captions.',
        words: [
          { word: 'today', punctuated_word: 'Today', start: 3, end: 3.4 },
          { word: 'we', punctuated_word: 'we', start: 3.4, end: 3.6 },
          { word: 'talk', punctuated_word: 'talk', start: 3.6, end: 4 },
          { word: 'about', punctuated_word: 'about', start: 4, end: 4.4 },
          {
            word: 'captions',
            punctuated_word: 'captions.',
            start: 4.4,
            end: 5,
          },
        ],
      },
    ],
  },
};

/** Diarized fixture: speaker 0 then speaker 1. */
const diarizedResponse: DeepgramPrerecordedResponse = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hi there. Hello back.',
            words: [
              {
                word: 'hi',
                punctuated_word: 'Hi',
                start: 0,
                end: 0.4,
                speaker: 0,
                speaker_confidence: 0.9,
              },
              {
                word: 'there',
                punctuated_word: 'there.',
                start: 0.4,
                end: 0.9,
                speaker: 0,
                speaker_confidence: 0.8,
              },
              {
                word: 'hello',
                punctuated_word: 'Hello',
                start: 1.5,
                end: 1.9,
                speaker: 1,
                speaker_confidence: 0.95,
              },
              {
                word: 'back',
                punctuated_word: 'back.',
                start: 1.9,
                end: 2.4,
                speaker: 1,
                speaker_confidence: 0.7,
              },
            ],
          },
        ],
      },
    ],
  },
};

describe('captions helpers', () => {
  describe('toSRT', () => {
    it('renders a words-only response', () => {
      expect(toSRT(wordsResponse)).toBe(
        '1\n' +
          '00:00:00,000 --> 00:00:02,100\n' +
          'Hello and welcome to the show.\n' +
          '\n' +
          '2\n' +
          '00:00:03,000 --> 00:00:05,000\n' +
          'Today we talk about captions.\n'
      );
    });

    it('renders an utterances response', () => {
      expect(toSRT(utterancesResponse)).toBe(
        '1\n' +
          '00:00:00,000 --> 00:00:02,100\n' +
          'Hello and welcome to the show.\n' +
          '\n' +
          '2\n' +
          '00:00:03,000 --> 00:00:05,000\n' +
          'Today we talk about captions.\n'
      );
    });

    it('renders a diarized response with speakerLabels', () => {
      expect(toSRT(diarizedResponse, { speakerLabels: true })).toBe(
        '1\n' +
          '00:00:00,000 --> 00:00:00,900\n' +
          'Speaker 0: Hi there.\n' +
          '\n' +
          '2\n' +
          '00:00:01,500 --> 00:00:02,400\n' +
          'Speaker 1: Hello back.\n'
      );
    });

    it('indexes cues from 1 and separates them with blank lines', () => {
      const srt = toSRT(wordsResponse);
      const cues = srt.trim().split('\n\n');
      expect(cues.length).toBeGreaterThanOrEqual(2);
      cues.forEach((cue, i) => {
        expect(cue.split('\n')[0]).toBe(String(i + 1));
      });
    });

    it('formats SRT timestamps with a comma millisecond separator', () => {
      const srt = toSRT(wordsResponse);
      expect(srt).toContain('00:00:00,000 --> ');
      expect(srt).toMatch(
        /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/
      );
    });

    it('handles 0 s, sub-second, and >1 h timestamps', () => {
      const response: DeepgramPrerecordedResponse = {
        results: {
          channels: [
            {
              alternatives: [
                {
                  words: [
                    { word: 'zero.', start: 0, end: 0.5 },
                    { word: 'hour.', start: 3601, end: 3601.25 },
                  ],
                },
              ],
            },
          ],
        },
      };
      const srt = toSRT(response);
      expect(srt).toContain('00:00:00,000 --> 00:00:00,500');
      expect(srt).toContain('01:00:01,000 --> 01:00:01,250');
    });

    it('prefixes cues with speaker labels when requested', () => {
      const srt = toSRT(diarizedResponse, { speakerLabels: true });
      expect(srt).toContain('Speaker 0: Hi there.');
      expect(srt).toContain('Speaker 1: Hello back.');
    });

    it('omits speaker labels by default', () => {
      expect(toSRT(diarizedResponse)).not.toContain('Speaker');
    });

    it('wraps lines at lineLength and cues at lineCount', () => {
      const srt = toSRT(wordsResponse, { lineLength: 12, lineCount: 1 });
      const cueBodies = srt
        .trim()
        .split('\n\n')
        .map((cue) => cue.split('\n').slice(2));
      cueBodies.forEach((lines) => {
        expect(lines.length).toBeLessThanOrEqual(1);
        lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(12));
      });
    });

    it('returns an empty string for an empty response', () => {
      expect(toSRT({})).toBe('');
      expect(toSRT({ results: { channels: [] } })).toBe('');
      expect(
        toSRT({ results: { channels: [{ alternatives: [{ words: [] }] }] } })
      ).toBe('');
    });
  });

  describe('toWebVTT', () => {
    it('renders a words-only response', () => {
      expect(toWebVTT(wordsResponse)).toBe(
        'WEBVTT\n' +
          '\n' +
          '00:00:00.000 --> 00:00:02.100\n' +
          'Hello and welcome to the show.\n' +
          '\n' +
          '00:00:03.000 --> 00:00:05.000\n' +
          'Today we talk about captions.\n'
      );
    });

    it('renders an utterances response', () => {
      expect(toWebVTT(utterancesResponse)).toBe(
        'WEBVTT\n' +
          '\n' +
          '00:00:00.000 --> 00:00:02.100\n' +
          'Hello and welcome to the show.\n' +
          '\n' +
          '00:00:03.000 --> 00:00:05.000\n' +
          'Today we talk about captions.\n'
      );
    });

    it('renders a diarized response with speakerLabels', () => {
      expect(toWebVTT(diarizedResponse, { speakerLabels: true })).toBe(
        'WEBVTT\n' +
          '\n' +
          '00:00:00.000 --> 00:00:00.900\n' +
          'Speaker 0: Hi there.\n' +
          '\n' +
          '00:00:01.500 --> 00:00:02.400\n' +
          'Speaker 1: Hello back.\n'
      );
    });

    it('starts with the WEBVTT header followed by a blank line', () => {
      expect(toWebVTT(wordsResponse).startsWith('WEBVTT\n\n')).toBe(true);
    });

    it('formats VTT timestamps with a dot millisecond separator', () => {
      const vtt = toWebVTT(wordsResponse);
      expect(vtt).toContain('00:00:00.000 --> ');
      expect(vtt).toMatch(
        /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/
      );
    });

    it('handles >1 h timestamps', () => {
      const response: DeepgramPrerecordedResponse = {
        results: {
          channels: [
            {
              alternatives: [
                { words: [{ word: 'hour.', start: 3601, end: 3601.5 }] },
              ],
            },
          ],
        },
      };
      expect(toWebVTT(response)).toContain('01:00:01.000 --> 01:00:01.500');
    });

    it('returns an empty string for an empty response', () => {
      expect(toWebVTT({})).toBe('');
    });
  });

  it('prefers utterances over channel words', () => {
    // The utterance fixture splits the same words into two utterances with a
    // gap (2.1 s → 3 s); the cue boundary must follow the utterance timing.
    const srt = toSRT(utterancesResponse);
    expect(srt).toContain('00:00:00,000 --> 00:00:02,100');
    expect(srt).toContain('00:00:03,000 --> 00:00:05,000');
  });
});
