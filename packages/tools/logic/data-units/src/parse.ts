/**
 * Reading a value with its unit (docs/tools/specs/data-units.md §5 items 3–11 and 14, the messages of §6): strict, and
 * every refusal says why. The number becomes an exact fraction; the value is kept in bits.
 */
import { groupDigits, mul, power, ratio, showNumber } from './ratio';
import { bitsName, byteSymbol, factorOf, isUnit, multiplierOf, prefixSuggestions, readUnit } from './units';
import type { Digits, Ratio } from './ratio';
import type { Reading, Unit } from './units';

export const MAX_TEXT = 200;
export const MAX_EXPONENT = 100n;

/** A refusal with its place: `start` from 0 in UTF-16 units of the field's text; -1 — no place. */
export interface TextError {
  message: string;
  start: number;
}

export const MESSAGES = {
  tooLong: `The value is longer than ${MAX_TEXT} characters.`,
  negative: 'A size or a rate is never negative.',
  sign: 'Write the number without a sign.',
  noNumber: 'Enter a number before the unit, as in 1 MB.',
  leadingMark: 'Write a digit before the decimal mark: 0.5.',
  trailingMark: 'Write a digit after the decimal mark, or remove it.',
  oneDecimal: 'A number has one decimal mark.',
  mixedGroups: 'Use one kind of digit-group separator.',
  groupsAfterMark: 'Digit groups go before the decimal mark.',
  underscore: '"_" goes between two digits.',
  noUnit: 'No unit: read as bytes.',
} as const;

/** A character as an error names it: `"x"`, or `U+200B (an invisible character)`. */
export const describeChar = (ch: string): string => {
  const code = ch.codePointAt(0) ?? 0;
  return /^[\p{C}\p{Z}]$/u.test(ch) && ch !== ' '
    ? `U+${code.toString(16).toUpperCase().padStart(4, '0')} (an invisible character)`
    : `"${ch}"`;
};

/** 'Column 4: …', or the message alone when it has no place. */
export const errorText = (error: TextError): string =>
  error.start < 0 ? error.message : `Column ${error.start + 1}: ${error.message}`;

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
/** Spaces inside a number and between it and its unit (§5 item 3). */
const isGroupSpace = (ch: string | undefined): boolean =>
  ch === ' ' || ch === '\u{a0}' || ch === '\u{2009}' || ch === '\u{202f}';
const isSpace = (ch: string | undefined): boolean => ch !== undefined && /^\s$/u.test(ch);

export interface ParsedNumber {
  value: Ratio;
  /** Where the number ends in the text. */
  end: number;
  /** The number as written (for messages: '512'). */
  written: string;
  note?: string;
}

export type NumberResult = { ok: true; number: ParsedNumber } | { ok: false; error: TextError };

const fail = (message: string, start: number): { ok: false; error: TextError } => ({
  ok: false,
  error: { message, start },
});

/** Group lengths: the first 1–3 digits, each next exactly 3 (§5 item 5). `parts` start at the given offsets. */
const checkGroups = (parts: { digits: string; at: number }[], mark: string): TextError | null => {
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i].digits.length;
    if (i === 0 ? n < 1 || n > 3 : n !== 3) {
      const sample = `1${mark}000${mark}000`;
      return { message: `A digit group has 3 digits, as in ${sample}.`, start: parts[i].at };
    }
  }
  return null;
};

/**
 * The number that starts at `from` (a digit there): digits, the decimal mark and digit groups by §5 item 5, then an
 * exponent. Ends at the last character that belongs to it.
 */
