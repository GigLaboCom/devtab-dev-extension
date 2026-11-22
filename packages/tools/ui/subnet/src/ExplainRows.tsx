/**
 * Explain's rows (docs/tools/specs/subnet.md §5 п. 13–16, §8 п. 2): the kit's result rows, each with its copy button
 * (numbers copied without digit groups), the rule or the source on a second line; the binary row marks the network
 * part — its bits in the text colour, the host's muted — and says it in words for those who do not see colour.
 */
import { CopyButton } from '@workspace/ui/copy-button';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import type { Explanation, Row } from '@workspace/tool-logic-subnet';
import type { ReactElement } from 'react';

/** 'Copy network', 'Copy reverse DNS name', 'Copy /64 networks'. */
export const copyLabel = (label: string): string => `Copy ${label.replace(/^[A-Z](?=[a-z])/, m => m.toLowerCase())}`;

const BinaryRow = ({
  row,
  explanation,
  onCopied,
}: {
  row: Row;
  explanation: Explanation;
  onCopied: () => void;
}): ReactElement => {
  const { bits, networkChars } = explanation.binary;
  return (
    <div data-slot="result-row" className="kit-result-row" data-row="binary">
      <span className="kit-result-row-label">{row.label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <output className="kit-result-row-value break-all" aria-label={row.label} aria-live="off">
          <span data-part="network-bits">{bits.slice(0, networkChars)}</span>
          <span data-part="host-bits" className="text-muted-foreground">
            {bits.slice(networkChars)}
          </span>
        </output>
      </span>
      <CopyButton icon value={row.copy} label={copyLabel(row.label)} resetAfterMs={1500} onCopied={onCopied} />
      <span className="kit-result-row-extra">{row.extra}</span>
    </div>
  );
};

export const ExplainRows = ({
  explanation,
  onCopied,
}: {
  explanation: Explanation;
  onCopied: () => void;
}): ReactElement => (
  <ResultRows aria-label="Block details" role="group">
    {explanation.rows.map(row =>
      row.id === 'binary' ? (
        <BinaryRow key={row.id} row={row} explanation={explanation} onCopied={onCopied} />
      ) : (
        <ResultRow
          key={row.id}
          data-row={row.id}
          label={row.label}
          value={row.value}
          copyLabel={copyLabel(row.label)}
          copy={{ value: row.copy, resetAfterMs: 1500, onCopied, disabled: row.copy === '' }}
          {...(row.extra === undefined ? {} : { extra: row.extra, extraBelow: true })}
        />
      ),
    )}
  </ResultRows>
);
