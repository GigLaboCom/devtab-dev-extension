/** What the page shows for the logic's answer (docs/tools/specs/backslash-escape.md §3, §6, §8): result, error, notes. */
import type { BackslashEscapePayload } from './history';
import type { Computed, Job } from './work';

export interface Outcome {
  output: string;
  /** Under the input, with its place. */
  error: string | null;
  /** Under the result, one line each. */
  notes: string[];
  /** For the history; null when there is nothing to record. */
  payload: Omit<BackslashEscapePayload, 'action'> | null;
}

export const EMPTY: Outcome = { output: '', error: null, notes: [], payload: null };

export const TOO_LARGE = 'Input is larger than 5 MB. This tool works with up to 5 MB.';
export const INVALID_UTF8 = 'Bytes from \\x and octal escapes are not valid UTF-8: shown as U+FFFD.';

/** `Kept with the backslash, as Python does: \q, \d` — up to five, then `and N more` (§8). */
export const keptNote = (kept: string[]): string => {
  const more = kept.length - 5;
  return `Kept with the backslash, as Python does: ${kept.slice(0, 5).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
};

const codePoint = (unit: number): string => `U+${unit.toString(16).toUpperCase().padStart(4, '0')}`;

/** The first unpaired surrogate, and how many there are (§8). */
export const surrogateNote = (count: number, first: number): string =>
  count === 1
    ? `Contains an unpaired surrogate (${codePoint(first)}). Most programs turn it into U+FFFD.`
    : `Contains ${count.toLocaleString('en-US')} unpaired surrogates, the first ${codePoint(first)}. Most programs turn them into U+FFFD.`;

export const toOutcome = (job: Job, computed: Computed): Outcome => {
  const base = {
    mode: job.mode,
    dialect: job.dialect,
    quote: job.quote,
    nonAscii: job.nonAscii,
    withQuotes: job.withQuotes,
  };
  if (computed.mode === 'escape')
    return { output: computed.text, error: null, notes: [], payload: { ...base, outcome: 'text' } };
  const { result } = computed;
  if (!result.ok) {
    const { message, line, column } = result.error;
    return {
      ...EMPTY,
      error: `Line ${line}, column ${column}: ${message}`,
      payload: { ...base, outcome: 'error', error: { message, line, column } },
    };
  }
  const notes: string[] = [];
  if (result.keptUnknown.length) notes.push(keptNote(result.keptUnknown));
  if (result.loneSurrogates && result.firstLoneSurrogate !== null)
    notes.push(surrogateNote(result.loneSurrogates, result.firstLoneSurrogate));
  if (result.invalidUtf8) notes.push(INVALID_UTF8);
  return { output: result.text, error: null, notes, payload: { ...base, outcome: 'text' } };
};
