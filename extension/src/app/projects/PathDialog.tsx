/**
 * A path in the project, asked for: a new file, a new folder, a new name (§4.6 «Записи файлов»). The field takes the
 * keyboard when the dialog opens, Enter runs, Escape closes; what the companion refuses (a secret, `.git`, a name that
 * exists, a read-only project, …) is said in the dialog in the page's words and the field keeps what was typed.
 */
import { errorText, toneOf } from './errors';
import { SaidNote } from './SaidNote';
import { TEXT } from './text';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { useEffect, useId, useRef, useState } from 'react';
import type { ErrorContext, Said } from './errors';
import type { ReactElement } from 'react';

/** How long a request waits before the dialog says it waits for the companion's window (an answer at once says nothing). */
export const WAIT_SAID_AFTER_MS = 400;

export interface PathDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  label: string;
  /** What the field holds when the dialog opens. */
  initial: string;
  placeholder?: string;
  action: string;
  /** Checks the value before it goes anywhere: a sentence when it is not one, else null. */
  validate?(value: string): string | null;
  /** Runs it; a rejection is said in the dialog. Resolves when done: the dialog closes. */
  run(value: string, signal: AbortSignal): Promise<void>;
  context?: ErrorContext;
  /** While `run` waits for the person elsewhere (the companion's window), what the dialog says. */
  waiting?: string;
}

export const PathDialog = ({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial,
  placeholder,
  action,
  validate,
  run,
  context = 'write',
  waiting,
}: PathDialogProps): ReactElement => {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<{ said: Said; tone: 'info' | 'error' } | null>(null);
  const [running, setRunning] = useState<AbortController | null>(null);
  // Said only when the request waits longer than an answer at once would take: no flash of it inside a trusted folder.
  const [long, setLong] = useState(false);
  useEffect(() => {
    setLong(false);
    if (!running) return;
    const timer = setTimeout(() => setLong(true), WAIT_SAID_AFTER_MS);
    return () => clearTimeout(timer);
  }, [running]);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setProblem(null);
    }
  }, [open, initial]);

  const close = (): void => {
    running?.abort();
    setRunning(null);
    onOpenChange(false);
  };
  const submit = (): void => {
    const trimmed = value.trim();
    const invalid = validate?.(trimmed) ?? null;
    if (invalid) return setProblem({ said: { text: invalid }, tone: 'error' });
    if (!trimmed || running) return;
    const abort = new AbortController();
    setRunning(abort);
    setProblem(null);
    run(trimmed, abort.signal).then(
      () => {
        setRunning(null);
        onOpenChange(false);
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setRunning(null);
        setProblem({ said: errorText(error, context), tone: toneOf(error) });
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
      <DialogContent
        onOpenAutoFocus={event => {
          // The keyboard goes to the field, its text selected, as an IDE's "new file" and "rename" do.
          event.preventDefault();
          field.current?.focus();
          field.current?.select();
        }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="kit-projects-path-form"
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}>
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            ref={field}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            disabled={running !== null}
            onChange={event => setValue(event.target.value)}
          />
          {running && long && waiting && (
            <p className="kit-projects-note" data-request="awaiting-confirmation" role="status">
              {waiting}
            </p>
          )}
          {problem && <SaidNote said={problem.said} tone={problem.tone} kind={context} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {TEXT.cancel}
            </Button>
            <Button type="submit" disabled={running !== null || !value.trim()}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
