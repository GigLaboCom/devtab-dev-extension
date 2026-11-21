/**
 * Copy a result with one press (docs/tools/README.md «Интерфейс»: every result has one; writing the clipboard on a
 * click needs no permission). A Button (`cn-button*`) in two forms:
 *
 *   <CopyButton value={text} />                               "Copy" → "Copied" until the value changes
 *   <CopyButton value={hash} icon label="Copy SHA-256" />     an icon button; its aria-label becomes "Copied" and the
 *                                                             icon a check, for `resetAfterMs` (url: 1500) or until the
 *                                                             value changes
 *
 * "Copied" belongs to the value that was copied: it goes the moment the value changes — in the same render, also when the
 * write answers after the value has changed. `value` may be a function, read at the moment of the press (a result that
 * is not text yet); then `resetKey` says what the result is now (a version, the input) and "Copied" goes when it
 * changes. Nothing to copy (an empty string) disables it. A refused write says "Not copied" the same way and goes to `onError`. The clipboard is
 * `navigator.clipboard` unless `write` says otherwise (a host, a test).
 *
 * `outcome` is a copy made without a press — a tool's automatic copy after Generate: when it succeeded and its text is
 * still the value, the button says "Copied" as if it had been pressed. A refusal leaves the button ready (the tool says
 * so in its own line).
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
  /** With a function `value`: what the result is now; "Copied" goes when it changes. */
  resetKey?: unknown;
  write?: (text: string) => Promise<void>;
  onCopied?: (text: string) => void;
  onError?: (error: unknown) => void;
  /** A copy of this value made elsewhere (a new object each time): shown as "Copied" when it succeeded. */
  outcome?: CopyOutcome | null;
}

/** What a copy made without the button did. */
export interface CopyOutcome {
  text: string;
  ok: boolean;
}

type Outcome = 'idle' | 'copied' | 'failed';

const writeClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

export const CopyButton = ({
  value,
  label = 'Copy',
  icon = false,
  resetAfterMs,
  resetKey,
  write = writeClipboard,
  onCopied,
  onError,
  outcome: elsewhere,
  disabled,
  variant = 'ghost',
  size,
  ...props
}: CopyButtonProps): ReactElement => {
  const shown = typeof value === 'string' ? value : undefined;
  // What the result is now: the value itself, or the key of a function value.
  const current = typeof value === 'string' ? value : resetKey;
  // What happened, and to which result: a new value is a new result, and what was copied before no longer is.
  const [state, setState] = useState<{ outcome: Outcome; of: unknown }>({ outcome: 'idle', of: undefined });
  const outcome: Outcome = Object.is(state.of, current) ? state.outcome : 'idle';
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: Outcome, of: unknown) => {
    setState({ outcome: next, of });
    clearTimeout(timer.current);
    if (resetAfterMs !== undefined)
      timer.current = setTimeout(
        () => setState(s => (Object.is(s.of, of) ? { ...s, outcome: 'idle' } : s)),
        resetAfterMs,
      );
  };
  const latestSettle = useRef(settle);
  latestSettle.current = settle;
  // A copy made elsewhere of the value now shown.
  useEffect(() => {
    if (elsewhere?.ok && elsewhere.text === shown) latestSettle.current('copied', shown);
  }, [elsewhere, shown]);
  const copy = () => {
    const of = current;
    const text = typeof value === 'string' ? value : value();
    if (text === '') return;
    write(text).then(
      () => {
        settle('copied', of);
        onCopied?.(text);
      },
      error => {
        settle('failed', of);
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
