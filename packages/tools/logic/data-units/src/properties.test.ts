import { compare, div, errorText, ladder, mul, parseValue, power, ratio, showNumber, sub } from './logic';
import { describe, expect, it } from 'vitest';
import type { Ratio, Reading } from './logic';

// The promises §10 cannot cover with examples, over generated values (docs/tools/specs/data-units.md §10, «свойства»):
// there and back returns the value; the ladder is monotone; 1 KiB = 1024 B and 1 kB = 1000 B at every step up to Q; a
// number's text reads back; a rounded value is within half a unit of its last digit. The seed is fixed.

const seeded = (seed: number) => () => (
  (seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0),
  seed
);
const next = seeded(0xda7a);
const below = (n: number): number => next() % n;
const digitsOf = (n: number): string => Array.from({ length: n }, () => String(below(10))).join('');

const PREFIXES = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'];
const BINARY = ['', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei', 'Zi', 'Yi', 'Ri', 'Qi'];

/** A random decimal text and its exact value: up to 30 integer digits, up to 20 fraction digits, sometimes e±N. */
const randomNumber = (): { text: string; value: Ratio } => {
  const int = digitsOf(1 + below(30)).replace(/^0+(?=\d)/, '');
  const frac = below(2) ? digitsOf(1 + below(20)) : '';
  let value = ratio(BigInt(int + frac), power(10n, frac.length));
  let text = frac ? `${int}.${frac}` : int;
  if (below(4) === 0) {
    const e = below(41) - 20;
    text += `e${e}`;
    value = e < 0 ? div(value, ratio(power(10n, -e))) : mul(value, ratio(power(10n, e)));
  }
  return { text, value };
};

/** A random unit and its bits per unit under the reading. */
const randomUnit = (reading: Reading): { text: string; factor: bigint } => {
  const step = below(11);
  const binary = step > 0 && below(2) === 0;
  const byte = below(2) === 0;
  const rate = below(4) === 0;
  const prefix = binary ? BINARY[step] : PREFIXES[step];
  const base = byte ? 'B' : below(2) ? 'bit' : 'b';
  // lower-case k and R, Q are decimal; other prefixes without i follow the reading.
  const perStep = binary || (step > 0 && step < 9 && prefix !== 'k' && reading === 'binary') ? 1024n : 1000n;
  const text = `${prefix}${base}${rate ? (base === 'bit' ? '/s' : 'ps') : ''}`;
  return { text, factor: power(perStep, step) * (byte ? 8n : 1n) };
};

const readBits = (text: string, reading: Reading): { bits: Ratio; rate: boolean } => {
  const r = parseValue(text, reading, 'exact');
  if (!r || !r.ok) throw new Error(`${text}: ${r && !r.ok ? errorText(r.error) : 'empty'}`);
  return { bits: r.value.bits, rate: r.value.rate };
};

describe('properties', () => {
  it('a value with a unit reads as number × factor (3,000 values)', () => {
    for (let i = 0; i < 3_000; i++) {
      const reading: Reading = below(2) ? 'decimal' : 'binary';
      const n = randomNumber();
      const u = randomUnit(reading);
      const space = below(2) ? ' ' : '';
      expect(readBits(`${n.text}${space}${u.text}`, reading).bits, `${n.text} ${u.text}`).toEqual(
        mul(n.value, ratio(u.factor)),
      );
    }
  });

  it('there and back: every row of the ladder reads back to the value, exactly (1,000 values, 40 rows each)', () => {
    for (let i = 0; i < 1_000; i++) {
      const n = randomNumber();
      const u = randomUnit('decimal');
      const { bits, rate } = readBits(`${n.text} ${u.text}`, 'decimal');
      for (const section of ladder(bits, rate, below(2) ? 'bit' : 'byte', 'exact'))
        for (const row of [section.base, ...section.decimal.rows, ...section.binary.rows]) {
          expect(row.value.rounded).toBe(false);
          const unit = row.label === 'bytes' ? 'B' : row.label === 'bits' ? 'bit' : row.label;
          expect(readBits(`${row.value.copy} ${unit}`, 'decimal').bits, `${row.value.copy} ${unit}`).toEqual(bits);
        }
    }
  });

  it('1 KiB = 1024 B and 1 kB = 1000 B at every step up to Q; the ladder falls monotonically (1,000 values)', () => {
    const exact = (copy: string): Ratio => {
      const [i, f = ''] = copy.split('.');
      return ratio(BigInt(i + f), power(10n, f.length));
    };
    for (let i = 0; i < 1_000; i++) {
      const n = randomNumber();
      const { bits, rate } = readBits(`${n.text} B`, 'decimal');
      for (const section of ladder(bits, rate, 'byte', 'exact')) {
        const base = exact(section.base.value.copy);
        const columns: [Ratio[], bigint][] = [
          [section.decimal.rows.map(r => exact(r.value.copy)), 1000n],
          [section.binary.rows.map(r => exact(r.value.copy)), 1024n],
        ];
        for (const [values, per] of columns) {
          let previous = base;
          for (const value of values) {
            expect(mul(value, ratio(per))).toEqual(previous);
            if (previous.num !== 0n) expect(compare(value, previous)).toBe(-1);
            previous = value;
          }
        }
      }
    }
  });

  it('a rounded value is within half a unit of its last shown digit (2,000 values)', () => {
    const digits = [3, 6, 9, 12, 15] as const;
    for (let i = 0; i < 2_000; i++) {
      const value = ratio(BigInt(digitsOf(1 + below(25))) + 1n, BigInt(digitsOf(1 + below(25))) + 1n);
      const d = digits[below(digits.length)];
      const shown = showNumber(value, d);
      const [int, frac = ''] = shown.copy.split('.');
      const back = ratio(BigInt(int + frac), power(10n, frac.length));
      const diff = sub(back, value);
      const half = ratio(1n, 2n * power(10n, frac.length));
      expect(compare(diff.num < 0n ? ratio(-diff.num, diff.den) : diff, half)).toBeLessThan(1);
      expect(shown.rounded).toBe(diff.num !== 0n);
      const significant = (int === '0' ? frac.replace(/^0+/, '') : int + frac).length;
      expect(significant <= d || frac === '').toBe(true);
    }
  });
});
