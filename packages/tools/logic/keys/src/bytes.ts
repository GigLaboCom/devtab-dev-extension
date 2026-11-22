/**
 * Bytes, unsigned big-endian integers and Base64url — the small helpers every form of a key needs (docs/tools/specs/
 * keys.md §5.4). Standard Base64 is the shared module's; Base64url here is strict (JWK, RFC 7515 §2: no padding, only
 * `A–Z a–z 0–9 - _`), because the shared reader is forgiving by design.
 */
import { bytesToBase64 } from '@workspace/tools-shared/base64';

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Leading zero bytes removed (an unsigned integer in its shortest form); zero is one byte 0x00. */
export const stripZeros = (bytes: Uint8Array): Uint8Array => {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return bytes.subarray(i);
};

/** An unsigned integer left-padded with zeros to `length` bytes; null when it does not fit. */
export const padTo = (bytes: Uint8Array, length: number): Uint8Array | null => {
  const v = stripZeros(bytes);
  const digits = v.length === 1 && v[0] === 0 ? 0 : v.length;
  if (digits > length) return null;
  const out = new Uint8Array(length);
  out.set(v.subarray(v.length - digits), length - digits);
  return out;
};

const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));

export const toBigInt = (bytes: Uint8Array): bigint => {
  if (bytes.length === 0) return 0n;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) parts.push(HEX[bytes[i]!]!);
  return BigInt(`0x${parts.join('')}`);
};

export const fromBigInt = (value: bigint): Uint8Array => {
  if (value < 0n) throw new RangeError('negative');
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Bits of an unsigned integer without its leading zeros. */
export const bitLength = (bytes: Uint8Array): number => {
  const v = stripZeros(bytes);
  if (v.length === 1 && v[0] === 0) return 0;
  return (v.length - 1) * 8 + (32 - Math.clz32(v[0]!));
};

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const base64url = (bytes: Uint8Array): string => bytesToBase64(bytes, { alphabet: 'url', padding: false });

const URL_VALUE = new Int16Array(128).fill(-1);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('').forEach((c, i) => {
  URL_VALUE[c.charCodeAt(0)] = i;
});

export type Base64urlResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; problem: 'padding' | 'char' | 'length'; position: number; char?: string };

/**
 * Strict Base64url (RFC 7515 §2, RFC 4648 §5 without padding): `=` anywhere is `padding`, any other character outside
 * the alphabet is `char` (position from 1), a length of 4k + 1 is `length`. Unused bits at the end are not checked.
 */
export const parseBase64url = (text: string): Base64urlResult => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3d) return { ok: false, problem: 'padding', position: i + 1 };
    if (c >= 128 || URL_VALUE[c]! < 0)
      return { ok: false, problem: 'char', position: i + 1, char: String.fromCodePoint(text.codePointAt(i)!) };
  }
  if (text.length % 4 === 1) return { ok: false, problem: 'length', position: text.length };
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    buffer = ((buffer << 6) | URL_VALUE[text.charCodeAt(i)]!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 0xff;
    }
  }
  return { ok: true, bytes: out };
};
