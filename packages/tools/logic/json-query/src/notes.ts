/**
 * Notes that are not errors (docs/tools/specs/json-query.md §5 п. 22, §6): about a pattern literal of `match()` or
 * `search()` that is not an I-Regexp (the function is then false for every node — valid, but surely not meant); and
 * about the document — repeated names, numbers a double cannot hold, a byte order mark.
 */
import { checkIRegexp } from './iregexp';
import { quoteName } from './paths';
import type { Argument, Call, Comparable, LogicalExpr, Query } from './parse';
import type { DuplicateKey, JsonNotes } from '@workspace/tools-shared/json-scan';

const MAX_NOTES = 3;

type Item = Query | LogicalExpr | Comparable | Argument | Call;

/** The calls of a query, in order, walked with an explicit stack. */
const callsOf = (query: Query): Call[] => {
  const calls: Call[] = [];
  const stack: Item[] = [query];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if ('segments' in item) {
      for (let s = item.segments.length - 1; s >= 0; s--)
        for (let k = item.segments[s]!.selectors.length - 1; k >= 0; k--) {
          const sel = item.segments[s]!.selectors[k]!;
          if (sel.kind === 'filter') stack.push(sel.expr);
        }
      continue;
    }
    if ('name' in item && 'args' in item) {
      calls.push(item);
      for (let k = item.args.length - 1; k >= 0; k--) stack.push(item.args[k]!);
      continue;
    }
    switch (item.kind) {
      case 'or':
      case 'and':
        for (let k = item.items.length - 1; k >= 0; k--) stack.push(item.items[k]!);
        break;
      case 'not':
        stack.push(item.expr);
        break;
      case 'compare':
        stack.push(item.right, item.left);
        break;
      case 'exists':
      case 'query':
        stack.push(item.query);
        break;
      case 'test':
      case 'call':
        stack.push(item.call);
        break;
      case 'logical':
        stack.push(item.expr);
        break;
      case 'literal':
        break;
    }
  }
  return calls;
};

/** The notes about a parsed query's pattern literals, at most three, each once. */
export const queryNotes = (query: Query): string[] => {
  const notes: string[] = [];
  for (const c of callsOf(query)) {
    if (c.name !== 'match' && c.name !== 'search') continue;
    const p = c.args[1];
    if (p?.kind !== 'literal' || p.literal.type !== 'string') continue;
    const pattern = p.literal.value;
    const checked = checkIRegexp(pattern);
    if (checked.ok) continue;
    const note = `The pattern ${quoteName(pattern)} of ${c.name}() is not an I-Regexp (RFC 9485): ${checked.message}, so ${c.name}() is false for every node.`;
    if (!notes.includes(note)) notes.push(note);
    if (notes.length === MAX_NOTES) break;
  }
  return notes;
};

const showKey = (key: string): string => {
  const quoted = JSON.stringify(key);
  return quoted.length > 40 ? `${quoted.slice(0, 39)}…` : quoted;
};

const at = (d: DuplicateKey): string => `${showKey(d.key)} at line ${d.line}, column ${d.column}`;

/** The note lines under the document, in order. */
export const documentNotes = (notes: Pick<JsonNotes, 'bom' | 'duplicateKeys' | 'inexactNumbers'>): string[] => {
  const out: string[] = [];
  if (notes.bom) out.push('A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1).');
  const dup = notes.duplicateKeys;
  if (dup.length === 1) out.push(`Duplicate key ${at(dup[0]!)}: a name selector selects every member with this name.`);
  else if (dup.length > 1)
    out.push(
      `${dup.length.toLocaleString('en-US')} duplicate keys, the first: ${at(dup[0]!)}. A name selector selects every member with its name.`,
    );
  const k = notes.inexactNumbers;
  if (k === 1) out.push('1 number is kept as written and compared exactly: JSON.parse in JavaScript would change it.');
  else if (k > 1)
    out.push(
      `${k.toLocaleString('en-US')} numbers are kept as written and compared exactly: JSON.parse in JavaScript would change them.`,
    );
  return out;
};
