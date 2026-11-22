/**
 * Reading and writing CSV (docs/tools/specs/json-csv.md §5): RFC 4180 with the liberties the specification allows —
 * records end at CRLF, LF or a lone CR; a byte order mark at the start and blank lines are skipped; a quote inside an
 * unquoted field is an ordinary character; spaces around values belong to them. One pass, no regular expression on the
 * input, no recursion: linear in the text.
 */
import { DELIMITERS, SAMPLE_RECORDS } from './types';
import { errorAt } from '@workspace/tools-shared/json-scan';
import type { CsvRecord, Delimiter } from './types';
import type { JsonErrorInfo } from '@workspace/tools-shared/json-scan';

const QUOTE = 34;
const LF = 10;
const CR = 13;

export const UNCLOSED_QUOTE = 'unclosed quote: the field never ends';
export const TEXT_AFTER_QUOTE = 'unexpected text after a closing quote (a quote inside a field must be doubled: "")';

export interface ReadRecords {
  ok: true;
  records: CsvRecord[];
  /** Where reading stopped: the end of the text, or after the last record's line break when maxRecords stopped it. */
  end: number;
  /** With `starts`: the offset of each field of each record. */
  starts?: number[][];
}

export type ReadResult = ReadRecords | { ok: false; error: JsonErrorInfo };

/** The reader of §5 «CSV → JSON: чтение», with the field offsets on request (the place of a header's error). */
export const readRecords = (
  text: string,
  delimiter: Delimiter,
  maxRecords = Number.POSITIVE_INFINITY,
  withStarts = false,
): ReadResult => {
  const d = delimiter.charCodeAt(0);
  const n = text.length;
  const records: CsvRecord[] = [];
  const starts: number[][] | undefined = withStarts ? [] : undefined;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < n && records.length < maxRecords) {
    const first = text.charCodeAt(i);
    // A line with nothing on it is not a record (§5 п. 1).
    if (first === LF) {
      i++;
      continue;
    }
    if (first === CR) {
      i += text.charCodeAt(i + 1) === LF ? 2 : 1;
      continue;
    }
    const offset = i;
    const fields: string[] = [];
    const fieldStarts: number[] | undefined = starts ? [] : undefined;
    for (;;) {
      fieldStarts?.push(i);
      if (text.charCodeAt(i) === QUOTE) {
        const open = i;
        let from = i + 1;
        let value = '';
        for (;;) {
          const q = text.indexOf('"', from);
          if (q < 0) return { ok: false, error: errorAt(text, UNCLOSED_QUOTE, open) };
          if (text.charCodeAt(q + 1) === QUOTE) {
            value += text.slice(from, q + 1);
            from = q + 2;
            continue;
          }
          value += text.slice(from, q);
          i = q + 1;
          break;
        }
        fields.push(value);
        const c = text.charCodeAt(i);
        if (c === d) {
          i++;
          continue;
        }
        if (i < n && c !== LF && c !== CR) return { ok: false, error: errorAt(text, TEXT_AFTER_QUOTE, i) };
      } else {
        const start = i;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === d || c === LF || c === CR) break;
          i++;
        }
        fields.push(text.slice(start, i));
        if (i < n && text.charCodeAt(i) === d) {
          i++;
          continue;
        }
      }
      break;
    }
    records.push({ offset, fields });
    if (starts && fieldStarts) starts.push(fieldStarts);
    if (i < n) i += text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
  }
  return starts ? { ok: true, records, end: i, starts } : { ok: true, records, end: i };
};

/** RFC 4180 reader of §5; throws nothing. maxRecords stops early (detection). */
export const readCsv = (
  text: string,
  delimiter: Delimiter,
  maxRecords?: number,
): { ok: true; records: CsvRecord[] } | { ok: false; error: JsonErrorInfo } => {
  const read = readRecords(text, delimiter, maxRecords);
  return read.ok ? { ok: true, records: read.records } : read;
};

/**
 * §5 «Разделитель»: the first SAMPLE_RECORDS records are read with each of `,` `;` tab `|`; a delimiter fits when every
 * one of them has the same number of fields, at least two; the one that gives more fields wins, a tie goes to the
 * earlier in the list. None fits: null (the caller reads with a comma).
 */
export const detectDelimiter = (text: string): Delimiter | null => {
  let best: Delimiter | null = null;
  let bestFields = 1;
  for (const delimiter of DELIMITERS) {
    // A delimiter that is not in the text at all cannot give two fields.
    if (!text.includes(delimiter)) continue;
    const read = readRecords(text, delimiter, SAMPLE_RECORDS);
    if (!read.ok || read.records.length === 0) continue;
    const fields = read.records[0]!.fields.length;
    if (fields <= bestFields || read.records.some(r => r.fields.length !== fields)) continue;
    best = delimiter;
    bestFields = fields;
  }
  return best;
};

export const DELIMITER_NAMES: Record<Delimiter, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

/**
 * A cell a spreadsheet would run as a formula (§5 «Формулы»; OWASP, «CSV Injection»): it starts with `=`, `+`, `-`,
 * `@`, a tab or a carriage return.
 */
export const looksLikeFormula = (value: string): boolean => {
  const c = value.charCodeAt(0);
  return c === 61 || c === 43 || c === 45 || c === 64 || c === 9 || c === CR;
};

/** One field of §5 «Запись CSV»: quoted when it must be (§2.6) or is asked to be, inner quotes doubled (§2.7). */
export const fieldWriter = (delimiter: Delimiter, quoteAll: boolean): ((value: string, quote?: boolean) => string) => {
  const d = delimiter.charCodeAt(0);
  const needsQuotes = (value: string): boolean => {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === d || c === QUOTE || c === LF || c === CR) return true;
    }
    return false;
  };
  return (value, quote = false) =>
    quoteAll || quote || needsQuotes(value) ? `"${value.includes('"') ? value.replaceAll('"', '""') : value}"` : value;
};
