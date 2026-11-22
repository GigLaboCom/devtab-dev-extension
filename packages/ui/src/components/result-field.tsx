/**
 * A read-only result field that never pays the browser's cost of a huge text (docs/tools/README.md «Пределы»; the
 * measurement: docs/tools/limits.md). Up to MAX_SHOWN_CHARS characters and MAX_SHOWN_LINES lines it is the kit's
 * Textarea with the whole value — the same element a tool rendered before, nothing more. Above either bound the field
 * shows the first part (whole lines when the lines are the bound) and a line under it says how much of how much, and
 * that Copy takes all; selecting the whole shown part and copying it (⌘C / Ctrl+C) copies the whole value too.
 *
 *   <ResultField id="x-output" className={code} spellCheck={false} value={output} />
 *   <ResultField … value={output} saves />          the tool has Save: "Copy and Save take all."
 *
 * The line is announced to a screen reader once, when the result becomes too large to show (a polite region filled
 * after it appears); the visible line follows the numbers silently, so typing in a large input does not read it again.
 *
 * Why these bounds (Chrome 159, docs/tools/limits.md): a field costs about 3 µs a line (2.6 million short lines — 8 s)
 * and per character by script — on one line, 256 Ki characters of Latin text take about 30 ms, of text with an emoji in
 * every 23 characters about 75 ms, of CJK about 170 ms (1 Mi: 40, 210 and about 650 ms). So the bound is on both: 256 Ki
 * characters and 10,000 lines (10,000 short lines — about 45 ms).
 */
import { Textarea } from './textarea';
import { ToolMessage } from './tool-page';
import { useEffect, useMemo, useState } from 'react';
import type { ClipboardEvent, ComponentProps, ReactElement } from 'react';

/** Characters a field shows of a text; a longer text is shown by its start. */
export const MAX_SHOWN_CHARS = 256 * 1024;
/** Lines (split at `\n`) a field shows of a text; a text with more is shown by its first lines. */
export const MAX_SHOWN_LINES = 10_000;

export interface ShownCut {
  /** Which bound cut the text. */
  by: 'characters' | 'lines';
  /** How many characters or lines are shown. */
  shown: number;
  /** How many there are. */
  total: number;
}

export interface ShownPart {
  text: string;
  /** Null when the text is shown whole. */
  cut: ShownCut | null;
}

const lineCount = (text: string): number => {
  let lines = 1;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) lines++;
  return lines;
};

/**
 * What a field shows of `text`: all of it, or its first `maxLines` lines (without the line break after the last), or —
 * when those are longer than `maxChars` — its first `maxChars` characters (one fewer rather than half a surrogate
 * pair). Reads no further than it has to while the text fits.
 */
export const shownPart = (text: string, maxChars = MAX_SHOWN_CHARS, maxLines = MAX_SHOWN_LINES): ShownPart => {
  let lineEnd = -1;
  for (let lines = 0; lines < maxLines; lines++) {
    lineEnd = text.indexOf('\n', lineEnd + 1);
    if (lineEnd < 0 || lineEnd >= maxChars) break;
  }
  const byLines = lineEnd >= 0 && lineEnd < maxChars;
  if (byLines) return { text: text.slice(0, lineEnd), cut: { by: 'lines', shown: maxLines, total: lineCount(text) } };
  if (text.length <= maxChars) return { text, cut: null };
  const code = text.charCodeAt(maxChars - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? maxChars - 1 : maxChars;
  return { text: text.slice(0, end), cut: { by: 'characters', shown: end, total: text.length } };
};

const COUNT = new Intl.NumberFormat('en-US');

/** "Showing the first 1,048,576 of 5,242,880 characters." — the one wording of a cut, inputs and results alike. */
export const shownWords = (cut: ShownCut): string =>
  `Showing the first ${COUNT.format(cut.shown)} of ${COUNT.format(cut.total)} ${cut.by}.`;

/** How long the polite region keeps the words it announced. */
const ANNOUNCED_MS = 5000;

export const COPY_TAKES_ALL = 'Copy copies all.';
export const COPY_AND_SAVE_TAKE_ALL = 'Copy and Save take all.';

/**
 * The line under a field that shows part of its text: visible and current (`children` when the line holds a control,
 * else `words`), not a live region; a polite region next to it gets `words` once, when the cut appears (filled after
 * mounting, so a screen reader notices it), and again only when the bound that cut it changes.
 */
export const ShownLine = ({
  words,
  by,
  children,
  ...props
}: { words: string; by: ShownCut['by'] } & Omit<ComponentProps<'p'>, 'role'>): ReactElement => {
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(words);
    // Read out, then emptied (a removal is not read): reading the page finds the visible line only, not twice.
    const timer = setTimeout(() => setAnnounced(''), ANNOUNCED_MS);
    return () => clearTimeout(timer);
    // Once per kind of cut: the numbers change with every edit of a large input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [by]);
  return (
    <>
      <ToolMessage role={undefined} data-part="shown-line" {...props}>
        {children ?? words}
      </ToolMessage>
      <span className="sr-only" role="status" data-part="shown-announcement">
        {announced}
      </span>
    </>
  );
};

export interface ResultFieldProps extends Omit<ComponentProps<'textarea'>, 'value' | 'defaultValue' | 'readOnly'> {
  /** The whole result: what Copy and Save take. */
  value: string;
  /** The tool has Save: the line says that Copy and Save take all. */
  saves?: boolean;
  /** Other bounds than the kit's (a tool whose own measurement says so). */
  maxChars?: number;
  maxLines?: number;
}

export const ResultField = ({
  value,
  saves = false,
  maxChars = MAX_SHOWN_CHARS,
  maxLines = MAX_SHOWN_LINES,
  onCopy,
  ...props
}: ResultFieldProps): ReactElement => {
  const part = useMemo(() => shownPart(value, maxChars, maxLines), [value, maxChars, maxLines]);
  const { cut } = part;
  // Copying all that is shown copies all there is.
  const copyAll = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    onCopy?.(event);
    const field = event.currentTarget;
    if (event.defaultPrevented || !cut || field.selectionStart !== 0 || field.selectionEnd !== part.text.length) return;
    event.clipboardData.setData('text/plain', value);
    event.preventDefault();
  };
  return (
    <>
      <Textarea
        readOnly
        value={part.text}
        onCopy={cut ? copyAll : onCopy}
        // Only when cut: how long the whole result is, in characters (for a test or another script reading the page).
        data-total-length={cut ? value.length : undefined}
        {...props}
      />
      {cut && (
        <ShownLine
          words={`${shownWords(cut)} ${saves ? COPY_AND_SAVE_TAKE_ALL : COPY_TAKES_ALL}`}
          by={cut.by}
          data-part="result-limit"
        />
      )}
    </>
  );
};
