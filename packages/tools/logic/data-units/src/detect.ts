/**
 * Does pasted text look like this tool's input (docs/tools/specs/data-units.md §7)? A value with an explicit data unit
 * — a prefix, a word or a rate — and nothing else; a bare number, one bare letter (`5B`) and config suffixes (`512m`)
 * are not this tool's. Bounded before parsing: one short line.
 */
import { parseValue } from './parse';

export const DETECT_MAX = 64;

export const detectDataUnits = (text: string): boolean => {
  const t = text.trim();
  if (t === '' || t.length > DETECT_MAX || /[\r\n]/.test(t)) return false;
  const parsed = parseValue(t, 'decimal', 'exact');
  if (!parsed?.ok) return false;
  const unit = parsed.value.unit;
  return unit !== null && (unit.step > 0 || unit.word || unit.rate);
};
