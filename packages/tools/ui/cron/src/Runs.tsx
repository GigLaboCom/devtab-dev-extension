/**
 * Next runs (docs/tools/specs/cron.md §5.8, §5.9, §8 item 4): the table — When in the chosen zone, the same in the
 * browser's zone when it differs, In, Note — the line about daylight saving time, or why there are no runs; Copy runs.
 *
 * The clock (`useNow`) lives here and nowhere else: this part renders once a second for the In column, the page around
 * it does not. The runs themselves are worked out when the expression, the zone or the number changes and again when
 * the clock reaches the first of them (a no-run expression walks 400 years once, not every second).
 */
import {
  browserTimeZone,
  DST_LINE,
  formatRunWhen,
  nextRuns,
  noRunsText,
  relativeTime,
  RUN_NOTES,
  runsText,
  whyNoRuns,
} from '@workspace/tool-logic-cron';
import { useNow } from '@workspace/tools-host';
import { CopyButton } from '@workspace/ui/copy-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { ToolMessage, ToolPane } from '@workspace/ui/tool-page';
import { useMemo, useState } from 'react';
import type { ParsedCron } from '@workspace/tool-logic-cron';
import type { ReactElement } from 'react';

interface NextRunsProps {
  /** Null: nothing to show (empty field, an error) — the table is empty and Copy runs is off. */
  cron: ParsedCron | null;
  zone: string;
  count: number;
  onCopied?: () => void;
}

interface Basis {
  cron: ParsedCron | null;
  zone: string;
  count: number;
  /** The moment the runs are counted from (strictly after it). */
  from: number;
}

export const NextRuns = ({ cron, zone, count, onCopied }: NextRunsProps): ReactElement => {
  const now = useNow();
  const browser = useMemo(() => browserTimeZone(), []);
  const [kept, setKept] = useState<Basis>(() => ({ cron, zone, count, from: Date.now() }));
  // A new expression, zone or number: count from this moment (state derived while rendering, no effect needed).
  let basis = kept;
  if (kept.cron !== cron || kept.zone !== zone || kept.count !== count) {
    basis = { cron, zone, count, from: Date.now() };
    setKept(basis);
  }

  const runs = useMemo(
    () => (basis.cron ? nextRuns(basis.cron, basis.from, basis.zone, basis.count) : []),
    [basis.cron, basis.from, basis.zone, basis.count],
  );
  // The clock reached the first run: count again from now, so it leaves the table.
  if (runs.length > 0 && now >= runs[0]!.epochMs && basis.from < now) setKept({ ...basis, from: now });

  const why = useMemo(
    () => (basis.cron && runs.length === 0 ? whyNoRuns(basis.cron, basis.from, basis.zone) : null),
    [basis.cron, basis.from, basis.zone, runs],
  );
  const withSeconds = cron !== null && cron.dialect !== 'unix';
  const local = browser !== zone;
  const rows = useMemo(
    () =>
      runs.map(run => ({
        run,
        when: formatRunWhen(run.epochMs, zone, withSeconds),
        local: local ? formatRunWhen(run.epochMs, browser, withSeconds) : '',
        note: RUN_NOTES[run.kind],
      })),
    [runs, zone, browser, local, withSeconds],
  );
  const copied = useMemo(() => runsText(runs, zone), [runs, zone]);
  const label = `Next runs in ${zone}`;

  return (
    <ToolPane
      label={label}
      data-runs=""
      actions={<CopyButton label="Copy runs" value={copied} onCopied={onCopied ? () => onCopied() : undefined} />}>
      {why ? (
        <ToolMessage data-no-runs="">{noRunsText(why)}</ToolMessage>
      ) : (
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              {local && <TableHead>Local ({browser})</TableHead>}
              <TableHead>In</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={`${row.run.epochMs}-${row.run.kind}`} data-run={row.run.kind}>
                <TableCell className="font-mono text-code whitespace-nowrap">{row.when}</TableCell>
                {local && (
                  <TableCell className="font-mono text-code whitespace-nowrap text-muted-foreground">
                    {row.local}
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap">{relativeTime(row.run.epochMs, now)}</TableCell>
                <TableCell className="text-muted-foreground">{row.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.some(row => row.note !== '') && <ToolMessage data-dst-line="">{DST_LINE}</ToolMessage>}
    </ToolPane>
  );
};
