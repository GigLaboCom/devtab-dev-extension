/**
 * Transfer time (docs/tools/specs/data-units.md §5 items 15–18): size ÷ rate → a duration in words, and the reverse —
 * size and time → rate, rate and time → size — with an optional share of the rate lost to overhead. Exact fractions to
 * the end; only the words and the shown digits round, and say so.
 */
import { MAX_TEXT, describeChar, errorText, parseValue } from './parse';
import {
  ONE,
  add,
  compare,
  div,
  fractionText,
  groupDigits,
  isZero,
  mul,
  power,
  ratio,
  roundHalfUp,
  showNumber,
  sub,
  terminates,
} from './ratio';
import { ladder } from './units';
import type { TextError } from './parse';
import type { Digits, Ratio } from './ratio';
import type { LadderSection, Reading } from './units';

export type Solve = 'time' | 'rate' | 'size';
export const SOLVES: readonly Solve[] = ['time', 'rate', 'size'];

export const TIME_MESSAGES = {
  tooLong: `The time is longer than ${MAX_TEXT} characters.`,
  negative: 'A time is never negative.',
  noNumber: 'Enter a number before the unit, as in 1 h 30 min.',
  clock: 'Write h:mm:ss (0:01:30), or 1 min 30 s.',
  clockRange: 'Minutes and seconds in h:mm:ss are 00 to 59.',
  unitAfter: 'Write a unit after each number: 1 h 30 min.',
  noUnit: 'No unit: read as seconds.',
  overhead: 'Overhead is a percentage from 0 to below 100.',
  sizeIsRate: 'This is a rate: Size takes a size, as in 4.7 GB.',
  rateIsSize: 'This is a size: Rate takes a rate, as in 100 Mbps or 12.5 MB/s.',
  rateNoUnit: 'Write the rate with its unit, as in 100 Mbps or 12.5 MB/s.',
  zeroRate: 'A rate of 0 never finishes the transfer: enter a rate above 0.',
  zeroTime: 'No rate moves data in 0 seconds: enter a time above 0.',
} as const;

const TIME_UNITS: Record<string, { id: string; seconds: Ratio }> = {};
for (const [id, seconds, names] of [
  ['d', ratio(86_400n), ['d', 'day', 'days']],
  ['h', ratio(3_600n), ['h', 'hr', 'hrs', 'hour', 'hours']],
  ['min', ratio(60n), ['m', 'min', 'mins', 'minute', 'minutes']],
  ['s', ratio(1n), ['s', 'sec', 'secs', 'second', 'seconds']],
  ['ms', ratio(1n, 1_000n), ['ms', 'millisecond', 'milliseconds']],
] as const)
  for (const name of names) TIME_UNITS[name] = { id, seconds };

const decimalOf = (digits: string): Ratio => {
  const [whole, fraction = ''] = digits.split(/[.,]/);
  return ratio(BigInt(whole + fraction), power(10n, fraction.length));
};

export type DurationResult = { ok: true; seconds: Ratio; notes: string[] } | { ok: false; error: TextError };

/** A duration (§5 item 15): parts `1 h 30 min`, a clock `1:30:00`, or seconds alone; null for an empty field. */
export const parseDuration = (text: string): DurationResult | null => {
  if (text.trim() === '') return null;
  const fail = (message: string, start: number): DurationResult => ({ ok: false, error: { message, start } });
  if (text.length > MAX_TEXT) return fail(TIME_MESSAGES.tooLong, -1);
  const start = text.length - text.trimStart().length;
  const body = text.trim();
  if (body[0] === '-' || body[0] === '\u{2212}') return fail(TIME_MESSAGES.negative, start);
  if (body.includes(':')) {
    const clock = /^([0-9]+):([0-9]{2}):([0-9]{2})(?:[.,]([0-9]+))?$/.exec(body);
    if (!clock) return fail(TIME_MESSAGES.clock, start);
    if (clock[2] >= '60' || clock[3] >= '60') return fail(TIME_MESSAGES.clockRange, start);
    const seconds = decimalOf(`${clock[3]}.${clock[4] ?? '0'}`);
    const whole = ratio(BigInt(clock[1]) * 3_600n + BigInt(clock[2]) * 60n);
    return { ok: true, seconds: add(whole, seconds), notes: [] };
  }
  if (/^[0-9]+(?:[.,][0-9]+)?$/.test(body))
    return { ok: true, seconds: decimalOf(body), notes: [TIME_MESSAGES.noUnit] };
  let total = ratio(0n);
  const seen = new Set<string>();
  let i = 0;
  while (i < body.length) {
    while (/\s/u.test(body[i] ?? '')) i++;
    if (i >= body.length) break;
    const number = /^[0-9]+(?:[.,][0-9]+)?/.exec(body.slice(i));
    if (!number) {
      if (/^[A-Za-z]$/.test(body[i])) return fail(TIME_MESSAGES.noNumber, start + i);
      const ch = String.fromCodePoint(body.codePointAt(i) ?? 0);
      return fail(`Unexpected ${describeChar(ch)}: write a duration such as 1 h 30 min.`, start + i);
    }
    const numberAt = i;
    i += number[0].length;
    while (/\s/u.test(body[i] ?? '')) i++;
    const word = /^[A-Za-z]+/.exec(body.slice(i));
    if (!word) {
      if (i >= body.length) return fail(TIME_MESSAGES.unitAfter, start + numberAt);
      const ch = String.fromCodePoint(body.codePointAt(i) ?? 0);
      return fail(`Unexpected ${describeChar(ch)}: write a duration such as 1 h 30 min.`, start + i);
    }
    const unit = TIME_UNITS[word[0].toLowerCase()];
    if (!unit)
      return fail(`Unknown time unit "${word[0]}": use d, h, min, s or ms (1 h 30 min), or h:mm:ss.`, start + i);
    if (seen.has(unit.id)) return fail(`"${word[0]}" appears twice.`, start + i);
    seen.add(unit.id);
    total = add(total, mul(decimalOf(number[0]), unit.seconds));
    i += word[0].length;
  }
  return { ok: true, seconds: total, notes: [] };
};

