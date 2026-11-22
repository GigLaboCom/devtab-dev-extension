/**
 * The parts of the String Inspector's page that show the inspected text (docs/tools/specs/string-inspector.md §5.4,
 * §5.6, §8). The text is hostile by definition, so every place that shows it is kept from touching the rest of the page:
 *
 *   - no bidirectional control ever reaches the DOM: each is a marker (the logic's visible parts), so none can reorder
 *     anything, and every box that holds the person's text is `dir="ltr"` — which isolates it (`unicode-bidi: isolate`
 *     by the browser's own style for `[dir]`) — so a right-to-left run reorders only inside its box;
 *   - the boxes clip what they hold: a fixed height with its own scroll (`overflow-auto`) and paint containment, so a
 *     run of combining marks stacked thousands high, or a glyph wider than its cell, paints inside the box and nowhere
 *     else, and the box itself does not grow past its limit;
 *   - long runs without a break wrap anywhere (`wrap-anywhere`), so a megabyte on one line widens nothing;
 *   - a word quoted in a warning is cut after 40 code points and wrapped in `<bdi>`.
 *
 * React builds every node; nothing is set as HTML.
 */
import {
  MAX_MARK_RUN,
  MAX_ROWS,
  MAX_VISIBLE,
  SUMMARY_LABELS,
  TABLE_COLUMNS,
  codePointLabel,
  quotedMixedWords,
  rowCells,
  summaryValue,
  wordParts,
} from '@workspace/tool-logic-string-inspector';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { EyeOffIcon, TriangleAlertIcon } from 'lucide-react';
import { Fragment } from 'react';
import type { CodePointRow, FormResult, Summary, VisiblePart, Warnings } from '@workspace/tool-logic-string-inspector';
import type { ReactElement, ReactNode } from 'react';

const number = (n: number): string => n.toLocaleString('en-US');
/** A box that scrolls is reached by the keyboard so its keys scroll it (as the kit's Table does when it scrolls). */
const SCROLL_BOX_TAB_INDEX = 0;
const plural = (n: number, one: string, many: string): string => `${number(n)} ${n === 1 ? one : many}`;

/** A section's head line: its heading and its actions, as a tool pane's head looks. */
export const SectionHead = ({ id, title, actions }: { id: string; title: string; actions?: ReactNode }) => (
  <div className="kit-tool-pane-head">
    <h3 id={id} className="cn-label m-0">
      {title}
    </h3>
    {actions && <div className="flex items-center gap-1">{actions}</div>}
  </div>
);

/** An invisible code point in the text: its marker in a box, named for a screen reader (§8). */
export const Marker = ({ part }: { part: Extract<VisiblePart, { marker: string }> }): ReactElement => (
  <span
    role="img"
    aria-label={part.name ?? codePointLabel(part.codePoint)}
    title={`${codePointLabel(part.codePoint)}${part.name ? ` ${part.name}` : ''}`}
    data-marker={part.marker}
    className="mx-px rounded-sm border border-border px-0.5 align-baseline font-mono text-xs text-muted-foreground">
    {part.marker}
  </span>
);

const Parts = ({ parts }: { parts: readonly VisiblePart[] }): ReactElement => (
  <>{parts.map((p, i) => ('text' in p ? <Fragment key={i}>{p.text}</Fragment> : <Marker key={i} part={p} />))}</>
);

/** The summary's eight pairs (§5.1), two or four columns by width; numbers in the code font. */
export const SummaryGrid = ({ summary }: { summary: Summary }): ReactElement => (
  <dl aria-labelledby="string-inspector-summary" className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
    {SUMMARY_LABELS.map(([key, label]) => (
      <div key={key} data-summary={key} className="flex min-w-0 flex-col">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="m-0 font-mono text-code">{summaryValue(summary, key)}</dd>
      </div>
    ))}
  </dl>
);

/** What the four normalisation forms would change (spec §15), one line. */
export const FormsLine = ({ forms }: { forms: readonly FormResult[] | null }): ReactElement => (
  <p data-part="forms" className="m-0 text-sm text-muted-foreground">
    {forms === null
      ? `Normalization not checked: the text has a run of more than ${MAX_MARK_RUN} combining marks.`
      : forms
          .map(f =>
            f.changes
              ? `${f.form} changes it: ${plural(f.codePoints, 'code point', 'code points')}, ${plural(f.utf8Bytes, 'UTF-8 byte', 'UTF-8 bytes')}`
              : `${f.form} leaves it as it is`,
          )
          .join('; ') + '.'}
  </p>
);

const Warning = ({ children }: { children: ReactNode }): ReactElement => (
  <li className="flex items-start gap-2 text-sm">
    <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
    <span className="min-w-0 wrap-anywhere">{children}</span>
  </li>
);

/**
 * The warnings of §5.5 as the logic's `warningLines` words them — the mixed-script line built here, so that a quoted
 * word is shown through its visible parts and isolated (`<bdi>`), never as raw text.
 */
