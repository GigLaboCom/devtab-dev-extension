/**
 * The JSON tool's logic (docs/tools/specs/json.md §5, §9): check, format, minify and sort keys without changing a value.
 * Reading is the shared exact scanner (@workspace/tools-shared/json-scan): one pass, no recursion, literals as written.
 * Printing only changes the whitespace between tokens — and the order of members when Sort keys asks for it: without
 * Sort keys the scanner's tokens go straight into the printer (no tree); with it, the ordered tree is printed back in
 * code-point order of the decoded names, by a loop, not a recursion. Sizes are the component's to check (LIVE_INPUT,
 * MAX_INPUT); these functions take any input.
 */
import { COMMENTS_NOT_ALLOWED, MAX_DEPTH, parseJsonTree, scanJson } from '@workspace/tools-shared/json-scan';
import type {
  JsonErrorInfo,
  JsonNode,
  JsonNotes,
  JsonSink,
  Layout,
  ParseOptions,
} from '@workspace/tools-shared/json-scan';

export interface PrintOptions extends ParseOptions {
  layout: Layout;
  sortKeys: boolean;
}

export type JsonCheck = { ok: true; notes: JsonNotes } | { ok: false; error: JsonErrorInfo };
export type JsonResult = { ok: true; text: string; notes: JsonNotes } | { ok: false; error: JsonErrorInfo };

/** Characters of input recomputed on every change (§12); above it, by Run. */
export const LIVE_INPUT = 256 * 1024;
/** Characters of input (and bytes of a file) accepted at all (§12). */
export const MAX_INPUT = 32 * 1024 * 1024;
/** `detectJson` checks the whole text up to this many characters, and only the start of a longer one (§7). */
export const DETECT_WHOLE_CHARS = 1024 * 1024;
export const DETECT_PREFIX_CHARS = 64 * 1024;

/** The deepest nesting accepted (§5 «Разбор» п. 3), the shared scanner's. */
export { MAX_DEPTH };

/** The scanner's words, and where this tool has an option for it, how to turn it on (§5 п. 5). */
const explain = (error: JsonErrorInfo): JsonErrorInfo =>
  error.message === COMMENTS_NOT_ALLOWED
    ? { ...error, message: `${COMMENTS_NOT_ALLOWED} (turn on "Allow comments")` }
    : error;

/** Validates without building the result (the status line). Empty input gives `empty input`. */
export const checkJson = (text: string, options: Partial<ParseOptions> = {}): JsonCheck => {
  const scanned = scanJson(text, { allowComments: options.allowComments === true });
  return scanned.ok ? { ok: true, notes: scanned.notes } : { ok: false, error: explain(scanned.error) };
};

/**
 * A printer of tokens (§5 «Результат»): Format puts every member on its own line one indent deeper, `"name": value`,
 * `{}` and `[]` when empty; Minify writes no whitespace at all. The tokens themselves are copied as they come.
 */
const printer = (layout: Layout): JsonSink & { text: () => string } => {
  const pretty = layout !== 'minify';
  const unit = layout === 'tab' ? '\t' : layout === 4 ? '    ' : '  ';
  const breaks: string[] = ['\n'];
  const lineAt = (depth: number): string => (breaks[depth] ??= `\n${unit.repeat(depth)}`);
  const colon = pretty ? ': ' : ':';
  let out = '';
  let depth = 0;
  /** An object or array was opened and nothing is in it yet: it closes as `{}` / `[]`. */
  let empty = false;
  /** A name was just written: its value follows on the same line. */
  let named = false;
  const member = (): void => {
    if (named) named = false;
    else if (pretty && depth > 0) out += lineAt(depth);
    empty = false;
  };
  return {
    open: bracket => {
      member();
      out += bracket;
      depth++;
      empty = true;
    },
    close: bracket => {
      depth--;
      if (empty) empty = false;
      else if (pretty) out += lineAt(depth);
      out += bracket === '{' ? '}' : ']';
    },
    key: raw => {
      member();
      out += raw;
      out += colon;
      named = true;
    },
    value: raw => {
      member();
      out += raw;
    },
    comma: () => {
      out += ',';
    },
    text: () => out,
  };
};

/**
 * Code-point order of two strings (Sort keys, §5 «Результат» п. 5): `B` < `_` < `a` < `b` < `ä`, and a character above
 * U+FFFF after U+E000–U+FFFF — where the order of UTF-16 units, JavaScript's `<`, would put it before them.
 */
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

export const compareKeys = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // The first unit that differs; after the same high surrogate, a low one is the second half of one character.
    const from = i > 0 && isHigh(a.charCodeAt(i - 1)) && (isLow(x) || isLow(y)) ? i - 1 : i;
    return a.codePointAt(from)! - b.codePointAt(from)!;
  }
  return a.length - b.length;
};

type Container = Extract<JsonNode, { type: 'object' | 'array' }>;

