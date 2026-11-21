/**
 * `detectUnixTime` (docs/tools/specs/unix-time.md §7) in a module of its own: the tool's definition imports it into
 * every host page that lists the tools, so it imports nothing — parsing, zones and Intl load with the component.
 */

const MAX_DETECT = 64;
/** 10 digits from 1: seconds 2001-09-09T01:46:40Z … 2033-05-18T03:33:19Z, an optional fraction of 1–9 digits. */
const SECONDS = /^1\d{9}(?:\.\d{1,9})?$/;
/** 13 digits from 1: milliseconds of the same span. */
const MILLISECONDS = /^1\d{12}$/;
const DATE = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d:(?:[0-5]\\d|60)';
/** ISO 8601 date-time with seconds and a zone, an optional fraction and at most one element in brackets. */
const ISO = new RegExp(
  `^${DATE}[T ]${TIME}(?:\\.\\d{1,9})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)(?:\\[[^\\[\\]]{1,40}\\])?$`,
);
/** IMF-fixdate or RFC 2822 with the day of the week and seconds. */
const MAIL = new RegExp(
  `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:0?[1-9]|[12]\\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4} ${TIME} (?:GMT|[+-]\\d{4})$`,
);

/**
 * Does pasted text look like one instant this tool reads (§7)? Strict on purpose — the first tool that says yes opens
 * without a question: a 10- or 13-digit number starting with 1 (US phone numbers cannot start with 0 or 1), an ISO
 * date-time with seconds and a zone, or a mail / HTTP date with its weekday. A date alone is not recognised.
 */
export const detectUnixTime = (text: string): boolean => {
  const t = text.trim();
  if (t.length < 10 || t.length > MAX_DETECT) return false;
  return SECONDS.test(t) || MILLISECONDS.test(t) || ISO.test(t) || MAIL.test(t);
};
