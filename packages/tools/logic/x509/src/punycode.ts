/**
 * Internationalised domain names: an A-label (`xn--…`) shown with its Unicode form (RFC 3492 Punycode, RFC 5891). Only
 * decoding, only labels a DNS name can have (≤ 63 characters); what does not decode is left as it is.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_LABEL = 63;

const adapt = (delta: number, points: number, first: boolean): number => {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
};

const digit = (c: number): number =>
  c >= 0x30 && c <= 0x39 ? c - 22 : c >= 0x41 && c <= 0x5a ? c - 0x41 : c >= 0x61 && c <= 0x7a ? c - 0x61 : BASE;

/** RFC 3492 §6.2: the Unicode label of a Punycode string (without `xn--`), or null. */
export const decodePunycode = (input: string): string | null => {
  const output: number[] = [];
  const basic = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(basic, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    output.push(c);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let at = basic > 0 ? basic + 1 : 0; at < input.length;) {
    const old = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (at >= input.length) return null;
      const d = digit(input.charCodeAt(at++));
      if (d >= BASE) return null;
      i += d * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (d < t) break;
      w *= BASE - t;
      if (w > 0x7fffffff) return null;
    }
    const points = output.length + 1;
    bias = adapt(i - old, points, old === 0);
    n += Math.floor(i / points);
    i %= points;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
};

/** `xn--bcher-kva.example` → `bücher.example`; null when no label is an A-label or one does not decode. */
export const unicodeDomain = (name: string): string | null => {
  const labels = name.split('.');
  if (!labels.some(l => /^xn--/i.test(l))) return null;
  const out: string[] = [];
  for (const label of labels) {
    if (!/^xn--/i.test(label)) {
      out.push(label);
      continue;
    }
    if (label.length > MAX_LABEL) return null;
    const decoded = decodePunycode(label.slice(4).toLowerCase());
    if (decoded === null || decoded === '') return null;
    out.push(decoded);
  }
  return out.join('.');
};