/** Prints the tree with every object's members in code-point order (stable: repeated names keep their order). */
const printSorted = (tree: JsonNode, sink: JsonSink): void => {
  const scalar = (node: JsonNode): void => {
    if (node.type === 'string' || node.type === 'number') sink.value(node.raw, node.type, node.offset);
    else if (node.type === 'boolean') sink.value(node.value ? 'true' : 'false', 'literal', node.offset);
    else sink.value('null', 'literal', node.offset);
  };
  const stack: Array<{ node: Container; next: number; members: unknown[] }> = [];
  const enter = (node: JsonNode): void => {
    if (node.type !== 'object' && node.type !== 'array') return scalar(node);
    sink.open(node.type === 'object' ? '{' : '[', node.offset);
    const members = node.type === 'object' ? [...node.entries].sort((x, y) => compareKeys(x.key, y.key)) : node.items;
    stack.push({ node, next: 0, members });
  };
  enter(tree);
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.next === top.members.length) {
      stack.pop();
      sink.close(top.node.type === 'object' ? '{' : '[', top.node.offset);
      continue;
    }
    if (top.next > 0) sink.comma();
    const member = top.members[top.next++];
    if (top.node.type === 'object') {
      const entry = member as Extract<JsonNode, { type: 'object' }>['entries'][number];
      sink.key(entry.raw, entry.offset, entry.key);
      enter(entry.value);
    } else enter(member as JsonNode);
  }
};

/** Format or minify; literals copied as written (§5). Throws nothing: an error comes back with its place. */
export const printJson = (text: string, options: PrintOptions): JsonResult => {
  const out = printer(options.layout);
  const parse = { allowComments: options.allowComments === true };
  if (options.sortKeys) {
    const parsed = parseJsonTree(text, parse);
    if (!parsed.ok) return { ok: false, error: explain(parsed.error) };
    printSorted(parsed.tree, out);
    return { ok: true, text: out.text(), notes: parsed.notes };
  }
  const scanned = scanJson(text, parse, out);
  return scanned.ok
    ? { ok: true, text: out.text(), notes: scanned.notes }
    : { ok: false, error: explain(scanned.error) };
};

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A name for a note: in JSON quotes, cut to 40 characters with `…` (§5 «Заметки»). */
const quoteKey = (key: string): string => {
  if (key.length <= 40) return JSON.stringify(key);
  let cut = key.slice(0, 40);
  const last = cut.charCodeAt(39);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, 39);
  return `${JSON.stringify(cut).slice(0, -1)}…"`;
};

/** The note lines of §5, in order. */
export const describeNotes = (notes: JsonNotes): string[] => {
  const lines: string[] = [];
  if (notes.bom) lines.push('A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1).');
  if (notes.comments > 0 || notes.trailingCommas > 0) {
    const parts = [
      notes.comments > 0 ? plural(notes.comments, 'comment', 'comments') : '',
      notes.trailingCommas > 0 ? plural(notes.trailingCommas, 'trailing comma', 'trailing commas') : '',
    ].filter(Boolean);
    lines.push(`Removed ${parts.join(' and ')}: the result is strict JSON.`);
  }
  const [first] = notes.duplicateKeys;
  if (first) {
    const place = `${quoteKey(first.key)} at line ${first.line.toLocaleString('en-US')}, column ${first.column.toLocaleString('en-US')}`;
    lines.push(
      notes.duplicateKeys.length === 1
        ? `Duplicate key ${place}. Both are kept; parsers disagree on which one wins (RFC 8259 §4).`
        : `${notes.duplicateKeys.length.toLocaleString('en-US')} duplicate keys, the first: ${place}. All are kept; parsers disagree on which one wins (RFC 8259 §4).`,
    );
  }
  if (notes.inexactNumbers > 0)
    lines.push(
      notes.inexactNumbers === 1
        ? "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it."
        : `${notes.inexactNumbers.toLocaleString('en-US')} numbers are kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change them.`,
    );
  return lines;
};

/**
 * Recognises JSON pasted anywhere (§7): after trimming, an object or an array that passes the strict check — the whole
 * text up to DETECT_WHOLE_CHARS, above it the first DETECT_PREFIX_CHARS, which may fail only at their own end. So the
 * answer costs the same for any size. JSONC and JSON Lines are not recognised: the strict check refuses both.
 */
export const detectJson = (text: string): boolean => {
  const trimmed = text.trim();
  const first = trimmed.charCodeAt(0);
  if (first !== 123 && first !== 91) return false;
  if (trimmed.length <= DETECT_WHOLE_CHARS) return scanJson(trimmed).ok;
  const head = scanJson(trimmed.slice(0, DETECT_PREFIX_CHARS));
  return head.ok || head.atEnd;
};

/** Size of a text for people (§3, §8): characters, lines (\n, \r\n, \r) and UTF-8 bytes. Linear, no copies. */
export const measureText = (text: string): { chars: number; lines: number; bytes: number } => {
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
  return { chars: text.length, lines, bytes };
};

/** `20.0 MB`: 1 MB = 1,048,576 bytes (or characters), one digit after the point (§8). */
export const formatMegabytes = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;
