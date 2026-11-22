/**
 * Recognises CSV pasted on the start page or in the palette (docs/tools/specs/json-csv.md §7). Comma-separated text is
 * also prose and code, so the rule is strict: at least three records with the same number of fields (two or more) by
 * the Auto delimiter, read without an error. Only the first DETECT_PREFIX_CHARS characters are read, so the answer costs
 * the same for any size.
 */
import { detectDelimiter, readRecords } from './csv';
import { DETECT_PREFIX_CHARS, SAMPLE_RECORDS } from './types';

/** A Markdown table's separator row (`|---|:--:|`): only dashes, colons and spaces in its cells, a dash somewhere. */
const SEPARATOR_CELL = /^[\s:-]*$/;

export const detectCsv = (text: string): boolean => {
  // trim() removes a byte order mark too (U+FEFF is white space to it).
  const trimmed = text.trim();
  if (trimmed === '') return false;
  const first = trimmed.charCodeAt(0);
  if (first === 123 || first === 91) return false;
  const head = trimmed.length > DETECT_PREFIX_CHARS ? trimmed.slice(0, DETECT_PREFIX_CHARS) : trimmed;
  const delimiter = detectDelimiter(head);
  if (!delimiter) return false;
  const read = readRecords(head, delimiter, SAMPLE_RECORDS);
  if (!read.ok || read.records.length < 3) return false;
  const { records } = read;
  // `a, b` everywhere: prose or code (a list, arguments, SQL), not a table. §7 says it of the comma; the same holds
  // for `a; b` (CSS, statements) and `a | b` (Markdown, console tables) — added (§15).
  if (delimiter !== '\t') {
    let bare = false;
    for (let i = head.indexOf(delimiter); i !== -1 && i < read.end; i = head.indexOf(delimiter, i + 1))
      if (head.charCodeAt(i + 1) !== 32) {
        bare = true;
        break;
      }
    if (!bare) return false;
  }
  // Added (§15): every line starting with the delimiter is indentation or a framed table, and every line ending with
  // it is code (`foo(a, b);`) — not data.
  if (records.every(r => r.fields[0] === '') || records.every(r => r.fields[r.fields.length - 1] === '')) return false;
  // Added (§15): a pipe table with a separator row is Markdown (markdown-preview recognises nothing itself).
  if (
    delimiter === '|' &&
    records.some(r => r.fields.some(f => f.includes('-')) && r.fields.every(f => SEPARATOR_CELL.test(f)))
  )
    return false;
  return true;
};
