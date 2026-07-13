import { toSpeakerSegments } from '../helpers/diarization';
import type { DeepgramPrerecordedResponse } from '../types';

const diarizedResponse: DeepgramPrerecordedResponse = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hi there. Hello back. Great to be here.',
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
                speaker_confidence: 0.6,
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
              {
                word: 'great',
                punctuated_word: 'Great',
                start: 3,
                end: 3.3,
                speaker: 0,
                speaker_confidence: 0.85,
              },
              {
                word: 'to',
                punctuated_word: 'to',
                start: 3.3,
                end: 3.5,
                speaker: 0,
                speaker_confidence: 0.8,
              },
              {
                word: 'be',
                punctuated_word: 'be',
                start: 3.5,
                end: 3.7,
                speaker: 0,
                speaker_confidence: 0.75,
              },
              {
                word: 'here',
                punctuated_word: 'here.',
                start: 3.7,
                end: 4.1,
                speaker: 0,
                speaker_confidence: 0.9,
              },
            ],
          },
        ],
      },
    ],
  },
};

const nonDiarizedResponse: DeepgramPrerecordedResponse = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hello world.',
            words: [
              { word: 'hello', punctuated_word: 'Hello', start: 0, end: 0.5 },
              {
                word: 'world',
                punctuated_word: 'world.',
                start: 0.5,
                end: 1,
              },
            ],
          },
        ],
      },
    ],
  },
};

describe('toSpeakerSegments', () => {
  it('splits segments on speaker change with correct boundaries', () => {
    const segments = toSpeakerSegments(diarizedResponse);
    expect(segments).toHaveLength(3);

    expect(segments[0]).toEqual({
      speaker: 0,
      text: 'Hi there.',
      start: 0,
      end: 0.9,
      confidence: 0.6,
    });
    expect(segments[1]).toEqual({
      speaker: 1,
      text: 'Hello back.',
      start: 1.5,
      end: 2.4,
      confidence: 0.7,
    });
    expect(segments[2]).toEqual({
      speaker: 0,
      text: 'Great to be here.',
      start: 3,
      end: 4.1,
      confidence: 0.75,
    });
  });

  it('uses the minimum speaker_confidence across each segment', () => {
    const segments = toSpeakerSegments(diarizedResponse);
    expect(segments.map((s) => s.confidence)).toEqual([0.6, 0.7, 0.75]);
  });

  it('joins punctuated words with spaces', () => {
    const [first] = toSpeakerSegments(diarizedResponse);
    expect(first?.text).toBe('Hi there.');
  });

  it('returns [] when diarization was not requested', () => {
    expect(toSpeakerSegments(nonDiarizedResponse)).toEqual([]);
  });

  it('returns [] for an empty response without throwing', () => {
    expect(toSpeakerSegments({})).toEqual([]);
    expect(toSpeakerSegments({ results: {} })).toEqual([]);
    expect(
      toSpeakerSegments({
        results: { channels: [{ alternatives: [{ words: [] }] }] },
      })
    ).toEqual([]);
  });
});
