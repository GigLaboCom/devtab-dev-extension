/**
 * Exact comparison of JSON number literals (docs/tools/specs/json-query.md §5 п. 14). A literal is read as a decimal —
 * sign, significant digits and a power of ten (a BigInt, so `1e999999999999` is still exact) — and two of them compare
 * by value, never through a double: `1 == 1.0 == 10e-1`, `-0 == 0`, `12345678901234567890 < 12345678901234567891`,
 * `1e400 > 1e399`. Linear in the literals' length.
 */

interface Decimal {
  sign: -1 | 0 | 1;
  /** Significant digits, no leading or trailing zeros ('' for zero). */
  digits: string;
  /** The value is 0.digits × 10^point. */
  point: bigint;
}

/** Reads a number literal of JSON or of a query (`-?int(.frac)?([eE][+-]?exp)?`); the grammar is checked before. */
const read = (raw: string): Decimal => {
  let i = 0;
  const negative = raw.charCodeAt(0) === 45;
  if (negative) i++;
  let mantissa = '';
  let fraction = 0;
  for (; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 46) continue;
    if (c === 101 || c === 69) break;
    mantissa += raw[i];
  }
  const dot = raw.indexOf('.');
  if (dot >= 0) {
    const e = raw.slice(dot + 1).search(/[eE]/);
    fraction = e < 0 ? raw.length - dot - 1 : e;
  }
  const exponent = i < raw.length ? BigInt(raw.slice(i + 1).replace(/^\+/, '')) : 0n;
  let start = 0;
  while (start < mantissa.length && mantissa.charCodeAt(start) === 48) start++;
  let end = mantissa.length;
  while (end > start && mantissa.charCodeAt(end - 1) === 48) end--;
  const digits = mantissa.slice(start, end);
  if (digits === '') return { sign: 0, digits: '', point: 0n };
  // mantissa × 10^(exponent − fraction); the first significant digit sits at position (length − start) of it.
  const point = exponent - BigInt(fraction) + BigInt(mantissa.length - start);
  return { sign: negative ? -1 : 1, digits, point };
};

const compareMagnitude = (a: Decimal, b: Decimal): -1 | 0 | 1 => {
  if (a.point !== b.point) return a.point < b.point ? -1 : 1;
  const n = Math.max(a.digits.length, b.digits.length);
  for (let k = 0; k < n; k++) {
    const x = a.digits.charCodeAt(k) || 48;
    const y = b.digits.charCodeAt(k) || 48;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/** -1, 0 or 1 as the value of `a` is less than, equal to or greater than that of `b`. */
export const compareNumbers = (a: string, b: string): -1 | 0 | 1 => {
  const x = read(a);
  const y = read(b);
  if (x.sign !== y.sign) return x.sign < y.sign ? -1 : 1;
  if (x.sign === 0) return 0;
  const m = compareMagnitude(x, y);
  return (x.sign > 0 ? m : -m) as -1 | 0 | 1;
};
