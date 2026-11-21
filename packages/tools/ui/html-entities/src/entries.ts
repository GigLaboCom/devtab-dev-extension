/**
 * The HTML Entities tool's texts and history helpers (the component's chunk only): the notes under the result, word
 * for word from docs/tools/specs/html-entities.md §6, the history labels, search text and payload guards.
 */
import type { HtmlEntitiesPayload, Mode } from './history';
import type { EncodeScope, NumericFormat } from '@workspace/tool-logic-html-entities';

export const TOO_LARGE = 'Input is larger than 5 MB. This tool works with up to 5 MB.';
export const ENCODED_AGAIN =
  'The input already contains HTML references. They are encoded again: &amp; becomes &amp;amp;.';

/** §6: `2 C1 control characters (U+0080–U+009F) left as is: …`, one — `1 C1 control character …`. */
export const keptC1Note = (n: number): string =>
  `${n.toLocaleString('en-US')} C1 control ${n === 1 ? 'character' : 'characters'} (U+0080–U+009F) left as is: HTML has no reference for them.`;

/** How many unknown names the note shows; the rest is counted (§5, §6). */
const SHOWN_UNKNOWN = 5;

/** §6: `Not recognised, left as is: &unknown;, &foo;` — over five, `… &a5; and 3 more.` */
export const unknownNote = (unknown: readonly string[]): string => {
  const shown = unknown.slice(0, SHOWN_UNKNOWN).join(', ');
  const more = unknown.length - SHOWN_UNKNOWN;
  return more > 0
    ? `Not recognised, left as is: ${shown} and ${more.toLocaleString('en-US')} more.`
    : `Not recognised, left as is: ${shown}`;
};

export const SCOPE_LABEL: Record<EncodeScope, string> = { special: `Only & < > " '`, nonAscii: 'Also non-ASCII' };
export const FORMAT_LABEL: Record<NumericFormat, string> = { decimal: 'Decimal', hex: 'Hex' };

export const entryLabel = (p: HtmlEntitiesPayload, inputLength: number): string =>
  [
    p.mode === 'encode' ? 'Encode' : 'Decode',
    p.mode === 'encode' && p.scope === 'nonAscii' ? `${SCOPE_LABEL.nonAscii} · ${FORMAT_LABEL[p.format]}` : '',
    `${inputLength.toLocaleString('en-US')} ${inputLength === 1 ? 'character' : 'characters'}`,
    p.action === 'copy' ? 'copied' : p.action === 'swap' ? 'swapped' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the input and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;

export const isMode = (v: unknown): v is Mode => v === 'encode' || v === 'decode';
export const isScope = (v: unknown): v is EncodeScope => v === 'special' || v === 'nonAscii';
export const isFormat = (v: unknown): v is NumericFormat => v === 'decimal' || v === 'hex';
