/**
 * Exact numbers of the Data Units tool (docs/tools/specs/data-units.md §5 items 1, 2 and 13): an irreducible fraction of
 * two bigints, and its decimal text. No value ever passes through a floating-point `number`.
 */

/** An irreducible fraction, `den > 0`. */
export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

const gcd = (a: bigint, b: bigint): bigint => {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

/** `base` to the power `n` (n ≥ 0), by multiplication. */
export const power = (base: bigint, n: number): bigint => {
  let out = 1n;
  for (let i = 0; i < n; i++) out *= base;
  return out;
};

/** The fraction num / den, reduced; a zero denominator is a programming error. */
export const ratio = (num: bigint, den = 1n): Ratio => {
  if (den === 0n) throw new RangeError('A fraction with a zero denominator');
  const sign = den < 0n ? -1n : 1n;
  const g = gcd(num, den) || 1n;
  return { num: (sign * num) / g, den: (sign * den) / g };
};

export const ZERO = ratio(0n);
export const ONE = ratio(1n);

export const add = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.den + b.num * a.den, a.den * b.den);
export const sub = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.den - b.num * a.den, a.den * b.den);
export const mul = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.num, a.den * b.den);
/** a / b; b must not be zero (the caller says why it is not, §6). */
export const div = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.den, a.den * b.num);
export const isZero = (a: Ratio): boolean => a.num === 0n;
export const compare = (a: Ratio, b: Ratio): -1 | 0 | 1 => {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};

/** Whether the decimal expansion ends: the denominator is 2^a · 5^b (§5 item 2). */
export const terminates = (a: Ratio): boolean => {
  let d = a.den;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
};

/** How many digits follow the point in the exact expansion of a terminating fraction. */
const exactPlaces = (den: bigint): number => {
  let twos = 0;
  let fives = 0;
  let d = den;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  return Math.max(twos, fives);
};

/** The digits shown: everything (`exact`) or at most this many significant ones (§5 item 13). */
export type Digits = 'exact' | 3 | 6 | 9 | 12 | 15;
export const DIGITS: readonly Digits[] = ['exact', 3, 6, 9, 12, 15];
/** A fraction that never ends, under `exact`: this many significant digits and the exact fraction beside. */
export const EXACT_REPEATING_DIGITS = 20;

/** A number as shown (`text`: groups and the `≈ ` mark) and as copied (`copy`: neither). */
export interface Shown {
  text: string;
  copy: string;
  rounded: boolean;
}

/** '1234567' → '1,234,567'. */
export const groupDigits = (integer: string): string => {
  let out = '';
  for (let i = 0; i < integer.length; i++) {
    if (i > 0 && (integer.length - i) % 3 === 0) out += ',';
    out += integer[i];
  }
  return out;
};

const trimZeros = (fraction: string): string => {
  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === '0') end--;
  return fraction.slice(0, end);
};

/** A non-negative fraction with `places` digits after the point, rounded half up; whether rounding changed it. */
const fixed = (value: Ratio, places: number): { integer: string; fraction: string; rounded: boolean } => {
  const scale = power(10n, places);
  const scaled = value.num * scale;
  let q = scaled / value.den;
  const r = scaled % value.den;
  if (2n * r >= value.den && r !== 0n) q += 1n;
  const integer = q / scale;
  const fraction = places === 0 ? '' : (q % scale).toString().padStart(places, '0');
  return { integer: integer.toString(), fraction: trimZeros(fraction), rounded: r !== 0n };
};

const decimalLength = (n: bigint): number => n.toString().length;

/** How many digits after the point keep `digits` significant ones; the integer part is never shortened (§5 item 13). */
const placesFor = (value: Ratio, digits: number): number => {
  const integer = value.num / value.den;
  if (integer > 0n) return Math.max(0, digits - decimalLength(integer));
  // Below one: the first significant digit is at place p (num · 10^p ≥ den).
  let p = Math.max(1, decimalLength(value.den) - decimalLength(value.num));
  while (value.num * power(10n, p) < value.den) p++;
  while (p > 1 && value.num * power(10n, p - 1) >= value.den) p--;
  return p - 1 + digits;
};

/**
 * A non-negative value as text (§5 item 13): under `exact` a terminating fraction in full and one that never ends to
 * EXACT_REPEATING_DIGITS significant digits; otherwise at most `digits` significant digits. Positional, never an
 * exponent; groups of three in the integer part; `≈ ` where rounding changed the value.
 */
export const showNumber = (value: Ratio, digits: Digits): Shown => {
  if (value.num < 0n) throw new RangeError('A negative value');
  if (value.num === 0n) return { text: '0', copy: '0', rounded: false };
  const places =
    digits === 'exact'
      ? terminates(value)
        ? exactPlaces(value.den)
        : placesFor(value, EXACT_REPEATING_DIGITS)
      : placesFor(value, digits);
  const { integer, fraction, rounded } = fixed(value, places);
  const copy = fraction ? `${integer}.${fraction}` : integer;
  const text = `${rounded ? '≈ ' : ''}${groupDigits(integer)}${fraction ? `.${fraction}` : ''}`;
  return { text, copy, rounded };
};

/** The exact decimal of a terminating fraction, without groups; null when it never ends. */
export const exactDecimal = (value: Ratio): string | null =>
  terminates(value) ? showNumber(value, 'exact').copy : null;

/** '3008/7'; a whole number alone. */
export const fractionText = (value: Ratio): string =>
  value.den === 1n ? value.num.toString() : `${value.num}/${value.den}`;

/** A non-negative fraction rounded half up to a whole number. */
export const roundHalfUp = (value: Ratio): bigint => {
  const q = value.num / value.den;
  const r = value.num % value.den;
  return 2n * r >= value.den && r !== 0n ? q + 1n : q;
};
