/**
 * A tool's input field that holds a huge text instead of laying it out (docs/tools/README.md «Пределы»; the
 * measurement: docs/tools/limits.md). Up to MAX_FIELD_CHARS characters and MAX_FIELD_LINES lines it is the kit's
 * Textarea, editable, with the whole value — the same element a tool rendered before. A paste that would take the text
 * past either bound never reaches the field: the pasted text is put in at the selection and handed to the tool whole.
 * Any text above a bound — pasted, typed, opened from a file or from the history, handed by the start page — is held:
 * the tool works on all of it, and the field turns read-only and shows its first part (as ResultField shows a result:
 * MAX_SHOWN_CHARS characters or MAX_SHOWN_LINES lines), with a line saying so and a Clear button. It cannot be edited
 * in place: a paste into the held field replaces the whole input, Clear empties it, and opening a file replaces it.
 *
 *   <InputField id="x-input" className={code} spellCheck={false} value={input} onValueChange={setInput} />
 *
 * Why these bounds (Chrome 159, docs/tools/limits.md): the field stays editable while a keystroke in it costs about a
 * frame. 1 Mi characters on one line — a paste about 50 ms, a keystroke about 17 ms (4 Mi: 160 ms and 60 ms); 50,000
 * short lines — about 150 ms and 30 ms (200,000: 0.6 s and 0.12 s).
 */
import { Button } from './button';
import { MAX_SHOWN_CHARS, MAX_SHOWN_LINES, ShownLine, shownPart, shownWords } from './result-field';
import { Textarea } from './textarea';
import { useMemo, useRef } from 'react';
import type { ChangeEvent, ClipboardEvent, ComponentProps, ReactElement, Ref } from 'react';

/** Characters the field takes for editing; a longer input is held. */
export const MAX_FIELD_CHARS = 1024 * 1024;
/** Lines (split at `\n`) the field takes for editing; an input with more is held. */
export const MAX_FIELD_LINES = 50_000;

/** Said after the cut: the visible line ends in a "clear the input" button; a screen reader gets the sentence whole. */
export const HELD_WORDS = 'Too large to edit here: paste to replace it, or clear the input.';
const HELD_PROMPT = ' Too large to edit here: paste to replace it, or ';

/** Is `text` above the field's bounds? Reads no further than the bounds. */
export const isHeld = (text: string, maxChars = MAX_FIELD_CHARS, maxLines = MAX_FIELD_LINES): boolean => {
  if (text.length > maxChars) return true;
  let at = -1;
  for (let lines = 0; lines < maxLines; lines++) {
    at = text.indexOf('\n', at + 1);
    if (at < 0) return false;
  }
  return true;
};

export interface InputFieldProps extends Omit<
  ComponentProps<'textarea'>,
  'value' | 'defaultValue' | 'onChange' | 'readOnly'
> {
  value: string;
  /** Every change of the input, the whole text: an edit, a paste kept out of the field, Clear. */
  onValueChange: (next: string) => void;
  /** Other bounds than the kit's (a tool whose own measurement says so). */
  maxChars?: number;
  maxLines?: number;
}

const setRef = <T,>(ref: Ref<T> | undefined, value: T | null): void => {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
};

export const InputField = ({
  value,
  onValueChange,
  maxChars = MAX_FIELD_CHARS,
  maxLines = MAX_FIELD_LINES,
  onPaste,
  ref,
  ...props
}: InputFieldProps): ReactElement => {
  const held = useMemo(() => isHeld(value, maxChars, maxLines), [value, maxChars, maxLines]);
  const part = useMemo(() => (held ? shownPart(value, MAX_SHOWN_CHARS, MAX_SHOWN_LINES) : null), [held, value]);
  const own = useRef<HTMLTextAreaElement | null>(null);
  const bind = (node: HTMLTextAreaElement | null): void => {
    own.current = node;
    setRef(ref, node);
  };

  const change = (event: ChangeEvent<HTMLTextAreaElement>): void => onValueChange(event.target.value);
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const pasted = event.clipboardData.getData('text/plain');
    if (held) {
      // A held input cannot be edited in place: a paste replaces it.
      event.preventDefault();
      onValueChange(pasted);
      return;
    }
    const field = event.currentTarget;
    const next = value.slice(0, field.selectionStart) + pasted + value.slice(field.selectionEnd);
    if (!isHeld(next, maxChars, maxLines)) return;
    event.preventDefault();
    onValueChange(next);
  };

  // One structure in both states, so the field stays the same element (and keeps the focus) when it is held or let go.
  return (
    <>
      {part ? (
        // A person cannot change a read-only field; a script can (a value set and an input event, as a test or an
        // extension does): that replaces the whole input.
        <Textarea
          ref={bind}
          readOnly
          value={part.text}
          onChange={change}
          onPaste={paste}
          data-held=""
          data-total-length={value.length}
          {...props}
        />
      ) : (
        <Textarea ref={bind} value={value} onChange={change} onPaste={paste} {...props} />
      )}
      {part && (
        <ShownLine
          words={part.cut ? `${shownWords(part.cut)} ${HELD_WORDS}` : HELD_WORDS}
          by={part.cut?.by ?? 'characters'}
          data-part="input-limit">
          {part.cut ? shownWords(part.cut) : ''}
          {HELD_PROMPT}
          <Button
            variant="link"
            size="sm"
            className="kit-tool-message-action"
            data-part="clear-held"
            onClick={() => {
              onValueChange('');
              own.current?.focus();
            }}>
            clear the input
          </Button>
          .
        </ShownLine>
      )}
    </>
  );
};
