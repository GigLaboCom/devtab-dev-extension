/**
 * Does pasted text look like a cron expression (docs/tools/specs/cron.md §7)? Cheap and strict: a host may open the
 * tool on it without asking. One of the macros; or 5 to 7 fields made only of cron's characters and names, at least one
 * with `*` or `?` (rows of numbers — dates, versions — are not cron), that read without an error. A crontab line with
 * its command is not recognised: the command is not a cron field.
 */
import { looksLikeCronField, MACROS, parseCron, splitFields } from './parse';

const DETECT_MAX = 200;

export const detectCron = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > DETECT_MAX) return false;
  if (trimmed.startsWith('@')) return Object.hasOwn(MACROS, trimmed.toLowerCase());
  const fields = splitFields(trimmed);
  if (fields.length < 5 || fields.length > 7) return false;
  if (!fields.every(f => looksLikeCronField(f.text))) return false;
  if (!fields.some(f => f.text.includes('*') || f.text.includes('?'))) return false;
  return parseCron(trimmed, 'auto').ok;
};
