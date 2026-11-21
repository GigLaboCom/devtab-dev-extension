/**
 * The rows of the Matches table (docs/tools/specs/regexp.md §8 п. 4): at most 1,000, each a button that selects its
 * match. Like the highlights (Highlight.tsx), they are not built at once: 200 with the render, 200 more per animation
 * frame; a chosen row not built yet is built at once. Each row is memoised, so selecting re-renders two rows.
 */
import { MAX_TABLE_ROWS, showMatchText } from '@workspace/tool-logic-regexp';
import { TableCell, TableRow } from '@workspace/ui/table';
import { memo, useEffect, useState } from 'react';
import type { Match } from '@workspace/tool-logic-regexp';
import type { ReactElement } from 'react';

const STEP = 200;

const MatchRow = memo(
  ({ m, selected, onSelect }: { m: Match; selected: boolean; onSelect: (match: number) => void }): ReactElement => (
    <TableRow data-row={m.index} data-state={selected ? 'selected' : undefined} className="relative">
      <TableCell>
        <button
          type="button"
          aria-label={`Match ${m.index + 1}`}
          aria-pressed={selected}
          className="cursor-pointer rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelect(m.index)}>
          {m.index + 1}
        </button>
      </TableCell>
      <TableCell>
        {m.line}:{m.column}
      </TableCell>
      <TableCell>
        {m.start}–{m.end}
      </TableCell>
      <TableCell className="break-all">{showMatchText(m.text)}</TableCell>
    </TableRow>
  ),
);
MatchRow.displayName = 'MatchRow';

export interface MatchRowsProps {
  matches: readonly Match[];
  selected: number;
  onSelect: (match: number) => void;
}

export const MatchRows = ({ matches, selected, onSelect }: MatchRowsProps): ReactElement => {
  const total = Math.min(matches.length, MAX_TABLE_ROWS);
  const [built, setBuilt] = useState({ matches, count: STEP });
  const count = built.matches === matches ? built.count : STEP;
  if (built.matches !== matches) setBuilt({ matches, count: STEP });
  else if (selected >= count && selected < total) setBuilt({ matches, count: selected + 1 });

  useEffect(() => {
    if (count >= total) return;
    const frame = requestAnimationFrame(() =>
      setBuilt(b => (b.matches === matches ? { matches, count: b.count + STEP } : b)),
    );
    return () => cancelAnimationFrame(frame);
  }, [count, total, matches]);

  return (
    <>
      {matches.slice(0, Math.min(count, total)).map(m => (
        <MatchRow key={m.index} m={m} selected={m.index === selected} onSelect={onSelect} />
      ))}
    </>
  );
};
