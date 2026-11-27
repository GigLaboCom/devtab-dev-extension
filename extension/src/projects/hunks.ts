/**
 * The hunks of `diff.sides` in the shape the editor module draws (`LineHunk`): the contract sends where each change
 * is (0-based lines, both sides); the module also wants its kind and the removed lines, which are the old side's own
 * lines. Shaping data, not a second comparison: the lines and the hunks are the companion's (or the demo's).
 */
import type { Hunk, LineHunk } from './types';

export const toLineHunks = (oldText: string, hunks: readonly Hunk[]): LineHunk[] => {
  const old = oldText.split('\n');
  return hunks.map(({ oldStart, oldLines, start, lines }) => ({
    kind: oldLines === 0 ? 'added' : lines === 0 ? 'deleted' : 'modified',
    start,
    lines,
    oldStart,
    oldLines,
    oldText: old
      .slice(oldStart, oldStart + oldLines)
      .map(line => `${line}\n`)
      .join(''),
  }));
};
