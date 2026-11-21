/**
 * The rows of the Unix Time tool (docs/tools/specs/unix-time.md §5.6, §8): a `<dl>` in three columns — the name, the
 * value in the code font (a click selects it whole), a copy icon. The clock (`useNow`) lives in the smallest parts that
 * show a ticking value: the whole list while the field is empty (`LiveResults`), only the Relative row once it holds
 * an instant (`RelativeRow`), and the zone line under the picker — so the page around them does not render every second.
 */
import { outputs, relativeOf, zoneSummary } from '@workspace/tool-logic-unix-time';
import { useNow } from '@workspace/tools-host';
import { CopyButton } from '@workspace/ui/copy-button';
import { Fragment, useMemo } from 'react';
import type { Outputs } from '@workspace/tool-logic-unix-time';
import type { ReactElement, ReactNode } from 'react';

type Values = { [K in keyof Outputs]: string | null };

interface Row {
  key: keyof Outputs;
  label: string;
  copy: string;
  /** Shown, muted, where the value is not defined for the instant. */
  missing?: string;
}

const YEARS = 'Only for years 1900 to 9999.';

/** §5.6, in order; the zone's ISO row only when the zone is not UTC. */
const rowsFor = (zone: string): Row[] => [
  { key: 'seconds', label: 'Seconds', copy: 'Copy seconds' },
  { key: 'milliseconds', label: 'Milliseconds', copy: 'Copy milliseconds' },
  { key: 'microseconds', label: 'Microseconds', copy: 'Copy microseconds' },
  { key: 'nanoseconds', label: 'Nanoseconds', copy: 'Copy nanoseconds' },
  { key: 'isoUtc', label: 'ISO 8601, UTC', copy: 'Copy ISO 8601 in UTC' },
  ...(zone === 'UTC'
    ? []
    : [{ key: 'isoZone' as const, label: `ISO 8601, ${zone}`, copy: `Copy ISO 8601 in ${zone}` }]),
  { key: 'rfc2822', label: 'RFC 2822', copy: 'Copy RFC 2822', missing: YEARS },
  { key: 'httpDate', label: 'HTTP date', copy: 'Copy HTTP date', missing: YEARS },
  { key: 'readable', label: 'Readable', copy: 'Copy readable date', missing: 'Not shown for years before 1 AD.' },
  { key: 'dayOfWeek', label: 'Day of week', copy: 'Copy day of week' },
  { key: 'dayOfYear', label: 'Day of year', copy: 'Copy day of year' },
  { key: 'isoWeekDate', label: 'ISO week date', copy: 'Copy ISO week date' },
  { key: 'relative', label: 'Relative', copy: 'Copy relative time' },
];

const asValues = (o: Outputs): Values => ({ ...o, dayOfYear: String(o.dayOfYear) });

interface ResultRowProps {
  row: Row;
  /** Undefined: an error — the row is empty and its button off. Null: not defined for this instant. */
  value: string | null | undefined;
  /** The value follows the clock: copy what is shown at the moment of the press. */
  live?: boolean;
  onCopied?: (text: string) => void;
}

const ResultRow = ({ row, value, live = false, onCopied }: ResultRowProps): ReactElement => (
  <div className="contents" data-row={row.key}>
    <dt className="text-sm whitespace-nowrap text-muted-foreground">{row.label}</dt>
    <dd className="m-0 min-w-0">
      {value === null ? (
        <span className="text-sm text-muted-foreground">{row.missing}</span>
      ) : (
        <span data-value className="font-mono break-all text-code text-foreground select-all">
          {value}
        </span>
      )}
    </dd>
    <dd className="m-0">
      <CopyButton
        icon
        size="icon-sm"
        label={row.copy}
        resetAfterMs={2000}
        value={live && value ? () => value : (value ?? '')}
        disabled={!value}
        onCopied={onCopied}
      />
    </dd>
  </div>
);

interface ListProps {
  zone: string;
  values: Values | null;
  live?: boolean;
  /** Replaces the Relative row (the one that follows the clock). */
  relative?: ReactNode;
  onCopied?: (text: string) => void;
}

const ResultList = ({ zone, values, live, relative, onCopied }: ListProps): ReactElement => (
  <dl
    aria-label="Result"
    className="m-0 grid max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
    {rowsFor(zone).map(row =>
      row.key === 'relative' && relative ? (
        <Fragment key={row.key}>{relative}</Fragment>
      ) : (
        <ResultRow
          key={row.key}
          row={row}
          value={values ? values[row.key] : undefined}
          live={live}
          onCopied={onCopied}
        />
      ),
    )}
  </dl>
);

const RELATIVE = rowsFor('UTC').at(-1)!;

/** The Relative row of a fixed instant: the only row that follows the clock. */
const RelativeRow = ({ epochNs, onCopied }: { epochNs: bigint; onCopied?: (text: string) => void }): ReactElement => {
  const now = useNow();
  return <ResultRow row={RELATIVE} value={relativeOf(epochNs, now)} onCopied={onCopied} />;
};

/** The field is empty: every row is the time now, renewed every second. */
export const LiveResults = ({ zone }: { zone: string }): ReactElement => {
  const now = useNow();
  const values = useMemo(() => asValues(outputs(BigInt(now) * 1_000_000n, zone, now)), [now, zone]);
  return <ResultList zone={zone} values={values} live />;
};

/** The field holds an instant: the rows are fixed but Relative. */
export const FixedResults = ({
  epochNs,
  zone,
  onCopied,
}: {
  epochNs: bigint;
  zone: string;
  onCopied?: (text: string) => void;
}): ReactElement => {
  const values = useMemo(() => asValues(outputs(epochNs, zone, 0)), [epochNs, zone]);
  return (
    <ResultList
      zone={zone}
      values={values}
      relative={<RelativeRow epochNs={epochNs} onCopied={onCopied} />}
      onCopied={onCopied}
    />
  );
};

/** An error: the rows are there, empty, their buttons off (§6). */
export const EmptyResults = ({ zone }: { zone: string }): ReactElement => <ResultList zone={zone} values={null} />;

const ZONE_LINE = 'text-sm text-muted-foreground';

/** Under the zone picker: "UTC+01:00 · Central European Standard Time" for the instant shown. */
export const ZoneLine = ({ epochNs, zone, id }: { epochNs: bigint; zone: string; id?: string }): ReactElement => (
  <p id={id} className={ZONE_LINE} data-zone-line>
    {zoneSummary(epochNs, zone)}
  </p>
);

/** The same for the time now (the offset and the name change at a change of the clocks). */
export const LiveZoneLine = ({ zone, id }: { zone: string; id?: string }): ReactElement => {
  const now = useNow();
  return <ZoneLine epochNs={BigInt(now) * 1_000_000n} zone={zone} id={id} />;
};
