/**
 * The part of IDNA2008 the `hostname` (draft 7 on) and `idn-hostname` checks apply (docs/tools/specs/json-schema.md
 * §5 п. 24): Punycode (RFC 3492) both ways, the label rules of RFC 5891 §5.4 that need no Unicode tables beyond what
 * `\p{…}` gives — no leading combining mark, no `--` in the third and fourth places, the DISALLOWED exceptions of RFC
 * 5892 §2.6 — and the contextual rules of RFC 5892 appendix A. The Bidi rule (RFC 5893) and the full derived property
 * table are not applied (§13).
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;

const adapt = (delta: number, points: number, first: boolean): number => {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
};

const digitOf = (c: number): number =>
  c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : BASE;

/** The Unicode label of a Punycode body (without `xn--`), or null when it is not valid Punycode. */
export const punycodeDecode = (input: string): string | null => {
  const out: number[] = [];
  const last = input.lastIndexOf('-');
  const basic = last < 0 ? 0 : last;
  for (let j = 0; j < basic; j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    out.push(c);
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const old = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitOf(input.charCodeAt(index++));
      if (digit >= BASE) return null;
      i += digit * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...out);
  } catch {
    return null;
  }
};

/** The length of a label's A-label form (`xn--` and the Punycode of it). */
export const aLabelLength = (label: string): number => {
  const cps = Array.from(label, c => c.codePointAt(0)!);
  const basic = cps.filter(c => c < 0x80).length;
  if (basic === cps.length) return label.length;
  let n = 128;
  let delta = 0;
  let bias = 72;
  let h = basic;
  let out = basic > 0 ? basic + 1 : 0;
  const sorted = [...new Set(cps.filter(c => c >= 0x80))].sort((a, b) => a - b);
  for (const m of sorted) {
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          out++;
          q = Math.floor((q - t) / (BASE - t));
        }
        out++;
        bias = adapt(delta, h + 1, h === basic);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out + 4;
};

/** RFC 5892 §2.6: exceptions that are DISALLOWED. */
const DISALLOWED = new Set([0x0640, 0x07fa, 0x302e, 0x302f, 0x3031, 0x3032, 0x3033, 0x3034, 0x3035, 0x303b]);

/** Virama code points (canonical combining class 9), for the ZERO WIDTH JOINER / NON-JOINER rules. */
const VIRAMA = new Set([
  0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d3b, 0x0d3c, 0x0d4d, 0x0dca, 0x0e3a, 0x0eba,
  0x0f84, 0x1039, 0x103a, 0x1714, 0x1715, 0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0x1bf2, 0x1bf3, 0x2d7f,
  0xa806, 0xa82c, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed, 0x10a3f, 0x11046, 0x11070, 0x1107f, 0x110b9, 0x11133, 0x11134,
  0x111c0, 0x11235, 0x112ea, 0x1134d, 0x11442, 0x114c2, 0x115bf, 0x1163f, 0x116b6, 0x1172b, 0x11839, 0x1193d, 0x1193e,
  0x119e0, 0x11a34, 0x11a47, 0x11a99, 0x11c3f, 0x11d44, 0x11d45, 0x11d97,
]);

const GREEK = /\p{Script=Greek}/u;
const HEBREW = /\p{Script=Hebrew}/u;
const KANA_HAN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const MARK = /^\p{M}/u;

/** RFC 5891 §5.4 and RFC 5892 appendix A on one Unicode label; true when it passes. */
export const labelPasses = (label: string, draft7OrLater = true): boolean => {
  if (label.length === 0) return false;
  if (label.startsWith('-') || label.endsWith('-')) return false;
  if (draft7OrLater && label.length >= 4 && label[2] === '-' && label[3] === '-') return false;
  if (MARK.test(label)) return false;
  const cps = Array.from(label, c => c.codePointAt(0)!);
  let arabicIndic = false;
  let extendedArabicIndic = false;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!;
    if (DISALLOWED.has(c)) return false;
    const prev = cps[i - 1];
    const next = cps[i + 1];
    if (c === 0x00b7 && !(prev === 0x6c && next === 0x6c)) return false; // MIDDLE DOT between two 'l'
    if (c === 0x0375 && !(next !== undefined && GREEK.test(String.fromCodePoint(next)))) return false; // KERAIA
    if ((c === 0x05f3 || c === 0x05f4) && !(prev !== undefined && HEBREW.test(String.fromCodePoint(prev))))
      return false;
    if (c === 0x30fb && !cps.some(x => x !== 0x30fb && KANA_HAN.test(String.fromCodePoint(x)))) return false;
    if (c >= 0x0660 && c <= 0x0669) arabicIndic = true;
    if (c >= 0x06f0 && c <= 0x06f9) extendedArabicIndic = true;
    if (c === 0x200d && !(prev !== undefined && VIRAMA.has(prev))) return false; // ZERO WIDTH JOINER
    if (c === 0x200c && !(prev !== undefined && VIRAMA.has(prev))) return false; // ZERO WIDTH NON-JOINER (virama case)
  }
  return !(arabicIndic && extendedArabicIndic);
};
