/**
 * The password and the salt as the person gives them (docs/tools/specs/password-hash.md §5.3, §5.4): UTF-8 bytes, the
 * notes under the password field, a random salt from the shared source or the person's own.
 */
import { encodeH64 } from './encoding';
import { formatNumber, SHORT_SALT } from './recommendations';
import { TEXT_SALT_FORMATS } from './types';
import { parseBase64 } from '@workspace/tools-shared/base64';
import { cryptoRandom, randomIndex } from '@workspace/tools-shared/random';
import type { Algorithm, Format } from './types';
import type { RandomSource } from '@workspace/tools-shared/random';

export const MAX_PASSWORD_BYTES = 4096;
/** bcrypt reads the first 72 bytes (OpenBSD bcrypt.c caps key_len at 72). */
export const BCRYPT_MAX_BYTES = 72;
export const MAX_SALT_BYTES = 1024;

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);

/** The bytes bcrypt is given: UTF-8, cut at 72 (it may cut a character, as bcrypt itself does). */
export const bcryptBytes = (password: string): Uint8Array => utf8(password).slice(0, BCRYPT_MAX_BYTES);

export const PASSWORD_TOO_LONG = `The password is longer than ${formatNumber(MAX_PASSWORD_BYTES)} bytes.`;
export const EDGE_SPACE = 'The password starts or ends with a space. It is part of the hashed bytes.';
export const NUL_NOTE = 'bcrypt stops reading at the NUL character (U+0000): only the part before it counts.';
export const NUL_FIRST = 'bcrypt would hash an empty password: it stops at the NUL character (U+0000) at the start.';
export const longForBcrypt = (bytes: number): string =>
  `bcrypt uses only the first 72 bytes of a password; this one is ${formatNumber(bytes)} bytes in UTF-8, so the rest is ignored.`;

/** What is said under the password field (§5.3): an error blocks the work, notes do not. */
export const passwordNotes = (password: string, algorithm: Algorithm): { error?: string; notes: string[] } => {
  const notes: string[] = [];
  const bytes = utf8(password).length;
  if (bytes > MAX_PASSWORD_BYTES) return { error: PASSWORD_TOO_LONG, notes };
  if (algorithm === 'bcrypt') {
    if (password.startsWith('\u{0}')) return { error: NUL_FIRST, notes };
    if (password.includes('\u{0}')) notes.push(NUL_NOTE);
    if (bytes > BCRYPT_MAX_BYTES) notes.push(longForBcrypt(bytes));
  }
  if (/^[ \t]|[ \t]$/.test(password)) notes.push(EDGE_SPACE);
  return { notes };
};

export const MAX_SECRET_BYTES = 1024;
export const SECRET_TOO_LONG = `The secret key is longer than ${formatNumber(MAX_SECRET_BYTES)} bytes.`;
/** Said whenever a secret key is typed (§5.10): the string will not carry it. */
export const SECRET_NOTE = 'The secret key is not part of the hash string: verifying needs the same key again.';
/** Said under a «does not match» of Argon2 (§5.10): what the page cannot know from the string. */
export const SECRET_UNKNOWN =
  'The hash string does not say whether a secret key (pepper) was used: with a missing or wrong key, even the right password does not match.';

/** The secret key (pepper) of Argon2, as typed: UTF-8, up to 1,024 bytes (§5.10). */
export const secretError = (secret: string): string | undefined =>
  utf8(secret).length > MAX_SECRET_BYTES ? SECRET_TOO_LONG : undefined;

export type SaltFormat = 'text' | 'hex' | 'base64';
export type SaltInput = { mode: 'random' } | { mode: 'custom'; text: string; format: SaltFormat };
export type ResolvedSalt =
  { ok: true; salt: Uint8Array; text?: string; warning?: string } | { ok: false; message: string };

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Hex as the Hash tool reads it: whitespace skipped, an optional `0x`, an even number of digits. */
export const parseHexSalt = (text: string): { ok: true; bytes: Uint8Array } | { ok: false; message: string } => {
  let digits = '';
  let i = 0;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text.startsWith('0x', i) || text.startsWith('0X', i)) i += 2;
  for (; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    if (/\s/.test(char)) {
      i += char.length;
      continue;
    }
    if (!/^[0-9a-fA-F]$/.test(char)) return { ok: false, message: `Position ${i + 1}: "${char}" is not a hex digit.` };
    digits += char;
    i += char.length;
  }
  if (digits.length % 2) return { ok: false, message: `Hex needs an even number of digits (${digits.length} found).` };
  const bytes = new Uint8Array(digits.length / 2);
  for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(digits.slice(2 * k, 2 * k + 2), 16);
  return { ok: true, bytes };
};

/** A salt written into the string as text (Django, `$7$`): printable ASCII without `$`. */
const TEXT_SALT = /^[\x20-\x23\x25-\x7e]+$/;
export const TEXT_SALT_ONLY = 'This format writes the salt as text: use printable ASCII without "$".';

/** The salt for a Hash (§5.4): random from `source`, or the person's own, checked for the algorithm and format. */
export const resolveSalt = (
  input: SaltInput,
  algorithm: Algorithm,
  format: Format,
  source: RandomSource = cryptoRandom,
): ResolvedSalt => {
  const textual = TEXT_SALT_FORMATS.has(format);
  if (input.mode === 'random') {
    if (format === 'scrypt-7') {
      const raw = new Uint8Array(32);
      source(raw);
      const text = encodeH64(raw);
      return { ok: true, salt: utf8(text), text };
    }
    if (textual) {
      let text = '';
      for (let i = 0; i < 22; i++) text += ALNUM[randomIndex(ALNUM.length, source)];
      return { ok: true, salt: utf8(text), text };
    }
    const salt = new Uint8Array(16);
    source(salt);
    return { ok: true, salt };
  }
  if (input.text === '') return { ok: false, message: 'Enter a salt or choose Random.' };
  let salt: Uint8Array;
  if (textual) {
    if (!TEXT_SALT.test(input.text)) return { ok: false, message: TEXT_SALT_ONLY };
    salt = utf8(input.text);
  } else if (input.format === 'hex') {
    const parsed = parseHexSalt(input.text);
    if (!parsed.ok) return parsed;
    salt = parsed.bytes;
  } else if (input.format === 'base64') {
    const parsed = parseBase64(input.text);
    if (!parsed.ok) return { ok: false, message: `Position ${parsed.error.column}: ${parsed.error.message}.` };
    salt = parsed.bytes;
  } else salt = utf8(input.text);
  if (salt.length === 0) return { ok: false, message: 'Enter a salt or choose Random.' };
  if (salt.length > MAX_SALT_BYTES)
    return { ok: false, message: `The salt is longer than ${formatNumber(MAX_SALT_BYTES)} bytes.` };
  const n = `${formatNumber(salt.length)} byte${salt.length === 1 ? '' : 's'}`;
  if (algorithm === 'bcrypt' && salt.length !== 16)
    return { ok: false, message: `bcrypt needs a salt of exactly 16 bytes; this one is ${n}.` };
  if (algorithm.startsWith('argon2') && salt.length < 8)
    return { ok: false, message: `Argon2 needs a salt of at least 8 bytes; this one is ${n}.` };
  return {
    ok: true,
    salt,
    ...(textual ? { text: input.text } : {}),
    ...(salt.length < 16 ? { warning: SHORT_SALT } : {}),
  };
};
