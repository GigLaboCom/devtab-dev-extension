/**
 * Exact decimal numbers (docs/tools/specs/json-schema.md §5 п. 14–16): a JSON number literal as sign, digits (a
 * `BigInt` without trailing zeros) and a decimal exponent, never a double — so `0.3` is a multiple of `0.1`,
 * `12345678901234567891` is greater than `12345678901234567890`, and `1.0`, `1` and `1e0` are one value.
 */
import type { Draft } from './drafts';

export interface Decimal {
  negative: boolean;
  /** Without trailing zeros; 0n for zero (then `negative` is false and `exponent` 0). */
  digits: bigint;
  /** value = ±digits · 10^exponent. Saturated at ±1e15 for absurd literals (`1e99999999999999999999`). */
  exponent: number;
}

const EXPONENT_LIMIT = 1e15;
const cache = new Map<string, Decimal>();

/** A JSON number literal (RFC 8259 grammar, as the scanner keeps it) as an exact decimal. */
export const toDecimal = (raw: string): Decimal => {
  const known = cache.get(raw);
  if (known) return known;
  let i = 0;
  const negative = raw.charCodeAt(0) === 45;
  if (negative) i = 1;
  let e = raw.indexOf('e', i);
  if (e < 0) e = raw.indexOf('E', i);
  const mantissa = e < 0 ? raw.slice(i) : raw.slice(i, e);
  let exponent = 0;
  if (e >= 0) {
    const text = raw.slice(e + 1);
    const n = Number(text);
    exponent =
      Math.abs(n) > EXPONENT_LIMIT || !Number.isFinite(n)
        ? Math.sign(n || (text.startsWith('-') ? -1 : 1)) * EXPONENT_LIMIT
        : n;
  }
  const dot = mantissa.indexOf('.');
  let text = mantissa;
  if (dot >= 0) {
    text = mantissa.slice(0, dot) + mantissa.slice(dot + 1);
    exponent -= mantissa.length - dot - 1;
  }
  let end = text.length;
  while (end > 1 && text.charCodeAt(end - 1) === 48) end--;
  exponent += text.length - end;
  const digits = BigInt(text.slice(0, end));
  const value: Decimal = digits === 0n ? { negative: false, digits: 0n, exponent: 0 } : { negative, digits, exponent };
  if (cache.size > 10_000) cache.clear();
  cache.set(raw, value);
  return value;
};

const digitCount = (n: bigint): number => (n < 0n ? -n : n).toString().length;

const POW10: bigint[] = [1n];
const pow10 = (k: number): bigint => {
  if (k < 64) {
    while (POW10.length <= k) POW10.push(POW10[POW10.length - 1]! * 10n);
    return POW10[k]!;
  }
  return 10n ** BigInt(k);
};

/** The magnitudes of two non-zero decimals: -1, 0, 1. */
const compareMagnitude = (a: Decimal, b: Decimal): -1 | 0 | 1 => {
  const la = digitCount(a.digits) + a.exponent;
  const lb = digitCount(b.digits) + b.exponent;
  if (la !== lb) return la < lb ? -1 : 1;
  // Same position of the leading digit: the exponents differ by at most the longer digit string.
  const e = Math.min(a.exponent, b.exponent);
  const x = a.digits * pow10(a.exponent - e);
  const y = b.digits * pow10(b.exponent - e);
  return x === y ? 0 : x < y ? -1 : 1;
};

export const compareDecimal = (a: Decimal, b: Decimal): -1 | 0 | 1 => {
  if (a.digits === 0n || b.digits === 0n) {
    if (a.digits === 0n && b.digits === 0n) return 0;
    if (a.digits === 0n) return b.negative ? 1 : -1;
    return a.negative ? -1 : 1;
  }
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const m = compareMagnitude(a, b);
  return a.negative ? ((-m || 0) as -1 | 0 | 1) : m;
};

export const compareNumbers = (a: string, b: string): -1 | 0 | 1 => compareDecimal(toDecimal(a), toDecimal(b));

const bitLength = (n: bigint): number => n.toString(2).length;

/**
 * Is `a` an integer multiple of `b` (b > 0)? a = m·10^p, b = n·10^q. With p ≥ q: n | m·10^(p−q); a factor 10^k only
 * adds twos and fives, of which n has at most bitlength(n), so k is capped there without changing the answer. With
 * p < q: n·10^(q−p) | m, impossible once n·10^(q−p) has more digits than m (m ≠ 0).
 */
export const isMultipleOf = (a: Decimal, b: Decimal): boolean => {
  if (a.digits === 0n) return true;
  if (b.digits === 0n) return false;
  const m = a.digits;
  const n = b.digits;
  if (a.exponent >= b.exponent) {
    const k = Math.min(a.exponent - b.exponent, bitLength(n));
    return (m * pow10(k)) % n === 0n;
  }
  const k = b.exponent - a.exponent;
  if (k > digitCount(m)) return false;
  return m % (n * pow10(k)) === 0n;
};

/** Draft 6 and later: any number with no fractional part; draft 4: a literal without fraction or exponent. */
export const isIntegerValue = (raw: string, draft: Draft): boolean => {
  if (draft === 'draft-04') return !/[.eE]/.test(raw);
  const d = toDecimal(raw);
  return d.digits === 0n || d.exponent >= 0;
};

/** A canonical text of the value (for hashing equal numbers alike): `1.0`, `1e0` and `10e-1` all give `1e0`. */
export const canonicalNumber = (raw: string): string => {
  const d = toDecimal(raw);
  return `${d.negative ? '-' : ''}${d.digits}e${d.exponent}`;
};
