/**
 * An exact JSON reader: strict RFC 8259, no recursion, every literal kept as written (docs/tools/specs/json.md §5
 * «Разбор», §9 — the shared scanner the specifications name, which does not exist yet). `JSON.parse` would turn
 * `12345678901234567890` into `12345678901234567000`, `1E400` into `Infinity` and drop a repeated key; this tree keeps
 * them, so JSON → YAML can print the numbers exactly as they came.
 *
 * Kept small and free of the tool's own types so it can move into @workspace/tools-shared as the shared scanner: the
 * names and shapes follow json.md §9 (`JsonNode`, `parseJsonTree`, `isInexactNumber`, `positionOf`, `decodeTextFile`,
 * `JsonErrorInfo`, `Layout`, `MAX_DEPTH`). What json.md also asks of it and this tool does not need — JSONC comments,
 * the token sink `scanJson` — is not here.
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

export interface DuplicateKey {
  /** The decoded name. */
  key: string;
  /** Of the repeated occurrence. */
  offset: number;
  line: number;
  column: number;
}

export interface JsonTreeNotes {
  /** A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1). */
  bom: boolean;
  duplicateKeys: DuplicateKey[];
  /** Integers beyond 2^53 − 1, literals that overflow to ±Infinity or underflow to 0 (json.md §5 «Заметки»). */
  inexactNumbers: number;
}

export type JsonNode =
  | { type: 'object'; offset: number; entries: Array<{ key: string; raw: string; offset: number; value: JsonNode }> }
  | { type: 'array'; offset: number; items: JsonNode[] }
  | { type: 'string'; offset: number; raw: string; value: string }
  | { type: 'number'; offset: number; raw: string }
  | { type: 'boolean'; offset: number; value: boolean }
  | { type: 'null'; offset: number };

export type JsonTreeResult = { ok: true; tree: JsonNode; notes: JsonTreeNotes } | { ok: false; error: JsonErrorInfo };

/** Nested objects and arrays allowed (RFC 8259 §9 lets a parser set a limit). */
export const MAX_DEPTH = 1000;

/** The number grammar of RFC 8259 §6. No nested repetition: linear on any input. */
export const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** A JSON number literal a double cannot hold: JSON.parse in JavaScript would change it (json.md §5 «Заметки»). */
export const isInexactNumber = (raw: string): boolean => {
  if (!/[.eE]/.test(raw)) {
    const n = BigInt(raw);
    return n > MAX_SAFE || n < -MAX_SAFE;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return true;
  // Underflow: the literal is not zero, the double is.
  return value === 0 && /[1-9]/.test(raw.replace(/[eE].*$/, ''));
};

/** Line and column (1-based, UTF-16) of an offset; \r\n is one line break, a lone \r is one too. */
export const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let start = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
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
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) starts.push(i + 1);
      }
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

const describeChar = (text: string, at: number): string => {
  const cp = text.codePointAt(at)!;
  const ch = String.fromCodePoint(cp);
  return INVISIBLE.test(ch)
    ? `unexpected U+${cp.toString(16).toUpperCase().padStart(4, '0')} (an invisible character)`
    : `unexpected ${JSON.stringify(ch)}`;
};

const CONTROL_HINT: Record<number, string> = { 9: '\\t', 10: '\\n', 13: '\\r' };

class JsonStop {
  constructor(
    readonly message: string,
    readonly at: number,
  ) {}
}

type ObjectNode = Extract<JsonNode, { type: 'object' }>;
type ArrayNode = Extract<JsonNode, { type: 'array' }>;
type Frame =
  | { node: ObjectNode; names: Set<string>; key: { key: string; raw: string; offset: number } | null }
  | { node: ArrayNode };

