/** Payload, labels, search text and guards of the tool's history entries (the component's chunk only). */
import { DIALECT_LABELS, holdsCredentials } from '@workspace/tool-logic-sql-format';
import type {
  KeywordCase,
  SqlDialect,
  SqlIndent,
  SqlLayout,
  SqlOptions,
  SqlResult,
} from '@workspace/tool-logic-sql-format';

/** Payload of schema 1. `action` is set when the person took or asked for the result (committed). */
export type SqlFormatPayload = {
  dialect: SqlDialect;
  keywordCase: KeywordCase;
  indent: SqlIndent;
  layout: SqlLayout;
  outcome: 'ok' | 'error';
  error?: { message: string; line?: number; column?: number };
  action?: 'copy' | 'save' | 'run';
};

export const KEYWORD_CASE_LABELS: Record<KeywordCase, string> = {
  upper: 'UPPER',
  lower: 'lower',
  preserve: 'Preserve',
};
export const INDENT_LABELS: Record<string, string> = { 2: '2 spaces', 4: '4 spaces', tab: 'Tab' };
export const LAYOUT_LABELS: Record<SqlLayout, string> = {
  standard: 'Standard',
  tabularLeft: 'Tabular left',
  tabularRight: 'Tabular right',
};
const ACTION_LABELS = { copy: 'copied', save: 'saved', run: 'ran' } as const;

/** The secret kind when the query holds a password or a secret key by its own syntax (history.ts). */
export const kindOf = (input: string): 'format' | 'credentials' => (holdsCredentials(input) ? 'credentials' : 'format');

export const payloadOf = (
  options: SqlOptions,
  result: SqlResult,
  action?: SqlFormatPayload['action'],
): SqlFormatPayload => ({
  dialect: options.dialect,
  keywordCase: options.keywordCase,
  indent: options.indent,
  layout: options.layout,
  ...(result.ok
    ? { outcome: 'ok' as const }
    : {
        outcome: 'error' as const,
        error:
          'line' in result.error
            ? { message: result.error.message, line: result.error.line, column: result.error.column }
            : { message: result.error.message },
      }),
  ...(action ? { action } : {}),
});

/** `PostgreSQL · UPPER · 2 spaces · Tabular left · error at line 1, column 15 · 1,234 characters · copied`. */
export const entryLabel = (p: SqlFormatPayload, inputLength: number): string =>
  [
    DIALECT_LABELS[p.dialect],
    KEYWORD_CASE_LABELS[p.keywordCase],
    INDENT_LABELS[String(p.indent)],
    p.layout === 'standard' ? '' : LAYOUT_LABELS[p.layout],
    p.outcome === 'error'
      ? p.error?.line !== undefined
        ? `error at line ${p.error.line}, column ${p.error.column}`
        : 'error'
      : '',
    `${inputLength.toLocaleString('en-US')} characters`,
    p.action ? ACTION_LABELS[p.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the query and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;
