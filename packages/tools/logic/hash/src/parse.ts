/**
 * The Hash tool's own readers of hex and Base64 (docs/tools/specs/hash.md §5.4), for the input and the HMAC key. They
 * differ on purpose from the shared modules: hex needs an even number of digits in the whole input (hex-ascii counts
 * per chunk), Base64 never mixes its two alphabets (the shared `parseBase64` is forgiving-base64, which does), and the
 * errors name a position in the field as typed — `Position N: …`, 1-based UTF-16.
 */

export type Decoded = { ok: true; bytes: Uint8Array } | { ok: false; message: string; position?: number };

const isSpace = (c: string): boolean => /\s/.test(c);

/** The character at `at` for a message: a whole code point, so an emoji is quoted as itself, not half of it. */
const charAt = (text: string, at: number): string => String.fromCodePoint(text.codePointAt(at)!);

const fail = (message: string, position?: number): Decoded =>
  position === undefined ? { ok: false, message } : { ok: false, message, position };

const HEX_VALUE = (code: number): number =>
  code >= 48 && code <= 57
    ? code - 48
    : code >= 97 && code <= 102
      ? code - 87
      : code >= 65 && code <= 70
        ? code - 55
        : -1;

/** Hex digits; white space anywhere; `0x` / `0X` once at the start; an even number of digits. Empty → no bytes. */
export const decodeHex = (text: string): Decoded => {
  let at = 0;
  while (at < text.length && isSpace(text[at]!)) at++;
  if (text[at] === '0' && (text[at + 1] === 'x' || text[at + 1] === 'X')) at += 2;
  const values: number[] = [];
  for (; at < text.length; at++) {
    const c = text[at]!;
    const value = HEX_VALUE(text.charCodeAt(at));
    if (value >= 0) values.push(value);
    else if (!isSpace(c)) return fail(`Position ${at + 1}: "${charAt(text, at)}" is not a hex digit.`, at);
  }
  if (values.length % 2 === 1) return fail(`Hex needs an even number of digits (${values.length} found).`);
  const bytes = new Uint8Array(values.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (values[2 * i]! << 4) | values[2 * i + 1]!;
  return { ok: true, bytes };
};

const COMMON = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SIXTY_FOUR = new Map<string, number>([...COMMON].map((c, i) => [c, i]));
/** The two characters each alphabet has of its own (RFC 4648 §4 and §5): their value and the alphabet's name. */
const OWN: Record<string, { value: number; alphabet: 'standard' | 'URL-safe' }> = {
  '+': { value: 62, alphabet: 'standard' },
  '/': { value: 63, alphabet: 'standard' },
  '-': { value: 62, alphabet: 'URL-safe' },
  _: { value: 63, alphabet: 'URL-safe' },
};

/**
 * RFC 4648 §4 or §5, never both in one input; white space anywhere; `=` only at the end, at most two, optional; the
 * length without `=` must not leave 1 modulo 4. The unused bits of the last character are not checked. Empty → no bytes.
 */
export const decodeBase64 = (text: string): Decoded => {
  const values: number[] = [];
  let first: { char: string; alphabet: string } | undefined;
  let padding = 0;
  let firstPad = -1;
  for (let at = 0; at < text.length; at++) {
    const c = text[at]!;
    if (isSpace(c)) continue;
    if (c === '=') {
      if (padding === 0) firstPad = at;
      padding++;
      if (padding > 2) return fail(`Position ${at + 1}: Base64 ends with at most two "=".`, at);
      continue;
    }
    // A character after "=" means that "=" was not at the end.
    if (padding > 0) return fail(`Position ${firstPad + 1}: "=" can only appear at the end.`, firstPad);
    const common = SIXTY_FOUR.get(c);
    if (common !== undefined) {
      values.push(common);
      continue;
    }
    const own = OWN[c];
    if (!own) return fail(`Position ${at + 1}: "${charAt(text, at)}" is not a Base64 character.`, at);
    if (first && first.alphabet !== own.alphabet)
      return fail(
        `Position ${at + 1}: "${c}" belongs to the ${own.alphabet} alphabet, but "${first.char}" was used before.`,
        at,
      );
    first ??= { char: c, alphabet: own.alphabet };
    values.push(own.value);
  }
  if (values.length % 4 === 1) return fail('Base64 length is not valid: one character too many or missing.');
  const bytes = new Uint8Array(Math.floor((values.length * 3) / 4));
  let out = 0;
  for (let i = 0; i < values.length; i += 4) {
    const n = (values[i]! << 18) | ((values[i + 1] ?? 0) << 12) | ((values[i + 2] ?? 0) << 6) | (values[i + 3] ?? 0);
    if (out < bytes.length) bytes[out++] = n >> 16;
    if (out < bytes.length) bytes[out++] = (n >> 8) & 255;
    if (out < bytes.length) bytes[out++] = n & 255;
  }
  return { ok: true, bytes };
};
