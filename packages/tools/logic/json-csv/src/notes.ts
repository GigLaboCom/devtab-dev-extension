/**
 * The notes under the result (docs/tools/specs/json-csv.md §5 «Заметки»), one line each, in the table's order, and
 * the sizes the page shows. Texts are the specification's word for word; the lines §15 added are marked.
 */
import { DELIMITER_NAMES } from './csv';
import type { CsvLosses, ToCsvNotes, ToJsonNotes } from './types';

const count = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

/** `2 rows × 3 columns` (no full stop): the size of a table. */
export const describeTable = (rows: number, columns: number): string =>
  `${plural(rows, 'row', 'rows')} × ${plural(columns, 'column', 'columns')}`;

/** The note of json.md §5 «Заметки», which this tool shares. */
const inexact = (n: number): string =>
  n === 1
    ? "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it."
    : `${count(n)} numbers are kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change them.`;

/** Added (§15): what reading this CSV back will not restore, or null when it restores everything. */
export const describeLosses = (lost: CsvLosses): string | null => {
  const parts = [
    lost.blanks > 0
      ? `${plural(lost.blanks, 'empty string or missing key', 'empty strings or missing keys')} (an empty cell, like null)`
      : '',
    lost.typedStrings > 0
      ? `${plural(lost.typedStrings, 'string that looks', 'strings that look')} like a number or true/false (read back as one)`
      : '',
    lost.jsonText > 0
      ? `${plural(lost.jsonText, 'array or object', 'arrays or objects')} (JSON text in a cell, read back as a string)`
      : '',
    lost.flattened ? 'nesting (put back only by "Nest dotted headers")' : '',
    lost.emptyNames > 0
      ? `${plural(lost.emptyNames, 'empty key', 'empty keys')} (a column without a name, read back as column_N)`
      : '',
  ].filter(Boolean);
  return parts.length === 0 ? null : `Not kept by CSV: ${parts.join('; ')}.`;
};

const RENAMED_SHOWN = 5;

/** The note lines of §5, in order. */
export const describeNotes = (notes: ToCsvNotes | ToJsonNotes): string[] => {
  const lines: string[] = [];
  if ('protectedCells' in notes) {
    if (notes.emptyArray) return ['The JSON array is empty.'];
    lines.push(`${describeTable(notes.rows, notes.columns)}.`);
    if (notes.protectedCells > 0)
      lines.push(
        notes.protectedCells === 1
          ? "1 cell starts with = + - @ or a tab and was prefixed with ' so spreadsheets show it as text."
          : `${count(notes.protectedCells)} cells start with = + - @ or a tab and were prefixed with ' so spreadsheets show them as text.`,
      );
    if (notes.formulaCells > 0)
      lines.push(
        notes.formulaCells === 1
          ? '1 cell starts with = + - @ or a tab: a spreadsheet may run it as a formula (turn on "Protect from formulas").'
          : `${count(notes.formulaCells)} cells start with = + - @ or a tab: a spreadsheet may run them as formulas (turn on "Protect from formulas").`,
      );
    if (notes.inexactNumbers > 0) lines.push(inexact(notes.inexactNumbers));
    const losses = describeLosses(notes.lost);
    if (losses) lines.push(losses);
    return lines;
  }
  if (notes.detected)
    lines.push(
      notes.fallback
        ? 'No delimiter found: read as comma-separated.'
        : `Detected delimiter: ${DELIMITER_NAMES[notes.delimiter]}.`,
    );
  if (notes.shortRows > 0)
    lines.push(
      notes.shortRows === 1
        ? '1 row has fewer fields than the header: the missing cells are empty.'
        : `${count(notes.shortRows)} rows have fewer fields than the header: the missing cells are empty.`,
    );
  if (notes.renamed.length > 0) {
    const shown = notes.renamed
      .slice(0, RENAMED_SHOWN)
      .map(r => `${r.column} (${r.from === '' ? 'empty' : r.from} → ${r.to})`)
      .join(', ');
    const more = notes.renamed.length - RENAMED_SHOWN;
    lines.push(`Renamed columns: ${shown}${more > 0 ? ` and ${count(more)} more` : ''}.`);
  }
  if (notes.inexactNumbers > 0) lines.push(inexact(notes.inexactNumbers));
  return lines;
};

/** Size of a text for people (§3): lines (\n, \r\n, \r) and UTF-8 bytes. Linear, no copies. */
export const measureText = (text: string): { lines: number; bytes: number } => {
  let lines = 1;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes++;
      if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) lines++;
    } else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return { lines, bytes };
};

/** `20.0 MB`: 1 MB = 1,048,576 bytes, one digit after the point. */
export const formatMegabytes = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;
