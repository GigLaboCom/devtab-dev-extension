/**
 * The shared JSON scanner (docs/tools/specs/json.md §5 «Разбор», §9): strict RFC 8259, JSONC on request, no
 * recursion, linear in the input, every literal kept as written. `JSON.parse` would turn `12345678901234567890` into
 * `12345678901234567000`, `1E400` into `Infinity`, `-0` into `0`, move integer-like keys to the front and drop a
 * repeated key; nothing here changes a value.
 *
 *   scanJson(text, options, sink?)   one pass over the tokens: a sink is told every bracket, key, value and comma in
 *                                    order with its UTF-16 offset; the answer is the notes or the first error
 *   parseJsonTree(text, options?)    the ordered tree, literals as written, duplicate keys kept and listed
 *   parseJsonValues(text, options?)  the same for several values one after another (samples of json-to-code)
 *
 * Errors are values, never exceptions, with the wording and the place of json.md §5 п. 6 and §10. Used by the `json`
 * tool and `yaml-json`; `json-csv` and `json-to-code` read JSON through it too (docs/tools/README.md, «Общий сканер
 * JSON»). A tool keeps its own printing, notes wording and limits.
 */

export interface JsonErrorInfo {
  message: string;
  /** UTF-16 offset of the problem in the input. */
  offset: number;
  /** 1-based; line breaks are \n, \r\n and \r. */
  line: number;
  /** 1-based UTF-16 column. */
  column: number;
}

export type Indent = 2 | 4 | 'tab';
export type Layout = Indent | 'minify';

export interface ParseOptions {
  /** JSONC: `//` and `/* *\/` comments wherever whitespace may stand, and one trailing comma per object or array. */
  allowComments: boolean;
}

export interface ScanOptions extends ParseOptions {
  /** Several values one after another, separated by whitespace (and comments): json-to-code's samples. Off: one. */
  multiple: boolean;
}

export interface DuplicateKey {
  /** The decoded name. */
  key: string;
  /** Of the repeated occurrence. */
  offset: number;
  line: number;
  column: number;
}

export interface JsonNotes {
  /** A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1). */
  bom: boolean;
  /** Comments skipped (JSONC only). */
  comments: number;
  /** Trailing commas skipped (JSONC only). */
  trailingCommas: number;
  duplicateKeys: DuplicateKey[];
  /** json.md §5 «Заметки»: integers beyond 2^53 − 1, literals that overflow to ±Infinity or underflow to 0. */
  inexactNumbers: number;
}

/**
 * Told every token, in order; offsets are UTF-16. A layout-preserving printer needs no more: the literals and names come
 * as written (`raw`), an empty object or array is an `open` followed by its `close`, and `comma` is called only between
 * two members (a trailing comma of JSONC and comments are skipped and counted in the notes).
 */
export interface JsonSink {
  open(bracket: '{' | '[', offset: number): void;
  close(bracket: '{' | '[', offset: number): void;
  /** raw: the name as written, with its quotes; name: decoded. */
  key(raw: string, offset: number, name: string): void;
  value(raw: string, kind: 'string' | 'number' | 'literal', offset: number): void;
  comma(): void;
}

export type JsonNode =
  | { type: 'object'; offset: number; entries: Array<{ key: string; raw: string; offset: number; value: JsonNode }> }
  | { type: 'array'; offset: number; items: JsonNode[] }
  | { type: 'string'; offset: number; raw: string; value: string }
  | { type: 'number'; offset: number; raw: string }
  | { type: 'boolean'; offset: number; value: boolean }
  | { type: 'null'; offset: number };

export type JsonScanResult =
  | { ok: true; notes: JsonNotes }
  /** atEnd: the error is at the end of the input — a prefix of valid JSON fails only so (detect reads a prefix). */
  | { ok: false; error: JsonErrorInfo; atEnd: boolean };
export type JsonTreeResult = { ok: true; tree: JsonNode; notes: JsonNotes } | { ok: false; error: JsonErrorInfo };
export type JsonValuesResult = { ok: true; values: JsonNode[]; notes: JsonNotes } | { ok: false; error: JsonErrorInfo };

