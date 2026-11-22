/**
 * JSON → CSV (docs/tools/specs/json-csv.md §5): the JSON is read by the shared exact scanner (`parseJsonTree`), so a
 * number reaches its cell as written (`12345678901234567890`, `1.50`, `1E400`, `-0`), keys keep their order (integer
 * keys are not moved to the front) and a repeated key is seen. Accepted shapes: an array of objects (columns are the
 * union of their keys in order of first appearance), one object, an array of arrays (records as they are), an array of
 * values (one column, `value`). No recursion: nested values are walked with an explicit stack.
 */
import { fieldWriter, looksLikeFormula } from './csv';
import { guarded } from './guard';
import { JSON_NUMBER, errorAt, parseJsonTree } from '@workspace/tools-shared/json-scan';
import type { Converted, CsvLosses, ToCsvNotes, ToCsvOptions } from './types';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

type ObjectNode = Extract<JsonNode, { type: 'object' }>;
type Entry = ObjectNode['entries'][number];

export const ROOT_SHAPE = 'expected an array of objects, an array of arrays or one object';

const kindName = (node: JsonNode): string =>
  node.type === 'object'
    ? 'an object'
    : node.type === 'array'
      ? 'an array'
      : node.type === 'null'
        ? 'null'
        : node.type === 'boolean'
          ? 'true or false'
          : `a ${node.type}`;

const shapeOf = (node: JsonNode): 'object' | 'array' | 'value' =>
  node.type === 'object' ? 'object' : node.type === 'array' ? 'array' : 'value';

/** A value as compact JSON text, literals as written (`["a","b"]`, `{}`): a cell for an array or a nested object. */
export const compactJson = (node: JsonNode): string => {
  if (node.type === 'string' || node.type === 'number') return node.raw;
  if (node.type === 'boolean') return node.value ? 'true' : 'false';
  if (node.type === 'null') return 'null';
  let out = '';
  type Frame = { node: Extract<JsonNode, { type: 'object' | 'array' }>; next: number };
  const stack: Frame[] = [];
  const enter = (value: JsonNode): void => {
    if (value.type === 'object' || value.type === 'array') {
      out += value.type === 'object' ? '{' : '[';
      stack.push({ node: value, next: 0 });
    } else out += compactJson(value);
  };
  enter(node);
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const size = top.node.type === 'object' ? top.node.entries.length : top.node.items.length;
    if (top.next === size) {
      stack.pop();
      out += top.node.type === 'object' ? '}' : ']';
      continue;
    }
    if (top.next > 0) out += ',';
    if (top.node.type === 'object') {
      const entry = top.node.entries[top.next++]!;
      out += `${entry.raw}:`;
      enter(entry.value);
    } else enter(top.node.items[top.next++]!);
  }
  return out;
};

/** A string that CSV → JSON with Detect types reads back as a number or true/false (§5 «Типы»). */
const readsAsTyped = (value: string): boolean => {
  const c = value.charCodeAt(0);
  if (c === 45 || (c >= 48 && c <= 57)) return JSON_NUMBER.test(value);
  return /^(?:true|True|TRUE|false|False|FALSE)$/.test(value);
};

/** JSON → CSV of §5. Throws nothing: an error comes back with its place (the scanner's for JSON itself). */
export const jsonToCsv = (text: string, options: ToCsvOptions): Converted<ToCsvNotes> =>
  guarded(text, () => convert(text, options));

