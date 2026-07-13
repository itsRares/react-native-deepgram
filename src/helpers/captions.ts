import type {
  DeepgramPrerecordedResponse,
  DeepgramPrerecordedUtterance,
  DeepgramPrerecordedWord,
} from '../types/deepgram/speech-to-text';

/**
 * Options for the caption export helpers ({@link toSRT} / {@link toWebVTT}).
 */
export interface CaptionOptions {
  /** Maximum characters per caption line. @default 32 */
  lineLength?: number;
  /** Maximum lines per cue. @default 2 */
  lineCount?: number;
  /**
   * Prefix cues with `Speaker N:` when diarization data is present.
   * @default false
   */
  speakerLabels?: boolean;
}

const DEFAULT_LINE_LENGTH = 32;
const DEFAULT_LINE_COUNT = 2;

type Cue = {
  start: number;
  end: number;
  lines: string[];
};

const pad = (value: number, width: number) =>
  String(value).padStart(width, '0');

/**
 * Format a time in seconds as `HH:MM:SS<sep>mmm` (SRT uses `,`, VTT `.`).
 */
const formatTimestamp = (seconds: number, msSeparator: string): string => {
  const safeSeconds =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? seconds
      : 0;
  const totalMs = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1_000);
  const millis = totalMs % 1_000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}${msSeparator}${pad(millis, 3)}`;
};

const wordText = (word: DeepgramPrerecordedWord): string =>
  word.punctuated_word ?? word.word ?? '';

/** Sentence-ending punctuation closes the current cue. */
const endsSentence = (text: string) => /[.!?]$/.test(text);

const speakerPrefix = (speakerLabels: boolean, speaker: number | undefined) =>
  speakerLabels && typeof speaker === 'number' ? `Speaker ${speaker}: ` : '';

/**
 * Chunk a word list into cues, breaking lines at `lineLength` characters,
 * cues at `lineCount` lines / sentence punctuation / speaker changes.
 */
const wordsToCues = (
  words: DeepgramPrerecordedWord[],
  lineLength: number,
  lineCount: number,
  speakerLabels: boolean
): Cue[] => {
  const cues: Cue[] = [];

  let cue: (Cue & { speaker?: number }) | null = null;
  let line = '';

  const closeCue = () => {
    if (!cue) {
      return;
    }
    if (line) {
      cue.lines.push(line);
      line = '';
    }
    if (cue.lines.length > 0) {
      cues.push({ start: cue.start, end: cue.end, lines: cue.lines });
    }
    cue = null;
  };

  for (const word of words) {
    const text = wordText(word);
    if (!text) {
      continue;
    }

    const start: number =
      typeof word.start === 'number' ? word.start : (cue?.end ?? 0);
    const end = typeof word.end === 'number' ? word.end : start;

    if (
      cue &&
      speakerLabels &&
      typeof word.speaker === 'number' &&
      word.speaker !== cue.speaker
    ) {
      closeCue();
    }

    if (!cue) {
      cue = { start, end, lines: [], speaker: word.speaker };
      line = speakerPrefix(speakerLabels, word.speaker) + text;
    } else {
      const candidate = `${line} ${text}`;
      if (line.length > 0 && candidate.length > lineLength) {
        cue.lines.push(line);
        line = '';
        if (cue.lines.length >= lineCount) {
          const speaker: number | undefined = cue.speaker;
          closeCue();
          cue = { start, end, lines: [], speaker };
          line = speakerPrefix(speakerLabels, speaker) + text;
        } else {
          line = text;
        }
      } else {
        line = candidate;
      }
    }

    cue.end = end;

    if (endsSentence(text)) {
      closeCue();
    }
  }

  closeCue();
  return cues;
};

/** Greedy word-wrap for utterances that carry no word-level detail. */
const wrapText = (text: string, lineLength: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${token}` : token;
    if (line && candidate.length > lineLength) {
      lines.push(line);
      line = token;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
};

