/**
 * A small DER writer (X.690 §10): the shared `@workspace/tools-shared/der` only reads, and a key's forms (SPKI,
 * PKCS#8, PKCS#1, SEC1 — docs/tools/specs/keys.md §5.4) have to be written. Definite lengths in their shortest form,
 * INTEGER in its shortest two's-complement form (unsigned values get a zero byte when the top bit is set), OBJECT
 * IDENTIFIER from dotted arcs. Every structure written here is read back by the strict reader in the tests.
 */
import { concat, stripZeros } from './bytes';

const length = (n: number): Uint8Array => {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
};

/** One element: the identifier octet (low tag numbers only — all a key needs), the length, the content. */
export const tlv = (identifier: number, ...content: Uint8Array[]): Uint8Array => {
  const body = concat(...content);
  return concat(Uint8Array.of(identifier), length(body.length), body);
};

export const sequence = (...items: Uint8Array[]): Uint8Array => tlv(0x30, ...items);
export const octetString = (bytes: Uint8Array): Uint8Array => tlv(0x04, bytes);
export const bitString = (bytes: Uint8Array): Uint8Array => tlv(0x03, Uint8Array.of(0), bytes);
export const nullValue = (): Uint8Array => Uint8Array.of(0x05, 0x00);
/** `[n]` constructed, context-specific: an explicitly tagged element (SEC1's `[0]` parameters, `[1]` public key). */
export const explicitTag = (n: number, ...items: Uint8Array[]): Uint8Array => tlv(0xa0 | n, ...items);

/** INTEGER of an unsigned big-endian value. */
export const unsigned = (bytes: Uint8Array): Uint8Array => {
  const v = stripZeros(bytes.length === 0 ? Uint8Array.of(0) : bytes);
  return tlv(0x02, v[0]! >= 0x80 ? concat(Uint8Array.of(0), v) : v);
};

export const smallInteger = (n: number): Uint8Array => unsigned(Uint8Array.of(n));

export const oid = (dotted: string): Uint8Array => {
  const arcs = dotted.split('.').map(BigInt);
  const values = [arcs[0]! * 40n + arcs[1]!, ...arcs.slice(2)];
  const out: number[] = [];
  for (const value of values) {
    const chunk: number[] = [];
    let v = value;
    do {
      chunk.unshift(Number(v & 0x7fn));
      v >>= 7n;
    } while (v > 0n);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i]! |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
};
