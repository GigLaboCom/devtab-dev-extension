/**
 * Randomness for the tools that generate (password, uuid, random-string): one source — `crypto.getRandomValues` — and
 * the helpers over it. Every function takes the source as a parameter, so a test hands in a predictable one; the
 * product never swaps it. Specification: docs/tools/specs/password.md §5.1, §5.2, §9.
 */

/** Fills `bytes` with random bytes. */
export type RandomSource = (bytes: Uint8Array) => void;

/** The most `getRandomValues` fills in one call (more throws a QuotaExceededError). */
const CHUNK = 65_536;

/** crypto.getRandomValues, in chunks of at most 65,536 bytes. */
export const cryptoRandom: RandomSource = bytes => {
  for (let at = 0; at < bytes.length; at += CHUNK) crypto.getRandomValues(bytes.subarray(at, at + CHUNK));
};

/**
 * Reads `source` ahead in blocks of `size` bytes and hands them out in order (same bytes, fewer calls). What is left
 * of the last block goes away with the returned source.
 */
export const bufferedSource = (source: RandomSource, size = 4096): RandomSource => {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`bufferedSource: size must be a positive integer`);
  let block = new Uint8Array(0);
  let at = 0;
  return bytes => {
    let filled = 0;
    while (filled < bytes.length) {
      if (at === block.length) {
        block = new Uint8Array(size);
        source(block);
        at = 0;
      }
      const n = Math.min(bytes.length - filled, block.length - at);
      bytes.set(block.subarray(at, at + n), filled);
      at += n;
      filled += n;
    }
  };
};

const TWO_32 = 2 ** 32;

/**
 * Uniform integer in [0, n), 1 ≤ n ≤ 2^32, by rejection sampling over 32-bit big-endian draws (§5.2): a draw at or
 * above the largest multiple of `n` not over 2^32 is thrown away. Arithmetic in `number` (exact up to 2^32), no
 * bitwise operations on the draw (they are signed 32-bit).
 */
export const randomIndex = (n: number, source: RandomSource): number => {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new RangeError(`randomIndex: n must be an integer 1…2^32`);
  const limit = TWO_32 - (TWO_32 % n);
  const draw = new Uint8Array(4);
  for (;;) {
    source(draw);
    const v = draw[0]! * 2 ** 24 + draw[1]! * 2 ** 16 + draw[2]! * 2 ** 8 + draw[3]!;
    if (v < limit) return v % n;
  }
};

/** log2 of a positive bigint, accurate to ~1e-12 relative: by its length in bits and its top 53 bits. */
export const log2BigInt = (n: bigint): number => {
  if (n <= 0n) throw new RangeError('log2BigInt: n must be positive');
  const bits = n.toString(2).length;
  if (bits <= 53) return Math.log2(Number(n));
  const shift = bits - 53;
  return Math.log2(Number(n >> BigInt(shift))) + shift;
};
