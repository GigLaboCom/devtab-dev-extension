/**
 * The rows of the Results table (docs/tools/specs/json-query.md §8 п. 3): at most 1,000 — number, normalized path,
 * the value on one line — each with two icon buttons, `Copy path N` and `Copy value N`. Built as the RegExp tool builds
 * its rows: 200 with the render, 200 more per animation frame, each row memoised. A row's value is copied indented by
 * 2, sliced from the values' text at the moment of the press; a row past the copy limit has no value to copy.
 */
import { valueOfRow } from '@workspace/tool-logic-json-query';
import { CopyButton } from '@workspace/ui/copy-button';
import { TableCell, TableRow } from '@workspace/ui/table';
import { memo, useEffect, useState } from 'react';
import type { QueryRow } from '@workspace/tool-logic-json-query';
import type { ReactElement } from 'react';

const STEP = 200;

export type Taken = 'copy-value' | 'copy-path';

const Row = memo(
  ({
    k,
    row,
    values,
    onTaken,
  }: {
    k: number;
    row: QueryRow;
    values: string;
    onTaken: (action: Taken) => void;
  }): ReactElement => (
    <TableRow data-row={k}>
      <TableCell className="text-muted-foreground">{k + 1}</TableCell>
      <TableCell className="break-all [unicode-bidi:isolate]" data-part="path">
        {row.path}
      </TableCell>
      <TableCell className="break-all [unicode-bidi:isolate]" data-part="value">
        {row.preview}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <CopyButton
            icon
            label={`Copy path ${k + 1}`}
            value={row.path}
            resetAfterMs={1500}
            onCopied={() => onTaken('copy-path')}
          />
          <CopyButton
            icon
            label={`Copy value ${k + 1}`}
            value={() => valueOfRow(values, row) ?? ''}
            resetKey={row}
            disabled={row.at === null}
            resetAfterMs={1500}
            onCopied={() => onTaken('copy-value')}
          />
        </div>
      </TableCell>
    </TableRow>
  ),
);
Row.displayName = 'Row';

export interface ResultRowsProps {
  rows: readonly QueryRow[];
  values: string;
  onTaken: (action: Taken) => void;
}

export const ResultRows = ({ rows, values, onTaken }: ResultRowsProps): ReactElement => {
  const [built, setBuilt] = useState({ rows, count: STEP });
  const count = built.rows === rows ? built.count : STEP;
  if (built.rows !== rows) setBuilt({ rows, count: STEP });

  useEffect(() => {
    if (count >= rows.length) return;
    const frame = requestAnimationFrame(() => setBuilt(b => (b.rows === rows ? { rows, count: b.count + STEP } : b)));
    return () => cancelAnimationFrame(frame);
  }, [count, rows]);

  return (
    <>
      {rows.slice(0, count).map((row, k) => (
        <Row key={k} k={k} row={row} values={values} onTaken={onTaken} />
      ))}
    </>
  );
};
