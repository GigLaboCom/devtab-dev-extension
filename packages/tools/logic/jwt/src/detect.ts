/**
 * `detectJwt` (docs/tools/specs/jwt.md §7) in a module of its own: the ui package's `./detect` re-exports it, and a
 * host loads every tool's `detect` together, lazily, when pasted text needs them — so it holds nothing else.
 */
import { parseBase64 } from '@workspace/tools-shared/base64';

const PART = /^[\w-]*$/;

/**
 * Does pasted text look like a JWT (§7)? After trimming and taking away `Bearer `: three dot-separated base64url parts
 * (a JWS) or five (a JWE), the first starting with `eyJ` (base64url of `{"`), up to 1 MiB, and the header a JSON object
 * with a string `alg`. Linear: a split and one character class per part, no pattern over the whole text.
 */
export const detectJwt = (text: string): boolean => {
  const t = text.trim().replace(/^bearer\s+/i, '');
  const parts = t.split('.', 6);
  if (!t.startsWith('eyJ') || t.length > 1_048_576 || (parts.length !== 3 && parts.length !== 5)) return false;
  if (!parts.every(p => PART.test(p))) return false;
  const bytes = parseBase64(parts[0]!);
  try {
    const header: unknown = bytes.ok && JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.bytes));
    return typeof (header as { alg?: unknown } | null)?.alg === 'string';
  } catch {
    return false;
  }
};
