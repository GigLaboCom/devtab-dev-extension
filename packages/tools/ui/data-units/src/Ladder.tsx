/**
 * Every unit at once (docs/tools/specs/data-units.md §5 item 12, §8): per section the base unit, then the decimal and
 * binary columns side by side (one under the other on a narrow page). Each row is the kit's result row with its copy
 * button — the number without groups and without the ≈ mark.
 */
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import type { LadderRow, LadderSection, ResultLine } from '@workspace/tool-logic-data-units';
import type { ReactElement } from 'react';

const ICON_RESET_MS = 1500;

const Row = ({ row, onCopied }: { row: LadderRow; onCopied: () => void }): ReactElement => (
  <ResultRow
    data-row={row.id}
    label={row.alias ? `${row.label} (${row.alias})` : row.label}
    outputLabel={row.label}
    value={row.value.text}
    copyLabel={`Copy ${row.label}`}
    copy={{ value: row.value.copy, resetAfterMs: ICON_RESET_MS, onCopied }}
  />
);

export const Lines = ({
  rows,
  label,
  onCopied,
}: {
  rows: readonly ResultLine[];
  label: string;
  onCopied: () => void;
}): ReactElement | null =>
  rows.length === 0 ? null : (
    <ResultRows aria-label={label} role="group">
      {rows.map(row => (
        <ResultRow
          key={row.id}
          data-row={row.id}
          label={row.label}
          value={row.value}
          copyLabel={`Copy ${row.label === 'h:mm:ss' ? row.label : row.label.toLowerCase()}`}
          copy={{ value: row.copy, resetAfterMs: ICON_RESET_MS, onCopied }}
        />
      ))}
    </ResultRows>
  );

export const Ladder = ({
  sections,
  onCopied,
}: {
  sections: readonly LadderSection[];
  onCopied: () => void;
}): ReactElement => (
  <div className="flex flex-col gap-6" data-part="ladder">
    {sections.map(section => (
      <section key={section.id} aria-label={section.title} data-section={section.id} className="flex flex-col gap-2">
        <h3 className="font-medium">{section.title}</h3>
        <ResultRows aria-label={`${section.title}: base unit`} role="group">
          <Row row={section.base} onCopied={onCopied} />
        </ResultRows>
        <div className="grid gap-4 lg:grid-cols-2">
          {[section.decimal, section.binary].map((column, i) => (
            <div key={i} className="flex min-w-0 flex-col gap-1" data-column={i === 0 ? 'decimal' : 'binary'}>
              <p className="text-muted-foreground">{column.title}</p>
              <ResultRows aria-label={column.title} role="group">
                {column.rows.map(row => (
                  <Row key={row.id} row={row} onCopied={onCopied} />
                ))}
              </ResultRows>
            </div>
          ))}
        </div>
      </section>
    ))}
  </div>
);
