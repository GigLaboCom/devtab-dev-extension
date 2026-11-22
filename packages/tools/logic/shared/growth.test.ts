import { GROWTH_BOUND, growth } from './growth';
import { describe, expect, it } from 'vitest';

/** A linear pass, a sort and a quadratic stand-in — the shape of a regression. */
const linear = (text: string): number => {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i) * (i & 7)) | 0;
  return sum;
};
const sorted = (values: number[]): number => [...values].sort((a, b) => a - b)[0]!;
/** Quadratic: each character is compared with a window that grows with the input. */
const quadratic = (text: string): number => {
  let sum = 0;
  for (let i = 0; i < text.length; i++) for (let j = 0; j < i; j += 64) sum = (sum + text.charCodeAt(j)) | 0;
  return sum;
};

describe('growth — the shape of an algorithm, not milliseconds', () => {
  it('linear work measures well under the bound', () => {
    expect(growth(linear, n => 'abcdefgh'.repeat(n / 8), 1 << 20)).toBeLessThan(GROWTH_BOUND);
  });

  it('n log n (a sort) measures under the bound', () => {
    const make = (n: number): number[] => Array.from({ length: n }, (_, i) => (i * 2654435761) % 1000003);
    expect(growth(sorted, make, 1 << 15)).toBeLessThan(GROWTH_BOUND);
  });

  it('a quadratic stand-in measures well over the bound', () => {
    expect(growth(quadratic, n => 'x'.repeat(n), 1 << 13)).toBeGreaterThan(2 * GROWTH_BOUND);
  });

  it('factor 16: linear about 1, quadratic about 16', () => {
    const make = (n: number) => 'x'.repeat(n);
    expect(growth(linear, make, 1 << 16, { factor: 16 })).toBeLessThan(GROWTH_BOUND);
    expect(growth(quadratic, make, 1 << 12, { factor: 16 })).toBeGreaterThan(8);
  });
});
