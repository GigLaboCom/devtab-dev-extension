/**
 * `detectDateCalc` (docs/tools/specs/date-calc.md §7) and where handed-over text goes (§3), in a module that imports
 * nothing: a host loads every tool's `detect` in one lazy chunk when pasted text needs it.
 *
 * A single timestamp or ISO date still opens Unix Time (earlier in the registry); this tool says yes only to what Unix
 * Time does not take and only this tool needs: an ISO 8601 duration (`P3DT4H`), or two moments on two lines.
 */

const MAX_DURATION = 64;
const MAX_PAIR = 200;

/** Upper-case designators only, at least one field, a field after T, a fraction only on seconds. */
const DURATION =
  /^[+-]?P(?:\d{1,20}Y)?(?:\d{1,20}M)?(?:\d{1,20}W)?(?:\d{1,20}D)?(?:T(?:\d{1,20}H)?(?:\d{1,20}M)?(?:\d{1,20}(?:[.,]\d{1,9})?S)?)?$/;

const SECONDS = /^1\d{9}(?:\.\d{1,9})?$/;
const MILLISECONDS = /^1\d{12}$/;
const DATE_PART = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
const DATE = new RegExp(`^${DATE_PART}$`);
/** The ISO date-time Unix Time recognises: seconds and a zone required, at most one element in brackets. */
const DATE_TIME = new RegExp(
  `^${DATE_PART}[T ](?:[01]\\d|2[0-3]):[0-5]\\d:(?:[0-5]\\d|60)(?:\\.\\d{1,9})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)(?:\\[[^\\[\\]]{1,40}\\])?$`,
);

const isDuration = (t: string): boolean =>
  t.length <= MAX_DURATION && DURATION.test(t) && /P(?:T?)\d/.test(t) && !/T$/.test(t);

const leap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const realDate = (t: string): boolean => {
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const d = Number(t.slice(8, 10));
  const length = m === 2 ? (leap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return d <= length;
};

const isMoment = (t: string): boolean =>
  SECONDS.test(t) || MILLISECONDS.test(t) || (DATE.test(t) && realDate(t)) || (DATE_TIME.test(t) && realDate(t));

/** The two lines of a pair of moments, or null. */
const pairOf = (t: string): [string, string] | null => {
  if (t.length > MAX_PAIR) return null;
  const lines = t.split(/\r?\n/);
  if (lines.length !== 2) return null;
  const [first, second] = lines.map(line => line.trim()) as [string, string];
  return isMoment(first) && isMoment(second) ? [first, second] : null;
};

/** §7: an ISO 8601 duration, or two moments on two lines. */
export const detectDateCalc = (text: string): boolean => {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_PAIR) return false;
  return isDuration(t) || pairOf(t) !== null;
};

/** §3: where text handed over from the start page goes. */
export type Handed =
  | { part: 'add'; duration: string }
  | { part: 'difference'; from: string; to: string }
  | { part: 'zones'; moment: string };

/**
 * A duration goes to Add or subtract, two moments to Difference; anything else (one moment, or text detect would not
 * have taken) to the moment of Time zones, where it is read or refused like a typed one.
 */
export const handOver = (text: string): Handed => {
  const t = text.trim();
  if (/^[+-]?[Pp]/.test(t) && !t.includes('\n')) return { part: 'add', duration: t };
  const lines = t.split(/\r?\n/).map(line => line.trim());
  if (lines.length === 2 && lines[0] && lines[1]) return { part: 'difference', from: lines[0], to: lines[1] };
  return { part: 'zones', moment: t };
};