/** The share of the rate lost to overhead, 0 ≤ p < 100 (§5 item 16); an empty field is 0. */
export const parseOverhead = (text: string): { ok: true; percent: Ratio } | { ok: false; error: TextError } => {
  const body = text.trim().replace(/\s*%$/, '');
  if (body === '') return { ok: true, percent: ratio(0n) };
  const start = text.length - text.trimStart().length;
  if (!/^[0-9]+(?:[.,][0-9]+)?$/.test(body)) return { ok: false, error: { message: TIME_MESSAGES.overhead, start } };
  const percent = decimalOf(body);
  if (compare(percent, ratio(100n)) >= 0) return { ok: false, error: { message: TIME_MESSAGES.overhead, start } };
  return { ok: true, percent };
};

const SECONDS_PER_YEAR = 31_557_600n; // a Julian year, 365.25 days (§5 item 18)

export interface DurationText {
  words: string;
  clock: string;
  rounded: boolean;
}

const plural = (n: string, unit: string): string => `${n} ${unit}${n === '1' ? '' : 's'}`;

/** A duration in words and as h:mm:ss (§5 item 18). */
export const durationText = (seconds: Ratio, digits: Digits): DurationText => {
  if (isZero(seconds)) return { words: '0 seconds', clock: '0:00:00', rounded: false };
  const ms = roundHalfUp(mul(seconds, ratio(1_000n)));
  const rounded = mul(seconds, ratio(1_000n)).den !== 1n;
  const mark = rounded ? '≈ ' : '';
  const hours = ms / 3_600_000n;
  const mm = ((ms / 60_000n) % 60n).toString().padStart(2, '0');
  const ss = ((ms / 1_000n) % 60n).toString().padStart(2, '0');
  const fff = ms % 1_000n;
  const clock = `${mark}${hours}:${mm}:${ss}${fff ? `.${fff.toString().padStart(3, '0')}` : ''}`;
  if (compare(seconds, ONE) < 0) {
    const shown = showNumber(seconds, digits);
    const under = compare(seconds, ratio(1n, 1_000n)) < 0 ? ' (under a millisecond)' : '';
    return { words: `${shown.text} seconds${under}`, clock, rounded: shown.rounded || rounded };
  }
  const days = ms / 86_400_000n;
  const h = (ms / 3_600_000n) % 24n;
  const min = (ms / 60_000n) % 60n;
  const s = (ms / 1_000n) % 60n;
  const secText = fff ? `${s}.${fff.toString().padStart(3, '0').replace(/0+$/, '')}` : `${s}`;
  const parts: string[] = [];
  if (days) parts.push(plural(groupDigits(days.toString()), 'day'));
  if (h) parts.push(plural(h.toString(), 'hour'));
  if (min) parts.push(plural(min.toString(), 'minute'));
  if (s || fff) parts.push(plural(secText, 'second'));
  let words = `${mark}${parts.join(' ')}`;
  if (compare(seconds, ratio(SECONDS_PER_YEAR)) >= 0) {
    const tenths = roundHalfUp(div(mul(seconds, ratio(10n)), ratio(SECONDS_PER_YEAR)));
    const years = `${groupDigits((tenths / 10n).toString())}${tenths % 10n ? `.${tenths % 10n}` : ''}`;
    words += ` (about ${years} year${years === '1' ? '' : 's'})`;
  }
  return { words, clock, rounded };
};

export interface TransferFields {
  solve: Solve;
  size: string;
  rate: string;
  time: string;
  overhead: string;
}

export interface FieldReport {
  error?: string;
  notes: string[];
  reading?: string;
}

export interface ResultLine {
  id: string;
  label: string;
  value: string;
  copy: string;
}

export type TransferResult =
  | { kind: 'time'; rows: ResultLine[]; words: string }
  | { kind: 'ladder'; title: string; sections: LadderSection[]; rows: ResultLine[]; rate: boolean; bits: Ratio };

export interface TransferAnswer {
  fields: Partial<Record<'size' | 'rate' | 'time' | 'overhead', FieldReport>>;
  result: TransferResult | null;
}