const utteranceToCues = (
  utterance: DeepgramPrerecordedUtterance,
  lineLength: number,
  lineCount: number,
  speakerLabels: boolean
): Cue[] => {
  const utteranceWords = utterance.words;
  if (Array.isArray(utteranceWords) && utteranceWords.length > 0) {
    const words = utteranceWords.map((word) => ({
      ...word,
      speaker: word.speaker ?? utterance.speaker,
    }));
    return wordsToCues(words, lineLength, lineCount, speakerLabels);
  }

  const transcript =
    typeof utterance.transcript === 'string' ? utterance.transcript.trim() : '';
  if (!transcript) {
    return [];
  }

  const prefix = speakerPrefix(speakerLabels, utterance.speaker);
  const lines = wrapText(prefix + transcript, lineLength);
  const start = typeof utterance.start === 'number' ? utterance.start : 0;
  const end = typeof utterance.end === 'number' ? utterance.end : start;

  const groups: string[][] = [];
  for (let i = 0; i < lines.length; i += lineCount) {
    groups.push(lines.slice(i, i + lineCount));
  }

  // Without word timings, spread the utterance duration evenly across cues.
  const duration = Math.max(0, end - start);
  return groups.map((groupLines, index) => ({
    start: start + (duration * index) / groups.length,
    end:
      index === groups.length - 1
        ? end
        : start + (duration * (index + 1)) / groups.length,
    lines: groupLines,
  }));
};

const buildCues = (
  response: DeepgramPrerecordedResponse,
  opts?: CaptionOptions
): Cue[] => {
  const lineLength =
    typeof opts?.lineLength === 'number' && opts.lineLength > 0
      ? opts.lineLength
      : DEFAULT_LINE_LENGTH;
  const lineCount =
    typeof opts?.lineCount === 'number' && opts.lineCount > 0
      ? opts.lineCount
      : DEFAULT_LINE_COUNT;
  const speakerLabels = opts?.speakerLabels === true;

  const utterances = response?.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances.flatMap((utterance) =>
      utteranceToCues(utterance, lineLength, lineCount, speakerLabels)
    );
  }

  const words = response?.results?.channels?.[0]?.alternatives?.[0]?.words;
  if (Array.isArray(words) && words.length > 0) {
    return wordsToCues(words, lineLength, lineCount, speakerLabels);
  }

  return [];
};

/**
 * Convert a Deepgram pre-recorded transcription response into an
 * [SRT](https://en.wikipedia.org/wiki/SubRip) subtitle document.
 *
 * Prefers `results.utterances` (request with `utterances: true`); otherwise
 * chunks the first channel's word timings. Returns an empty string when the
 * response contains no words or utterances — never throws.
 */
export function toSRT(
  response: DeepgramPrerecordedResponse,
  opts?: CaptionOptions
): string {
  const cues = buildCues(response, opts);
  if (cues.length === 0) {
    return '';
  }
  return (
    cues
      .map(
        (cue, index) =>
          `${index + 1}\n` +
          `${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n` +
          cue.lines.join('\n')
      )
      .join('\n\n') + '\n'
  );
}

/**
 * Convert a Deepgram pre-recorded transcription response into a
 * [WebVTT](https://developer.mozilla.org/docs/Web/API/WebVTT_API) document.
 *
 * Prefers `results.utterances` (request with `utterances: true`); otherwise
 * chunks the first channel's word timings. Returns an empty string when the
 * response contains no words or utterances — never throws.
 */
export function toWebVTT(
  response: DeepgramPrerecordedResponse,
  opts?: CaptionOptions
): string {
  const cues = buildCues(response, opts);
  if (cues.length === 0) {
    return '';
  }
  return (
    'WEBVTT\n\n' +
    cues
      .map(
        (cue) =>
          `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n` +
          cue.lines.join('\n')
      )
      .join('\n\n') +
    '\n'
  );
}
