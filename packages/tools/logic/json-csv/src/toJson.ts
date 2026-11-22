/**
 * CSV → JSON (docs/tools/specs/json-csv.md §5): the records of the RFC 4180 reader, the first one as names (or an array
 * of arrays without a header row), types guessed by the look of a cell or not at all, dotted names nested on request.
 * The JSON is printed as text from the cells — never through a JavaScript number, so `12345678901234567890`, `1e5` and
 * `-0` come out as written; strings are escaped by `JSON.stringify`, which is exact for strings. Printing follows the
 * JSON tool's rules (json.md §5 «Результат»): Format puts every member on its own line, Minify writes no whitespace,
 * no line break at the end.
 */
import { detectDelimiter, readRecords } from './csv';
import { guarded } from './guard';
import { JSON_NUMBER, MAX_DEPTH, errorAt, isInexactNumber } from '@workspace/tools-shared/json-scan';
import type { Converted, ToJsonNotes, ToJsonOptions } from './types';
import type { Layout } from '@workspace/tools-shared/json-scan';

/** A printer that puts the commas itself: `open`, `key` (a name already in JSON quotes), `value` (JSON text), `close`. */
const jsonWriter = (layout: Layout) => {
  const pretty = layout !== 'minify';
  const unit = layout === 'tab' ? '\t' : layout === 4 ? '    ' : '  ';
  const breaks: string[] = ['\n'];
  const lineAt = (depth: number): string => (breaks[depth] ??= `\n${unit.repeat(depth)}`);
  const colon = pretty ? ': ' : ':';
  let out = '';
  let depth = 0;
  let empty = false;
  let named = false;
  const member = (): void => {
    if (named) {
      named = false;
      return;
    }
    if (depth > 0) {
      if (!empty) out += ',';
      if (pretty) out += lineAt(depth);
    }
    empty = false;
  };
  return {
    open: (bracket: '{' | '['): void => {
      member();
      out += bracket;
      depth++;
      empty = true;
    },
    close: (bracket: '}' | ']'): void => {
      depth--;
      if (empty) empty = false;
      else if (pretty) out += lineAt(depth);
      out += bracket;
    },
    key: (quoted: string): void => {
      member();
      out += quoted;
      out += colon;
      named = true;
    },
    value: (json: string): void => {
      member();
      out += json;
    },
    text: (): string => out,
  };
};

const TRUE = new Set(['true', 'True', 'TRUE']);
const FALSE = new Set(['false', 'False', 'FALSE']);

/** The header's names made unique and non-empty (§5 п. 6): empty → `column_<n>`, a repeat → `<name>_2`, `_3`… */
const uniqueNames = (header: string[]): { names: string[]; renamed: ToJsonNotes['renamed'] } => {
  const taken = new Set(header.filter(name => name !== ''));
  const seen = new Set<string>();
  const renamed: ToJsonNotes['renamed'] = [];
  const free = (base: string, first: number): string => {
    for (let k = first; ; k++) {
      const candidate = `${base}_${k}`;
      if (!taken.has(candidate)) return candidate;
    }
  };
  const names = header.map((name, i) => {
    let to = name;
    if (name === '') to = taken.has(`column_${i + 1}`) ? free(`column_${i + 1}`, 2) : `column_${i + 1}`;
    else if (seen.has(name)) to = free(name, 2);
    seen.add(name);
    if (to !== name) {
      taken.add(to);
      renamed.push({ column: i + 1, from: name, to });
    }
    return to;
  });
  return { names, renamed };
};

/** A column's name for a message: in JSON quotes, cut to 40 characters with `…`. */
const quoteName = (name: string): string => {
  if (name.length <= 40) return JSON.stringify(name);
  const cut = name.slice(0, (name.charCodeAt(39) & 0xfc00) === 0xd800 ? 39 : 40);
  return `${JSON.stringify(cut).slice(0, -1)}…"`;
};

/** One step of printing a nested record: open a group, a leaf (a column), close the group. */
type Step =
  | { op: 'open'; key: string; end: number; first: number; last: number }
  | { op: 'leaf'; key: string; column: number; leaf: number }
  | { op: 'close' };

interface Group {
  key: string;
  children: Map<string, Group | { key: string; column: number }>;
}

/** Nest dotted headers (§5 п. 7): the names cut at `.`, as a tree in column order, then as steps. Or the conflict. */
const nestedSteps = (
  names: string[],
): { ok: true; steps: Step[] } | { ok: false; value: number; child: number } | { ok: false; deep: number } => {
  const root: Group = { key: '', children: new Map() };
  /** The first column under each group, for the message. */
  const firstUnder = new Map<Group, number>();
  for (let column = 0; column < names.length; column++) {
    const parts = names[column]!.split('.');
    // Inside the array of records, as deep as the JSON scanner reads (MAX_DEPTH): the result stays readable JSON.
    if (parts.length >= MAX_DEPTH) return { ok: false, deep: column };
    let group = root;
    for (let k = 0; k < parts.length - 1; k++) {
      const found = group.children.get(parts[k]!);
      if (found && !('children' in found)) return { ok: false, value: found.column, child: column };
      if (found) group = found;
      else {
        const next: Group = { key: parts[k]!, children: new Map() };
        group.children.set(parts[k]!, next);
        firstUnder.set(next, column);
        group = next;
      }
    }
    const last = parts[parts.length - 1]!;
    const found = group.children.get(last);
    if (found && 'children' in found) return { ok: false, value: column, child: firstUnder.get(found)! };
    group.children.set(last, { key: last, column });
  }
  const steps: Step[] = [];
  let leaves = 0;
  // An explicit stack, so a name with thousands of dots does not reach the call stack.
  const stack: Array<{ items: Array<Group | { key: string; column: number }>; next: number; open: number }> = [
    { items: [...root.children.values()], next: 0, open: -1 },
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.next === top.items.length) {
      stack.pop();
      if (top.open >= 0) {
        const open = steps[top.open] as Extract<Step, { op: 'open' }>;
        open.end = steps.length;
        open.last = leaves;
        steps.push({ op: 'close' });
      }
      continue;
    }
    const item = top.items[top.next++]!;
    if ('children' in item) {
      steps.push({ op: 'open', key: JSON.stringify(item.key), end: -1, first: leaves, last: leaves });
      stack.push({ items: [...item.children.values()], next: 0, open: steps.length - 1 });
    } else steps.push({ op: 'leaf', key: JSON.stringify(item.key), column: item.column, leaf: leaves++ });
  }
  return { ok: true, steps };
};

