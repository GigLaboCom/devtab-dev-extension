/**
 * The words the tool shows about an expression (docs/tools/specs/cron.md §5.1, §5.7, §5.8, §5.9), word for word, and
 * the copied runs (§3). Kept with the logic so the tests read the same sentences the page shows.
 */
import { MACROS } from './parse';
import { formatIsoInZone } from '@workspace/tools-shared/time';
import type { CronNote, ParsedCron } from './parse';
import type { NoRuns, Run } from './runs';

const DIALECT_NAMES = { unix: 'Unix cron', seconds: 'Cron with seconds', quartz: 'Quartz' } as const;

/** §5.1: "Unix cron (5 fields)", "Unix cron macro: @daily = 0 0 * * *", the crontab line. */
export const readAsText = (cron: ParsedCron): string => {
  const { macro, crontabLine, fields } = cron.readAs;
  if (macro)
    return `Unix cron macro: ${macro} = ${MACROS[macro]}${crontabLine ? ' — the command after it is ignored' : ''}`;
  if (crontabLine) return 'crontab line — the command after the 5th field is ignored';
  return `${DIALECT_NAMES[cron.dialect]} (${fields} fields)`;
};

/** §5.7, in the order the notes are shown. */
export const NOTE_TEXTS: Readonly<Record<CronNote, string>> = {
  or: 'Runs when the day of month OR the day of week matches: cron does this when both fields are set.',
  'and-star': "One day field starts with *, so a day must match both fields (cron's rule).",
  'quartz-dow-numbers': 'Quartz numbers days from 1 = Sunday to 7 = Saturday.',
  'seconds-dow-numbers': 'Day numbers: 0 and 7 = Sunday, as in Unix cron and Spring.',
};

/** §5.8: why there is no table. */
export const noRunsText = (why: NoRuns): string =>
  why.kind === 'past'
    ? `No runs after now: the last year in the expression is ${why.lastYear}.`
    : why.kind === 'no-such-day'
      ? `This never runs: no selected month has day ${why.day}.`
      : 'This never runs: no matching day in a full 400-year calendar cycle.';

/** §5.9: the Note column. */
export const RUN_NOTES: Readonly<Record<Run['kind'], string>> = {
  normal: '',
  'after-gap': 'after the clocks moved forward',
  repeated: 'repeated hour, second pass',
};

/** §5.9: under a table with at least one note. */
export const DST_LINE =
  'Daylight saving time: a job at a fixed time runs once — when the clocks move forward, or on the first pass of a repeated hour. Other jobs follow the clock (Vixie cron).';

/** §5.6: when cronstrue cannot describe what passed the check. */
export const NO_DESCRIPTION = 'No description for this expression.';

/** §6. */
export const TOO_LONG = 'The expression is longer than 1,000 characters.';

/** §3: Copy runs — one instant a line in the chosen zone, `2027-03-28T03:00:00+02:00`, no line break at the end. */
export const runsText = (runs: readonly Run[], zone: string): string =>
  runs.map(run => formatIsoInZone(BigInt(run.epochMs) * 1_000_000n, zone)).join('\n');

/** §6: "Column N: …" — N counts characters (code points) from 1 in the input as typed; no place, no prefix. */
export const errorText = (input: string, message: string, offset?: number): string =>
  offset === undefined ? message : `Column ${[...input.slice(0, offset)].length + 1}: ${message}`;
