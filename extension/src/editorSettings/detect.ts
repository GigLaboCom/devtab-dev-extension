/**
 * Seam `IndentDetector` (docs/replaceable-behaviors.md; research §4.7): the indentation a text already uses, so an edit
 * keeps it instead of mixing in another. Runs once when a text is opened (each side of a comparison on its own), never
 * per keystroke.
 *
 * The default, `countingDetector`, counts as VS Code does: the lines indented with tabs and those indented with
 * spaces; for the space-indented lines, the step from the line before (0, 4, 8, 4, 8, 12 → 4, 4, 4, 4, 4); the most
 * frequent step among 2, 4, 6 and 8 is the size (a tie goes to the smaller). It decides only with at least
 * `DETECT_MIN_LINES` indented lines; with fewer there is nothing to go by and the level is skipped. More tab lines than
 * space lines: tabs, and the size stays the settings' (a tab says nothing about its width).
 *
 * Bounded, so a huge or hostile text cannot hold the page: at most `DETECT_MAX_LINES` lines and `DETECT_MAX_CHARS`
 * characters are read — a longer text is judged by its start — and a line's leading whitespace is counted only up to
 * `DETECT_MAX_INDENT` characters. Synchronous for that reason: the work is small and fixed, and the text is on the page
 * already.
 */
import type { IndentStyle } from './model';

/** What a text's own indentation says; `indentSize` absent: the text does not tell (tabs, or no regular step). */
export interface DetectedIndent {
  indentStyle: IndentStyle;
  indentSize?: number;
}

export interface IndentDetector {
  /** For reports and tests. */
  readonly id: string;
  /** The text's indentation, or null when it does not have enough indented lines to tell. */
  detect(text: string): DetectedIndent | null;
}

export const DETECT_MAX_LINES = 10_000;
export const DETECT_MAX_CHARS = 524_288;
export const DETECT_MIN_LINES = 5;
/** Leading whitespace counted per line; a deeper indent counts as this deep. */
export const DETECT_MAX_INDENT = 256;
const STEPS = [2, 4, 6, 8] as const;

export const detectIndent = (text: string): DetectedIndent | null => {
  const end = Math.min(text.length, DETECT_MAX_CHARS);
  let tabLines = 0;
  let spaceLines = 0;
  let previous = 0;
  const steps = new Map<number, number>();
  let lines = 0;
  for (let start = 0; start < end && lines < DETECT_MAX_LINES; lines++) {
    const newline = text.indexOf('\n', start);
    const stop = newline < 0 || newline > end ? end : newline;
    // The leading whitespace, as far as it counts.
    let at = start;
    const limit = Math.min(stop, start + DETECT_MAX_INDENT);
    while (at < limit && (text[at] === ' ' || text[at] === '\t')) at++;
    const blank = at === stop || (at === stop - 1 && text[at] === '\r');
    if (!blank) {
      const first = text[start];
      if (first === '\t') tabLines++;
      else if (first === ' ') {
        spaceLines++;
        const indent = at - start;
        const step = Math.abs(indent - previous);
        if (step > 0) steps.set(step, (steps.get(step) ?? 0) + 1);
        previous = indent;
      } else previous = 0;
    }
    start = stop + 1;
  }
  if (tabLines + spaceLines < DETECT_MIN_LINES) return null;
  if (tabLines > spaceLines) return { indentStyle: 'tab' };
  let size: number | undefined;
  let best = 0;
  for (const step of STEPS) {
    const count = steps.get(step) ?? 0;
    if (count > best) {
      best = count;
      size = step;
    }
  }
  return size === undefined ? { indentStyle: 'space' } : { indentStyle: 'space', indentSize: size };
};

/** The default detector: counts lines as above. */
export const countingDetector: IndentDetector = { id: 'counting', detect: detectIndent };

/** No detection: the settings alone apply (the detector switched off, or a host that wants none). */
export const noDetector: IndentDetector = { id: 'none', detect: () => null };
