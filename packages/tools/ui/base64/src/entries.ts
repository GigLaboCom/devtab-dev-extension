/** Labels, search text and payload guards of the Base64 tool's history entries (the component's chunk only). */
import type { Base64Payload, LineLength, Mode } from './history';
import type { Base64Alphabet } from '@workspace/tool-logic-base64';

const ALPHABET_LABEL: Record<Base64Alphabet, string> = { standard: 'Standard', url: 'URL-safe' };

export const entryLabel = (p: Base64Payload, inputLength: number): string =>
  [
    p.mode === 'encode' ? 'Encode' : 'Decode',
    p.mode === 'encode' ? ALPHABET_LABEL[p.alphabet] : '',
    p.mode === 'encode' && p.padding !== (p.alphabet === 'standard') ? (p.padding ? 'padding' : 'no padding') : '',
    p.mode === 'encode' && p.lineLength ? `lines of ${p.lineLength}` : '',
    p.outcome === 'hex' ? 'not UTF-8, shown as hex' : '',
    p.outcome === 'error'
      ? p.error?.line === undefined
        ? 'data URL'
        : `error at line ${p.error.line}, column ${p.error.column}`
      : '',
    `${inputLength.toLocaleString('en-US')} characters`,
    p.action === 'copy' ? 'copied' : p.action === 'swap' ? 'swapped' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the input and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;

export const isMode = (v: unknown): v is Mode => v === 'encode' || v === 'decode';
export const isAlphabet = (v: unknown): v is Base64Alphabet => v === 'standard' || v === 'url';
export const isLineLength = (v: unknown): v is LineLength => v === 0 || v === 64 || v === 76;
