/**
 * The lists of Match and Summarize (docs/tools/specs/subnet.md §3, §5 п. 20, 29): entries by line or comma, text from
 * `#` to the end of the line skipped, each entry read by `parseEntry` with its line number. One linear pass.
 */
import { parseEntry } from './block';
import type { Address, TextError } from './address';
import type { Entry, Note } from './block';

export const MAX_LIST_CHARS = 8 * 1024 * 1024;
export const MAX_ENTRIES = 500_000;

export interface ListItem {
  /** The line of the field, from 1. */
  line: number;
  text: string;
  entry: Entry;
}

export interface ListError {
  line: number;
  error: TextError;
}

export interface ParsedList {
  items: ListItem[];
  errors: ListError[];
  /** Notes by kind: the first line that has it and how many lines do. */
  notes: { line: number; note: Note; count: number }[];
  /** Set when the list is over the limits: nothing is read then. */
  tooLong?: string;
}

/** Reads a list: blocks, addresses and ranges (`addresses: true` — addresses only, as the Addresses field wants). */
export const parseList = (text: string, options: { addresses?: boolean } = {}): ParsedList => {
  if (text.length > MAX_LIST_CHARS)
    return { items: [], errors: [], notes: [], tooLong: 'The list is longer than 8 MB.' };
  const items: ListItem[] = [];
  const errors: ListError[] = [];
  const notes = new Map<string, { line: number; note: Note; count: number }>();
  let line = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    line++;
    let content = text.slice(start, end);
    if (content.endsWith('\r')) content = content.slice(0, -1);
    const hash = content.indexOf('#');
    if (hash !== -1) content = content.slice(0, hash);
    let from = 0;
    while (from <= content.length) {
      let comma = content.indexOf(',', from);
      if (comma === -1) comma = content.length;
      const piece = content.slice(from, comma);
      if (piece.trim() !== '') {
        if (items.length + errors.length >= MAX_ENTRIES)
          return { items: [], errors: [], notes: [], tooLong: 'The list has more than 500,000 entries.' };
        const read = parseEntry(piece, from);
        if (!read.ok) errors.push({ line, error: read.error });
        else if (options.addresses && !(read.entry.kind === 'block' && read.entry.fromAddress)) {
          const range = read.entry.kind === 'range';
          errors.push({
            line,
            error: {
              message: range
                ? 'A range, not an address: ranges go in the Blocks list.'
                : 'A block, not an address: blocks go in the Blocks list.',
              start: from,
              end: comma,
            },
          });
        } else {
          items.push({ line, text: piece.trim(), entry: read.entry });
          for (const note of read.entry.notes) {
            const seen = notes.get(note.kind);
            if (seen) seen.count++;
            else notes.set(note.kind, { line, note, count: 1 });
          }
        }
      }
      from = comma + 1;
    }
    start = end + 1;
  }
  return { items, errors, notes: [...notes.values()] };
};

/** The address of an Addresses entry (a block written as one address). */
export const addressOf = (item: ListItem): Address => {
  const entry = item.entry as Extract<Entry, { kind: 'block' }>;
  return entry.address ?? { family: entry.block.family, value: entry.block.network };
};

/** 'Line 3: … (and 4 more lines that could not be read)' — the first error of a list and the count. */
export const listErrorText = (errors: readonly ListError[]): string => {
  if (!errors.length) return '';
  const first = errors[0]!;
  const lines = new Set(errors.map(e => e.line));
  const more = lines.size - 1;
  const tail = more ? ` (and ${more} more ${more === 1 ? 'line' : 'lines'} that could not be read)` : '';
  return `Line ${first.line}: ${first.error.message}${tail}`;
};

/** 'Line 4: host bits are set, read as 10.0.12.0/22 (and 2 more lines like it).' for the host-bits note. */
export const listNoteText = (note: { line: number; note: Note; count: number }): string => {
  const more = note.count - 1;
  const tail = more ? ` (and ${more} more ${more === 1 ? 'line' : 'lines'} like it)` : '';
  if (note.note.kind === 'host-bits') {
    const block = /in the block (\S+)\.$/.exec(note.note.text)?.[1] ?? '';
    return `Line ${note.line}: host bits are set, read as ${block}${tail}.`;
  }
  return `Line ${note.line}: ${note.note.text.replace(/\.$/, '')}${tail}.`;
};
