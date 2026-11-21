/** The JSON tool's history entries as the component writes and reads them: labels, the search excerpt, a guard. */
import type { JsonResultPayload } from './history';
import type { Indent } from '@workspace/tool-logic-json';

const INDENT_LABEL: Record<string, string> = { 2: '2 spaces', 4: '4 spaces', tab: 'Tab' };

export const resultLabel = (p: JsonResultPayload): string =>
  [
    p.action === 'format' ? `Format · ${INDENT_LABEL[String(p.indent)]}` : 'Minify',
    p.sortKeys ? 'sorted keys' : '',
    p.ok ? '' : `error at line ${p.error?.line}, column ${p.error?.column}`,
  ]
    .filter(Boolean)
    .join(' · ');

export const editLabel = (text: string): string => `Edit · ${text.length.toLocaleString('en-US')} characters`;

/** The first characters of the text, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

export const isIndent = (v: unknown): v is Indent => v === 2 || v === 4 || v === 'tab';