export const WarningList = ({ warnings, lines }: { warnings: Warnings; lines: readonly string[] }): ReactElement => {
  const mixed = warnings.mixedScripts.length;
  return (
    <div role="status" aria-label="Warnings">
      {lines.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-part="warnings">
          {lines.map(line =>
            line.startsWith('Mixed scripts in ') ? (
              <Warning key="mixed">
                {`Mixed scripts in ${plural(mixed, 'word', 'words')}: `}
                {quotedMixedWords(warnings).map((m, i) => {
                  const { parts, cut } = wordParts(m.word);
                  return (
                    <Fragment key={m.index}>
                      {i > 0 && ', '}
                      <bdi dir="ltr" data-word>
                        {'"'}
                        <Parts parts={parts} />
                        {cut ? '\u{2026}' : ''}
                        {'"'}
                      </bdi>
                      {` (${m.scripts.join(', ')})`}
                    </Fragment>
                  );
                })}
                .
              </Warning>
            ) : (
              <Warning key={line}>{line}</Warning>
            ),
          )}
        </ul>
      )}
    </div>
  );
};

/** The visible text (§5.4): the first 10,000 code points, markers for the invisible ones, isolated and clipped. */
export const VisibleText = ({ parts, codePoints }: { parts: readonly VisiblePart[]; codePoints: number }) => (
  <>
    <div
      dir="ltr"
      role="region"
      aria-label="The text with its invisible characters marked"
      tabIndex={SCROLL_BOX_TAB_INDEX}
      data-part="visible"
      className="cn-textarea max-h-90 min-h-9 overflow-auto text-sm leading-gpui whitespace-pre-wrap wrap-anywhere [contain:content]">
      <Parts parts={parts} />
    </div>
    {codePoints > MAX_VISIBLE && (
      <p className="kit-tool-message" data-part="visible-limit">
        {`Showing the first ${number(MAX_VISIBLE)} of ${number(codePoints)} code points.`}
      </p>
    )}
  </>
);

/** The `Char` cell: the marker of an invisible code point, a mark on a dotted circle, or the character itself. */
const CharCell = ({ row, shown }: { row: CodePointRow; shown: string }): ReactElement =>
  row.marker !== null ? (
    <span className="inline-flex items-center gap-1">
      <EyeOffIcon aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
      <span className="rounded-sm border border-border px-0.5 font-mono text-xs text-muted-foreground">
        {row.marker}
      </span>
    </span>
  ) : (
    <bdi dir="ltr" className="-my-1 inline-flex h-8 max-w-16 items-center overflow-hidden px-1 text-base">
      {shown}
    </bdi>
  );

const NameCell = ({ row, name }: { row: CodePointRow; name: string }): ReactElement =>
  row.lookalike === null ? (
    <>{name}</>
  ) : (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>{name}</span>
      <span className="inline-flex items-center gap-1 text-warning">
        <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {`looks like ${row.lookalike}`}
      </span>
    </span>
  );

/**
 * The table of §5.6: a row per code point of the first 1,000, at most 480 px high with its own scroll and the head row
 * kept in place. The kit's Table scrolls only sideways (its container is the scroll box), so the table here is the kit's
 * parts in a box of its own (reported: a `Table` that scrolls both ways belongs to the kit).
 */
export const CharacterTable = ({ rows, codePoints }: { rows: readonly CodePointRow[]; codePoints: number }) => (
  <>
    <div
      role="region"
      aria-label="Characters, one row per code point"
      tabIndex={SCROLL_BOX_TAB_INDEX}
      data-part="table"
      className="max-h-120 overflow-auto rounded-md border border-border [contain:content]">
      <table className="cn-table" aria-label="Characters">
        <TableHeader className="sticky top-0 z-10">
          <TableRow>
            {TABLE_COLUMNS.map(c => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const cells = rowCells(row);
            const first = i === 0 || rows[i - 1]!.grapheme !== row.grapheme;
            const flagged = row.marker !== null || row.lookalike !== null;
            return (
              <TableRow
                key={i}
                data-first={first || undefined}
                data-flagged={flagged || undefined}
                className={first && i > 0 ? 'border-t-2 border-t-border' : undefined}>
                <TableCell className="font-mono text-code text-muted-foreground">{first ? cells[0] : ''}</TableCell>
                <TableCell>
                  <CharCell row={row} shown={cells[1]!} />
                </TableCell>
                <TableCell className="font-mono text-code whitespace-nowrap">{cells[2]}</TableCell>
                <TableCell className="text-xs">
                  <NameCell row={row} name={cells[3]!} />
                </TableCell>
                <TableCell className="text-xs">{cells[4]}</TableCell>
                <TableCell className="text-xs">{cells[5]}</TableCell>
                <TableCell className="font-mono text-code whitespace-nowrap">{cells[6]}</TableCell>
                <TableCell className="font-mono text-code whitespace-nowrap">{cells[7]}</TableCell>
                <TableCell className="font-mono text-code whitespace-nowrap">{cells[8]}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </div>
    {codePoints > MAX_ROWS && (
      <p className="kit-tool-message" data-part="table-limit">
        {`Showing the first ${number(MAX_ROWS)} of ${number(codePoints)} code points.`}
      </p>
    )}
  </>
);