export const parseNumber = (text: string, from: number): NumberResult => {
  let j = from;
  while (j < text.length) {
    const ch = text[j];
    if (isDigit(ch) || ch === ',' || ch === '.' || ch === '_') j++;
    else if (isGroupSpace(ch) && isDigit(text[j - 1]) && isDigit(text[j + 1])) j++;
    else break;
  }
  const body = text.slice(from, j);
  const last = body[body.length - 1];
  if (last === ',' || last === '.') return fail(MESSAGES.trailingMark, j - 1);
  for (let i = 0; i < body.length; i++)
    if (body[i] === '_' && !(isDigit(body[i - 1]) && isDigit(body[i + 1]))) return fail(MESSAGES.underscore, from + i);

  const indexes = (pred: (ch: string) => boolean): number[] => {
    const out: number[] = [];
    for (let i = 0; i < body.length; i++) if (pred(body[i])) out.push(i);
    return out;
  };
  const dots = indexes(ch => ch === '.');
  const commas = indexes(ch => ch === ',');
  const spaces = indexes(ch => isGroupSpace(ch));

  let decimalAt = -1;
  let groupMark: string | null = spaces.length ? ' ' : null;
  let note: string | undefined;
  const intDigits = (end: number): string => body.slice(0, end).replace(/[^0-9]/g, '');

  if (dots.length && commas.length) {
    const lastDot = dots[dots.length - 1];
    const lastComma = commas[commas.length - 1];
    const [decimals, mark] = lastDot > lastComma ? [dots, ','] : [commas, '.'];
    if (decimals.length > 1) return fail(MESSAGES.oneDecimal, from + decimals[decimals.length - 1]);
    if (spaces.length) return fail(MESSAGES.mixedGroups, from + spaces[0]);
    decimalAt = decimals[0];
    groupMark = mark;
  } else if (dots.length + commas.length > 1) {
    if (spaces.length) return fail(MESSAGES.mixedGroups, from + spaces[0]);
    groupMark = dots.length ? '.' : ',';
  } else if (dots.length + commas.length === 1) {
    const at = dots.length ? dots[0] : commas[0];
    const mark = body[at];
    const before = body.slice(0, at);
    const after = body.slice(at + 1);
    const hasExponent = /[eE][+-]?[0-9]/.test(text.slice(j, j + 3));
    const shape = !spaces.length && !body.includes('_') && /^[1-9][0-9]{0,2}$/.test(before) && /^[0-9]{3}$/.test(after);
    if (shape && !hasExponent) {
      const whole = `${before}${after}`;
      const half = `${before}.${after.replace(/0+$/, '') || '0'}`.replace(/\.0$/, '');
      if (mark === ',') {
        groupMark = ',';
        note = `"${body}" is read as ${whole} (comma as thousands separator). If you meant ${half}, write ${half}.`;
      } else {
        decimalAt = at;
        note = `"${body}" is read as ${half} (point as decimal mark). If you meant ${whole}, write ${whole}.`;
      }
    } else decimalAt = at;
  }

  // Digit groups: only in the integer part, by the one group mark.
  if (groupMark !== null) {
    const isMark = (ch: string): boolean => (groupMark === ' ' ? isGroupSpace(ch) : ch === groupMark);
    const intEnd = decimalAt < 0 ? body.length : decimalAt;
    if (decimalAt >= 0)
      for (let i = decimalAt + 1; i < body.length; i++)
        if (isMark(body[i])) return fail(MESSAGES.groupsAfterMark, from + i);
    const parts: { digits: string; at: number }[] = [];
    let start = 0;
    for (let i = 0; i <= intEnd; i++) {
      if (i === intEnd || isMark(body[i])) {
        parts.push({ digits: body.slice(start, i).replace(/_/g, ''), at: from + start });
        start = i + 1;
      }
    }
    const bad = checkGroups(parts, groupMark);
    if (bad) return { ok: false, error: bad };
  }

  const integer = intDigits(decimalAt < 0 ? body.length : decimalAt);
  const fraction = decimalAt < 0 ? '' : body.slice(decimalAt + 1).replace(/[^0-9]/g, '');
  let value = ratio(BigInt(integer + fraction), power(10n, fraction.length));

  // The exponent: e or E, a sign, digits — only when a digit follows, otherwise the e begins the unit (§5 item 4).
  let end = j;
  const exp = /^[eE]([+-]?)([0-9]+)/.exec(text.slice(j));
  if (exp) {
    const n = BigInt(`${exp[1] === '-' ? '-' : ''}${exp[2]}`);
    if (n > MAX_EXPONENT || n < -MAX_EXPONENT)
      return fail(`The exponent is -${MAX_EXPONENT} to ${MAX_EXPONENT}; this is ${n}.`, j);
    let scale = 1n;
    for (let c = n < 0n ? -n : n; c > 0n; c--) scale *= 10n;
    value = n < 0n ? ratio(value.num, value.den * scale) : ratio(value.num * scale, value.den);
    end = j + exp[0].length;
  }
  return { ok: true, number: { value, end, written: text.slice(from, end), ...(note ? { note } : {}) } };
};

export interface Quantity {
  /** The value in bits (bits per second for a rate). */
  bits: Ratio;
  rate: boolean;
  /** null — a number alone (bytes, §5 item 10). */
  unit: Unit | null;
  number: Ratio;
  /** The number as written. */
  written: string;
  /** Where the number ends and where the unit starts (the text's length when there is none). */
  numberEnd: number;
  unitStart: number;
}

export type ValueResult =
  { ok: true; value: Quantity; notes: string[]; reading: string | null } | { ok: false; error: TextError };

const UNKNOWN_HINT = 'Sizes: B, kB, KiB, MB, MiB … QB, bit, Mbit; rates: Mbps, MB/s, MiB/s.';

/** The base units' name in the reading line: bytes, bits, bytes per second, bits per second. */
const baseWords = (unit: Unit): string => `${unit.base === 'byte' ? 'bytes' : 'bits'}${unit.rate ? ' per second' : ''}`;

