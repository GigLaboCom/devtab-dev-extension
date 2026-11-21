/**
 * A result with its copy action (`kit-result-row*` in @workspace/dna/style-gpui.css): a name, the value in the code
 * font in an `<output>` — not a field, so a browser offers neither to save it as a password nor to check its spelling —
 * and an icon CopyButton. Rows line up in a `ResultRows` grid (names, values and buttons in three columns).
 *
 *   <ResultRows>
 *     <ResultRow label="SHA-256" value={hex} copyLabel="Copy SHA-256" />
 *     <ResultRow label="Port" value="" empty="empty" />          an empty value shows the muted word, no button
 *   </ResultRows>
 *
 * `extra` goes after the value (a "Matches" mark, a "default" note), or with `extraBelow` on a line of its own under the
 * value (a longer note, a reason); `copy` replaces the copy button's props. The value is not a live region: an
 * `<output>` would be one (role `status`), and a screen reader would read every row again on every keystroke of the
 * input it is derived from — a tool announces what it means to, once, in its own words.
 */
import { CopyButton } from './copy-button';
import { cn } from '../lib/utils';
import type { CopyButtonProps } from './copy-button';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

export const ResultRows = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="result-rows" className={cn('kit-result-rows', className)} {...props} />
);

export interface ResultRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  label: ReactNode;
  value: string;
  /** The output's accessible name; default: `label` when it is a string. */
  outputLabel?: string;
  /** The copy button's accessible name; default: `Copy <label>`. */
  copyLabel?: string;
  /** Shown instead of an empty value (muted); default: nothing. */
  empty?: ReactNode;
  /** After the value, inside its cell; with `extraBelow`, on a line of its own under the value. */
  extra?: ReactNode;
  extraBelow?: boolean;
  copy?: Partial<CopyButtonProps>;
}

export const ResultRow = ({
  label,
  value,
  outputLabel,
  copyLabel,
  empty,
  extra,
  extraBelow = false,
  copy,
  className,
  ...props
}: ResultRowProps): ReactElement => {
  const name = outputLabel ?? (typeof label === 'string' ? label : undefined);
  return (
    <div data-slot="result-row" className={cn('kit-result-row', className)} {...props}>
      <span className="kit-result-row-label">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <output
          className="kit-result-row-value"
          aria-label={name}
          aria-live="off"
          data-empty={value === '' || undefined}>
          {value === '' ? empty : value}
        </output>
        {!extraBelow && extra}
      </span>
      {value === '' ? (
        <span />
      ) : (
        <CopyButton icon value={value} label={copyLabel ?? (name ? `Copy ${name}` : 'Copy')} {...copy} />
      )}
      {extraBelow && extra !== undefined && <span className="kit-result-row-extra">{extra}</span>}
    </div>
  );
};
