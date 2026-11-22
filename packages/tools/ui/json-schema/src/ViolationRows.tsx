/**
 * The rows of the Violations and Schema problems tables (docs/tools/specs/json-schema.md §8 п. 2, 5): number, the place
 * (a link-like button: the pointer and its line and column — a click puts the caret there), the sentence with the causes
 * of an `anyOf`/`oneOf` under it, and the place in the schema. At most 1,000 rows, built as JSON Query builds its own:
 * 200 with the render, 200 more per animation frame, each row memoised.
 */
import { placeName } from '@workspace/tool-logic-json-schema';
import { Button } from '@workspace/ui/button';
import { TableCell, TableRow } from '@workspace/ui/table';
import { memo, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

const STEP = 200;

/** What a row needs: a violation of the document or a problem of a schema. */
export interface Placed {
  instanceLocation: string;
  keywordLocation: string;
  message: string;
  offset: number;
  line: number;
  column: number;
  /** For a schema problem: which schema ('schema', 'referenced-<n>'). */
  source?: string;
  causes?: Placed[];
}

export type GoTo = (place: Placed) => void;

const Where = ({ place, goTo }: { place: Placed; goTo: GoTo }): ReactElement => (
  <Button
    variant="link"
    size="sm"
    className="h-auto flex-col items-start gap-0 p-0 text-left font-mono text-code whitespace-normal"
    data-part="where"
    aria-label={`Go to ${placeName(place.instanceLocation)}, line ${place.line}, column ${place.column}`}
    onClick={() => goTo(place)}>
    <span className="break-all [unicode-bidi:isolate]">{placeName(place.instanceLocation)}</span>
    <span className="font-sans text-xs whitespace-nowrap text-muted-foreground">{`line ${place.line}, column ${place.column}`}</span>
  </Button>
);

const Row = memo(({ k, place, goTo }: { k: number; place: Placed; goTo: GoTo }): ReactElement => (
  <TableRow data-row={k}>
    <TableCell className="align-top text-muted-foreground">{k + 1}</TableCell>
    <TableCell className="align-top">
      <Where place={place} goTo={goTo} />
    </TableCell>
    <TableCell className="align-top whitespace-normal" data-part="problem">
      <span className="[unicode-bidi:isolate]">{place.message}</span>
      {place.causes && place.causes.length > 0 && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 border-l border-border pl-3">
          {place.causes.map((c, i) => (
            <li key={i} data-part="cause" className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
              <Where place={c} goTo={goTo} />
              <span className="[unicode-bidi:isolate]">{c.message}</span>
              <span className="font-mono text-code break-all">{c.keywordLocation}</span>
            </li>
          ))}
        </ul>
      )}
    </TableCell>
    <TableCell className="align-top font-mono text-code break-all text-muted-foreground" data-part="schema-place">
      {place.keywordLocation}
    </TableCell>
  </TableRow>
));
Row.displayName = 'Row';

export const ViolationRows = ({ rows, goTo }: { rows: readonly Placed[]; goTo: GoTo }): ReactElement => {
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
      {rows.slice(0, count).map((place, k) => (
        <Row key={k} k={k} place={place} goTo={goTo} />
      ))}
    </>
  );
};