/** Ordered tree with literals as written; duplicate keys are kept and listed in the notes. Throws nothing. */
export const parseJsonTree = (text: string): JsonTreeResult => {
  const n = text.length;
  const bom = text.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;
  const duplicateKeys: DuplicateKey[] = [];
  let inexactNumbers = 0;
  const positions = positionsIn(text);
  const stack: Frame[] = [];
  let root: JsonNode | null = null;

  const fail = (message: string, at = i): never => {
    throw new JsonStop(message, at);
  };
  const ws = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else return;
    }
  };

  /** A string token at `i` (the opening quote): its raw text and decoded value. */
  const string = (): { raw: string; value: string } => {
    const start = i;
    let escaped = false;
    i++;
    for (;;) {
      if (i >= n) fail('unterminated string', n);
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        const raw = text.slice(start, i);
        return { raw, value: escaped ? (JSON.parse(raw) as string) : raw.slice(1, -1) };
      }
      if (c === 92) {
        escaped = true;
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('invalid \\u escape: 4 hex digits expected');
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else if (e === undefined) fail('unterminated string', n);
        else fail(`invalid escape "\\${String.fromCodePoint(text.codePointAt(i + 1)!)}"`);
        continue;
      }
      if (c < 0x20) {
        const hint = CONTROL_HINT[c];
        fail(
          `control character U+${c.toString(16).toUpperCase().padStart(4, '0')} in a string${hint ? `; write it as ${hint}` : ''}`,
        );
      }
      i++;
    }
  };

  const digits = (): void => {
    while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
  };
  const isDigit = (at: number): boolean => at < n && text.charCodeAt(at) >= 48 && text.charCodeAt(at) <= 57;

  const number = (): string => {
    const start = i;
    if (text[i] === '-') i++;
    if (text[i] === '0') {
      i++;
      if (isDigit(i)) fail('leading zeros are not allowed', i - 1);
    } else if (isDigit(i)) digits();
    else fail('invalid number', start);
    if (text[i] === '.') {
      i++;
      if (!isDigit(i)) fail('expected a digit after "."');
      digits();
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!isDigit(i)) fail('expected a digit in the exponent');
      digits();
    }
    return text.slice(start, i);
  };

  const deliver = (node: JsonNode): void => {
    const top = stack[stack.length - 1];
    if (!top) root = node;
    else if ('items' in top.node) top.node.items.push(node);
    else {
      const frame = top as Extract<Frame, { names: Set<string> }>;
      frame.node.entries.push({ ...frame.key!, value: node });
      frame.key = null;
    }
  };

  /** A property name and its colon, in the object on top of the stack. */
  const key = (afterComma: boolean): void => {
    ws();
    const frame = stack[stack.length - 1] as Extract<Frame, { names: Set<string> }>;
    const c = text[i];
    if (c !== '"') {
      if (c === undefined) fail('unexpected end of input, expected a property name', n);
      if (c === '}' && afterComma) fail('trailing comma');
      if (c === "'") fail('property names must be in double quotes');
      fail('expected a property name in double quotes');
    }
    const offset = i;
    const { raw, value } = string();
    if (frame.names.has(value)) duplicateKeys.push({ key: value, offset, ...positions(offset) });
    else frame.names.add(value);
    frame.key = { key: value, raw, offset };
    ws();
    if (text[i] !== ':') fail(i >= n ? "unexpected end of input, expected ':'" : "expected ':'");
    i++;
  };

  try {
    let expectValue = true;
    let rootEnd = 0;
    for (;;) {
      ws();
      if (expectValue) {
        if (i >= n)
          fail(
            root === null && stack.length === 0 && text.trim() === ''
              ? 'empty input'
              : 'unexpected end of input, expected a value',
            n,
          );
        const c = text[i]!;
        const offset = i;
        if (c === '{' || c === '[') {
          if (stack.length >= MAX_DEPTH) fail(`nesting deeper than ${MAX_DEPTH} levels`);
          i++;
          ws();
          if (c === '{') {
            const node: ObjectNode = { type: 'object', offset, entries: [] };
            if (text[i] === '}') {
              i++;
              deliver(node);
              expectValue = false;
            } else {
              stack.push({ node, names: new Set(), key: null });
              key(false);
            }
          } else {
            const node: ArrayNode = { type: 'array', offset, items: [] };
            if (text[i] === ']') {
              i++;
              deliver(node);
              expectValue = false;
            } else stack.push({ node });
          }
        } else if (c === '"') {
          const { raw, value } = string();
          deliver({ type: 'string', offset, raw, value });
          expectValue = false;
        } else if (c === '-' || (c >= '0' && c <= '9')) {
          const raw = number();
          if (isInexactNumber(raw)) inexactNumbers++;
          deliver({ type: 'number', offset, raw });
          expectValue = false;
        } else if (text.startsWith('true', i) || text.startsWith('false', i)) {
          const value = c === 't';
          i += value ? 4 : 5;
          deliver({ type: 'boolean', offset, value });
          expectValue = false;
        } else if (text.startsWith('null', i)) {
          i += 4;
          deliver({ type: 'null', offset });
          expectValue = false;
        } else if (c === "'") fail('strings must be in double quotes');
        else fail(describeChar(text, i));
        if (!expectValue && stack.length === 0) rootEnd = i;
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top) {
        if (i >= n) break;
        const several = /[\n\r]/.test(text.slice(rootEnd, i)) && (text[i] === '{' || text[i] === '[');
        fail(
          several
            ? 'unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read'
            : 'unexpected text after the JSON value',
        );
      }
      const isObject = !('items' in top!.node);
      const closer = isObject ? '}' : ']';
      const c = text[i];
      if (c === ',') {
        i++;
        if (isObject) key(true);
        else {
          ws();
          if (text[i] === ']') fail('trailing comma');
        }
        expectValue = true;
      } else if (c === closer) {
        i++;
        stack.pop();
        deliver(top!.node);
        if (stack.length === 0) rootEnd = i;
      } else if (c === undefined) fail(`unexpected end of input, expected ',' or '${closer}'`, n);
      else fail(`expected ',' or '${closer}'`);
    }
    return { ok: true, tree: root!, notes: { bom, duplicateKeys, inexactNumbers } };
  } catch (error) {
    if (!(error instanceof JsonStop)) throw error;
    return { ok: false, error: { message: error.message, offset: error.at, ...positions(error.at) } };
  }
};
