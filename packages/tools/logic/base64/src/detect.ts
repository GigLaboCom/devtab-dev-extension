/**
 * `detectBase64` (docs/tools/specs/base64.md §7) in a module of its own: the ui package's `./detect` re-exports it,
 * and a host loads every tool's `detect` together, lazily, when pasted text needs them. It needs only parseBase64 and strict UTF-8;
 * encoding, the hex view and the rest of the logic stay in the tool's own chunk.
 */
import { parseBase64 } from '@workspace/tools-shared/base64';

/** Strict UTF-8 that keeps a byte order mark as U+FEFF (§5 «Декодирование», step 6); null when the bytes are not UTF-8. */
export const strictUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
};

const DETECT_SHAPE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const ONLY_HEX = /^[0-9a-fA-F]+$/;
const NOT_A_WORD = /[0-9+/_=-]/;
/** Control characters other than TAB, LF and CR (C0, DEL and C1), and U+FFFD. */
const NOT_PLAIN_TEXT = /[^\P{Cc}\t\n\r]|\uFFFD/u;

/**
 * Does pasted text look like Base64 of text (§7)? Cheap checks first; the decode runs only on a string that already has
 * Base64's shape. Binary Base64 (images, keys) is not recognised on purpose.
 */
export const detectBase64 = (text: string): boolean => {
  const t = text.trim();
  if (t.length < 8 || t.length > 65_536) return false;
  if (!DETECT_SHAPE.test(t) || ONLY_HEX.test(t) || !NOT_A_WORD.test(t)) return false;
  const parsed = parseBase64(t);
  if (!parsed.ok) return false;
  const decoded = strictUtf8(parsed.bytes);
  return decoded !== null && !NOT_PLAIN_TEXT.test(decoded);
};
