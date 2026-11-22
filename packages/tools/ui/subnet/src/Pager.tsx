/**
 * Pages of a long table (docs/tools/specs/subnet.md §5 п. 24): `Subnets 1–1,000 of 65,536` and First, Previous, Next,
 * Last. The numbers are `bigint` — a split can have 2^128 rows — and a page always starts at a multiple of its size.
 */
import { groupDigits } from '@workspace/tool-logic-subnet';
import { Button } from '@workspace/ui/button';
import type { ReactElement } from 'react';

export interface PagerProps {
  /** 'Subnets', 'Addresses'. */
  noun: string;
  from: bigint;
  size: bigint;
  total: bigint;
  onPage: (from: bigint) => void;
}

export const Pager = ({ noun, from, size, total, onPage }: PagerProps): ReactElement | null => {
  if (total <= size) return null;
  const lastPage = ((total - 1n) / size) * size;
  const to = from + size > total ? total : from + size;
  return (
    <div className="flex flex-wrap items-center gap-2" data-part="pager">
      <span className="text-muted-foreground" aria-live="polite">
        {noun} {groupDigits(from + 1n)}–{groupDigits(to)} of {groupDigits(total)}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={from === 0n} onClick={() => onPage(0n)}>
          First
        </Button>
        <Button variant="outline" size="sm" disabled={from === 0n} onClick={() => onPage(from - size)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={from >= lastPage} onClick={() => onPage(from + size)}>
          Next
        </Button>
        <Button variant="outline" size="sm" disabled={from >= lastPage} onClick={() => onPage(lastPage)}>
          Last
        </Button>
      </div>
    </div>
  );
};
