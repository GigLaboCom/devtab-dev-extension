/**
 * Reading a cron expression (docs/tools/specs/cron.md §5.1–§5.3, §6, §9): the dialect and the number of fields, every
 * field into the set of values it selects (or a special day), the day-of-month / day-of-week rule, and the seven-field
 * normal form the description is made from. Errors say what is wrong and where (a 0-based offset into the input as
 * typed); the component writes them as "Column N: …".
 *
 * Linear in the input: the fields are split by a scan, never by a regular expression with repetition, and every
 * expression below is anchored and bounded by the field it tests.
 */

export type Dialect = 'unix' | 'seconds' | 'quartz';
export type DialectOption = 'auto' | Dialect;

/** §12: longer input is refused by the component before it reaches the logic. */
export const MAX_INPUT = 1000;
/** §5.8: the Gregorian calendar with its weekdays repeats every 400 years (146 097 days). */
export const HORIZON_YEARS = 400;
export const RUN_COUNTS = [5, 10, 20, 50] as const;

export type DomSpec =
  | { kind: 'set'; days: ReadonlySet<number> }
  | { kind: 'last'; offset: number } // L, L-n
  | { kind: 'lastWeekday' } // LW
  | { kind: 'nearestWeekday'; day: number }; // nW
export type DowSpec =
  | { kind: 'set'; days: ReadonlySet<number> } // 0 = Sunday … 6 = Saturday, whatever the dialect
  | { kind: 'last'; day: number } // 5L
  | { kind: 'nth'; day: number; n: number }; // 1#2

export type CronNote = 'or' | 'and-star' | 'quartz-dow-numbers' | 'seconds-dow-numbers';

export interface ParsedCron {
  dialect: Dialect;
  /** How it was read: macro, crontab line, number of fields. */
  readAs: { macro?: string; crontabLine: boolean; fields: number };
  seconds: ReadonlySet<number>;
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  dom: DomSpec;
  months: ReadonlySet<number>;
  dow: DowSpec;
  /** null = any year. */
  years: ReadonlySet<number> | null;
  /** §5.3: 'dom' / 'dow' for Quartz. */
  dayRule: 'or' | 'and' | 'dom' | 'dow';
  /** §5.5: neither the minute nor the hour field starts with *. */
  fixedTime: boolean;
  /** §5.6: seven fields for cronstrue. */
  normalized: string;
  notes: CronNote[];
}

export type ParseResult =
  | { ok: true; cron: ParsedCron }
  | { ok: false; message: string; /** 0-based in the original input. */ offset?: number };

/** §5.1: the macros cron knows, as five Unix fields. */
export const MACROS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface Token {
  text: string;
  offset: number;
}

class CronError extends Error {
  constructor(
    message: string,
    readonly offset?: number,
  ) {
    super(message);
  }
}

/** The fields: runs of anything but spaces and tabs, with where each starts. */
export const splitFields = (input: string): Token[] => {
  const out: Token[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    while (i < n && (input[i] === ' ' || input[i] === '\t')) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && input[i] !== ' ' && input[i] !== '\t') i++;
    out.push({ text: input.slice(start, i), offset: start });
  }
  return out;
};

/** The edges trimmed of any white space (a pasted line ends with one), the offsets kept. */
const trimmed = (input: string): { text: string; start: number } => {
  let start = 0;
  let end = input.length;
  while (start < end && /\s/.test(input[start]!)) start++;
  while (end > start && /\s/.test(input[end - 1]!)) end--;
  return { text: input.slice(start, end), start };
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: readonly string[];
  /** The value of the first name: JAN = 1, SUN = 0 (Unix) or 1 (Quartz). */
  nameBase?: number;
}

const SECOND: FieldSpec = { name: 'second', min: 0, max: 59 };
const MINUTE: FieldSpec = { name: 'minute', min: 0, max: 59 };
const HOUR: FieldSpec = { name: 'hour', min: 0, max: 23 };
const DOM: FieldSpec = { name: 'day of month', min: 1, max: 31 };
const MONTH: FieldSpec = { name: 'month', min: 1, max: 12, names: MONTHS, nameBase: 1 };
const DOW_UNIX: FieldSpec = { name: 'day of week', min: 0, max: 7, names: DAYS, nameBase: 0 };
const DOW_QUARTZ: FieldSpec = { name: 'day of week', min: 1, max: 7, names: DAYS, nameBase: 1 };
const YEAR: FieldSpec = { name: 'year', min: 1970, max: 2099 };

