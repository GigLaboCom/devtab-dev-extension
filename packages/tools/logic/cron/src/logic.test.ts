/**
 * docs/tools/specs/cron.md §10 — every row is a test here (the row's input in the test name), then the rules of §5,
 * §6 and §7 the table does not show. "Now" is 2026-11-19T18:30:00Z (a Thursday) and the zone UTC unless a test says
 * otherwise; every zone is named, nothing depends on the machine's zone (the last block runs the daylight-saving rows
 * again under other machine zones).
 */
import { dayMatches } from './days';
import { describeCron } from './describe';
import { detectCron } from './detect';
import { MAX_INPUT, parseCron, RUN_COUNTS } from './parse';
import { formatRunWhen, gapEndMs, nextRuns, whyNoRuns } from './runs';
import { errorText, NOTE_TEXTS, noRunsText, readAsText, runsText } from './texts';
import { formatIsoUtc, wallTimeToEpochMs } from '@workspace/tools-shared/time';
import { toString as cronstrue } from 'cronstrue';
import { afterAll, describe, expect, it } from 'vitest';
import type { DialectOption, ParsedCron } from './parse';
import type { Run } from './runs';

const NOW = Date.UTC(2026, 10, 19, 18, 30);

const parse = (text: string, dialect: DialectOption = 'auto'): ParsedCron => {
  const r = parseCron(text, dialect);
  if (!r.ok) throw new Error(`${text}: ${errorText(text, r.message, r.offset)}`);
  return r.cron;
};
const error = (text: string, dialect: DialectOption = 'auto'): string => {
  const r = parseCron(text, dialect);
  if (r.ok) throw new Error(`${text}: no error`);
  return errorText(text, r.message, r.offset);
};
interface Options {
  dialect?: DialectOption;
  zone?: string;
  now?: number;
  count?: number;
}
const runs = (text: string, { dialect = 'auto', zone = 'UTC', now = NOW, count = 10 }: Options = {}): Run[] =>
  nextRuns(parse(text, dialect), now, zone, count);
/** The runs as §5.9 writes them, with their note when there is one. */
const when = (text: string, options: Options = {}): string[] => {
  const zone = options.zone ?? 'UTC';
  const cron = parse(text, options.dialect);
  return runs(text, options).map(
    run => formatRunWhen(run.epochMs, zone, cron.dialect !== 'unix') + (run.kind === 'normal' ? '' : ` ${run.kind}`),
  );
};
/** Just the dates of the runs: "2026-11-23". */
const dates = (text: string, options: Options = {}): string[] =>
  runs(text, options).map(run => formatIsoUtc(BigInt(run.epochMs) * 1_000_000n).slice(0, 10));
const describe_ = (text: string, dialect: DialectOption = 'auto'): string | null => describeCron(parse(text, dialect));
const at = (iso: string): number => Date.parse(iso);

