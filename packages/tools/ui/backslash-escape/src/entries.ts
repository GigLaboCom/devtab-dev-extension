/** Labels, search text and payload guards of the String Escape tool's history entries (the component's chunk only). */
import { DIALECT_NAMES, DIALECTS, quotesFor } from '@workspace/tool-logic-backslash-escape';
import type { BackslashEscapePayload, Mode } from './history';
import type { Dialect, Quote } from '@workspace/tool-logic-backslash-escape';

const QUOTE_LABEL: Record<Quote, string> = { '"': 'double quotes', "'": 'single quotes', '`': 'backticks' };

/** "Escape · JavaScript · single quotes · non-ASCII · with quotes · 12 characters · copied". */
export const entryLabel = (p: BackslashEscapePayload, inputLength: number): string =>
  [
    p.mode === 'escape' ? 'Escape' : 'Unescape',
    DIALECT_NAMES[p.dialect],
    p.mode === 'escape' && quotesFor(p.dialect).length > 1 ? QUOTE_LABEL[p.quote] : '',
    p.mode === 'escape' && p.nonAscii ? 'non-ASCII' : '',
    p.withQuotes ? 'with quotes' : '',
    p.outcome === 'error' && p.error ? `error at line ${p.error.line}, column ${p.error.column}` : '',
    `${inputLength.toLocaleString('en-US')} characters`,
    p.action === 'copy' ? 'copied' : p.action === 'swap' ? 'swapped' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the input and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;

export const isMode = (v: unknown): v is Mode => v === 'escape' || v === 'unescape';
export const isDialect = (v: unknown): v is Dialect => (DIALECTS as readonly unknown[]).includes(v);
export const isQuoteOf = (dialect: Dialect, v: unknown): v is Quote =>
  (quotesFor(dialect) as readonly unknown[]).includes(v);
