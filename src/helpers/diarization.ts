import type { DeepgramPrerecordedResponse } from '../types/deepgram/speech-to-text';

/**
 * A contiguous run of words attributed to a single speaker in a diarized
 * pre-recorded transcription response.
 */
export interface SpeakerSegment {
  /** Deepgram speaker index. */
  speaker: number;
  /** Punctuated text of the segment (joined words). */
  text: string;
  /** Segment start, in seconds. */
  start: number;
  /** Segment end, in seconds. */
  end: number;
  /** Minimum `speaker_confidence` across the segment's words. */
  confidence: number;
}

/**
 * Fold the word-level diarization data of a pre-recorded response
 * (`diarize: true`) into per-speaker segments. A new segment starts whenever
 * the `speaker` index changes. Returns an empty array when the response
 * carries no `speaker` fields (diarization not requested) — never throws.
 * @see https://developers.deepgram.com/docs/diarization
 */
export function toSpeakerSegments(
  response: DeepgramPrerecordedResponse
): SpeakerSegment[] {
  const words = response?.results?.channels?.[0]?.alternatives?.[0]?.words;
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  const segments: SpeakerSegment[] = [];
  let current: SpeakerSegment | null = null;

  for (const word of words) {
    if (typeof word?.speaker !== 'number') {
      continue;
    }

    const text = word.punctuated_word ?? word.word;
    if (!text) {
      continue;
    }

    const confidence =
      typeof word.speaker_confidence === 'number' ? word.speaker_confidence : 1;
    const start = typeof word.start === 'number' ? word.start : 0;
    const end = typeof word.end === 'number' ? word.end : start;

    if (current && current.speaker === word.speaker) {
      current.text += ` ${text}`;
      current.end = end;
      current.confidence = Math.min(current.confidence, confidence);
    } else {
      current = { speaker: word.speaker, text, start, end, confidence };
      segments.push(current);
    }
  }

  return segments;
}