/** Nested objects and arrays allowed (RFC 8259 §9 lets a parser set a limit). */
export const MAX_DEPTH = 1000;
/** A result larger than either is not put into a result field (json.md §12); other tools use the same limits. */
export const SHOW_RESULT_CHARS = 8 * 1024 * 1024;
export const SHOW_RESULT_LINES = 200_000;

/** The number grammar of RFC 8259 §6. No nested repetition: linear on any input. */
export const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** A JSON number literal a double cannot hold: JSON.parse in JavaScript would change it (json.md §5 «Заметки»). */
export const isInexactNumber = (raw: string): boolean => {
  const fraction = raw.includes('.');
  const exponent = raw.includes('e') || raw.includes('E');
  if (!fraction && !exponent) {
    // Fifteen digits or fewer always fit; only longer integers need the exact comparison.
    if (raw.length - (raw.charCodeAt(0) === 45 ? 1 : 0) <= 15) return false;
    const n = BigInt(raw);
    return n > MAX_SAFE || n < -MAX_SAFE;
  }
  // Without an exponent a literal this short can neither overflow nor underflow (the smallest double is ~4.9e-324).
  if (!exponent && raw.length <= 300) return false;
  const value = Number(raw);
  if (!Number.isFinite(value)) return true;
  // Underflow: the literal is not zero, the double is.
  return value === 0 && /[1-9]/.test(raw.replace(/[eE].*$/, ''));
};

const isBreak = (text: string, i: number): boolean => {
  const c = text.charCodeAt(i);
  return c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10);
};

/** Line and column (1-based, UTF-16) of an offset; \r\n is one line break, a lone \r is one too. */
export const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let start = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (isBreak(text, i)) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: offset - start + 1 };
};

/** Many positions in one text: the line starts once, then a binary search per offset. */
export const positionsIn = (text: string): ((offset: number) => { line: number; column: number }) => {
  let starts: number[] | null = null;
  return offset => {
    if (!starts) {
      starts = [0];
      for (let i = 0; i < text.length; i++) if (isBreak(text, i)) starts.push(i + 1);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! + 1 };
  };
};

export const errorAt = (text: string, message: string, offset: number): JsonErrorInfo => ({
  message,
  offset,
  ...positionOf(text, offset),
});

/** Strict UTF-8 (RFC 8259 §8.1); the decoder drops a byte order mark. */
export const decodeTextFile = (bytes: Uint8Array): { ok: true; text: string } | { ok: false; message: string } => {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, message: 'The file is not valid UTF-8 text.' };
  }
};

const INVISIBLE = /^[\p{White_Space}\p{Cc}\p{Cf}]$/u;

const hex4 = (cp: number): string => cp.toString(16).toUpperCase().padStart(4, '0');

/** A character outside JSON whitespace that a person cannot see (json.md §5 п. 6), or null. */
const invisibleAt = (text: string, at: number): string | null => {
  const cp = text.codePointAt(at);
  if (cp === undefined || cp === 32 || cp === 9 || cp === 10 || cp === 13) return null;
  return INVISIBLE.test(String.fromCodePoint(cp)) ? `unexpected U+${hex4(cp)} (an invisible character)` : null;
};

/** `unexpected "x"` for the character at `at` (a whole surrogate pair), `U+XXXX` when it is invisible. */
const unexpected = (text: string, at: number): string =>
  at >= text.length
    ? 'unexpected end of input'
    : (invisibleAt(text, at) ?? `unexpected ${JSON.stringify(String.fromCodePoint(text.codePointAt(at)!))}`);

const CONTROL_HINT: Record<number, string> = { 9: '\\t', 10: '\\n', 13: '\\r' };

/** `//` or `/*` where whitespace may stand, without JSONC. A tool with an option for comments adds how to turn it on. */
export const COMMENTS_NOT_ALLOWED = 'comments are not allowed in JSON';
const JSON_LINES =
  'unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read';

class JsonStop {
  constructor(
    readonly message: string,
    readonly at: number,
  ) {}
}

