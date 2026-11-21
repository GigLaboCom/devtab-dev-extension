import { bufferedSource, cryptoRandom, log2BigInt, randomIndex } from './random';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RandomSource } from './random';

/** Bytes 0, 1, 2, … modulo 256, the count going on between calls (password.md §10). */
const counter = (): RandomSource => {
  let next = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = next++ % 256;
  };
};
/** The given bytes, round and round. */
const list = (values: number[]): RandomSource => {
  let next = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = values[next++ % values.length]!;
  };
};

afterEach(() => vi.restoreAllMocks());

describe('randomIndex (password.md §5.2, §10 rows 1–3)', () => {
  it('reads 32-bit big-endian draws: 63, 43, 23, 3, 77 for 94 from the counter', () => {
    const source = counter();
    expect(Array.from({ length: 5 }, () => randomIndex(94, source))).toEqual([63, 43, 23, 3, 77]);
  });

  it('throws away a draw at or above the limit', () => {
    expect(randomIndex(94, list([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 5]))).toBe(5);
  });

  it('throws nothing away when n divides 2^32', () => {
    expect(randomIndex(64, list([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 5]))).toBe(63);
  });

  it('takes 1 and 2^32, and refuses what is outside', () => {
    expect(randomIndex(1, counter())).toBe(0);
    expect(randomIndex(2 ** 32, list([0xff, 0xff, 0xff, 0xff]))).toBe(2 ** 32 - 1);
    for (const n of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN]) expect(() => randomIndex(n, counter())).toThrow(RangeError);
  });

  it('is uniform with the real source: χ² of 200 000 draws over 10 values stays under 27.88 (p = 0.001)', () => {
    const counts = new Array<number>(10).fill(0);
    const source = bufferedSource(cryptoRandom);
    for (let i = 0; i < 200_000; i++) counts[randomIndex(10, source)]!++;
    const chi2 = counts.reduce((sum, c) => sum + (c - 20_000) ** 2 / 20_000, 0);
    expect(chi2).toBeLessThan(27.88);
  });
});

describe('cryptoRandom', () => {
  it('fills 100 000 bytes in two calls of at most 65 536 (password.md §10 row 31)', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const bytes = new Uint8Array(100_000);
    cryptoRandom(bytes);
    expect(spy.mock.calls.map(([a]) => (a as Uint8Array).length)).toEqual([65_536, 34_464]);
    expect(bytes.some(b => b !== 0)).toBe(true);
  });
});

describe('bufferedSource', () => {
  it('hands out the same bytes in the same order, in fewer calls', () => {
    const direct = counter();
    let calls = 0;
    const inner = counter();
    const buffered = bufferedSource(bytes => {
      calls++;
      inner(bytes);
    }, 16);
    const a = new Uint8Array(40);
    const b = new Uint8Array(40);
    for (let i = 0; i < 10; i++) {
      direct(a.subarray(i * 4, i * 4 + 4));
      buffered(b.subarray(i * 4, i * 4 + 4));
    }
    expect(b).toEqual(a);
    expect(calls).toBe(3);
  });

  it('serves a request larger than its block', () => {
    const out = new Uint8Array(10);
    bufferedSource(counter(), 4)(out);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('log2BigInt', () => {
  it('is exact for small numbers and close for large ones', () => {
    expect(log2BigInt(1n)).toBe(0);
    expect(log2BigInt(1024n)).toBe(10);
    expect(log2BigInt(26n ** 16n)).toBeCloseTo(16 * Math.log2(26), 10);
    const big = 94n ** 128n;
    expect(Math.abs(log2BigInt(big) - 128 * Math.log2(94)) / (128 * Math.log2(94))).toBeLessThan(1e-12);
  });

  it('refuses zero and negatives', () => {
    expect(() => log2BigInt(0n)).toThrow(RangeError);
    expect(() => log2BigInt(-5n)).toThrow(RangeError);
  });
});
