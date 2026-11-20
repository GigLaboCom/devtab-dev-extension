/**
 * The JSON tool's logic (roadmap 1D: format, validate with the error's position, minify, sort keys). Pure functions —
 * the component (JsonTool.tsx) only wires them to the page. `JSON.parse` does the parsing; its messages differ between
 * engines and do not always carry a position, so the position of an error comes from `locateJsonError`, a small
 * strict scanner of RFC 8259 that stops at the first problem.
 */

export interface JsonErrorInfo {
  message: string;
  /** UTF-16 offset of the problem in the input. */
  offset: number;
  /** 1-based, for people. */
  line: number;
  /** 1-based UTF-16 column, for people. */
  column: number;
}

export type JsonResult = { ok: true; text: string } | { ok: false; error: JsonErrorInfo };

export type Indent = 2 | 4 | 'tab';

export interface FormatOptions {
  indent: Indent;
  sortKeys: boolean;
}

const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
};

const describe = (text: string, at: number): string =>
  at >= text.length ? 'unexpected end of input' : `unexpected ${JSON.stringify(text[at])}`;

/** The first syntax error of `text` as JSON, or null when it is valid. */
export const locateJsonError = (text: string): JsonErrorInfo | null => {
  let i = 0;
  const fail = (message: string, at = i): never => {
    throw Object.assign(new Error(message), { at });
  };
  const ws = (): void => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const expect = (word: string): void => {
    for (const ch of word) {
      if (text[i] !== ch) fail(describe(text, i));
      i++;
    }
  };
  const string = (): void => {
    i++; // the opening quote
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const ch = text[i];
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === '\\') {
        const esc = text[i + 1];
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('invalid \\u escape');
          i += 6;
        } else if (esc !== undefined && '"\\/bfnrt'.includes(esc)) i += 2;
        else fail('invalid escape');
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) fail('control character in a string');
      i++;
    }
  };
  const number = (): void => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match || match[0] === '-') fail('invalid number');
    i += match![0].length;
  };
  const value = (depth: number): void => {
    if (depth > 10_000) fail('nesting too deep');
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail(text[i] === '}' ? 'trailing comma' : 'expected a property name in double quotes');
        string();
        ws();
        if (text[i] !== ':') fail("expected ':'");
        i++;
        value(depth + 1);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return;
        }
        fail("expected ',' or '}'");
      }
    }
    if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] === ']') fail('trailing comma');
        value(depth + 1);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return;
        }
        fail("expected ',' or ']'");
      }
    }
    if (ch === '"') return string();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return number();
    if (ch === 't') return expect('true');
    if (ch === 'f') return expect('false');
    if (ch === 'n') return expect('null');
    fail(text.trim() === '' ? 'empty input' : describe(text, i));
  };
  try {
    value(0);
    ws();
    if (i < text.length) fail('unexpected text after the JSON value');
    return null;
  } catch (error) {
    const at = (error as { at?: number }).at ?? 0;
    return { message: (error as Error).message, offset: at, ...positionOf(text, at) };
  }
};

/** Parses or explains why not. */
const parse = (text: string): { ok: true; value: unknown } | { ok: false; error: JsonErrorInfo } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    // The scanner and JSON.parse agree on what is valid; this fallback only guards against a disagreement.
    return { ok: false, error: locateJsonError(text) ?? { message: String(error), offset: 0, line: 1, column: 1 } };
  }
};

/** Object keys in code-point order, recursively; arrays keep their order. */
export const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
};

export const formatJson = (text: string, { indent, sortKeys }: FormatOptions): JsonResult => {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  const value = sortKeys ? sortKeysDeep(parsed.value) : parsed.value;
  return { ok: true, text: JSON.stringify(value, null, indent === 'tab' ? '\t' : indent) };
};

export const minifyJson = (
  text: string,
  { sortKeys }: Pick<FormatOptions, 'sortKeys'> = { sortKeys: false },
): JsonResult => {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  return { ok: true, text: JSON.stringify(sortKeys ? sortKeysDeep(parsed.value) : parsed.value) };
};

/** Recognizes JSON pasted anywhere (roadmap 1B: the «paste anything» field asks every tool). */
export const detectJson = (text: string): boolean => {
  const t = text.trim();
  return (t.startsWith('{') || t.startsWith('[')) && locateJsonError(t) === null;
};