const isHex = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/** What may come next: a value (at the top, after ':'). */
const VALUE = 0;
/** After '[': a value or ']'. */
const FIRST_ITEM = 1;
/** After ',' in an array: a value (or ']' after a trailing comma in JSONC). */
const NEXT_ITEM = 2;
/** After '{': a name or '}'. */
const FIRST_KEY = 3;
/** After ',' in an object: a name (or '}' after a trailing comma in JSONC). */
const NEXT_KEY = 4;
/** After a name: ':'. */
const COLON = 5;
/** After a value: ',' or the closing bracket; at the top, the end (or the next value). */
const AFTER = 6;

interface Frame {
  object: boolean;
  /** The decoded names seen so far (objects only), for duplicate keys. */
  names: Set<string> | null;
}

/**
 * The iterative scanner of json.md §5 «Разбор»: one pass, an explicit stack of open brackets (MAX_DEPTH deep at most),
 * so no input reaches the call stack. Throws nothing: errors come back as values.
 */
export const scanJson = (text: string, options: Partial<ScanOptions> = {}, sink?: JsonSink): JsonScanResult => {
  const comments = options.allowComments === true;
  const multiple = options.multiple === true;
  const n = text.length;
  const bom = text.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;
  const notes: JsonNotes = { bom, comments: 0, trailingCommas: 0, duplicateKeys: [], inexactNumbers: 0 };
  const stack: Frame[] = [];
  let positions: ((offset: number) => { line: number; column: number }) | null = null;
  let expect: number = VALUE;
  /** Where the last value at the top ended (the JSON Lines hint looks at what follows it). */
  let topEnd = 0;
  /** A comma was read and the member after it has not started yet. */
  let comma = false;

  const fail = (message: string, at = i): never => {
    throw new JsonStop(message, at);
  };

  /** Whitespace, and comments when they are allowed. */
  const skip = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else if (c === 47) {
        const next = text.charCodeAt(i + 1);
        if (next !== 47 && next !== 42) return;
        if (!comments) fail(COMMENTS_NOT_ALLOWED);
        if (next === 47) {
          i += 2;
          while (i < n && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
        } else {
          const end = text.indexOf('*/', i + 2);
          if (end < 0) fail('unterminated comment');
          i = end + 2;
        }
        notes.comments++;
      } else return;
    }
  };

  /** A string at `i` (the opening quote). Returns whether it holds an escape; `i` ends after the closing quote. */
  const string = (): boolean => {
    let escaped = false;
    i++;
    for (;;) {
      if (i >= n) fail('unterminated string', n);
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return escaped;
      }
      if (c === 92) {
        escaped = true;
        const e = text.charCodeAt(i + 1);
        if (e === 117) {
          for (let k = 2; k < 6; k++) {
            if (i + k >= n) fail('unterminated string', n);
            if (!isHex(text.charCodeAt(i + k))) fail('invalid \\u escape: 4 hex digits expected');
          }
          i += 6;
        } else if (e === 34 || e === 92 || e === 47 || e === 98 || e === 102 || e === 110 || e === 114 || e === 116)
          i += 2;
        else if (i + 1 >= n) fail('unterminated string', n);
        else fail(`invalid escape "\\${String.fromCodePoint(text.codePointAt(i + 1)!)}"`);
        continue;
      }
      if (c < 0x20) {
        const hint = CONTROL_HINT[c];
        fail(`control character U+${hex4(c)} in a string${hint ? `; write it as ${hint}` : ''}`);
      }
      i++;
    }
  };

  const digits = (): void => {
    while (i < n && isDigit(text.charCodeAt(i))) i++;
  };

  /** A number at `i`; `i` ends after it. */
  const number = (): void => {
    const start = i;
    if (text.charCodeAt(i) === 45) {
      i++;
      if (i >= n) fail('unexpected end of input', n);
    }
    const first = text.charCodeAt(i);
    if (first === 48) {
      i++;
      if (isDigit(text.charCodeAt(i))) fail('leading zeros are not allowed', i - 1);
    } else if (isDigit(first)) digits();
    else fail('invalid number', start);
    if (text.charCodeAt(i) === 46) {
      i++;
      if (!isDigit(text.charCodeAt(i))) fail('expected a digit after "."');
      digits();
    }
    const e = text.charCodeAt(i);
    if (e === 101 || e === 69) {
      i++;
      const sign = text.charCodeAt(i);
      if (sign === 43 || sign === 45) i++;
      if (!isDigit(text.charCodeAt(i))) fail('expected a digit in the exponent');
      digits();
    }
  };

  /** `true`, `false` or `null` at `i`: the first character that differs is the error. */
  const literal = (word: string): void => {
    for (let k = 0; k < word.length; k++, i++) if (text.charCodeAt(i) !== word.charCodeAt(k)) fail(unexpected(text, i));
  };

  /** A member follows the comma before it: only now is the comma a separator, not a trailing one. */
  const separate = (): void => {
    if (!comma) return;
    comma = false;
    sink?.comma();
  };

  /** A value starts at `i` (whitespace skipped, not at the end). */
  const value = (): void => {
    const c = text.charCodeAt(i);
    const offset = i;
    separate();
    if (c === 123 || c === 91) {
      if (stack.length >= MAX_DEPTH) fail(`nesting deeper than ${MAX_DEPTH} levels`);
      i++;
      const object = c === 123;
      stack.push({ object, names: null });
      sink?.open(object ? '{' : '[', offset);
      expect = object ? FIRST_KEY : FIRST_ITEM;
      return;
    }
    if (c === 34) {
      string();
      sink?.value(text.slice(offset, i), 'string', offset);
    } else if (c === 45 || isDigit(c)) {
      number();
      const raw = text.slice(offset, i);
      if (isInexactNumber(raw)) notes.inexactNumbers++;
      sink?.value(raw, 'number', offset);
    } else if (c === 116 || c === 102 || c === 110) {
      literal(c === 116 ? 'true' : c === 102 ? 'false' : 'null');
      sink?.value(text.slice(offset, i), 'literal', offset);
    } else if (c === 39) fail('strings must be in double quotes');
    else fail(unexpected(text, i));
    expect = AFTER;
    if (stack.length === 0) topEnd = i;
  };

  /** A name at `i` (its quote), recorded in the object on top. */
  const key = (): void => {
    const offset = i;
    separate();
    const escaped = string();
    const raw = text.slice(offset, i);
    const name = escaped ? (JSON.parse(raw) as string) : raw.slice(1, -1);
    const frame = stack[stack.length - 1]!;
    if (frame.names === null) frame.names = new Set([name]);
    else if (frame.names.has(name)) {
      positions ??= positionsIn(text);
      notes.duplicateKeys.push({ key: name, offset, ...positions(offset) });
    } else frame.names.add(name);
    sink?.key(raw, offset, name);
    expect = COLON;
  };

  const close = (): void => {
    const frame = stack.pop()!;
    comma = false;
    sink?.close(frame.object ? '{' : '[', i);
    i++;
    expect = AFTER;
    if (stack.length === 0) topEnd = i;
  };

  try {
    for (;;) {
      skip();
      const end = i >= n;
      const c = text.charCodeAt(i);
      switch (expect) {
        case VALUE:
          if (end) fail(stack.length === 0 ? 'empty input' : 'unexpected end of input, expected a value', n);
          value();
          break;
        case FIRST_ITEM:
        case NEXT_ITEM:
          if (end)
            fail(
              expect === FIRST_ITEM || comments
                ? "unexpected end of input, expected a value or ']'"
                : 'unexpected end of input, expected a value',
              n,
            );
          if (c === 93) {
            if (expect === NEXT_ITEM) {
              if (!comments) fail('trailing comma');
              notes.trailingCommas++;
            }
            close();
          } else value();
          break;
        case FIRST_KEY:
        case NEXT_KEY:
          if (end)
            fail(
              expect === FIRST_KEY || comments
                ? "unexpected end of input, expected a property name or '}'"
                : 'unexpected end of input, expected a property name',
              n,
            );
          if (c === 34) key();
          else if (c === 125) {
            if (expect === NEXT_KEY) {
              if (!comments) fail('trailing comma');
              notes.trailingCommas++;
            }
            close();
          } else if (c === 39) fail('property names must be in double quotes');
          else fail(invisibleAt(text, i) ?? 'expected a property name in double quotes');
          break;
        case COLON:
          if (end) fail("unexpected end of input, expected ':'", n);
          if (c !== 58) fail(invisibleAt(text, i) ?? "expected ':'");
          i++;
          expect = VALUE;
          break;
        case AFTER: {
          const top = stack[stack.length - 1];
          if (!top) {
            if (end) return { ok: true, notes };
            if (multiple) {
              value();
              break;
            }
            const lines = /[\n\r]/.test(text.slice(topEnd, i)) && (c === 123 || c === 91);
            fail(lines ? JSON_LINES : 'unexpected text after the JSON value');
          }
          const closer = top!.object ? '}' : ']';
          if (end) fail(`unexpected end of input, expected ',' or '${closer}'`, n);
          if (c === 44) {
            i++;
            comma = true;
            expect = top!.object ? NEXT_KEY : NEXT_ITEM;
          } else if (c === (top!.object ? 125 : 93)) close();
          else fail(invisibleAt(text, i) ?? `expected ',' or '${closer}'`);
          break;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof JsonStop)) throw error;
    return {
      ok: false,
      error: { message: error.message, offset: error.at, ...positionOf(text, error.at) },
      atEnd: error.at >= n,
    };
  }
};

