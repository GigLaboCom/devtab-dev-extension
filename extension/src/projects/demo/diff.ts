/**
 * The demo's stand-in for the companion's hunks (the server's `vcs_line_hunks`, HEAD → disk): a plain line diff of two
 * small texts, in the shape the editor module draws (`LineHunk`), and the commit of some of those hunks. Only the demo
 * needs it — the companion sends its hunks, and «Compare code» compares in the editor's module (D13); this is the
 * demo's data, not a second comparison of the product.
 */
import type { LineHunk } from '../types';

/** The editor's lines: a trailing newline opens one more, empty line. */
const linesOf = (text: string): string[] => text.split('\n');

/** Above this many cells the demo does not diff line by line: the whole text is one hunk. */
const MAX_CELLS = 4_000_000;

/** The hunks that turn `oldText` into `newText`, in order; 0-based editor lines. */
export const lineHunks = (oldText: string, newText: string): LineHunk[] => {
  if (oldText === newText) return [];
  const a = linesOf(oldText);
  const b = linesOf(newText);
  // The common prefix and suffix stay out of the table.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  const pairs: [number, number][] = [];
  if (n * m <= MAX_CELLS) {
    // Longest common subsequence, from the end.
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] =
          a[head + i] === b[head + j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[head + i] === b[head + j]) {
        pairs.push([head + i, head + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
      else j++;
    }
  }
  pairs.push([a.length - tail, b.length - tail]);
  const hunks: LineHunk[] = [];
  let oldAt = head;
  let newAt = head;
  for (const [oldMatch, newMatch] of pairs) {
    const oldLines = oldMatch - oldAt;
    const lines = newMatch - newAt;
    if (oldLines > 0 || lines > 0)
      hunks.push({
        kind: oldLines === 0 ? 'added' : lines === 0 ? 'deleted' : 'modified',
        start: newAt,
        lines,
        oldStart: oldAt,
        oldLines,
        oldText: a
          .slice(oldAt, oldMatch)
          .map(line => `${line}\n`)
          .join(''),
      });
    oldAt = oldMatch + 1;
    newAt = newMatch + 1;
  }
  return hunks;
};

/** `oldText` with only the chosen hunks (by index) of `lineHunks(oldText, newText)` applied. */
export const applyHunks = (oldText: string, newText: string, chosen: readonly number[]): string => {
  const a = linesOf(oldText);
  const b = linesOf(newText);
  const out: string[] = [];
  let at = 0;
  lineHunks(oldText, newText).forEach((hunk, index) => {
    out.push(...a.slice(at, hunk.oldStart));
    out.push(
      ...(chosen.includes(index)
        ? b.slice(hunk.start, hunk.start + hunk.lines)
        : a.slice(hunk.oldStart, hunk.oldStart + hunk.oldLines)),
    );
    at = hunk.oldStart + hunk.oldLines;
  });
  out.push(...a.slice(at));
  return out.join('\n');
};

/** A short, stable stand-in for the text's SHA-256 (the page treats the hash as opaque): FNV-1a, 64 bits as hex. */
export const textHash = (text: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5 | 1) >>> 0;
  }
  return `demo-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};