describe('§10, Unix cron (5 fields) and macros', () => {
  it('* * * * *: Every minute; 18:31, 18:32, 18:33', () => {
    expect(parse('* * * * *')).toMatchObject({ dialect: 'unix', readAs: { crontabLine: false, fields: 5 } });
    expect(describe_('* * * * *')).toBe('Every minute');
    expect(when('* * * * *', { count: 3 })).toEqual([
      'Thu 2026-11-19 18:31 UTC',
      'Thu 2026-11-19 18:32 UTC',
      'Thu 2026-11-19 18:33 UTC',
    ]);
  });

  it('*/15 * * * *: Every 15 minutes; 18:45, 19:00, 19:15', () => {
    expect(describe_('*/15 * * * *')).toBe('Every 15 minutes');
    expect(when('*/15 * * * *', { count: 3 })).toEqual([
      'Thu 2026-11-19 18:45 UTC',
      'Thu 2026-11-19 19:00 UTC',
      'Thu 2026-11-19 19:15 UTC',
    ]);
  });

  it.each(['0 9 * * 1-5', '0 9 * * MON-FRI'])('%s: At 09:00, Monday through Friday; Fri 11-20 … Thu 11-26', text => {
    expect(describe_(text)).toBe('At 09:00, Monday through Friday');
    expect(when(text, { count: 5 })).toEqual([
      'Fri 2026-11-20 09:00 UTC',
      'Mon 2026-11-23 09:00 UTC',
      'Tue 2026-11-24 09:00 UTC',
      'Wed 2026-11-25 09:00 UTC',
      'Thu 2026-11-26 09:00 UTC',
    ]);
  });

  it.each(['@daily', '@midnight', '@DAILY'])('%s: the normal form 0 0 0 * * * *, At 00:00; Fri 11-20 00:00', text => {
    const cron = parse(text);
    expect(cron.normalized).toBe('0 0 0 * * * *');
    expect(cron.dialect).toBe('unix');
    expect(describeCron(cron)).toBe('At 00:00');
    expect(when(text, { count: 2 })).toEqual(['Fri 2026-11-20 00:00 UTC', 'Sat 2026-11-21 00:00 UTC']);
  });

  it('@weekly: At 00:00, only on Sunday; Sun 11-22, 11-29, 12-06', () => {
    expect(describe_('@weekly')).toBe('At 00:00, only on Sunday');
    expect(dates('@weekly', { count: 3 })).toEqual(['2026-11-22', '2026-11-29', '2026-12-06']);
  });

  it('@hourly: Every hour; 19:00, 20:00', () => {
    expect(describe_('@hourly')).toBe('Every hour');
    expect(when('@hourly', { count: 2 })).toEqual(['Thu 2026-11-19 19:00 UTC', 'Thu 2026-11-19 20:00 UTC']);
  });

  it.each(['@yearly', '@annually'])('%s: At 00:00, on day 1 of the month, only in January; 2027, 2028', text => {
    expect(describe_(text)).toBe('At 00:00, on day 1 of the month, only in January');
    expect(dates(text, { count: 2 })).toEqual(['2027-01-01', '2028-01-01']);
  });

  it('@monthly: At 00:00, on day 1 of the month; 2026-12-01, 2027-01-01', () => {
    expect(describe_('@monthly')).toBe('At 00:00, on day 1 of the month');
    expect(dates('@monthly', { count: 2 })).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('0 0 1 * MON: the OR rule and its note; Mon 11-23, Mon 11-30, Tue 12-01, Mon 12-07, Mon 12-14', () => {
    const cron = parse('0 0 1 * MON');
    expect(cron).toMatchObject({ dayRule: 'or', notes: ['or'] });
    expect(describeCron(cron)).toBe('At 00:00, on day 1 of the month, and on Monday');
    expect(when('0 0 1 * MON', { count: 5 })).toEqual([
      'Mon 2026-11-23 00:00 UTC',
      'Mon 2026-11-30 00:00 UTC',
      'Tue 2026-12-01 00:00 UTC',
      'Mon 2026-12-07 00:00 UTC',
      'Mon 2026-12-14 00:00 UTC',
    ]);
  });

  it('0 0 */2 * 1: the AND rule and its note; Mondays with an odd date', () => {
    const cron = parse('0 0 */2 * 1');
    expect(cron).toMatchObject({ dayRule: 'and', notes: ['and-star'] });
    expect(describeCron(cron)).toBe('At 00:00, every 2 days in a month, and on Monday');
    expect(dates('0 0 */2 * 1', { count: 5 })).toEqual([
      '2026-11-23',
      '2026-12-07',
      '2026-12-21',
      '2027-01-11',
      '2027-01-25',
    ]);
  });

  it('0 0 1-7 * 1: OR; Mon 11-23, Mon 11-30, Tue 12-01, Wed 12-02, Thu 12-03', () => {
    expect(parse('0 0 1-7 * 1').dayRule).toBe('or');
    expect(when('0 0 1-7 * 1', { count: 5 })).toEqual([
      'Mon 2026-11-23 00:00 UTC',
      'Mon 2026-11-30 00:00 UTC',
      'Tue 2026-12-01 00:00 UTC',
      'Wed 2026-12-02 00:00 UTC',
      'Thu 2026-12-03 00:00 UTC',
    ]);
  });

  it('0 0 13 * 5: OR; Fri 11-20, 11-27, 12-04, 12-11, Sun 12-13', () => {
    expect(parse('0 0 13 * 5').dayRule).toBe('or');
    expect(when('0 0 13 * 5', { count: 5 })).toEqual([
      'Fri 2026-11-20 00:00 UTC',
      'Fri 2026-11-27 00:00 UTC',
      'Fri 2026-12-04 00:00 UTC',
      'Fri 2026-12-11 00:00 UTC',
      'Sun 2026-12-13 00:00 UTC',
    ]);
  });

  it('0 0 * * 7: only on Sunday / 0 0 * * 5-7: Friday through Sunday', () => {
    expect(describe_('0 0 * * 7')).toBe('At 00:00, only on Sunday');
    expect(when('0 0 * * 7', { count: 1 })).toEqual(['Sun 2026-11-22 00:00 UTC']);
    expect(describe_('0 0 * * 5-7')).toBe('At 00:00, Friday through Sunday');
    expect(when('0 0 * * 5-7', { count: 4 })).toEqual([
      'Fri 2026-11-20 00:00 UTC',
      'Sat 2026-11-21 00:00 UTC',
      'Sun 2026-11-22 00:00 UTC',
      'Fri 2026-11-27 00:00 UTC',
    ]);
  });

  it('5 0 * 8 *: At 00:05, only in August; 2027-08-01 00:05', () => {
    expect(describe_('5 0 * 8 *')).toBe('At 00:05, only in August');
    expect(when('5 0 * 8 *', { count: 1 })).toEqual(['Sun 2027-08-01 00:05 UTC']);
  });

  it('0 0,12 1 */2 *: At 00:00 and 12:00, on day 1 of the month, every 2 months', () => {
    expect(describe_('0 0,12 1 */2 *')).toBe('At 00:00 and 12:00, on day 1 of the month, every 2 months');
    expect(when('0 0,12 1 */2 *', { count: 3 })).toEqual([
      'Fri 2027-01-01 00:00 UTC',
      'Fri 2027-01-01 12:00 UTC',
      'Mon 2027-03-01 00:00 UTC',
    ]);
  });

  it('23 0-20/2 * * *: every 2 hours between 00:00 and 20:59; 20:23, 11-20 00:23, 02:23', () => {
    expect(describe_('23 0-20/2 * * *')).toBe('At 23 minutes past the hour, every 2 hours, between 00:00 and 20:59');
    expect(when('23 0-20/2 * * *', { count: 3 })).toEqual([
      'Thu 2026-11-19 20:23 UTC',
      'Fri 2026-11-20 00:23 UTC',
      'Fri 2026-11-20 02:23 UTC',
    ]);
  });

  it('5/15 * * * *: from 5 to the end of the field; 18:35, 18:50, 19:05', () => {
    expect(describe_('5/15 * * * *')).toBe('Every 15 minutes, starting at 5 minutes past the hour');
    expect([...parse('5/15 * * * *').minutes]).toEqual([5, 20, 35, 50]);
    expect(when('5/15 * * * *', { count: 3 })).toEqual([
      'Thu 2026-11-19 18:35 UTC',
      'Thu 2026-11-19 18:50 UTC',
      'Thu 2026-11-19 19:05 UTC',
    ]);
  });

  it('0 0 L * *: on the last day of the month', () => {
    expect(describe_('0 0 L * *')).toBe('At 00:00, on the last day of the month');
    expect(dates('0 0 L * *', { count: 4 })).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });

  it('0 0 L-3 * *: 3 days before the last day of the month', () => {
    expect(describe_('0 0 L-3 * *')).toBe('At 00:00, 3 days before the last day of the month');
    expect(dates('0 0 L-3 * *', { count: 4 })).toEqual(['2026-11-27', '2026-12-28', '2027-01-28', '2027-02-25']);
  });

  it('0 0 LW * *: the last weekday', () => {
    expect(dates('0 0 LW * *', { count: 4 })).toEqual(['2026-11-30', '2026-12-31', '2027-01-29', '2027-02-26']);
  });

  it('0 0 15W * * / 0 0 1W * *: the nearest weekday', () => {
    expect(dates('0 0 15W * *', { count: 3 })).toEqual(['2026-12-15', '2027-01-15', '2027-02-15']);
    expect(dates('0 0 1W * *', { count: 5 })).toEqual([
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
      '2027-04-01',
    ]);
  });

  it.each(['0 0 * * 5L', '0 0 * * FRIL'])('%s: on the last Friday of the month', text => {
    expect(describe_(text)).toBe('At 00:00, on the last Friday of the month');
    expect(dates(text, { count: 3 })).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
  });

  it('0 0 * * 1#2: on the second Monday of the month', () => {
    expect(describe_('0 0 * * 1#2')).toBe('At 00:00, on the second Monday of the month');
    expect(dates('0 0 * * 1#2', { count: 3 })).toEqual(['2026-12-14', '2027-01-11', '2027-02-08']);
  });

  it('0 0 * JAN,jul sun: names in any case', () => {
    expect(describe_('0 0 * JAN,jul sun')).toBe('At 00:00, only on Sunday, only in January and July');
    expect(dates('0 0 * JAN,jul sun', { count: 2 })).toEqual(['2027-01-03', '2027-01-10']);
  });

  it('0 0 29 2 *: once in four years', () => {
    expect(dates('0 0 29 2 *', { count: 3 })).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });
});

describe('§10, with seconds and Quartz', () => {
  it('*/5 * * * * *: With seconds, Every 5 seconds; 18:30:05, 18:30:10', () => {
    expect(parse('*/5 * * * * *')).toMatchObject({ dialect: 'seconds', readAs: { fields: 6 } });
    expect(describe_('*/5 * * * * *')).toBe('Every 5 seconds');
    expect(when('*/5 * * * * *', { count: 2 })).toEqual(['Thu 2026-11-19 18:30:05 UTC', 'Thu 2026-11-19 18:30:10 UTC']);
  });

  it('0 0 12 * * 1-5: With seconds, At 12:00, Monday through Friday, the note on day numbers', () => {
    const cron = parse('0 0 12 * * 1-5');
    expect(cron).toMatchObject({ dialect: 'seconds', notes: ['seconds-dow-numbers'] });
    expect(describeCron(cron)).toBe('At 12:00, Monday through Friday');
  });

  it.each(['0 0 12 ? * 2-6', '0 0 12 ? * MON-FRI'])('%s: Quartz (6), At 12:00, Monday through Friday', text => {
    const cron = parse(text);
    expect(cron).toMatchObject({ dialect: 'quartz', readAs: { fields: 6 }, dayRule: 'dow' });
    expect(describeCron(cron)).toBe('At 12:00, Monday through Friday');
    expect(when(text, { count: 2 })).toEqual(['Fri 2026-11-20 12:00:00 UTC', 'Mon 2026-11-23 12:00:00 UTC']);
  });

  it('0 15 10 ? * 6L 2026-2030: Quartz (7), the last Friday, 2026 through 2030', () => {
    const cron = parse('0 15 10 ? * 6L 2026-2030');
    expect(cron).toMatchObject({ dialect: 'quartz', readAs: { fields: 7 }, notes: ['quartz-dow-numbers'] });
    expect(describeCron(cron)).toBe('At 10:15, on the last Friday of the month, 2026 through 2030');
    expect(dates('0 15 10 ? * 6L 2026-2030', { count: 2 })).toEqual(['2026-11-27', '2026-12-25']);
  });

  it('0 0 0 ? * 1#1, Dialect Quartz: on the first Sunday of the month', () => {
    expect(describe_('0 0 0 ? * 1#1', 'quartz')).toBe('At 00:00, on the first Sunday of the month');
    expect(dates('0 0 0 ? * 1#1', { dialect: 'quartz', count: 2 })).toEqual(['2026-12-06', '2027-01-03']);
  });

  it('0 0 0 1 1 ? 2099: one run, 2099-01-01 00:00', () => {
    expect(when('0 0 0 1 1 ? 2099')).toEqual(['Thu 2099-01-01 00:00:00 UTC']);
  });

  it('0 0 12 ? * 1-5, Dialect With seconds: ? as *, Mon–Fri 12:00', () => {
    const cron = parse('0 0 12 ? * 1-5', 'seconds');
    expect(cron).toMatchObject({ dialect: 'seconds', dayRule: 'and', notes: ['seconds-dow-numbers'] });
    expect(when('0 0 12 ? * 1-5', { dialect: 'seconds', count: 3 })).toEqual([
      'Fri 2026-11-20 12:00:00 UTC',
      'Mon 2026-11-23 12:00:00 UTC',
      'Tue 2026-11-24 12:00:00 UTC',
    ]);
  });

  it('0 9 * * 1-5, Dialect Quartz / 0 0 9 * * *, Dialect Unix: the field counts', () => {
    expect(error('0 9 * * 1-5', 'quartz')).toBe('Quartz needs 6 or 7 fields, found 5.');
    expect(error('0 0 9 * * *', 'unix')).toBe('Unix cron needs 5 fields, found 6.');
  });
});

describe('§10 «строки ошибок §6» — the texts and columns word for word', () => {
  it.each([
    ['* * * *', 'Expected 5, 6 or 7 fields, found 4.'],
    ['* * * * * * * *', 'Expected 5, 6 or 7 fields, found 8.'],
    ['0 0 9 * * 8', 'Column 11: 8 is out of range for day of week (0–7)'],
    ['  60 * * * *', 'Column 3: 60 is out of range for minute (0–59)'],
    ['60 * * * *', 'Column 1: 60 is out of range for minute (0–59)'],
    ['* 24 * * *', 'Column 3: 24 is out of range for hour (0–23)'],
    ['* * 0 * *', 'Column 5: 0 is out of range for day of month (1–31)'],
    ['* * 32 * *', 'Column 5: 32 is out of range for day of month (1–31)'],
    ['* * * 13 *', 'Column 7: 13 is out of range for month (1–12)'],
    ['* * * * 8', 'Column 9: 8 is out of range for day of week (0–7)'],
    ['a b c d e', 'Column 1: "a" is not valid in minute'],
    ['5-1 * * * *', 'Column 1: range 5-1 goes backwards'],
    ['*/0 * * * *', 'Column 3: step "0" must be a whole number from 1'],
    ['*/x * * * *', 'Column 3: step "x" must be a whole number from 1'],
    ['1,,2 * * * *', 'Column 3: empty item in a list'],
    ['1-2-3 * * * *', 'Column 1: "1-2-3" is not a range'],
    ['1/2/3 * * * *', 'Column 1: more than one / in "1/2/3"'],
    ['@reboot', '@reboot runs once when cron starts; it has no schedule to show.'],
    ['@every 5m', 'Unknown macro @every 5m.'],
    ['0 0 L,15 * *', 'Column 5: L and W must be the whole day-of-month field (L, L-3, LW, 15W)'],
    ['0 0 * * L', 'Column 9: L alone in day of week is ambiguous: write the day, e.g. 5L or FRIL'],
    ['0 0 * * 1#6', 'Column 10: #6: the week number must be 1–5'],
    ['0 0 * * 1#0', 'Column 10: #0: the week number must be 1–5'],
    ['0 0 L-31 * *', 'Column 5: L-31: the offset must be 0–30'],
    ['0 0 32W * *', 'Column 5: 32 is out of range for day of month (1–31)'],
    ['0 0 0 ? * ?', 'Column 11: Quartz allows ? in only one of day of month and day of week'],
    ['0 0 0 1 1 ? 1969', 'Column 13: 1969 is out of range for year (1970–2099)'],
    ['0 0 0 1 1 ? 2100', 'Column 13: 2100 is out of range for year (1970–2099)'],
    ['0 0 ? ? *', 'Column 7: ? is allowed only in day of month and day of week'],
    ['0 0 * * ПН', 'Column 9: "ПН" is not valid in day of week'],
    // §5.1: an AWS EventBridge expression (six fields, the year last).
    ['0 12 * * ? *', 'Column 10: ? is allowed only in day of month and day of week'],
  ])('%s → %s', (text, message) => {
    expect(error(text)).toBe(message);
  });

  it('0 0 9 * * 1, Dialect Quartz: Column 7: Quartz needs ? in day of month or day of week', () => {
    expect(error('0 0 9 * * 1', 'quartz')).toBe('Column 7: Quartz needs ? in day of month or day of week');
  });

  it('@DAILY reads as @daily', () => {
    expect(parse('@DAILY')).toEqual(parse('@daily'));
    expect(readAsText(parse('@DAILY'))).toBe('Unix cron macro: @daily = 0 0 * * *');
  });

  it('0 3 * * * root /usr/bin/x, 0 3 * * * echo hi: a crontab line, At 03:00', () => {
    for (const text of ['0 3 * * * root /usr/bin/x', '0 3 * * * echo hi']) {
      const cron = parse(text);
      expect(cron.readAs).toEqual({ crontabLine: true, fields: 5 });
      expect(describeCron(cron)).toBe('At 03:00');
    }
  });

  it('0 0 30 2 *, 0 0 31 4,6,9,11 *: a description, and no such day', () => {
    expect(describe_('0 0 30 2 *')).toBe('At 00:00, on day 30 of the month, only in February');
    expect(noRunsText(whyNoRuns(parse('0 0 30 2 *'), NOW, 'UTC'))).toBe(
      'This never runs: no selected month has day 30.',
    );
    expect(noRunsText(whyNoRuns(parse('0 0 31 4,6,9,11 *'), NOW, 'UTC'))).toBe(
      'This never runs: no selected month has day 31.',
    );
  });

  it('two crontab lines glued into one: usually a field count or a value error', () => {
    expect(error('0 3 * * *0 4 * * *')).toBe('Expected 5, 6 or 7 fields, found 9.');
    expect(error('0 3 * * 10 4 * * 2')).toBe('Expected 5, 6 or 7 fields, found 9.');
    expect(error('0 3 * * 1-50 4 * * *')).toBe('Expected 5, 6 or 7 fields, found 9.');
    expect(error('0 3 * *\t* 0 4')).toBe('Column 11: 0 is out of range for day of week (1–7)');
    // With a command after the first line, the first line is read and the rest is its command.
    expect(parse('0 3 * * * a.sh0 4 * * * b.sh').readAs).toEqual({ crontabLine: true, fields: 5 });
  });

  it('a column counts characters, whatever the input holds before the error', () => {
    expect(error('\t60 * * * *')).toBe('Column 2: 60 is out of range for minute (0–59)');
    expect(errorText('😀 60', 'x', 3)).toBe('Column 3: x');
  });
});

describe('§10, daylight saving time (§5.5)', () => {
  const berlinSpring = { zone: 'Europe/Berlin', now: at('2027-03-26T12:00:00Z') };
  const berlinSpringNight = { zone: 'Europe/Berlin', now: at('2027-03-27T23:30:00Z') };
  const berlinAutumn = { zone: 'Europe/Berlin', now: at('2027-10-30T12:00:00Z') };

  it('30 2 * * *, Europe/Berlin: 03-28 03:00 +02:00 after the clocks moved forward', () => {
    expect(when('30 2 * * *', { ...berlinSpring, count: 3 })).toEqual([
      'Sat 2027-03-27 02:30 +01:00',
      'Sun 2027-03-28 03:00 +02:00 after-gap',
      'Mon 2027-03-29 02:30 +02:00',
    ]);
  });

  it('30 2,14 * * *, Europe/Berlin: …03-27 14:30 +01:00; 03-28 03:00 after-gap; 03-28 14:30 +02:00', () => {
    expect(when('30 2,14 * * *', { ...berlinSpring, count: 5 })).toEqual([
      'Fri 2027-03-26 14:30 +01:00',
      'Sat 2027-03-27 02:30 +01:00',
      'Sat 2027-03-27 14:30 +01:00',
      'Sun 2027-03-28 03:00 +02:00 after-gap',
      'Sun 2027-03-28 14:30 +02:00',
    ]);
  });

  it('0 1-3 * * *, Europe/Berlin: 02:00 falls on the normal 03:00 — one run, no note', () => {
    expect(when('0 1-3 * * *', { ...berlinSpring, count: 6 })).toEqual([
      'Sat 2027-03-27 01:00 +01:00',
      'Sat 2027-03-27 02:00 +01:00',
      'Sat 2027-03-27 03:00 +01:00',
      'Sun 2027-03-28 01:00 +01:00',
      'Sun 2027-03-28 03:00 +02:00',
      'Mon 2027-03-29 01:00 +02:00',
    ]);
  });

  it('*/30 2 * * *, Europe/Berlin: not a fixed time — nothing on 03-28', () => {
    expect(parse('*/30 2 * * *').fixedTime).toBe(false);
    expect(when('*/30 2 * * *', { ...berlinSpring, count: 4 })).toEqual([
      'Sat 2027-03-27 02:00 +01:00',
      'Sat 2027-03-27 02:30 +01:00',
      'Mon 2027-03-29 02:00 +02:00',
      'Mon 2027-03-29 02:30 +02:00',
    ]);
  });

  it('0 0-23/2 * * *, now 2027-03-27T23:30Z: a step without * is a fixed time (Vixie cron) — 03:00 after-gap', () => {
    expect(parse('0 0-23/2 * * *').fixedTime).toBe(true);
    expect(when('0 0-23/2 * * *', { ...berlinSpringNight, count: 3 })).toEqual([
      'Sun 2027-03-28 03:00 +02:00 after-gap',
      'Sun 2027-03-28 04:00 +02:00',
      'Sun 2027-03-28 06:00 +02:00',
    ]);
  });

  it('*/20 30 2 * * *: three missing seconds are one run, then 03-29 02:30:00, 02:30:20', () => {
    expect(when('*/20 30 2 * * *', { ...berlinSpringNight, count: 3 })).toEqual([
      'Sun 2027-03-28 03:00:00 +02:00 after-gap',
      'Mon 2027-03-29 02:30:00 +02:00',
      'Mon 2027-03-29 02:30:20 +02:00',
    ]);
  });

  it('0 30 2 ? * *: Quartz follows the same rule', () => {
    expect(when('0 30 2 ? * *', { ...berlinSpringNight, count: 2 })).toEqual([
      'Sun 2027-03-28 03:00:00 +02:00 after-gap',
      'Mon 2027-03-29 02:30:00 +02:00',
    ]);
  });

  it('30 2 * * *, now 2027-10-30T12:00Z: once on the repeated night, on the first pass', () => {
    expect(when('30 2 * * *', { ...berlinAutumn, count: 2 })).toEqual([
      'Sun 2027-10-31 02:30 +02:00',
      'Mon 2027-11-01 02:30 +01:00',
    ]);
  });

  it('*/30 2 * * *, now 2027-10-30T12:00Z: both passes, the second marked', () => {
    expect(when('*/30 2 * * *', { ...berlinAutumn, count: 5 })).toEqual([
      'Sun 2027-10-31 02:00 +02:00',
      'Sun 2027-10-31 02:30 +02:00',
      'Sun 2027-10-31 02:00 +01:00 repeated',
      'Sun 2027-10-31 02:30 +01:00 repeated',
      'Mon 2027-11-01 02:00 +01:00',
    ]);
  });

  it('30 2,14 * * *, now 2027-10-30T12:00Z: 10-30 14:30 +02:00, 10-31 02:30 +02:00, 10-31 14:30 +01:00', () => {
    expect(when('30 2,14 * * *', { ...berlinAutumn, count: 3 })).toEqual([
      'Sat 2027-10-30 14:30 +02:00',
      'Sun 2027-10-31 02:30 +02:00',
      'Sun 2027-10-31 14:30 +01:00',
    ]);
  });

  it('30 2 * * *, America/New_York, now 2027-03-12T12:00Z: 03-14 03:00 −04:00 after-gap', () => {
    expect(when('30 2 * * *', { zone: 'America/New_York', now: at('2027-03-12T12:00:00Z'), count: 3 })).toEqual([
      'Sat 2027-03-13 02:30 -05:00',
      'Sun 2027-03-14 03:00 -04:00 after-gap',
      'Mon 2027-03-15 02:30 -04:00',
    ]);
  });

  it('gapEndMs for 2027-03-28 02:30, Europe/Berlin: 2027-03-28T01:00:00Z', () => {
    const local = Date.UTC(2027, 2, 28, 2, 30);
    const resolved = wallTimeToEpochMs(local, 'Europe/Berlin');
    expect(resolved).toMatchObject({ kind: 'gap', epochMs: at('2027-03-28T01:30:00Z') });
    expect(new Date(gapEndMs(local, resolved!.epochMs, 'Europe/Berlin')).toISOString()).toBe(
      '2027-03-28T01:00:00.000Z',
    );
  });

  it('wallTimeToEpochMs 2027-10-31 02:30, Europe/Berlin: the overlap, 00:30Z and 01:30Z', () => {
    expect(wallTimeToEpochMs(Date.UTC(2027, 9, 31, 2, 30), 'Europe/Berlin')).toEqual({
      kind: 'overlap',
      epochMs: at('2027-10-31T00:30:00Z'),
      laterEpochMs: at('2027-10-31T01:30:00Z'),
      shiftMs: 3_600_000,
    });
  });
});

describe('§10, no runs, the horizon and speed', () => {
  it.each([
    ['0 0 30 2 *', 30],
    ['0 0 31 4,6,9,11 *', 31],
  ])('%s: no runs in 400 years, no-such-day %i, quickly', (text, day) => {
    const cron = parse(text);
    const start = performance.now();
    expect(nextRuns(cron, NOW, 'UTC', 10)).toEqual([]);
    const ms = performance.now() - start;
    expect(whyNoRuns(cron, NOW, 'UTC')).toEqual({ kind: 'no-such-day', day });
    expect(ms).toBeLessThan(500);
  });

  it('0 0 0 1 1 ? 2020: past, 2020', () => {
    const cron = parse('0 0 0 1 1 ? 2020');
    expect(nextRuns(cron, NOW, 'UTC', 10)).toEqual([]);
    expect(whyNoRuns(cron, NOW, 'UTC')).toEqual({ kind: 'past', lastYear: 2020 });
    expect(noRunsText(whyNoRuns(cron, NOW, 'UTC'))).toBe('No runs after now: the last year in the expression is 2020.');
  });

  it('0 0 L-30 2 *: never, after the whole 400-year cycle', () => {
    const cron = parse('0 0 L-30 2 *');
    const start = performance.now();
    expect(nextRuns(cron, NOW, 'UTC', 10)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(500);
    expect(whyNoRuns(cron, NOW, 'UTC')).toEqual({ kind: 'never' });
    expect(noRunsText({ kind: 'never' })).toBe('This never runs: no matching day in a full 400-year calendar cycle.');
  });

  it('0 0 */29 2 1, Runs 10: the AND rule — February 1st when it is a Monday', () => {
    expect(dates('0 0 */29 2 1', { count: 10 }).map(d => d.slice(0, 4))).toEqual([
      '2027',
      '2038',
      '2044',
      '2049',
      '2055',
      '2066',
      '2072',
      '2077',
      '2083',
      '2094',
    ]);
    expect(dates('0 0 */29 2 1', { count: 10 }).every(d => d.endsWith('-02-01'))).toBe(true);
  });

  it('* * * * * *, Runs 50: 18:30:01 … 18:30:50, quickly', () => {
    const start = performance.now();
    const list = runs('* * * * * *', { count: 50 });
    expect(performance.now() - start).toBeLessThan(100);
    expect(list).toHaveLength(50);
    expect(formatRunWhen(list[0]!.epochMs, 'UTC', true)).toBe('Thu 2026-11-19 18:30:01 UTC');
    expect(formatRunWhen(list[49]!.epochMs, 'UTC', true)).toBe('Thu 2026-11-19 18:30:50 UTC');
  });

  it('0 0 1 1 ? 2030: cronstrue alone reads six fields with the year last — why the normal form exists', () => {
    expect(cronstrue('0 0 1 1 ? 2030', { use24HourTimeFormat: true })).toMatch(/only in 2030$/);
    // Read here: six fields without ? in a day field are cron with seconds, where ? in the month is an error.
    expect(error('0 0 1 1 ? 2030')).toBe('Column 9: ? is allowed only in day of month and day of week');
  });
});

describe('§5.5 in a southern zone, a half-hour zone and a gap at midnight', () => {
  it('Australia/Sydney, the clocks forward on 2027-10-03: 30 2 * * * runs at 03:00 +11:00', () => {
    expect(when('30 2 * * *', { zone: 'Australia/Sydney', now: at('2027-10-01T12:00:00Z'), count: 3 })).toEqual([
      'Sat 2027-10-02 02:30 +10:00',
      'Sun 2027-10-03 03:00 +11:00 after-gap',
      'Mon 2027-10-04 02:30 +11:00',
    ]);
  });

  it('Australia/Sydney, the clocks back on 2027-04-04: a fixed job once, */30 on both passes', () => {
    const autumn = { zone: 'Australia/Sydney', now: at('2027-04-02T12:00:00Z') };
    expect(when('30 2 * * *', { ...autumn, count: 3 })).toEqual([
      'Sat 2027-04-03 02:30 +11:00',
      'Sun 2027-04-04 02:30 +11:00',
      'Mon 2027-04-05 02:30 +10:00',
    ]);
    expect(when('*/30 2 * * *', { ...autumn, count: 6 })).toEqual([
      'Sat 2027-04-03 02:00 +11:00',
      'Sat 2027-04-03 02:30 +11:00',
      'Sun 2027-04-04 02:00 +11:00',
      'Sun 2027-04-04 02:30 +11:00',
      'Sun 2027-04-04 02:00 +10:00 repeated',
      'Sun 2027-04-04 02:30 +10:00 repeated',
    ]);
  });

  it('Australia/Lord_Howe moves its clocks by 30 minutes: 02:00 and 02:15 run at 02:30', () => {
    const spring = { zone: 'Australia/Lord_Howe', now: at('2027-10-01T12:00:00Z'), count: 3 };
    expect(when('15 2 * * *', spring)).toEqual([
      'Sat 2027-10-02 02:15 +10:30',
      'Sun 2027-10-03 02:30 +11:00 after-gap',
      'Mon 2027-10-04 02:15 +11:00',
    ]);
    expect(when('0 2 * * *', spring)[1]).toBe('Sun 2027-10-03 02:30 +11:00 after-gap');
    // 2027-10-03 02:30 is a normal time there, the first after the gap: the merged run is that one, with no note.
    expect(when('0,30 2 * * *', spring).slice(2)).toEqual(['Sun 2027-10-03 02:30 +11:00']);
  });

  it('Australia/Lord_Howe, the half hour repeated on 2027-04-04', () => {
    const autumn = { zone: 'Australia/Lord_Howe', now: at('2027-04-03T12:00:00Z') };
    expect(when('45 1 * * *', { ...autumn, count: 2 })).toEqual([
      'Sun 2027-04-04 01:45 +11:00',
      'Mon 2027-04-05 01:45 +10:30',
    ]);
    expect(when('*/15 1 * * *', { ...autumn, count: 7 })).toEqual([
      'Sun 2027-04-04 01:00 +11:00',
      'Sun 2027-04-04 01:15 +11:00',
      'Sun 2027-04-04 01:30 +11:00',
      'Sun 2027-04-04 01:45 +11:00',
      'Sun 2027-04-04 01:30 +10:30 repeated',
      'Sun 2027-04-04 01:45 +10:30 repeated',
      'Mon 2027-04-05 01:00 +10:30',
    ]);
  });

  it('Asia/Kolkata (+05:30, no daylight saving): wall times are local', () => {
    expect(when('30 2 * * *', { zone: 'Asia/Kolkata', count: 2 })).toEqual([
      'Fri 2026-11-20 02:30 +05:30',
      'Sat 2026-11-21 02:30 +05:30',
    ]);
  });

  it('America/Santiago jumps at midnight: a daily job runs at 01:00 that night, and once on the night back', () => {
    expect(when('0 0 * * *', { zone: 'America/Santiago', now: at('2027-09-03T12:00:00Z'), count: 3 })).toEqual([
      'Sat 2027-09-04 00:00 -04:00',
      'Sun 2027-09-05 01:00 -03:00 after-gap',
      'Mon 2027-09-06 00:00 -03:00',
    ]);
    expect(when('0 0 * * *', { zone: 'America/Santiago', now: at('2027-04-02T12:00:00Z'), count: 2 })).toEqual([
      'Sat 2027-04-03 00:00 -03:00',
      'Sun 2027-04-04 00:00 -04:00',
    ]);
  });

  it('UTC has no changes: the same wall times every day', () => {
    expect(when('30 2 * * *', { now: at('2027-03-26T12:00:00Z'), count: 3 })).toEqual([
      'Sat 2027-03-27 02:30 UTC',
      'Sun 2027-03-28 02:30 UTC',
      'Mon 2027-03-29 02:30 UTC',
    ]);
  });
});

describe('§5.1 dialects, macros and crontab lines', () => {
  it('Read as names the dialect and the number of fields (§5.1)', () => {
    expect(readAsText(parse('0 9 * * 1-5'))).toBe('Unix cron (5 fields)');
    expect(readAsText(parse('*/5 * * * * *'))).toBe('Cron with seconds (6 fields)');
    expect(readAsText(parse('0 0 12 ? * 2-6'))).toBe('Quartz (6 fields)');
    expect(readAsText(parse('0 15 10 ? * 6L 2026-2030'))).toBe('Quartz (7 fields)');
    expect(readAsText(parse('@weekly'))).toBe('Unix cron macro: @weekly = 0 0 * * 0');
    expect(readAsText(parse('0 3 * * * /usr/local/bin/backup.sh'))).toBe(
      'crontab line — the command after the 5th field is ignored',
    );
  });

  it('§2.8: a whole crontab line reads as its five fields', () => {
    const cron = parse('0 3 * * * /usr/local/bin/backup.sh');
    expect(cron.dialect).toBe('unix');
    expect(describeCron(cron)).toBe('At 03:00');
    expect(when('0 3 * * * /usr/local/bin/backup.sh', { count: 1 })).toEqual(['Fri 2026-11-20 03:00 UTC']);
  });

  it('an /etc/crontab line with a user and a command, and more than seven fields', () => {
    expect(parse('17 * * * * root cd / && run-parts --report /etc/cron.hourly').readAs.crontabLine).toBe(true);
    expect(parse('0 0 1 * * root').readAs.crontabLine).toBe(true);
  });

  it('a crontab line may start with a macro: what follows is the command', () => {
    const cron = parse('@daily /usr/bin/backup');
    expect(cron.readAs).toEqual({ macro: '@daily', crontabLine: true, fields: 5 });
    expect(readAsText(cron)).toBe('Unix cron macro: @daily = 0 0 * * * — the command after it is ignored');
    expect(error('@reboot /usr/bin/start')).toBe('@reboot runs once when cron starts; it has no schedule to show.');
  });

  it('the sixth field that looks like a cron field keeps the error (it is not hidden as a command)', () => {
    expect(error('0 0 9 * * MON#9')).toBe('Column 14: #9: the week number must be 1–5');
    expect(error('0 0 9 * * 1,8')).toBe('Column 13: 8 is out of range for day of week (0–7)');
  });

  it('six fields: Quartz when the day of month or the day of week is exactly ?, otherwise with seconds', () => {
    expect(parse('0 0 12 ? * *').dialect).toBe('quartz');
    expect(parse('0 0 12 * * ?').dialect).toBe('quartz');
    expect(parse('0 0 12 * * *').dialect).toBe('seconds');
  });

  it('a dialect chosen by hand takes only its own number of fields; a macro is taken by any', () => {
    expect(error('0 9 * * 1-5', 'seconds')).toBe('Cron with seconds needs 6 fields, found 5.');
    expect(error('0 0 9 * * * * *', 'quartz')).toBe('Quartz needs 6 or 7 fields, found 8.');
    expect(error('0 0 0 1 1 ? 2030', 'seconds')).toBe('Cron with seconds needs 6 fields, found 7.');
    expect(error('* * * *', 'unix')).toBe('Unix cron needs 5 fields, found 4.');
    for (const dialect of ['unix', 'seconds', 'quartz'] as const)
      expect(parse('@hourly', dialect).dialect).toBe('unix');
    // A crontab line is Unix cron: Unix chosen by hand reads it too.
    expect(parse('0 3 * * * /usr/bin/x', 'unix').readAs.crontabLine).toBe(true);
    expect(error('0 3 * * * /usr/bin/x', 'seconds')).toBe('Column 11: more than one / in "/usr/bin/x"');
  });

  it('a Spring expression with ? and a numeric day of week reads as Quartz, with the note; With seconds reads it as Spring', () => {
    expect(parse('0 0 9 ? * 1')).toMatchObject({ dialect: 'quartz', notes: ['quartz-dow-numbers'] });
    expect(dates('0 0 9 ? * 1', { count: 1 })).toEqual(['2026-11-22']); // Sunday
    expect(dates('0 0 9 ? * 1', { dialect: 'seconds', count: 1 })).toEqual(['2026-11-23']); // Monday
  });

  it('empty, white space only, and a field count of 0', () => {
    expect(error('')).toBe('Expected 5, 6 or 7 fields, found 0.');
    expect(error('   \t ')).toBe('Expected 5, 6 or 7 fields, found 0.');
  });
});

describe('§5.2 fields', () => {
  it('7 is Sunday in Unix and With seconds: 5-7 is Fri, Sat, Sun; */2 is 0, 2, 4, 6', () => {
    expect(parse('0 0 * * 5-7').dow).toEqual({ kind: 'set', days: new Set([5, 6, 0]) });
    expect(parse('0 0 * * */2').dow).toEqual({ kind: 'set', days: new Set([0, 2, 4, 6]) });
    expect(parse('0 0 0 * * 7').dow).toEqual({ kind: 'set', days: new Set([0]) });
  });

  it('Quartz numbers days 1 = Sunday … 7 = Saturday; 0 is out of range there', () => {
    expect(parse('0 0 0 ? * 1,7').dow).toEqual({ kind: 'set', days: new Set([0, 6]) });
    expect(error('0 0 0 ? * 0')).toBe('Column 11: 0 is out of range for day of week (1–7)');
    expect(parse('0 0 0 ? * SUN').dow).toEqual({ kind: 'set', days: new Set([0]) });
  });

  it('names in ranges and at the start of a step, any case; a step larger than the range gives one value', () => {
    expect([...parse('0 0 * mar-may mon-wed').months]).toEqual([3, 4, 5]);
    expect([...parse('0 0 * FEB/5 *').months]).toEqual([2, 7, 12]);
    expect([...parse('0 0-5/10 * * *').hours]).toEqual([0]);
    expect([...parse('*/45 * * * *').minutes]).toEqual([0, 45]);
    expect([...parse('10-20/4 * * * *').minutes]).toEqual([10, 14, 18]);
    expect(error('0 0 * JANUARY *')).toBe('Column 7: "JANUARY" is not valid in month');
    expect(error('0 0 * * MON-5L')).toBe('Column 9: L and # must be the whole day-of-week field (5L, FRIL, 1#2)');
  });

  it('a/n runs to the end of the field: in the Unix day of week that is 7, Sunday', () => {
    expect(parse('0 0 * * 1/2').dow).toEqual({ kind: 'set', days: new Set([1, 3, 5, 0]) });
    expect([...parse('0 20/2 * * *').hours]).toEqual([20, 22]);
  });

  it('no wrap-around ranges: 22-2 goes backwards (Vixie cron)', () => {
    expect(error('0 22-2 * * *')).toBe('Column 3: range 22-2 goes backwards');
    expect(error('0 0 * * SAT-SUN')).toBe('Column 9: range SAT-SUN goes backwards');
  });

  it('an error points at the item or the number at fault, not only the field', () => {
    expect(error('1,60 * * * *')).toBe('Column 3: 60 is out of range for minute (0–59)');
    expect(error('1-60 * * * *')).toBe('Column 3: 60 is out of range for minute (0–59)');
    expect(error('1, * * * *')).toBe('Column 3: empty item in a list');
    expect(error(',1 * * * *')).toBe('Column 1: empty item in a list');
    expect(error('-5 * * * *')).toBe('Column 1: "-5" is not a range');
    expect(error('/5 * * * *')).toBe('Column 1: "/5" is not valid in minute');
    expect(error('*/ * * * *')).toBe('Column 3: step "" must be a whole number from 1');
  });

  it('? only in the day fields, as the whole field', () => {
    expect(error('? * * * *')).toBe('Column 1: ? is allowed only in day of month and day of week');
    expect(error('0 0 1,? * *')).toBe('Column 7: ? must be the whole field');
    expect(parse('0 0 ? * ?').dayRule).toBe('and');
    expect(error('0 0 0 1 * 2', 'quartz')).toBe('Column 7: Quartz needs ? in day of month or day of week');
  });

  it('the special values: L, L-n, LW, nW in the day of month; nL, n#k in the day of week; whole fields only', () => {
    expect(parse('0 0 L * *').dom).toEqual({ kind: 'last', offset: 0 });
    expect(parse('0 0 L-0 * *').dom).toEqual({ kind: 'last', offset: 0 });
    expect(parse('0 0 l-30 * *').dom).toEqual({ kind: 'last', offset: 30 });
    expect(parse('0 0 lw * *').dom).toEqual({ kind: 'lastWeekday' });
    expect(parse('0 0 31W * *').dom).toEqual({ kind: 'nearestWeekday', day: 31 });
    expect(parse('0 0 * * fril').dow).toEqual({ kind: 'last', day: 5 });
    expect(parse('0 0 * * 7L').dow).toEqual({ kind: 'last', day: 0 });
    expect(parse('0 0 0 ? * 7L').dow).toEqual({ kind: 'last', day: 6 });
    expect(parse('0 0 * * MON#5').dow).toEqual({ kind: 'nth', day: 1, n: 5 });
    for (const text of ['0 0 15W,20 * *', '0 0 1-5W * *', '0 0 L/2 * *', '0 0 W * *', '0 0 L-x * *'])
      expect(error(text)).toBe('Column 5: L and W must be the whole day-of-month field (L, L-3, LW, 15W)');
    for (const text of ['0 0 * * 1#1,2#2', '0 0 * * 5L,6', '0 0 * * 1,5L', '0 0 * * L5'])
      expect(error(text)).toBe('Column 9: L and # must be the whole day-of-week field (5L, FRIL, 1#2)');
    expect(error('0 0 0W * *')).toBe('Column 5: 0 is out of range for day of month (1–31)');
    expect(error('0 0 * * 8L')).toBe('Column 9: 8 is out of range for day of week (0–7)');
  });

  it('nW never leaves the month; a day past the month’s end is its last day', () => {
    // 2027-05-01 is a Saturday: Monday the 3rd. 2027-01-31 is a Sunday: Friday the 29th. April has no 31st.
    expect(dates('0 0 1W 5 *', { count: 1 })).toEqual(['2027-05-03']);
    expect(dates('0 0 31W 1 *', { count: 1 })).toEqual(['2027-01-29']);
    expect(dates('0 0 31W 4 *', { count: 1 })).toEqual(['2027-04-30']);
    // 2027-08-15 is a Sunday: Monday the 16th; 2027-05-15 a Saturday: Friday the 14th.
    expect(dates('0 0 15W 8 *', { count: 1 })).toEqual(['2027-08-16']);
    expect(dates('0 0 15W 5 *', { count: 1 })).toEqual(['2027-05-14']);
  });

  it('L-n where the month is too short does not run that month; the fifth weekday may not exist', () => {
    expect(dates('0 0 L-29 * *', { count: 3 })).toEqual(['2026-12-02', '2027-01-02', '2027-03-02']);
    expect(dates('0 0 * * MON#5', { count: 2 })).toEqual(['2026-11-30', '2027-03-29']);
  });
});

describe('§5.3 the day of month and the day of week together', () => {
  it('both set: OR; one starts with * or is ?: AND, where * matches always and */2 does not', () => {
    expect(parse('0 0 1 * 1').dayRule).toBe('or');
    expect(parse('0 0 L * 5').dayRule).toBe('or');
    expect(parse('0 0 * * 1').dayRule).toBe('and');
    expect(parse('0 0 ? * 1').dayRule).toBe('and');
    expect(parse('0 0 1 * *').dayRule).toBe('and');
    expect(parse('0 0 1 * */2').dayRule).toBe('and');
    expect(parse('0 0 * * 1').notes).toEqual([]);
    expect(parse('0 0 1 * */2').notes).toEqual(['and-star']);
    expect(parse('0 0 */2 * ?').notes).toEqual([]);
  });

  it('Quartz: the field without ? decides', () => {
    expect(parse('0 0 0 15 * ?').dayRule).toBe('dom');
    expect(parse('0 0 0 ? * MON').dayRule).toBe('dow');
    expect(dayMatches(parse('0 0 0 15 * ?'), 2026, 11, 15)).toBe(true);
    expect(dayMatches(parse('0 0 0 15 * ?'), 2026, 11, 16)).toBe(false);
  });

  it('the notes, in the order of §5.7, word for word', () => {
    expect(parse('0 0 0 1 * 1').notes).toEqual(['or', 'seconds-dow-numbers']);
    expect(parse('0 0 0 */2 * 1').notes).toEqual(['and-star', 'seconds-dow-numbers']);
    expect(parse('0 0 0 * * MON').notes).toEqual([]);
    expect(NOTE_TEXTS).toEqual({
      or: 'Runs when the day of month OR the day of week matches: cron does this when both fields are set.',
      'and-star': "One day field starts with *, so a day must match both fields (cron's rule).",
      'quartz-dow-numbers': 'Quartz numbers days from 1 = Sunday to 7 = Saturday.',
      'seconds-dow-numbers': 'Day numbers: 0 and 7 = Sunday, as in Unix cron and Spring.',
    });
  });
});

describe('§5.5 a fixed time', () => {
  it.each([
    ['30 2 * * *', true],
    ['30 2,14 * * *', true],
    ['0 1-3 * * *', true],
    ['0 0-23/2 * * *', true],
    ['*/30 2 * * *', false],
    ['0 * * * *', false],
    ['*/20 30 2 * * *', true],
    ['@daily', true],
    ['@hourly', false],
  ])('%s: %s', (text, fixed) => {
    expect(parse(text).fixedTime).toBe(fixed);
  });
});

describe('§5.6 the normal form', () => {
  it('always seven fields: second 0 when absent, year * when absent, upper case', () => {
    expect(parse('0 9 * * mon-fri').normalized).toBe('0 0 9 * * MON-FRI *');
    expect(parse('*/5 * * * * *').normalized).toBe('*/5 * * * * * *');
    expect(parse('0 15 10 ? * 6L 2026-2030').normalized).toBe('0 15 10 ? * 6L 2026-2030');
    expect(parse('@yearly').normalized).toBe('0 0 0 1 1 * *');
  });

  it('cronstrue never sees what the check refused; the lower-case special values read as written in upper case', () => {
    expect(describe_('0 0 lw * *')).toBe('At 00:00, on the last weekday of the month');
    expect(describe_('0 0 * * fril')).toBe('At 00:00, on the last Friday of the month');
    expect(describe_('0 0 * * mon#1')).toBe('At 00:00, on the first Monday of the month');
  });
});

describe('§5.8 the next runs', () => {
  it('strictly after now: a run at the very moment is not listed', () => {
    expect(when('30 18 * * *', { count: 1 })).toEqual(['Fri 2026-11-20 18:30 UTC']);
    expect(when('30 18 * * *', { count: 1, now: NOW - 1 })).toEqual(['Thu 2026-11-19 18:30 UTC']);
  });

  it('the days are the zone’s: at 18:30 UTC it is already Friday 03:30 in Asia/Tokyo', () => {
    expect(when('0 2 * * 5', { count: 1 })).toEqual(['Fri 2026-11-20 02:00 UTC']);
    expect(when('0 2 * * 5', { zone: 'Asia/Tokyo', count: 1 })).toEqual(['Fri 2026-11-27 02:00 +09:00']);
    expect(when('0 9 * * 4', { zone: 'Pacific/Honolulu', count: 1 })).toEqual(['Thu 2026-11-19 09:00 -10:00']);
  });

  it('a year after 2099 without a year field is fine (2100 is no leap year); with one, the search ends with its last year', () => {
    expect(dates('0 0 29 2 *', { count: 20 }).slice(-3)).toEqual(['2096-02-29', '2104-02-29', '2108-02-29']);
    expect(dates('0 0 0 1 1 ? 2027-2028', { count: 5 })).toEqual(['2027-01-01', '2028-01-01']);
  });

  it.each(RUN_COUNTS)('Runs %i: exactly that many, in order, without repeats', count => {
    const list = runs('*/7 * * * *', { count });
    expect(list).toHaveLength(count);
    expect(list.every((r, i) => i === 0 || r.epochMs > list[i - 1]!.epochMs)).toBe(true);
  });

  it('the year field of the current year with every run past: past', () => {
    const cron = parse('0 0 0 1 1 ? 2026');
    expect(nextRuns(cron, NOW, 'UTC', 5)).toEqual([]);
    expect(whyNoRuns(cron, NOW, 'UTC')).toEqual({ kind: 'past', lastYear: 2026 });
  });

  it('only the day of month decides: Quartz with ? in the day of week, AND with * in the day of week', () => {
    expect(whyNoRuns(parse('0 0 0 30 2 ?'), NOW, 'UTC')).toEqual({ kind: 'no-such-day', day: 30 });
    expect(whyNoRuns(parse('0 0 30,31 2 *'), NOW, 'UTC')).toEqual({ kind: 'no-such-day', day: 30 });
    // Day 30 and Monday by the OR rule do run; L-30 in February never does.
    expect(nextRuns(parse('0 0 30 2 1'), NOW, 'UTC', 1)).toHaveLength(1);
  });
});

describe('§5.9 a run as shown, and Copy runs (§3)', () => {
  it('the weekday, the date, the time — seconds when asked or when there are any — then the offset or UTC', () => {
    const t = at('2027-03-28T01:00:00Z');
    expect(formatRunWhen(t, 'Europe/Berlin', false)).toBe('Sun 2027-03-28 03:00 +02:00');
    expect(formatRunWhen(t, 'Europe/Berlin', true)).toBe('Sun 2027-03-28 03:00:00 +02:00');
    expect(formatRunWhen(t + 5000, 'Europe/Berlin', false)).toBe('Sun 2027-03-28 03:00:05 +02:00');
    expect(formatRunWhen(at('2026-11-20T09:00:00Z'), 'UTC', false)).toBe('Fri 2026-11-20 09:00 UTC');
    expect(formatRunWhen(at('2026-11-20T09:00:00Z'), 'Asia/Kathmandu', false)).toBe('Fri 2026-11-20 14:45 +05:45');
  });

  it('Copy runs: ISO 8601 in the zone, one a line, no line break at the end', () => {
    expect(runsText(runs('0 9 * * 1-5', { count: 2 }), 'UTC')).toBe(
      '2026-11-20T09:00:00+00:00\n2026-11-23T09:00:00+00:00',
    );
    expect(
      runsText(
        runs('30 2 * * *', { zone: 'Europe/Berlin', now: at('2027-03-27T12:00:00Z'), count: 1 }),
        'Europe/Berlin',
      ),
    ).toBe('2027-03-28T03:00:00+02:00');
    expect(runsText([], 'UTC')).toBe('');
  });
});

describe('§7 detectCron', () => {
  it.each(['0 9 * * 1-5', '*/15 * * * *', '@daily', '0 0 12 ? * MON-FRI', '0 15 10 ? * 6L 2026-2030'])(
    '%s: yes',
    text => {
      expect(detectCron(text)).toBe(true);
    },
  );

  it.each([
    '1 2 3 4 5',
    '2026 11 19 18 30',
    '1.2.3',
    '0 3 * * * /usr/local/bin/backup.sh',
    '60 * * * *',
    '* * * *',
    'a b c d e',
    '1700000000',
    '#ffffff',
    '(\\d+)-\\w*',
  ])('%s: no', text => {
    expect(detectCron(text)).toBe(false);
  });

  it('the macros in any case, white space around; not @reboot, not a macro with a command', () => {
    for (const text of ['@yearly', '@ANNUALLY', ' @monthly\n', '@weekly', '@Midnight', '@hourly'])
      expect(detectCron(text)).toBe(true);
    for (const text of ['@reboot', '@every 5m', '@daily /usr/bin/x', '@']) expect(detectCron(text)).toBe(false);
  });

  it('five words of ordinary text and the other tools’ inputs are not cron', () => {
    for (const text of [
      'the quick brown fox jumps',
      'Hello World Foo Bar Baz',
      'helloWorld',
      'hello_world-foo',
      '0b1010 0x1F 255 0o17 10',
      'ff 10 255 1010 777',
      'rgb(255 0 0)',
      'hsl(120 100% 50%)',
      'oklch(0.7 0.1 200)',
      '#fff',
      'b\na\nc\na\nb',
      '* * *',
      '- - - - -',
      '*** *** *** *** ***',
      '1700000000000',
      '2023-11-14T22:13:20Z',
      '0 9 * * 1-5\n0 10 * * 1-5',
      'LW LW LW LW LW',
      'MON TUE WED THU FRI',
      `0 9 * * ${'1,'.repeat(100)}1`,
    ])
      expect(detectCron(text)).toBe(false);
  });

  it('a crontab line is not recognised, nor text longer than 200 characters', () => {
    expect(detectCron('0 3 * * * root /usr/bin/x')).toBe(false);
    expect(detectCron(`*/5 * * * * ${' '.repeat(200)}`)).toBe(true);
    expect(detectCron(`*/5   *   *   *   ${'*'.padStart(190)}`)).toBe(false);
  });
});

describe('limits and long input (§12)', () => {
  it('the constants', () => {
    expect(MAX_INPUT).toBe(1000);
    expect([...RUN_COUNTS]).toEqual([5, 10, 20, 50]);
  });

  it('a megabyte of input is read and refused in linear time', () => {
    const cases = [
      '1,'.repeat(500_000),
      `${'*'.repeat(1_000_000)} * * * *`,
      `${' '.repeat(1_000_000)}x`,
      `0 0 * * ${'1-'.repeat(500_000)}`,
      `0 0 ${'L'.repeat(1_000_000)} * *`,
      `0 3 * * * ${'a'.repeat(1_000_000)}`,
      `${'@'.repeat(1_000_000)}`,
      `* * * * ${'MON#'.repeat(250_000)}`,
    ];
    for (const text of cases) {
      const start = performance.now();
      parseCron(text, 'auto');
      detectCron(text);
      expect(performance.now() - start, text.slice(0, 20)).toBeLessThan(500);
    }
  });
});

describe('whatever the machine’s zone', () => {
  const machine = process.env.TZ;
  afterAll(() => {
    if (machine === undefined) delete process.env.TZ;
    else process.env.TZ = machine;
  });

  it.each(['UTC', 'Pacific/Chatham', 'America/Los_Angeles', 'Asia/Kathmandu', 'Australia/Lord_Howe'])(
    'with the machine in %s, the daylight-saving rows give the same answers',
    zone => {
      process.env.TZ = zone;
      expect(when('30 2 * * *', { zone: 'Europe/Berlin', now: at('2027-03-26T12:00:00Z'), count: 3 })).toEqual([
        'Sat 2027-03-27 02:30 +01:00',
        'Sun 2027-03-28 03:00 +02:00 after-gap',
        'Mon 2027-03-29 02:30 +02:00',
      ]);
      expect(when('*/30 2 * * *', { zone: 'Europe/Berlin', now: at('2027-10-30T12:00:00Z'), count: 4 })).toEqual([
        'Sun 2027-10-31 02:00 +02:00',
        'Sun 2027-10-31 02:30 +02:00',
        'Sun 2027-10-31 02:00 +01:00 repeated',
        'Sun 2027-10-31 02:30 +01:00 repeated',
      ]);
      expect(when('30 2 * * *', { zone: 'Australia/Sydney', now: at('2027-10-01T12:00:00Z'), count: 2 })[1]).toBe(
        'Sun 2027-10-03 03:00 +11:00 after-gap',
      );
      expect(when('0 9 * * 1-5', { count: 1 })).toEqual(['Fri 2026-11-20 09:00 UTC']);
    },
  );
});

describe('the next runs equal the plain rule of §5.8 item 3 — every wall time through wallTimeToEpochMs', () => {
  // The rule as §5.8 writes it, without the shortcuts nextRuns takes (one instant a wall time outside the change,
  // stopping early): every wall time of every matching day through wallTimeToEpochMs, then §5.5.
  const plain = (cron: ParsedCron, nowMs: number, zone: string, count: number): string[] => {
    const out = new Map<number, Run['kind']>();
    const rank = { normal: 0, repeated: 1, 'after-gap': 2 } as const;
    const put = (t: number, kind: Run['kind']) => {
      if (t <= nowMs) return;
      const there = out.get(t);
      if (there === undefined || rank[kind] < rank[there]) out.set(t, kind);
    };
    const start = Date.parse(new Date(nowMs).toISOString().slice(0, 10)) - 2 * 86_400_000;
    for (let d = start; d < start + 10 * 86_400_000; d += 86_400_000) {
      const enough = [...out.keys()].sort((x, y) => x - y)[count - 1];
      if (enough !== undefined && d - 86_400_000 > enough) break; // a later day cannot hold an earlier run
      const date = new Date(d);
      if (!dayMatches(cron, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())) continue;
      for (const h of [...cron.hours].sort((a, b) => a - b))
        for (const m of [...cron.minutes].sort((a, b) => a - b))
          for (const s of [...cron.seconds].sort((a, b) => a - b)) {
            const local = d + (h * 3600 + m * 60 + s) * 1000;
            const r = wallTimeToEpochMs(local, zone)!;
            if (r.kind === 'exact') put(r.epochMs, 'normal');
            else if (r.kind === 'gap') {
              if (cron.fixedTime) put(gapEndMs(local, r.epochMs, zone), 'after-gap');
            } else {
              put(r.epochMs, 'normal');
              if (!cron.fixedTime) put(r.laterEpochMs, 'repeated');
            }
          }
    }
    return [...out]
      .sort((a, b) => a[0] - b[0])
      .slice(0, count)
      .map(([t, kind]) => `${new Date(t).toISOString()} ${kind}`);
  };
  const fast = (cron: ParsedCron, nowMs: number, zone: string, count: number): string[] =>
    nextRuns(cron, nowMs, zone, count).map(r => `${new Date(r.epochMs).toISOString()} ${r.kind}`);

  const changes: Array<[string, string]> = [
    ['Europe/Berlin', '2027-03-28T00:20:00Z'],
    ['Europe/Berlin', '2027-10-31T00:20:00Z'],
    ['America/New_York', '2027-03-14T06:20:00Z'],
    ['America/New_York', '2027-11-07T05:20:00Z'],
    ['Australia/Sydney', '2027-10-02T15:20:00Z'],
    ['Australia/Sydney', '2027-04-03T15:20:00Z'],
    ['Australia/Lord_Howe', '2027-10-02T15:10:00Z'],
    ['Australia/Lord_Howe', '2027-04-03T14:10:00Z'],
    ['America/Santiago', '2027-09-05T03:20:00Z'],
    ['Pacific/Chatham', '2027-09-25T13:20:00Z'],
  ];
  const expressions: Array<[string, number]> = [
    ['*/7 * * * *', 50],
    ['30 2 * * *', 3],
    ['0 1-3 * * *', 5],
    ['15,45 0-3 * * *', 12],
    ['*/20 30 2 * * *', 4],
    ['*/30 * * * * *', 50],
    ['0 0 * * *', 3],
    ['0 * * * *', 8],
  ];

  it.each(changes)(
    '%s around %s: every expression gives the plain rule’s runs',
    (zone, iso) => {
      for (const [text, count] of expressions) {
        const cron = parse(text);
        for (const offset of [0, 40 * 60_000, 80 * 60_000, 150 * 60_000]) {
          const now = at(iso) + offset;
          expect(fast(cron, now, zone, count), `${text} at ${new Date(now).toISOString()}`).toEqual(
            plain(cron, now, zone, count),
          );
        }
      }
    },
    30_000,
  );

  it('an every-second expression on the days the clocks change takes milliseconds, not a scan of the day', () => {
    const cron = parse('* * * * * *');
    for (const [zone, iso] of changes) {
      const start = performance.now();
      nextRuns(cron, at(iso) + 30 * 60_000, zone, 50);
      expect(performance.now() - start, `${zone} ${iso}`).toBeLessThan(50);
    }
  });
});