const convert = (text: string, options: ToCsvOptions): Converted<ToCsvNotes> => {
  const parsed = parseJsonTree(text);
  if (!parsed.ok) return parsed;
  const { tree, notes: scanned } = parsed;
  const lost: CsvLosses = { blanks: 0, typedStrings: 0, jsonText: 0, flattened: false, emptyNames: 0 };
  const notes: ToCsvNotes = {
    rows: 0,
    columns: 0,
    protectedCells: 0,
    emptyArray: false,
    inexactNumbers: scanned.inexactNumbers,
    formulaCells: 0,
    lost,
  };

  let items: JsonNode[];
  if (tree.type === 'object') items = [tree];
  else if (tree.type === 'array') items = tree.items;
  else return { ok: false, error: errorAt(text, ROOT_SHAPE, tree.offset) };
  if (items.length === 0) {
    notes.emptyArray = true;
    return { ok: true, text: '', notes };
  }
  const shape = shapeOf(items[0]!);
  for (const item of items)
    if (shapeOf(item) !== shape)
      return {
        ok: false,
        error: errorAt(
          text,
          `every item must be of one kind: the first is ${kindName(items[0]!)}, this one is ${kindName(item)}`,
          item.offset,
        ),
      };

  const write = fieldWriter(options.delimiter, options.quoteAll);
  /** A string goes into a cell: the formula guard of §5 «Формулы», then the quoting of §5 «Запись CSV». */
  const stringField = (value: string): string => {
    if (looksLikeFormula(value)) {
      if (options.protectFormulas) {
        notes.protectedCells++;
        return write(`'${value}`, true);
      }
      notes.formulaCells++;
    }
    return write(value);
  };
  /** Any value as its cell (§5 «JSON → CSV: значения и колонки» п. 1). */
  const cell = (node: JsonNode): string => {
    switch (node.type) {
      case 'string':
        if (node.value === '') lost.blanks++;
        else if (readsAsTyped(node.value)) lost.typedStrings++;
        return stringField(node.value);
      case 'number':
        return write(node.raw);
      case 'boolean':
        return write(node.value ? 'true' : 'false');
      case 'null':
        return write('');
      default:
        lost.jsonText++;
        return write(compactJson(node));
    }
  };

  /** The fields of each record, by column (undefined: a missing key, an empty cell). */
  const rows: Array<Array<string | undefined>> = [];
  let names: string[] = [];

  if (shape === 'array') {
    for (const item of items) rows.push((item as Extract<JsonNode, { type: 'array' }>).items.map(cell));
    notes.columns = rows.reduce((max, r) => Math.max(max, r.length), 0);
  } else if (shape === 'value') {
    names = ['value'];
    for (const item of items) rows.push([cell(item)]);
    notes.columns = 1;
  } else {
    const repeated = scanned.duplicateKeys.length > 0 ? new Set(scanned.duplicateKeys.map(k => k.offset)) : null;
    const columns = new Map<string, number>();
    /** The row that last wrote each column: a second write in one row is the error of §5 п. 2. */
    const written: number[] = [];
    for (let row = 0; row < items.length; row++) {
      const fields: Array<string | undefined> = [];
      const stack: Array<{ entries: Entry[]; next: number; prefix: string }> = [
        { entries: (items[row] as ObjectNode).entries, next: 0, prefix: '' },
      ];
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        if (top.next === top.entries.length) {
          stack.pop();
          continue;
        }
        const entry = top.entries[top.next++]!;
        if (repeated?.has(entry.offset))
          return {
            ok: false,
            error: errorAt(
              text,
              `duplicate key ${JSON.stringify(entry.key)}: a row can't have two values for one column`,
              entry.offset,
            ),
          };
        const name = top.prefix + entry.key;
        const value = entry.value;
        if (options.flatten && value.type === 'object' && value.entries.length > 0) {
          lost.flattened = true;
          stack.push({ entries: value.entries, next: 0, prefix: `${name}.` });
          continue;
        }
        let column = columns.get(name);
        if (column === undefined) {
          column = names.length;
          columns.set(name, column);
          names.push(name);
        } else if (written[column] === row)
          return {
            ok: false,
            error: errorAt(
              text,
              `two values for column ${JSON.stringify(name)} in one row (a key with a dot and a nested object?)`,
              entry.offset,
            ),
          };
        written[column] = row;
        fields[column] = cell(value);
      }
      rows.push(fields);
    }
    notes.columns = names.length;
  }
  notes.rows = rows.length;

  const width = notes.columns;
  if (width === 0) return { ok: true, text: '', notes };
  const empty = write('');
  /** One record; a record of one empty field is `""`, or it would be a blank line, which a reader skips. */
  const record = (fields: Array<string | undefined>, length: number): string => {
    if (length === 1) return fields[0] === undefined || fields[0] === '' ? '""' : fields[0];
    let line = '';
    for (let j = 0; j < length; j++) {
      if (j > 0) line += options.delimiter;
      line += fields[j] ?? empty;
    }
    return line;
  };
  const lines: string[] = [];
  if (options.header && shape !== 'array') {
    lost.emptyNames = names.filter(name => name === '').length;
    lines.push(record(names.map(stringField), width));
  }
  for (const fields of rows) {
    if (shape === 'object') for (let j = 0; j < width; j++) if (fields[j] === undefined) lost.blanks++;
    lines.push(record(fields, shape === 'array' ? fields.length : width));
  }
  const nl = options.newline;
  return { ok: true, text: lines.join(nl) + nl, notes };
};

/** For Save: U+FEFF + text when Add BOM is on. */
export const withBom = (text: string): string => `\uFEFF${text}`;
