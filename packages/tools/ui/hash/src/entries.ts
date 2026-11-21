/**
 * The Hash tool's history entries (schema 1 of its payload): what each kind carries and how the History list labels it.
 * Kept out of history.ts, which every host page that lists the tools loads.
 */
import type { Algorithm, InputFormat, OutputFormat } from '@workspace/tool-logic-hash';

/** Options both kinds carry (schema 1). */
export interface HashOptionsPayload {
  output: OutputFormat;
  hmac: boolean;
  /** The key as typed, and how to read it; only when `hmac`. */
  key?: string;
  keyFormat?: InputFormat;
  compare: string;
  /** Lowercase hex, in §5.1 order. */
  digests: Partial<Record<Algorithm, string>>;
}

/** A text, hex or Base64 input; the text itself is the blob `input`. */
export interface HashTextPayload extends HashOptionsPayload {
  input: InputFormat;
}

/** A hashed file: what of it is kept. */
export interface HashFilePayload extends HashOptionsPayload {
  input: 'file';
  file: { name: string; size: number; type: string };
}

export type HashPayload = HashTextPayload | HashFilePayload;

const FORMAT: Record<InputFormat, string> = { text: 'Text', hex: 'Hex', base64: 'Base64' };

export const textLabel = (format: InputFormat, text: string, hmac: boolean): string =>
  [hmac ? 'HMAC' : '', FORMAT[format], `${text.length.toLocaleString('en-US')} characters`].filter(Boolean).join(' · ');

export const fileLabel = (name: string, size: string, hmac: boolean): string =>
  [hmac ? 'HMAC' : '', 'File', name, size].filter(Boolean).join(' · ');

/** The first characters of the text, for the History list's search (inside the encrypted record). */
export const excerpt = (text: string): string => text.slice(0, 2000);

export const isInputFormat = (v: unknown): v is InputFormat => v === 'text' || v === 'hex' || v === 'base64';
export const isOutputFormat = (v: unknown): v is OutputFormat => v === 'hex' || v === 'HEX' || v === 'base64';
