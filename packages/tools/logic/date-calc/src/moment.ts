/**
 * What a moment field reads (docs/tools/specs/date-calc.md §5.1–§5.3): a Unix timestamp in seconds or milliseconds, or
 * ISO 8601 / RFC 3339 — a date, a date and time without a zone (read on the clocks of the zone beside the field), with an
 * offset or Z, with a zone in RFC 9557 brackets. Whole milliseconds; finer digits are dropped with a note. Wall times go
 * to an instant by the shared `wallTimeToEpochMs` (Temporal's `compatible`), and the page says what happened in a gap or
 * an overlap.
 */
import {
  DAY_MS,
  MAX_INPUT,
  OUT_OF_RANGE,
  dateText,
  daysInMonth,
  inRange,
  isoIn,
  lengthWords,
  localMs,
  localOf,
  monthName,
  two,
  weekdayOfDay,
} from './clock';
import {
  formatIsoInZone,
  formatOffset,
  resolveTimeZone,
  wallTimeToEpochMs,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';

/** A moment and the zone it is read, counted and shown in (the picker's, or the one in brackets). */
export interface Moment {
  epochMs: number;
  zone: string;
}

export type MomentResult =
  | { ok: true; empty: true }
  | { ok: true; empty: false; moment: Moment; readAs: string; notes: string[] }
  | { ok: false; message: string };

export const TOO_LONG_MOMENT = 'Too long for a moment (more than 200 characters).';
export const FINER_DROPPED = 'Digits finer than 1 millisecond were dropped.';
export const LEAP_SECOND =
  'Second 60 (a leap second) has no Unix time of its own: read as the next second, as POSIX does.';
export const SLASHED = 'Dates with / or . are not read: write YYYY-MM-DD.';
export const NOT_A_MOMENT =
  'Not a moment this tool reads. Write 2024-03-31, 2024-03-31T14:30, 2024-03-31T14:30:00Z or a Unix timestamp such as 1711895400.';
export const YEAR_ZERO = 'Year -000000 is not allowed: write 0000.';
export const HOURS = 'Hours go from 00 to 23.';
export const MINUTES = 'Minutes go from 00 to 59.';
export const SECONDS = 'Seconds go from 00 to 59.';

const fail = (message: string): MomentResult => ({ ok: false, message });

const NUMBER = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const ISO =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?)?((?:\[[^[\]]*\])*)$/;
/** Day, month and year with / or . in any order — refused with its own text. */
const SLASHED_DATE = /^\d{1,4}[/.]\d{1,2}[/.]\d{1,4}$/;

const strip = (text: string): string => {
  const t = text.trim();
  const quoted = t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0];
  return quoted ? t.slice(1, -1).trim() : t;
};

const floorDiv = (a: bigint, b: bigint): bigint => {
  const r = ((a % b) + b) % b;
  return (a - r) / b;
};

const readAsLine = (epochMs: number, zone: string): string =>
  `${isoIn(epochMs, zone)} (${weekdayOfDay(Math.floor(localMs(epochMs, zone) / DAY_MS))})`;

/** §5.2 п. 1: 1–11 digits are seconds, 12–14 milliseconds; a fraction is floored to the millisecond. */
const readNumber = (sign: string, whole: string, fraction: string | undefined, zone: string): MomentResult => {
  const digits = whole.replace(/^0+(?=\d)/, '').length;
  if (digits >= 15)
    return fail(`${digits} digits: microseconds and nanoseconds are not read here. Unix Time reads them.`);
  const unit = digits <= 11 ? 1000n : 1n;
  const frac = fraction ?? '';
  const scale = 10n ** BigInt(frac.length);
  const numerator = (BigInt(whole) * scale + (frac ? BigInt(frac) : 0n)) * unit * (sign === '-' ? -1n : 1n);
  const ms = floorDiv(numerator, scale);
  if (ms > 8_640_000_000_000_000n || ms < -8_640_000_000_000_000n) return fail(OUT_OF_RANGE);
  const epochMs = Number(ms);
  const notes: string[] = [];
  if (numerator % scale !== 0n) notes.push(FINER_DROPPED);
  if (!sign && !fraction && whole.length === 8) {
    const y = Number(whole.slice(0, 4));
    const m = Number(whole.slice(4, 6));
    const d = Number(whole.slice(6, 8));
    if (y >= 1900 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m))
      notes.push(
        `If this is a date (${whole.slice(0, 4)}-${whole.slice(4, 6)}-${whole.slice(6, 8)}), write it with dashes.`,
      );
  }
  if (!sign && !fraction && whole.length === 4) notes.push(`If this is a year, write ${whole}-01-01.`);
  const name = unit === 1000n ? 'seconds' : 'milliseconds';
  return {
    ok: true,
    empty: false,
    moment: { epochMs, zone },
    readAs: `Read as Unix ${name} (${digits} digit${digits === 1 ? '' : 's'}): ${readAsLine(epochMs, zone)}.`,
    notes,
  };
};

/** "+05:30" → ms; null when out of range (the error names the offset as written). */
const offsetOf = (text: string): number | null => {
  if (text === 'Z' || text === 'z') return 0;
  const sign = text[0] === '-' ? -1 : 1;
  const digits = text.slice(1).replace(':', '');
  const h = Number(digits.slice(0, 2));
  const m = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (h > 23 || m > 59) return null;
  return sign * (h * 3600 + m * 60) * 1000;
};