/** CSV → JSON of §5. Throws nothing: an error comes back with its place. */
export const csvToJson = (text: string, options: ToJsonOptions): Converted<ToJsonNotes> =>
  guarded(text, () => convert(text, options));

const convert = (text: string, options: ToJsonOptions): Converted<ToJsonNotes> => {
  const found = options.delimiter === 'auto' ? detectDelimiter(text) : null;
  const delimiter = options.delimiter === 'auto' ? (found ?? ',') : options.delimiter;
  const read = readRecords(text, delimiter);
  if (!read.ok) return read;
  const { records } = read;
  const notes: ToJsonNotes = {
    delimiter,
    detected: options.delimiter === 'auto',
    fallback: options.delimiter === 'auto' && found === null,
    rows: 0,
    columns: 0,
    shortRows: 0,
    renamed: [],
    inexactNumbers: 0,
  };

  /** A cell as JSON text (§5 «Типы»), or undefined when Leave out drops it. */
  const valueOf = (cell: string, inArray: boolean): string | undefined => {
    if (cell === '')
      return options.empty === 'string' ? '""' : options.empty === 'null' || inArray ? 'null' : undefined;
    if (options.detectTypes) {
      const c = cell.charCodeAt(0);
      if ((c === 45 || (c >= 48 && c <= 57)) && JSON_NUMBER.test(cell)) {
        if (isInexactNumber(cell)) notes.inexactNumbers++;
        return cell;
      }
      if (TRUE.has(cell)) return 'true';
      if (FALSE.has(cell)) return 'false';
    }
    return JSON.stringify(cell);
  };

  const out = jsonWriter(options.layout);
  out.open('[');
  if (!options.header) {
    for (const record of records) {
      out.open('[');
      for (const cell of record.fields) out.value(valueOf(cell, true)!);
      out.close(']');
      notes.columns = Math.max(notes.columns, record.fields.length);
    }
    notes.rows = records.length;
    out.close(']');
    return { ok: true, text: out.text(), notes };
  }

  const header = records[0];
  if (!header) {
    out.close(']');
    return { ok: true, text: out.text(), notes };
  }
  const { names, renamed } = uniqueNames(header.fields);
  notes.renamed = renamed;
  notes.columns = names.length;
  notes.rows = records.length - 1;
  const width = names.length;

  let steps: Step[] | null = null;
  if (options.nest) {
    const nested = nestedSteps(names);
    if (!nested.ok) {
      const at = 'deep' in nested ? nested.deep : nested.value;
      const starts = readRecords(text, delimiter, 1, true);
      const offset = starts.ok ? (starts.starts?.[0]?.[at] ?? header.offset) : header.offset;
      const message =
        'deep' in nested
          ? `column ${quoteName(names[at]!)} nests deeper than ${MAX_DEPTH} levels`
          : `column ${quoteName(names[nested.value]!)} is both a value and the parent of ${quoteName(names[nested.child]!)}`;
      return { ok: false, error: errorAt(text, message, offset) };
    }
    steps = nested.steps;
  }
  const keys = names.map(name => JSON.stringify(name));
  const omit = options.empty === 'omit';
  const values: Array<string | undefined> = new Array<string | undefined>(width);
  /** Nested and Leave out: present[k] — leaves before the k-th (in printing order) that have a value. */
  const present = new Int32Array(width + 1);

  for (let r = 1; r < records.length; r++) {
    const { fields, offset } = records[r]!;
    if (fields.length > width)
      return {
        ok: false,
        error: errorAt(text, `this row has ${fields.length} fields, the header has ${width}`, offset),
      };
    if (fields.length < width) notes.shortRows++;
    out.open('{');
    if (!steps) {
      for (let j = 0; j < width; j++) {
        const value = valueOf(fields[j] ?? '', false);
        if (value === undefined) continue;
        out.key(keys[j]!);
        out.value(value);
      }
    } else {
      for (let j = 0; j < width; j++) values[j] = valueOf(fields[j] ?? '', false);
      if (omit) {
        let k = 0;
        for (const step of steps)
          if (step.op === 'leaf') {
            present[k + 1] = present[k]! + (values[step.column] === undefined ? 0 : 1);
            k++;
          }
      }
      for (let s = 0; s < steps.length; s++) {
        const step = steps[s]!;
        if (step.op === 'open') {
          // A group whose every leaf is left out is left out too.
          if (omit && present[step.last]! - present[step.first]! === 0) {
            s = step.end;
            continue;
          }
          out.key(step.key);
          out.open('{');
        } else if (step.op === 'leaf') {
          const value = values[step.column];
          if (value === undefined) continue;
          out.key(step.key);
          out.value(value);
        } else out.close('}');
      }
    }
    out.close('}');
  }
  out.close(']');
  return { ok: true, text: out.text(), notes };
};