/**
 * The reading line of an ambiguous prefix (§5 items 8 and 14): which reading counted, its multiplier, and the value by
 * the other reading.
 */
export const readingLine = (q: Quantity, reading: Reading, digits: Digits): string | null => {
  const unit = q.unit;
  if (!unit || unit.system !== 'ambiguous') return null;
  const other: Reading = reading === 'decimal' ? 'binary' : 'decimal';
  const words = baseWords(unit);
  const one = groupDigits(multiplierOf(unit, reading).toString());
  const otherValue = showNumber(mul(q.number, ratio(multiplierOf(unit, other))), digits).text;
  const name = (r: Reading): string => (r === 'decimal' ? 'decimal' : 'binary');
  const source = (r: Reading): string => (r === 'decimal' ? 'SI' : 'JEDEC, Windows');
  return reading === 'decimal'
    ? `${unit.written} is read as ${name(reading)}: 1 ${unit.written} = ${one} ${words} (${source(reading)}). As ${name(other)} (${source(other)}), ${q.written} ${unit.written} is ${otherValue} ${words}.`
    : `${unit.written} is read as ${name(reading)} (${source(reading)}): 1 ${unit.written} = ${one} ${words}. As ${name(other)} (${source(other)}), ${q.written} ${unit.written} is ${otherValue} ${words}.`;
};

/**
 * A value with its unit (§5 items 3–11): null for an empty field; otherwise the quantity in bits, the notes (§6) and
 * the reading line of an ambiguous prefix, or the first refusal with its place.
 */
export const parseValue = (text: string, reading: Reading, digits: Digits): ValueResult | null => {
  if (text.trim() === '') return null;
  if (text.length > MAX_TEXT) return fail(MESSAGES.tooLong, -1);
  let i = 0;
  while (isSpace(text[i])) i++;
  let end = text.length;
  while (end > i && isSpace(text[end - 1])) end--;
  const first = text[i];
  if (first === '-' || first === '\u{2212}') return fail(MESSAGES.negative, i);
  if (first === '+') return fail(MESSAGES.sign, i);
  if (first === '.' || first === ',') return fail(MESSAGES.leadingMark, i);
  if (/^[A-Za-z]$/.test(first)) return fail(MESSAGES.noNumber, i);
  if (!isDigit(first)) {
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    return fail(`Unexpected ${describeChar(ch)}: start with a number, as in 1.5 GiB.`, i);
  }
  const parsed = parseNumber(text.slice(0, end), i);
  if (!parsed.ok) return parsed;
  const { number } = parsed;
  const notes: string[] = [];
  if (number.note) notes.push(number.note);
  let k = number.end;
  while (k < end && isSpace(text[k])) k++;
  if (k >= end) {
    notes.push(MESSAGES.noUnit);
    const q: Quantity = {
      bits: mul(number.value, ratio(8n)),
      rate: false,
      unit: null,
      number: number.value,
      written: number.written,
      numberEnd: number.end,
      unitStart: end,
    };
    return { ok: true, value: q, notes, reading: null };
  }
  let u = k;
  while (u < end && !isSpace(text[u])) u++;
  const written = text.slice(k, u);
  for (const ch of written)
    if (!/^[A-Za-z/]$/.test(ch)) return fail(`Unexpected ${describeChar(ch)} in the unit.`, k + written.indexOf(ch));
  const unit = readUnit(written);
  if (!isUnit(unit)) {
    if (unit.problem === 'prefix-only')
      return fail(
        `"${written}" alone is a prefix, not a unit: write ${prefixSuggestions(number.written, unit.step, unit.binary)}. Config suffixes shows how programs read it.`,
        k,
      );
    if (unit.problem === 'per-other') return fail(`Rates are per second: write ${unit.stem}/s.`, k);
    return fail(`Unknown unit "${written}". ${UNKNOWN_HINT}`, k);
  }
  let rest = u;
  while (rest < end && isSpace(text[rest])) rest++;
  if (rest < end) {
    const ch = String.fromCodePoint(text.codePointAt(rest) ?? 0);
    return fail(`Unexpected ${describeChar(ch)} after the unit.`, rest);
  }
  // b is always a bit (§5 item 9): say so where everyday writing means bytes.
  if (!unit.rate && !unit.word && unit.base === 'bit' && unit.step > 0 && written === written.toLowerCase())
    notes.push(
      `"${written}" is read as ${bitsName(unit)}: a lower-case b is a bit. For ${bitsName(unit).replace(/bits$/, 'bytes')} write ${byteSymbol(unit)}.`,
    );
  const q: Quantity = {
    bits: mul(number.value, ratio(factorOf(unit, reading))),
    rate: unit.rate,
    unit,
    number: number.value,
    written: number.written,
    numberEnd: number.end,
    unitStart: k,
  };
  return { ok: true, value: q, notes, reading: readingLine(q, reading, digits) };
};
