/**
 * The description in words (docs/tools/specs/cron.md §5.6): cronstrue, given the seven-field normal form, so it never
 * guesses what six fields mean. The only module that imports the library: the tool's component is loaded lazily, and
 * `detect` (its own module, loaded with every tool's) does not reach this one.
 */
import { toString as cronstrue } from 'cronstrue';
import type { ParsedCron } from './parse';

/** cronstrue with the options of §5.6; null when it throws. */
export const describeCron = (cron: ParsedCron): string | null => {
  try {
    return cronstrue(cron.normalized, {
      use24HourTimeFormat: true,
      verbose: false,
      throwExceptionOnParseError: true,
      dayOfWeekStartIndexZero: cron.dialect !== 'quartz',
      monthStartIndexZero: false,
      locale: 'en',
    });
  } catch {
    return null;
  }
};