const DIGITS = /^\d+$/;
const QUESTION_ONLY_IN_DAYS = '? is allowed only in day of month and day of week';
const DOM_WHOLE = 'L and W must be the whole day-of-month field (L, L-3, LW, 15W)';
const DOW_WHOLE = 'L and # must be the whole day-of-week field (5L, FRIL, 1#2)';

/** One number or name of a field, as the field's value. */
const value = (text: string, offset: number, spec: FieldSpec): number => {
  if (DIGITS.test(text)) {
    const n = Number(text);
    if (n < spec.min || n > spec.max)
      throw new CronError(`${text} is out of range for ${spec.name} (${spec.min}–${spec.max})`, offset);
    return n;
  }
  const index = spec.names ? spec.names.indexOf(text.toUpperCase()) : -1;
  if (index >= 0) return index + spec.nameBase!;
  if (text === '?') throw new CronError(QUESTION_ONLY_IN_DAYS, offset);
  throw new CronError(`"${text}" is not valid in ${spec.name}`, offset);
};

/** §5.2: `*`, `a`, `a-b`, a step after `*`, `a-b` or `a` (`a/n` runs to the end of the field), joined by commas. */
const list = (text: string, offset: number, spec: FieldSpec, day: boolean): Set<number> => {
  const out = new Set<number>();
  let start = 0;
  for (;;) {
    const comma = text.indexOf(',', start);
    const item = text.slice(start, comma < 0 ? text.length : comma);
    const at = offset + start;
    if (item === '') throw new CronError('empty item in a list', at);
    if (item === '?') throw new CronError(day ? '? must be the whole field' : QUESTION_ONLY_IN_DAYS, at);
    const slash = item.indexOf('/');
    if (slash >= 0 && item.indexOf('/', slash + 1) >= 0) throw new CronError(`more than one / in "${item}"`, at);
    const base = slash >= 0 ? item.slice(0, slash) : item;
    let step = 1;
    if (slash >= 0) {
      const stepText = item.slice(slash + 1);
      if (!DIGITS.test(stepText) || Number(stepText) < 1)
        throw new CronError(`step "${stepText}" must be a whole number from 1`, at + slash + 1);
      step = Number(stepText);
    }
    let lo: number;
    let hi: number;
    if (base === '*') {
      lo = spec.min;
      hi = spec.max;
    } else if (base.includes('-')) {
      const dash = base.indexOf('-');
      const a = base.slice(0, dash);
      const b = base.slice(dash + 1);
      if (a === '' || b === '' || b.includes('-')) throw new CronError(`"${item}" is not a range`, at);
      lo = value(a, at, spec);
      hi = value(b, at + dash + 1, spec);
      if (lo > hi) throw new CronError(`range ${a}-${b} goes backwards`, at);
    } else if (base === '') {
      throw new CronError(`"${item}" is not valid in ${spec.name}`, at);
    } else {
      lo = value(base, at, spec);
      hi = slash >= 0 ? spec.max : lo;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
    if (comma < 0) return out;
    start = comma + 1;
  }
};

const range = (min: number, max: number): Set<number> => {
  const out = new Set<number>();
  for (let v = min; v <= max; v++) out.add(v);
  return out;
};

/** A field that is not a day: a list, never `?`, L, W or #. */
const plain = (token: Token, spec: FieldSpec): Set<number> => list(token.text, token.offset, spec, false);

/** §5.2: day of month — a list, `?`, or one of L, L-n, LW, nW as the whole field. */
const dayOfMonth = (token: Token): DomSpec => {
  const { text, offset } = token;
  const upper = text.toUpperCase();
  if (upper === '?') return { kind: 'set', days: range(1, 31) };
  if (!upper.includes('L') && !upper.includes('W')) return { kind: 'set', days: list(text, offset, DOM, true) };
  if (upper === 'L') return { kind: 'last', offset: 0 };
  if (upper === 'LW') return { kind: 'lastWeekday' };
  if (/^L-\d{1,9}$/.test(upper)) {
    const n = Number(upper.slice(2));
    if (n > 30) throw new CronError(`${text}: the offset must be 0–30`, offset);
    return { kind: 'last', offset: n };
  }
  if (/^\d{1,9}W$/.test(upper)) return { kind: 'nearestWeekday', day: value(text.slice(0, -1), offset, DOM) };
  throw new CronError(DOM_WHOLE, offset);
};

/** §5.2: day of week — a list, `?`, or one of nL, n#k as the whole field; always 0 = Sunday … 6 = Saturday. */
const dayOfWeek = (token: Token, dialect: Dialect): DowSpec => {
  const { text, offset } = token;
  const upper = text.toUpperCase();
  const spec = dialect === 'quartz' ? DOW_QUARTZ : DOW_UNIX;
  const day = (n: number): number => (dialect === 'quartz' ? n - 1 : n % 7);
  if (upper === '?') return { kind: 'set', days: range(0, 6) };
  if (upper === 'L') throw new CronError('L alone in day of week is ambiguous: write the day, e.g. 5L or FRIL', offset);
  const hash = upper.indexOf('#');
  if (hash >= 0) {
    if (/[,/\-L]/.test(upper)) throw new CronError(DOW_WHOLE, offset);
    const k = text.slice(hash + 1);
    if (k.includes('#')) throw new CronError(`"${text}" is not valid in day of week`, offset);
    const d = day(value(text.slice(0, hash), offset, spec));
    if (!DIGITS.test(k) || Number(k) < 1 || Number(k) > 5)
      throw new CronError(`#${k}: the week number must be 1–5`, offset + hash);
    return { kind: 'nth', day: d, n: Number(k) };
  }
  if (upper.includes('L')) {
    if (!upper.endsWith('L') || /[,/-]/.test(upper)) throw new CronError(DOW_WHOLE, offset);
    return { kind: 'last', day: day(value(text.slice(0, -1), offset, spec)) };
  }
  const days = new Set<number>();
  for (const v of list(text, offset, spec, true)) days.add(day(v));
  return { kind: 'set', days };
};

const startsWithStar = (text: string): boolean => text.startsWith('*');
const isAny = (text: string): boolean => text === '*' || text === '?';

/** Reads the fields of a dialect whose count is already right (5 Unix; 6 seconds; 6 or 7 Quartz). */
const readFields = (tokens: readonly Token[], dialect: Dialect, readAs: ParsedCron['readAs']): ParsedCron => {
  const withSeconds = dialect !== 'unix';
  const [second, minute, hour, dom, month, dow, year] = withSeconds ? tokens : [{ text: '0', offset: -1 }, ...tokens];
  const seconds = plain(second!, SECOND);
  const minutes = plain(minute!, MINUTE);
  const hours = plain(hour!, HOUR);
  const domSpec = dayOfMonth(dom!);
  const months = plain(month!, MONTH);
  const dowSpec = dayOfWeek(dow!, dialect);
  const years = year === undefined || year.text === '*' ? null : plain(year, YEAR);

  const domText = dom!.text;
  const dowText = dow!.text;
  let dayRule: ParsedCron['dayRule'];
  if (dialect === 'quartz') {
    const domAsk = domText === '?';
    const dowAsk = dowText === '?';
    if (!domAsk && !dowAsk) throw new CronError('Quartz needs ? in day of month or day of week', dom!.offset);
    if (domAsk && dowAsk)
      throw new CronError('Quartz allows ? in only one of day of month and day of week', dow!.offset);
    dayRule = dowAsk ? 'dom' : 'dow';
  } else {
    const restricted = (t: string): boolean => !startsWithStar(t) && t !== '?';
    dayRule = restricted(domText) && restricted(dowText) ? 'or' : 'and';
  }

  const notes: CronNote[] = [];
  if (dayRule === 'or') notes.push('or');
  if (dayRule === 'and') {
    const starred = (a: string, b: string): boolean => startsWithStar(a) && !isAny(a) && !isAny(b);
    if (starred(domText, dowText) || starred(dowText, domText)) notes.push('and-star');
  }
  const dowDigits = /\d/.test(dowText);
  if (dialect === 'quartz' && dowDigits) notes.push('quartz-dow-numbers');
  if (dialect === 'seconds' && dowDigits) notes.push('seconds-dow-numbers');

  const normalized = [second!.text, minute!.text, hour!.text, domText, month!.text, dowText, year?.text ?? '*']
    .join(' ')
    .toUpperCase();

  return {
    dialect,
    readAs,
    seconds,
    minutes,
    hours,
    dom: domSpec,
    months,
    dow: dowSpec,
    years,
    dayRule,
    fixedTime: !startsWithStar(minute!.text) && !startsWithStar(hour!.text),
    normalized,
    notes,
  };
};

const attempt = (read: () => ParsedCron): ParseResult => {
  try {
    return { ok: true, cron: read() };
  } catch (error) {
    if (error instanceof CronError)
      return error.offset === undefined
        ? { ok: false, message: error.message }
        : { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
};

/** §5.1: anything but digits, `* ? , / # - L W` and three-letter month and day names — a command, not a field. */
const CRON_FIELD = /^(?:[0-9*?,/#LW-]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT)+$/i;
export const looksLikeCronField = (text: string): boolean => text.length <= 200 && CRON_FIELD.test(text);

/** §5.1 item 5: the first five fields are Unix cron and the sixth is a command (or a user name). */
const crontabLine = (tokens: readonly Token[]): ParseResult | null => {
  if (tokens.length < 6 || looksLikeCronField(tokens[5]!.text)) return null;
  const five = attempt(() => readFields(tokens.slice(0, 5), 'unix', { crontabLine: true, fields: 5 }));
  return five.ok ? five : null;
};

const fieldCount = (n: number): ParseResult => ({ ok: false, message: `Expected 5, 6 or 7 fields, found ${n}.` });

const macro = (tokens: readonly Token[], whole: string): ParseResult => {
  const name = tokens[0]!.text.toLowerCase();
  if (name === '@reboot')
    return { ok: false, message: '@reboot runs once when cron starts; it has no schedule to show.' };
  const fields = MACROS[name];
  if (!fields) return { ok: false, message: `Unknown macro ${whole}.` };
  // A crontab line may start with a macro: what follows it is the command.
  const expanded = splitFields(fields).map(t => ({ text: t.text, offset: tokens[0]!.offset }));
  return attempt(() => readFields(expanded, 'unix', { macro: name, crontabLine: tokens.length > 1, fields: 5 }));
};

/**
 * §5.1: reads the expression in the dialect chosen, or picks one (Auto): a macro; 5 fields — Unix; 6 — Quartz when the
 * day of month or the day of week is exactly `?`, otherwise with seconds; 7 — Quartz; a crontab line when that fails and
 * the sixth field is a command. Errors carry the offset of the field or item at fault in `input` as typed.
 */
export const parseCron = (input: string, dialect: DialectOption): ParseResult => {
  const { text: whole, start } = trimmed(input);
  const tokens = splitFields(whole).map(t => ({ text: t.text, offset: t.offset + start }));
  const n = tokens.length;
  if (n > 0 && tokens[0]!.text.startsWith('@')) return macro(tokens, whole);
  const read = (d: Dialect): ParseResult => attempt(() => readFields(tokens, d, { crontabLine: false, fields: n }));

  if (dialect === 'unix') {
    if (n === 5) return read('unix');
    return crontabLine(tokens) ?? { ok: false, message: `Unix cron needs 5 fields, found ${n}.` };
  }
  if (dialect === 'seconds')
    return n === 6 ? read('seconds') : { ok: false, message: `Cron with seconds needs 6 fields, found ${n}.` };
  if (dialect === 'quartz')
    return n === 6 || n === 7 ? read('quartz') : { ok: false, message: `Quartz needs 6 or 7 fields, found ${n}.` };

  if (n === 5) return read('unix');
  if (n === 6 || n === 7) {
    const quartz = n === 7 || tokens[5]!.text === '?' || tokens[3]!.text === '?';
    const result = read(quartz ? 'quartz' : 'seconds');
    return result.ok ? result : (crontabLine(tokens) ?? result);
  }
  if (n > 7) return crontabLine(tokens) ?? fieldCount(n);
  return fieldCount(n);
};