/**
 * Solves for the field `solve` from the other two (§5 item 17): field reports under each input (an error, notes, the
 * reading line) and, when both inputs read, the result.
 */
export const solveTransfer = (fields: TransferFields, reading: Reading, digits: Digits): TransferAnswer => {
  const answer: TransferAnswer = { fields: {}, result: null };
  let size: Ratio | null = null;
  let rate: Ratio | null = null;
  let rateUnit: { number: Ratio; written: string } | null = null;
  let time: Ratio | null = null;

  if (fields.solve !== 'size') {
    const parsed = parseValue(fields.size, reading, digits);
    if (parsed) {
      if (!parsed.ok) answer.fields.size = { error: errorText(parsed.error), notes: [] };
      else if (parsed.value.rate)
        answer.fields.size = {
          error: errorText({ message: TIME_MESSAGES.sizeIsRate, start: parsed.value.unitStart }),
          notes: [],
        };
      else {
        answer.fields.size = { notes: parsed.notes, ...(parsed.reading ? { reading: parsed.reading } : {}) };
        size = parsed.value.bits;
      }
    }
  }
  if (fields.solve !== 'rate') {
    const parsed = parseValue(fields.rate, reading, digits);
    if (parsed) {
      if (!parsed.ok) answer.fields.rate = { error: errorText(parsed.error), notes: [] };
      else if (!parsed.value.unit)
        answer.fields.rate = {
          error: errorText({ message: TIME_MESSAGES.rateNoUnit, start: parsed.value.numberEnd }),
          notes: [],
        };
      else if (!parsed.value.rate)
        answer.fields.rate = {
          error: errorText({ message: TIME_MESSAGES.rateIsSize, start: parsed.value.unitStart }),
          notes: [],
        };
      else {
        answer.fields.rate = { notes: parsed.notes, ...(parsed.reading ? { reading: parsed.reading } : {}) };
        rate = parsed.value.bits;
        rateUnit = { number: parsed.value.number, written: parsed.value.unit.written };
      }
    }
  }
  if (fields.solve !== 'time') {
    const parsed = parseDuration(fields.time);
    if (parsed) {
      if (!parsed.ok) answer.fields.time = { error: errorText(parsed.error), notes: [] };
      else {
        answer.fields.time = { notes: parsed.notes };
        time = parsed.seconds;
      }
    }
  }
  const overhead = parseOverhead(fields.overhead);
  if (!overhead.ok) answer.fields.overhead = { error: errorText(overhead.error), notes: [] };
  const share = overhead.ok ? div(sub(ratio(100n), overhead.percent), ratio(100n)) : null;
  if (!share) return answer;
  const lossy = compare(share, ONE) !== 0;
  const effectiveRow = (): ResultLine[] => {
    if (!lossy || !rateUnit) return [];
    const shown = showNumber(mul(rateUnit.number, share), digits);
    return [
      {
        id: 'effective',
        label: 'Effective rate',
        value: `${shown.text} ${rateUnit.written}`,
        copy: shown.copy,
      },
    ];
  };

  if (fields.solve === 'time' && size && rate) {
    if (isZero(rate)) {
      answer.fields.rate = { ...answer.fields.rate, notes: [], error: TIME_MESSAGES.zeroRate };
      return answer;
    }
    const seconds = div(size, mul(rate, share));
    const text = durationText(seconds, digits);
    const shown = showNumber(seconds, digits);
    const rows: ResultLine[] = [
      { id: 'time', label: 'Time', value: text.words, copy: text.words.replace(/^≈ /, '') },
      { id: 'seconds', label: 'Seconds', value: shown.text, copy: shown.copy },
      { id: 'clock', label: 'h:mm:ss', value: text.clock, copy: text.clock.replace(/^≈ /, '') },
    ];
    if (shown.rounded) {
      const exact = terminates(seconds) ? showNumber(seconds, 'exact').copy : fractionText(seconds);
      rows.push({ id: 'exact', label: 'Exact', value: `${exact} seconds`, copy: exact });
    }
    rows.push(...effectiveRow());
    answer.result = { kind: 'time', rows, words: text.words };
  } else if (fields.solve === 'rate' && size && time) {
    if (isZero(time)) {
      answer.fields.time = { notes: [], error: TIME_MESSAGES.zeroTime };
      return answer;
    }
    const bits = div(div(size, time), share);
    const rows: ResultLine[] = terminates(bits)
      ? []
      : [{ id: 'exact', label: 'Exact', value: `${fractionText(bits)} bit/s`, copy: fractionText(bits) }];
    answer.result = {
      kind: 'ladder',
      title: 'Rate needed',
      sections: ladder(bits, true, 'bit', digits),
      rows,
      rate: true,
      bits,
    };
  } else if (fields.solve === 'size' && rate && time) {
    const bits = mul(mul(rate, share), time);
    answer.result = {
      kind: 'ladder',
      title: 'Size moved',
      sections: ladder(bits, false, 'byte', digits),
      rows: effectiveRow(),
      rate: false,
      bits,
    };
  }
  return answer;
};