/** The note of a wall time that fell into a gap or an overlap (§5.2); `verb` is "Read as" or "The result is". */
export const wallNotes = (
  resolution: NonNullable<ReturnType<typeof wallTimeToEpochMs>>,
  zone: string,
  date: string,
  clock: string,
  part: 'moment' | 'result',
): string[] => {
  if (resolution.kind === 'gap')
    return [
      `${clock} does not exist in ${zone} on ${date}: the clocks moved forward by ${lengthWords(resolution.shiftMs)}. ${
        part === 'moment' ? 'Read as' : 'The result is'
      } ${isoIn(resolution.epochMs, zone)}.`,
    ];
  if (resolution.kind === 'overlap') {
    const first = formatOffset(zoneOffsetMs(resolution.epochMs, zone));
    const second = isoIn(resolution.laterEpochMs, zone);
    return [
      `${clock} happens twice in ${zone} on ${date}: the clocks moved back by ${lengthWords(resolution.shiftMs)}. ${
        part === 'moment'
          ? `Read as the first (${first}); for the second, write ${second}.`
          : `The result is the first (${first}); the second is ${second}.`
      }`,
    ];
  }
  return [];
};

/** §5.2: what the field holds, read in `zone` unless the text names its own. */
export const parseMoment = (text: string, zone: string): MomentResult => {
  const t = strip(text);
  if (t === '') return { ok: true, empty: true };
  if (t.length > MAX_INPUT) return fail(TOO_LONG_MOMENT);

  const number = NUMBER.exec(t);
  if (number) return readNumber(number[1]!, number[2]!, number[3], zone);

  const iso = ISO.exec(t);
  if (!iso) return fail(SLASHED_DATE.test(t) ? SLASHED : NOT_A_MOMENT);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, offsetText, tail] = iso;
  if (yearText === '-000000') return fail(YEAR_ZERO);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) return fail(`Month ${monthText} does not exist.`);
  if (day < 1 || day > daysInMonth(year, month))
    return fail(
      day < 1
        ? `Day ${dayText} does not exist.`
        : `${yearText}-${monthText}-${dayText} is not a date: ${monthName(month)} ${yearText} has ${daysInMonth(year, month)} days.`,
    );
  const hour = Number(hourText ?? 0);
  const minute = Number(minuteText ?? 0);
  const second = Number(secondText ?? 0);
  if (hour > 23) return fail(HOURS);
  if (minute > 59) return fail(MINUTES);
  if (second > 60) return fail(SECONDS);

  const notes: string[] = [];
  const frac = fraction ?? '';
  const ms = Number(frac.slice(0, 3).padEnd(3, '0'));
  if (/[1-9]/.test(frac.slice(3))) notes.push(FINER_DROPPED);
  if (second === 60) notes.push(LEAP_SECOND);

  // RFC 9557 brackets: the first element without "=" names the zone; "!" is dropped; the others are skipped.
  let bracketZone: string | null = null;
  for (const element of (tail ?? '').match(/\[[^[\]]*\]/g) ?? []) {
    const inner = element.slice(1, -1).replace(/^!/, '');
    if (inner.includes('=')) continue;
    const resolved = resolveTimeZone(inner);
    if (!resolved) return fail(`Unknown time zone "${inner}".`);
    bracketZone = resolved;
    break;
  }
  const momentZone = bracketZone ?? zone;
  if (bracketZone && bracketZone !== zone) notes.push(`The zone in brackets is used: ${bracketZone}.`);

  const local = localOf(year, month, day, ((hour * 60 + minute) * 60 + second) * 1000 + ms);
  // Far outside the range: no zone can bring it back (offsets stay within a day).
  if (Math.abs(local) > 8.64e15 + 2 * DAY_MS) return fail(OUT_OF_RANGE);

  let epochMs: number;
  if (offsetText !== undefined) {
    const offset = offsetOf(offsetText);
    if (offset === null) return fail(`Offset ${offsetText} is out of range: offsets go up to ±23:59.`);
    epochMs = local - offset;
    if (!inRange(epochMs)) return fail(OUT_OF_RANGE);
    const numeric = offsetText !== 'Z' && offsetText !== 'z' && offsetText.replace(':', '') !== '-0000';
    if (bracketZone && numeric) {
      const real = zoneOffsetMs(epochMs, bracketZone);
      if (real !== offset)
        notes.push(
          `The offset ${formatOffset(offset)} does not match ${bracketZone} (${formatOffset(real)}) at that moment; the offset is used.`,
        );
    }
  } else {
    const resolution = wallTimeToEpochMs(local, momentZone);
    if (!resolution) return fail(OUT_OF_RANGE);
    epochMs = resolution.epochMs;
    const clock = `${two(hour)}:${two(minute)}${secondText !== undefined && second !== 0 ? `:${two(second)}` : ''}`;
    notes.push(...wallNotes(resolution, momentZone, dateText(Math.floor(local / DAY_MS)), clock, 'moment'));
  }
  if (!inRange(epochMs)) return fail(OUT_OF_RANGE);
  return {
    ok: true,
    empty: false,
    moment: { epochMs, zone: momentZone },
    readAs: `Read as ${readAsLine(epochMs, momentZone)}.`,
    notes,
  };
};

/** §5.9: the text Now writes — the current second, ISO 8601 in the field's zone. */
export const nowText = (nowMs: number, zone: string): string =>
  formatIsoInZone(BigInt(Math.floor(nowMs / 1000) * 1000) * 1_000_000n, zone);