type ObjectNode = Extract<JsonNode, { type: 'object' }>;
type ArrayNode = Extract<JsonNode, { type: 'array' }>;

/** A sink that builds the ordered tree: literals as written, strings also decoded. */
const treeSink = (): JsonSink & { roots: JsonNode[] } => {
  type Key = { key: string; raw: string; offset: number };
  const roots: JsonNode[] = [];
  const open: Array<ObjectNode | ArrayNode> = [];
  /** The name each open object or array is the value of (null in an array or at the top). */
  const keys: Array<Key | null> = [];
  let pending: Key | null = null;
  const deliver = (node: JsonNode): void => {
    const top = open[open.length - 1];
    if (!top) roots.push(node);
    else if (top.type === 'array') top.items.push(node);
    else {
      top.entries.push({ ...pending!, value: node });
      pending = null;
    }
  };
  return {
    roots,
    open: (bracket, offset) => {
      open.push(bracket === '{' ? { type: 'object', offset, entries: [] } : { type: 'array', offset, items: [] });
      keys.push(pending);
      pending = null;
    },
    close: () => {
      const node = open.pop()!;
      pending = keys.pop()!;
      deliver(node);
    },
    key: (raw, offset, name) => {
      pending = { key: name, raw, offset };
    },
    value: (raw, kind, offset) => {
      if (kind === 'string')
        deliver({
          type: 'string',
          offset,
          raw,
          value: raw.includes('\\') ? (JSON.parse(raw) as string) : raw.slice(1, -1),
        });
      else if (kind === 'number') deliver({ type: 'number', offset, raw });
      else if (raw === 'null') deliver({ type: 'null', offset });
      else deliver({ type: 'boolean', offset, value: raw === 'true' });
    },
    comma: () => undefined,
  };
};

/** Ordered tree with literals as written; duplicate keys are kept and listed in the notes. Throws nothing. */
export const parseJsonTree = (text: string, options: Partial<ParseOptions> = {}): JsonTreeResult => {
  const sink = treeSink();
  const scanned = scanJson(text, { allowComments: options.allowComments === true }, sink);
  return scanned.ok ? { ok: true, tree: sink.roots[0]!, notes: scanned.notes } : { ok: false, error: scanned.error };
};

/**
 * Several values one after another, separated by whitespace (and comments when allowed): each an ordered tree with
 * literals as written. Blank input is `empty input`, as for one value. Throws nothing.
 */
export const parseJsonValues = (text: string, options: Partial<ParseOptions> = {}): JsonValuesResult => {
  const sink = treeSink();
  const scanned = scanJson(text, { allowComments: options.allowComments === true, multiple: true }, sink);
  return scanned.ok ? { ok: true, values: sink.roots, notes: scanned.notes } : { ok: false, error: scanned.error };
};
