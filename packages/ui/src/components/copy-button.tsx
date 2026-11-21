/**
 * Copy a result with one press (docs/tools/README.md «Интерфейс»: every result has one; writing the clipboard on a
 * click needs no permission). A Button (`cn-button*`) in two forms:
 *
 *   <CopyButton value={text} />                               "Copy" → "Copied" until the value changes
 *   <CopyButton value={hash} icon label="Copy SHA-256" />     an icon button; its aria-label becomes "Copied" and the
 *                                                             icon a check, for `resetAfterMs` (url: 1500) or until the
 *                                                             value changes
 *
 * `value` may be a function, read at the moment of the press (a result that is not text yet). Nothing to copy (an
 * empty string) disables it. A refused write says "Not copied" the same way and goes to `onError`. The clipboard is
 * `navigator.clipboard` unless `write` says otherwise (a host, a test).
 */
import { Button } from './button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactElement } from 'react';

export interface CopyButtonProps extends Omit<ComponentProps<typeof Button>, 'value' | 'onClick' | 'onError'> {
  /** What to copy, or how to get it when pressed. */
  value: string | (() => string);
  /** The button's words (default "Copy"), or the icon button's accessible name ("Copy SHA-256"). */
  label?: string;
  /** An icon button with `label` as its aria-label. */
  icon?: boolean;
  /** Go back to "Copy" after this long; absent: only when the value changes. */
  resetAfterMs?: number;
  write?: (text: string) => Promise<void>;
  onCopied?: (text: string) => void;
  onError?: (error: unknown) => void;
}

type Outcome = 'idle' | 'copied' | 'failed';

const writeClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

export const CopyButton = ({
  value,
  label = 'Copy',
  icon = false,
  resetAfterMs,
  write = writeClipboard,
  onCopied,
  onError,
  disabled,
  variant = 'ghost',
  size,
  ...props
}: CopyButtonProps): ReactElement => {
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const shown = typeof value === 'string' ? value : undefined;
  // A new value is a new result: what was copied before no longer is.
  useEffect(() => setOutcome('idle'), [shown]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: Outcome) => {
    setOutcome(next);
    clearTimeout(timer.current);
    if (resetAfterMs !== undefined) timer.current = setTimeout(() => setOutcome('idle'), resetAfterMs);
  };
  const copy = () => {
    const text = typeof value === 'string' ? value : value();
    if (text === '') return;
    write(text).then(
      () => {
        settle('copied');
        onCopied?.(text);
      },
      error => {
        settle('failed');
        onError?.(error);
      },
    );
  };

  const words = outcome === 'copied' ? 'Copied' : outcome === 'failed' ? 'Not copied' : label;
  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (icon ? 'icon-xs' : 'sm')}
      data-slot="copy-button"
      data-copied={outcome === 'copied' || undefined}
      disabled={disabled || value === ''}
      onClick={copy}
      {...(icon ? { 'aria-label': words, title: words } : {})}
      {...props}>
      {icon ? outcome === 'copied' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" /> : words}
    </Button>
  );
};
