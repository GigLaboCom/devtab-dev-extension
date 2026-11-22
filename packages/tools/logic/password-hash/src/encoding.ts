/**
 * The byte encodings of the password hash strings (docs/tools/specs/password-hash.md §5.5). Four of them are RFC 4648
 * Base64 bit order with another alphabet and no padding; crypt-base64 (h64, the `$7$` string) takes the low bits first.
 * Decoders refuse a character outside their alphabet and a length of 1 modulo 4; trailing bits are not checked (C2SP
 * PHC strings let a consumer ignore them).
 */

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** bcrypt's alphabet: `./` first, then A–Z, a–z, 0–9; RFC 4648 bit order. */
const BCRYPT = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** crypt-base64 (passlib's h64, libsodium's escrypt): `./`, 0–9, A–Z, a–z; low bits first. */
export const H64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const table = (alphabet: string): Int8Array => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) t[alphabet.charCodeAt(i)] = i;
  return t;
};
const STANDARD_T = table(STANDARD);
const BCRYPT_T = table(BCRYPT);
const H64_T = table(H64);
/** passlib's ab64 reads `.` and `+` alike. */
const AB64_T = (() => {
  const t = table(STANDARD);
  t['.'.charCodeAt(0)] = 62;
  return t;
})();

const encodeWith = (bytes: Uint8Array, alphabet: string): string => {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const x = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += alphabet[x >> 18]! + alphabet[(x >> 12) & 63]! + alphabet[(x >> 6) & 63]! + alphabet[x & 63]!;
  }
  const left = bytes.length - i;
  if (left === 1) {
    const x = bytes[i]! << 16;
    out += alphabet[x >> 18]! + alphabet[(x >> 12) & 63]!;
  } else if (left === 2) {
    const x = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += alphabet[x >> 18]! + alphabet[(x >> 12) & 63]! + alphabet[(x >> 6) & 63]!;
  }
  return out;
};

const decodeWith = (text: string, t: Int8Array): Uint8Array | null => {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? t[c]! : -1;
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
    }
  }
  return out;
};

/** PHC B64: RFC 4648 §4 alphabet, no padding (C2SP phc-strings.md, "B64"). */
export const encodeB64 = (bytes: Uint8Array): string => encodeWith(bytes, STANDARD);
export const decodeB64 = (text: string): Uint8Array | null => decodeWith(text, STANDARD_T);

/** passlib's ab64: B64 with `.` for `+` (passlib.utils.binary.ab64_encode); reads `+` too. */
export const encodeAb64 = (bytes: Uint8Array): string => encodeB64(bytes).replaceAll('+', '.');
export const decodeAb64 = (text: string): Uint8Array | null => decodeWith(text, AB64_T);

/** Padded RFC 4648 Base64, as Django writes it; `=` only at the end, at most two, and optional when reading. */
export const decodePadded = (text: string): Uint8Array | null => {
  const body = text.replace(/={1,2}$/, '');
  if (body.includes('=')) return null;
  if (text.length !== body.length && text.length % 4 !== 0) return null;
  return decodeWith(body, STANDARD_T);
};

/** bcrypt's base64: 16 bytes of salt are 22 characters, 23 bytes of hash 31. */
export const encodeBcrypt64 = (bytes: Uint8Array): string => encodeWith(bytes, BCRYPT);
export const decodeBcrypt64 = (text: string): Uint8Array | null => decodeWith(text, BCRYPT_T);

/** crypt-base64 with the low bits first (passlib h64.encode_bytes). */
export const encodeH64 = (bytes: Uint8Array): string => {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc |= b << bits;
    bits += 8;
    while (bits >= 6) {
      out += H64[acc & 63];
      acc >>>= 6;
      bits -= 6;
    }
  }
  if (bits > 0) out += H64[acc & 63];
  return out;
};
export const decodeH64 = (text: string): Uint8Array | null => {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? H64_T[c]! : -1;
    if (v < 0) return null;
    acc |= v << bits;
    bits += 6;
    if (bits >= 8 && at < out.length) {
      out[at++] = acc & 255;
      acc >>>= 8;
      bits -= 8;
    }
  }
  return out;
};

/** A value of `digits` crypt-base64 characters, low first (`$7$`: N as one, r and p as five, 30 bits). */
export const encodeH64Int = (value: number, digits: number): string => {
  let out = '';
  for (let i = 0; i < digits; i++) out += H64[Math.floor(value / 64 ** i) % 64];
  return out;
};
export const decodeH64Int = (text: string): number | null => {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? H64_T[c]! : -1;
    if (v < 0) return null;
    value += v * 64 ** i;
  }
  return value;
};
