/**
 * Does pasted text look like this tool's input (docs/tools/specs/compress.md §7)? Base64 or plain hex whose bytes start
 * like gzip, zlib or zstd. Cheap and strict: the length is checked first, the expressions are anchored with no nested
 * repetition, and only the first bytes are decoded — raw deflate and brotli have no signature and are never claimed.
 */
import { isZlibHeader } from './formats';
import { parseBase64 } from '@workspace/tools-shared/base64';

export const MIN_DETECT = 16;
export const MAX_DETECT = 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
const HEX = /^[0-9a-fA-F]+$/;

/** Is this the start of a stream the tool would recognise (§7, rule 3)? `total` — the whole length in bytes. */
const startsCompressed = (b: Uint8Array, total: number): boolean => {
  if (b[0] === 0x1f && b[1] === 0x8b) return total >= 18 && b[2] === 8 && (b[3]! & 0xe0) === 0;
  if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return total >= 9;
  return total >= 8 && b.length >= 2 && isZlibHeader(b[0]!, b[1]!) && b[0]! >> 4 === 7 && (b[1]! & 0x20) === 0;
};

export const detectCompress = (text: string): boolean => {
  if (text.length > MAX_DETECT + 1024) return false;
  const t = text.trim();
  if (t.length < MIN_DETECT || t.length > MAX_DETECT) return false;
  if (HEX.test(t) && t.length % 2 === 0) {
    const head = new Uint8Array(4);
    for (let i = 0; i < 4; i++) head[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
    return startsCompressed(head, t.length / 2);
  }
  if (!BASE64.test(t)) return false;
  const padding = t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0;
  if ((t.length - padding) % 4 === 1) return false;
  // Eight characters give six bytes; the length in bytes comes from the length of the text.
  const parsed = parseBase64(t.slice(0, 8));
  if (!parsed.ok) return false;
  const total = Math.floor(((t.length - padding) * 6) / 8);
  return startsCompressed(parsed.bytes, total);
};
