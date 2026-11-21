/**
 * The Base64 tool's logic (docs/tools/specs/base64.md §5, §9): text to Base64 as UTF-8, Base64 back to text, or to hex
 * when the bytes are not UTF-8. Bytes to Base64 and Base64 to bytes are the shared module's (@workspace/tools-shared,
 * also used by base64-image); what is this tool's own is the text around them: UTF-8 both ways, the hex view, the data
 * URL check and `detectBase64`. Size limits are the component's: these functions take any input.
 */
import { strictUtf8 } from './detect';
import { bytesToBase64, parseBase64 } from '@workspace/tools-shared/base64';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { Base64Alphabet, Base64Options } from '@workspace/tools-shared/base64';

export type { Base64Alphabet, Base64Options } from '@workspace/tools-shared/base64';

export interface DecodeError {
  message: string;
  /** Absent when the error has no place (data URL). */
  offset?: number;
  line?: number;
  column?: number;
}

export type DecodeResult =
  | { ok: true; kind: 'text'; text: string; bom: boolean }
  | { ok: true; kind: 'hex'; text: string; byteCount: number }
  | { ok: false; error: DecodeError };

/** Above this many UTF-16 code units the tool refuses (§12); exactly this many is still worked on. */
export const MAX_INPUT = 5 * 1024 * 1024;
/** Up to this many the result follows every edit; above it, 300 ms after the last one (§12). */
export const LIVE_INPUT = 256 * 1024;
/** How long the result waits after the last edit of a large input (§12). */
export const SETTLE_MS = 300;

export const DATA_URL_MESSAGE = 'This is a data URL. Open it in Base64 Image.';

/** Padding is on for the standard alphabet and off for URL-safe (§4). */
export const defaultPadding = (alphabet: Base64Alphabet): boolean => alphabet === 'standard';

const utf8 = new TextEncoder();

/** UTF-8 (§5 «Кодирование», step 1: a lone surrogate becomes U+FFFD), then bytesToBase64. */
export const encodeText = (text: string, options: Base64Options): string => bytesToBase64(utf8.encode(text), options);

/** `data:` after leading ASCII whitespace, in any case (§5 «Декодирование», step 8). */
const DATA_URL = /^[\t\n\f\r ]*data:/i;

/** The data URL check (§5 «Декодирование», step 8), parseBase64, then UTF-8 or the hex view (steps 6–7). */
export const decodeText = (input: string): DecodeResult => {
  if (DATA_URL.test(input)) return { ok: false, error: { message: DATA_URL_MESSAGE } };
  const parsed = parseBase64(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const text = strictUtf8(parsed.bytes);
  if (text === null)
    return {
      ok: true,
      kind: 'hex',
      text: bytesToHex(parsed.bytes, { format: 'spaced' }),
      byteCount: parsed.bytes.length,
    };
  return { ok: true, kind: 'text', text, bom: text.startsWith('\uFEFF') };
};
