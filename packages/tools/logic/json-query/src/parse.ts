/**
 * The JSONPath query parser (docs/tools/specs/json-query.md §5 «Язык»): RFC 9535 whole — the grammar of its §2 and the
 * ABNF of its appendix A, the well-typedness rules of the function extensions (§2.4.3) — into a tree the evaluator
 * walks. Nothing is evaluated here and nothing becomes code: a filter is data.
 *
 * A recursive descent over the query's own nesting, bounded by MAX_NESTING (the query is at most MAX_QUERY characters);
 * the document's depth never reaches it. Errors are values with a UTF-16 range [start, end) and the reason in plain
 * words (§6); the first one wins.
 */

export const MAX_QUERY = 10_000;
export const MAX_NESTING = 64;
/** RFC 9535 §2.1: integers of indexes and slices are within the I-JSON range. */
const MAX_INT = 9_007_199_254_740_991;

export interface QueryError {
  message: string;
  /** UTF-16 offsets, [start, end); both -1 when the error has no place (the query is too long). */
  start: number;
  end: number;
}

export type Literal =
  | { type: 'string'; value: string }
  | { type: 'number'; raw: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' };

export type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null }
  | { kind: 'filter'; expr: LogicalExpr };

export interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

export interface Query {
  /** `$` — the root; `@` — the current node (inside a filter only). */
  root: '$' | '@';
  segments: Segment[];
  /** Only names and indexes, one per segment, no descendants: at most one node (RFC 9535 §2.3.5.1). */
  singular: boolean;
  start: number;
  end: number;
}

export type FunctionName = 'length' | 'count' | 'match' | 'search' | 'value';
type ParamType = 'value' | 'nodes' | 'logical';
type ResultType = 'value' | 'logical' | 'nodes';

/** RFC 9535 §2.4.4–§2.4.8: the five function extensions and their types. */
const FUNCTIONS: Record<FunctionName, { params: ParamType[]; result: ResultType; example: string }> = {
  length: { params: ['value'], result: 'value', example: 'length(@.a) > 2' },
  count: { params: ['nodes'], result: 'value', example: 'count(@.*) > 2' },
  match: { params: ['value', 'value'], result: 'logical', example: "match(@.a, 'x.*')" },
  search: { params: ['value', 'value'], result: 'logical', example: "search(@.a, 'x')" },
  value: { params: ['nodes'], result: 'value', example: 'value(@..a) == 1' },
};

export type Argument =
  | { kind: 'literal'; literal: Literal }
  | { kind: 'query'; query: Query }
  | { kind: 'logical'; expr: LogicalExpr }
  | { kind: 'call'; call: Call };

export interface Call {
  name: FunctionName;
  args: Argument[];
  start: number;
  end: number;
}

export type Comparable =
  { kind: 'literal'; literal: Literal } | { kind: 'query'; query: Query } | { kind: 'call'; call: Call };

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type LogicalExpr =
  | { kind: 'or'; items: LogicalExpr[] }
  | { kind: 'and'; items: LogicalExpr[] }
  | { kind: 'not'; expr: LogicalExpr }
  | { kind: 'compare'; op: CompareOp; left: Comparable; right: Comparable }
  /** A test of a query: true when it selects at least one node. */
  | { kind: 'exists'; query: Query }
  /** A test of a function: its LogicalType result (or a NodesType one, non-empty). */
  | { kind: 'test'; call: Call };

export type ParseResult = { ok: true; query: Query } | { ok: false; error: QueryError };

export const isFunctionName = (name: string): name is FunctionName => Object.hasOwn(FUNCTIONS, name);
export const functionResult = (name: FunctionName): ResultType => FUNCTIONS[name].result;

class Stop {
  constructor(readonly error: QueryError) {}
}

/** An operand not yet placed: a comparison's side, a test, or a function's argument. */
type Atom =
  | { kind: 'literal'; literal: Literal; start: number; end: number }
  | { kind: 'query'; query: Query; start: number; end: number }
  | { kind: 'call'; call: Call; start: number; end: number };

type Operand = { atom: Atom } | { expr: LogicalExpr; start: number; end: number };

const isBlank = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isAlpha = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isLower = (c: number): boolean => c >= 0x61 && c <= 0x7a;
const isHex = (c: number): boolean => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const hex4 = (cp: number): string => cp.toString(16).toUpperCase().padStart(4, '0');

const INVISIBLE = /^[\p{White_Space}\p{Cc}\p{Cf}]$/u;

/** A code point of `name-first` (RFC 9535 §2.5.1.1): ALPHA, `_`, U+0080 and above except surrogates. */
const isNameFirst = (cp: number): boolean =>
  isAlpha(cp) || cp === 0x5f || (cp >= 0x80 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0x10ffff);

const SHORT_ESCAPES: Record<number, string> = { 0x62: '\b', 0x66: '\f', 0x6e: '\n', 0x72: '\r', 0x74: '\t' };
const CONTROL_HINTS: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Parses a JSONPath query (RFC 9535). Throws nothing: an error comes back as a value. */
export const parseQuery = (text: string): ParseResult => {
  if (text.length > MAX_QUERY)
    return { ok: false, error: { message: 'The query is longer than 10,000 characters.', start: -1, end: -1 } };
  const n = text.length;
  let i = 0;
  let depth = 0;

  const fail = (message: string, start = i, end = start): never => {
    throw new Stop({ message, start, end });
  };
  const charEnd = (at: number): number => {
    const c = text.charCodeAt(at);
    return c >= 0xd800 && c <= 0xdbff && at + 1 < n ? at + 2 : Math.min(at + 1, n);
  };
  /** `"x"` (a whole code point), `U+00A0 (an invisible character)`, or the end. */
  const shown = (at: number): string => {
    const cp = text.codePointAt(at);
    if (cp === undefined) return 'end of the query';
    if (cp >= 0xd800 && cp <= 0xdfff) return `U+${hex4(cp)} (a lone surrogate)`;
    const ch = String.fromCodePoint(cp);
    if (!isBlank(cp) && INVISIBLE.test(ch)) return `U+${hex4(cp)} (an invisible character)`;
    return JSON.stringify(ch);
  };
  /** The reason for an unexpected character at `at`, or for the end of the query, and what was expected. */
  const unexpected = (expected: string, at = i): never => {
    if (at >= n) fail(`unexpected end of the query: expected ${expected}`, n, n);
    const what = shown(at);
    if (what.endsWith('character)') || what.endsWith('surrogate)')) fail(`unexpected ${what}`, at, charEnd(at));
    return fail(`unexpected ${what}: expected ${expected}`, at, charEnd(at));
  };
  const skip = (): void => {
    while (i < n && isBlank(text.charCodeAt(i))) i++;
  };
  const deeper = (at: number): void => {
    if (++depth > MAX_NESTING) fail(`the query is nested deeper than ${MAX_NESTING} levels`, at, at + 1);
  };

  // ── literals ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** A string literal at `i` (its quote); `i` ends after the closing quote. */
  const string = (): string => {
    const quote = text.charCodeAt(i);
    const q = quote === 0x27 ? "'" : '"';
    const open = i;
    i++;
    let out = '';
    for (;;) {
      if (i >= n) fail(`unterminated string: the closing ${q} is missing`, open, n);
      const c = text.charCodeAt(i);
      if (c === quote) {
        i++;
        return out;
      }
      if (c === 0x5c) {
        const e = text.charCodeAt(i + 1);
        if (i + 1 >= n) fail(`unterminated string: the closing ${q} is missing`, open, n);
        const short = SHORT_ESCAPES[e];
        if (short !== undefined) {
          out += short;
          i += 2;
        } else if (e === 0x2f || e === 0x5c || e === quote) {
          out += String.fromCharCode(e);
          i += 2;
        } else if (e === 0x75) {
          const unit = (at: number): number => {
            for (let k = 0; k < 4; k++)
              if (!isHex(text.charCodeAt(at + 2 + k)))
                fail('invalid \\u escape: 4 hex digits expected', at, Math.min(at + 2 + k, n));
            return parseInt(text.slice(at + 2, at + 6), 16);
          };
          const first = unit(i);
          if (first >= 0xdc00 && first <= 0xdfff)
            fail('invalid \\u escape: a lone surrogate is not a character', i, i + 6);
          if (first >= 0xd800 && first <= 0xdbff) {
            const pair = text.charCodeAt(i + 6) === 0x5c && text.charCodeAt(i + 7) === 0x75;
            const second = pair ? unit(i + 6) : -1;
            if (second < 0xdc00 || second > 0xdfff)
              fail('invalid \\u escape: a lone surrogate is not a character', i, i + 6);
            out += String.fromCharCode(first, second);
            i += 12;
          } else {
            out += String.fromCharCode(first);
            i += 6;
          }
        } else fail(`invalid escape "\\${String.fromCodePoint(text.codePointAt(i + 1)!)}"`, i, charEnd(i + 1));
        continue;
      }
      if (c < 0x20) {
        const hint = CONTROL_HINTS[c] ?? `\\u${hex4(c).toLowerCase()}`;
        fail(`control character U+${hex4(c)} in a string: write it as ${hint}`, i, i + 1);
      }
      if (c >= 0xd800 && c <= 0xdfff) {
        const low = text.charCodeAt(i + 1);
        if (c > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) fail(`unexpected ${shown(i)}`, i, i + 1);
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += text[i];
      i++;
    }
  };

  /** Digits from `i`; returns where they end. */
  const digitsFrom = (at: number): number => {
    while (at < n && isDigit(text.charCodeAt(at))) at++;
    return at;
  };

  /** An integer of an index or a slice (RFC 9535 §2.3.3: `0` / `-`? DIGIT1 *DIGIT, within the I-JSON range). */
  const integer = (): number => {
    const start = i;
    let at = i;
    if (text.charCodeAt(at) === 0x2d) at++;
    if (!isDigit(text.charCodeAt(at))) {
      if (at > start) fail('expected a digit after "-"', at, charEnd(at));
      unexpected('an index');
    }
    const end = digitsFrom(at);
    const c = text.charCodeAt(end);
    if (c === 0x2e || c === 0x65 || c === 0x45) {
      let tail = end + 1;
      while (tail < n && /[0-9eE+\-.]/.test(text[tail]!)) tail++;
      fail('an index is an integer: no fraction or exponent', start, tail);
    }
    const digits = text.slice(at, end);
    if (digits.length > 1 && digits.charCodeAt(0) === 0x30) fail('leading zeros are not allowed', start, end);
    if (digits === '0' && at > start) fail('-0 is not an index', start, end);
    const value = Number(text.slice(start, end));
    if (digits.length > 16 || Math.abs(value) > MAX_INT)
      fail('the index is outside the interoperable range −(2^53 − 1) to 2^53 − 1', start, end);
    i = end;
    return value;
  };

  /** A number literal of a filter (RFC 9535 §2.3.5.1: (int / "-0") [frac] [exp]); its text as written. */
  const number = (): string => {
    const start = i;
    let at = i;
    if (text.charCodeAt(at) === 0x2d) at++;
    if (!isDigit(text.charCodeAt(at))) fail('expected a digit after "-"', at, charEnd(at));
    const intEnd = digitsFrom(at);
    if (intEnd - at > 1 && text.charCodeAt(at) === 0x30) fail('leading zeros are not allowed', start, intEnd);
    at = intEnd;
    if (text.charCodeAt(at) === 0x2e) {
      if (!isDigit(text.charCodeAt(at + 1))) fail('expected a digit after "."', at + 1, charEnd(at + 1));
      at = digitsFrom(at + 1);
    }
    const e = text.charCodeAt(at);
    if (e === 0x65 || e === 0x45) {
      at++;
      const sign = text.charCodeAt(at);
      if (sign === 0x2b || sign === 0x2d) at++;
      if (!isDigit(text.charCodeAt(at))) fail('expected a digit in the exponent', at, charEnd(at));
      at = digitsFrom(at);
    }
    i = at;
    return text.slice(start, at);
  };

  // ── queries ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** A member-name-shorthand at `i`, or null when no name starts there. */
  const shorthand = (): string | null => {
    const start = i;
    let at = i;
    let first = true;
    while (at < n) {
      const cp = text.codePointAt(at)!;
      if (!(isNameFirst(cp) || (!first && isDigit(cp)))) break;
      at += cp > 0xffff ? 2 : 1;
      first = false;
    }
    if (at === start) return null;
    i = at;
    return text.slice(start, at);
  };

  const selector = (): Selector => {
    const c = text.charCodeAt(i);
    if (c === 0x27 || c === 0x22) return { kind: 'name', name: string() };
    if (c === 0x2a) {
      i++;
      return { kind: 'wildcard' };
    }
    if (c === 0x3f) {
      const at = i;
      i++;
      skip();
      if (i >= n || text.charCodeAt(i) === 0x5d || text.charCodeAt(i) === 0x2c)
        fail('expected a filter expression after "?"', i, i >= n ? n : charEnd(i));
      deeper(at);
      const expr = logical();
      depth--;
      return { kind: 'filter', expr };
    }
    if (c === 0x2d || isDigit(c) || c === 0x3a) {
      const start = c === 0x3a ? null : integer();
      const afterStart = i;
      skip();
      if (text.charCodeAt(i) !== 0x3a) {
        i = afterStart;
        return { kind: 'index', index: start! };
      }
      i++;
      skip();
      let end: number | null = null;
      let step: number | null = null;
      const e = text.charCodeAt(i);
      if (e === 0x2d || isDigit(e)) {
        end = integer();
        skip();
      }
      if (text.charCodeAt(i) === 0x3a) {
        i++;
        skip();
        const s = text.charCodeAt(i);
        if (s === 0x2d || isDigit(s)) step = integer();
      }
      return { kind: 'slice', start, end, step };
    }
    return unexpected('a selector: a quoted name, *, an index, a slice or a filter');
  };

  const bracketed = (): Selector[] => {
    i++; // [
    skip();
    const selectors = [selector()];
    for (;;) {
      skip();
      const c = text.charCodeAt(i);
      if (c === 0x5d) {
        i++;
        return selectors;
      }
      if (c === 0x2c) {
        i++;
        skip();
        selectors.push(selector());
        continue;
      }
      return unexpected('"," or "]"');
    }
  };

  /** One segment at `i` (a `.` or a `[`). */
  const segment = (): Segment => {
    if (text.charCodeAt(i) === 0x5b) return { descendant: false, selectors: bracketed() };
    // `.`
    if (text.charCodeAt(i + 1) === 0x2e) {
      i += 2;
      const c = text.charCodeAt(i);
      if (c === 0x5b) return { descendant: true, selectors: bracketed() };
      if (c === 0x2a) {
        i++;
        return { descendant: true, selectors: [{ kind: 'wildcard' }] };
      }
      const name = shorthand();
      if (name === null) unexpected('a member name, * or [ after ".."');
      return { descendant: true, selectors: [{ kind: 'name', name: name! }] };
    }
    i++;
    if (text.charCodeAt(i) === 0x2a) {
      i++;
      return { descendant: false, selectors: [{ kind: 'wildcard' }] };
    }
    const name = shorthand();
    if (name === null) unexpected('a member name or * after "."');
    return { descendant: false, selectors: [{ kind: 'name', name: name! }] };
  };

  const isSingular = (segments: Segment[]): boolean =>
    segments.every(s => {
      const only = s.selectors[0]!;
      return !s.descendant && s.selectors.length === 1 && (only.kind === 'name' || only.kind === 'index');
    });

  /**
   * A query at `i` (its `$` or `@`). At the top (`top`), what follows the last segment must be the end; inside a
   * filter, the segments stop before anything else (whitespace is given back).
   */
  const query = (top: boolean): Query => {
    const start = i;
    const root = text[i] === '$' ? '$' : '@';
    i++;
    const segments: Segment[] = [];
    for (;;) {
      const before = i;
      skip();
      const c = text.charCodeAt(i);
      if (c === 0x2e || c === 0x5b) {
        segments.push(segment());
        continue;
      }
      if (top) {
        if (i >= n) {
          if (i > before) fail('spaces are not allowed after the query', before, n);
          break;
        }
        unexpected('a segment (.name, [selector] or ..)');
      }
      i = before;
      break;
    }
    return { root, segments, singular: isSingular(segments), start, end: i };
  };

  // ── filter expressions ────────────────────────────────────────────────────────────────────────────────────────

  /** A function call at `i` (its name, already known to be followed by `(`). */
  const call = (name: string, start: number): Call => {
    if (!isFunctionName(name))
      fail(
        `unknown function "${name}": the functions are length, count, match, search and value`,
        start,
        start + name.length,
      );
    const fn = FUNCTIONS[name as FunctionName];
    deeper(i);
    i++; // (
    skip();
    const args: Array<{ operand: Operand; start: number }> = [];
    if (text.charCodeAt(i) !== 0x29) {
      for (;;) {
        const at = i;
        args.push({ operand: orExpr(), start: at });
        skip();
        const c = text.charCodeAt(i);
        if (c === 0x2c) {
          i++;
          skip();
          continue;
        }
        if (c === 0x29) break;
        unexpected('"," or ")"');
      }
    }
    i++; // )
    depth--;
    const end = i;
    const f = name as FunctionName;
    if (args.length !== fn.params.length)
      fail(`${f}() takes ${plural(fn.params.length, 'argument')}, not ${args.length}`, start, end);
    const typed = args.map((a, k) => argument(f, fn.params[k]!, a.operand));
    return { name: f, args: typed, start, end };
  };

  /** RFC 9535 §2.4.3: an argument against its parameter's declared type. */
  const argument = (f: FunctionName, type: ParamType, operand: Operand): Argument => {
    const span: [number, number] =
      'atom' in operand ? [operand.atom.start, operand.atom.end] : [operand.start, operand.end];
    if (type === 'value') {
      if (!('atom' in operand)) return fail(`${f}() takes a value, not a logical expression`, ...span);
      const a = operand.atom;
      if (a.kind === 'literal') return { kind: 'literal', literal: a.literal };
      if (a.kind === 'query') {
        if (!a.query.singular) fail(`${f}() takes a value: this query can select several nodes`, ...span);
        return { kind: 'query', query: a.query };
      }
      if (FUNCTIONS[a.call.name].result !== 'value')
        fail(`${f}() takes a value: ${a.call.name}() gives true or false`, ...span);
      return { kind: 'call', call: a.call };
    }
    if (type === 'nodes') {
      if (!('atom' in operand)) return fail(`${f}() takes a query, not a logical expression`, ...span);
      const a = operand.atom;
      if (a.kind === 'literal') fail(`${f}() takes a query, not a literal`, ...span);
      if (a.kind === 'call') fail(`${f}() takes a query, not a function call`, ...span);
      return { kind: 'query', query: (a as Extract<Atom, { kind: 'query' }>).query };
    }
    // LogicalType: a logical expression, a query (non-empty) or a function with a LogicalType or NodesType result.
    return { kind: 'logical', expr: asTest(operand) };
  };

  /** An operand standing alone where a test is expected. */
  const asTest = (operand: Operand): LogicalExpr => {
    if (!('atom' in operand)) return operand.expr;
    const a = operand.atom;
    if (a.kind === 'query') return { kind: 'exists', query: a.query };
    if (a.kind === 'literal')
      return fail('a literal alone is not a test: compare it, or test a query such as @.a', a.start, a.end);
    if (FUNCTIONS[a.call.name].result === 'value')
      fail(
        `${a.call.name}() gives a value, not true or false: compare it, as in ${FUNCTIONS[a.call.name].example}`,
        a.start,
        a.end,
      );
    return { kind: 'test', call: a.call };
  };

  /** A comparison's side (RFC 9535 §2.3.5.1: a literal, a singular query, a function of ValueType). */
  const comparable = (a: Atom): Comparable => {
    if (a.kind === 'literal') return { kind: 'literal', literal: a.literal };
    if (a.kind === 'query') {
      if (!a.query.singular)
        fail(
          'this query can select several nodes, so it cannot be compared: only names and indexes (@.a, @[0]) may be compared',
          a.start,
          a.end,
        );
      return { kind: 'query', query: a.query };
    }
    if (FUNCTIONS[a.call.name].result !== 'value')
      fail(`${a.call.name}() gives true or false: use it alone, without a comparison`, a.start, a.end);
    return { kind: 'call', call: a.call };
  };

  const WORD = /[A-Za-z0-9_]*/y;

  /** A literal, a query or a function call at `i`. */
  const atom = (expected: string): Atom => {
    const start = i;
    const c = text.charCodeAt(i);
    if (c === 0x40 || c === 0x24) {
      const q = query(false);
      return { kind: 'query', query: q, start, end: q.end };
    }
    if (c === 0x27 || c === 0x22) {
      const value = string();
      return { kind: 'literal', literal: { type: 'string', value }, start, end: i };
    }
    if (c === 0x2d || isDigit(c)) {
      const raw = number();
      return { kind: 'literal', literal: { type: 'number', raw }, start, end: i };
    }
    if (isAlpha(c) || c === 0x5f) {
      WORD.lastIndex = i;
      const word = WORD.exec(text)![0];
      const end = i + word.length;
      const next = text.charCodeAt(end);
      if (word === 'true' || word === 'false' || word === 'null') {
        i = end;
        const literal: Literal = word === 'null' ? { type: 'null' } : { type: 'boolean', value: word === 'true' };
        return { kind: 'literal', literal, start, end };
      }
      if (/^(true|false|null)$/i.test(word)) fail('literals are lowercase: true, false, null', start, end);
      if (next === 0x28 && isLower(c)) {
        i = end;
        const fn = call(word, start);
        return { kind: 'call', call: fn, start, end: fn.end };
      }
      if (isLower(c) && /^[a-z][a-z0-9_]*$/.test(word)) {
        let at = end;
        while (at < n && isBlank(text.charCodeAt(at))) at++;
        if (text.charCodeAt(at) === 0x28 && at > end)
          fail('no space is allowed between a function name and "("', end, at);
        if (isFunctionName(word))
          fail(`expected "(" after ${word}: it is a function`, end, end >= n ? n : charEnd(end));
      }
      return unexpected(expected, start);
    }
    return unexpected(expected);
  };

  const COMPARISON: readonly CompareOp[] = ['==', '!=', '<=', '>=', '<', '>'];
  const comparisonAt = (): CompareOp | null => COMPARISON.find(op => text.startsWith(op, i)) ?? null;

  /** After an operand: a lone `=`, `&` or `|` is a likely slip; say what was meant. */
  const slips = (): void => {
    const c = text.charCodeAt(i);
    if (c === 0x3d && text.charCodeAt(i + 1) !== 0x3d) fail('use == to compare', i, i + 1);
    if (c === 0x26 && text.charCodeAt(i + 1) !== 0x26) fail('use && for "and"', i, i + 1);
    if (c === 0x7c && text.charCodeAt(i + 1) !== 0x7c) fail('use || for "or"', i, i + 1);
  };

  const EXPECTED_OPERAND = 'a query (@…, $…), a literal or a function call';

  /** basic-expr (paren-expr / comparison-expr / test-expr), or an atom standing alone (an argument, a test). */
  const basic = (): Operand => {
    const start = i;
    const c = text.charCodeAt(i);
    if (c === 0x21 && text.charCodeAt(i + 1) !== 0x3d) {
      i++;
      skip();
      if (text.charCodeAt(i) === 0x28) {
        const inner = paren();
        return { expr: { kind: 'not', expr: inner }, start, end: i };
      }
      const a = atom(EXPECTED_OPERAND);
      if (a.kind === 'literal')
        fail('a literal alone is not a test: compare it, or test a query such as @.a', a.start, a.end);
      const after = i;
      skip();
      if (comparisonAt())
        fail('! applies to a query, a function or a parenthesis, not to a comparison: write !(…)', start, start + 1);
      i = after;
      return { expr: { kind: 'not', expr: asTest({ atom: a }) }, start, end: i };
    }
    if (c === 0x28) {
      const inner = paren();
      return { expr: inner, start, end: i };
    }
    const left = atom(EXPECTED_OPERAND);
    const after = i;
    skip();
    const op = comparisonAt();
    if (!op) {
      slips();
      i = after;
      return { atom: left };
    }
    i += op.length;
    skip();
    const right = atom('a value to compare with');
    return { expr: { kind: 'compare', op, left: comparable(left), right: comparable(right) }, start, end: i };
  };

  const paren = (): LogicalExpr => {
    const open = i;
    deeper(open);
    i++;
    skip();
    const inner = asTest(orExpr());
    skip();
    if (text.charCodeAt(i) !== 0x29) {
      slips();
      unexpected('")"');
    }
    i++;
    depth--;
    return inner;
  };

  const andExpr = (): Operand => {
    const first = basic();
    const items: Operand[] = [first];
    for (;;) {
      const before = i;
      skip();
      if (!text.startsWith('&&', i)) {
        slips();
        i = before;
        break;
      }
      i += 2;
      skip();
      items.push(basic());
    }
    if (items.length === 1) return first;
    const start = 'atom' in first ? first.atom.start : first.start;
    return { expr: { kind: 'and', items: items.map(asTest) }, start, end: i };
  };

  /** logical-or-expr; an atom alone stays an atom (a function's argument decides what it is). */
  const orExpr = (): Operand => {
    const first = andExpr();
    const items: Operand[] = [first];
    for (;;) {
      const before = i;
      skip();
      if (!text.startsWith('||', i)) {
        i = before;
        break;
      }
      i += 2;
      skip();
      items.push(andExpr());
    }
    if (items.length === 1) return first;
    const start = 'atom' in first ? first.atom.start : first.start;
    return { expr: { kind: 'or', items: items.map(asTest) }, start, end: i };
  };

  const logical = (): LogicalExpr => asTest(orExpr());

  // ── the query ─────────────────────────────────────────────────────────────────────────────────────────────────

  try {
    if (n > 0 && isBlank(text.charCodeAt(0))) {
      skip();
      fail('spaces are not allowed before the query', 0, i);
    }
    if (text.charCodeAt(0) !== 0x24) {
      if (text.charCodeAt(0) === 0x40) fail('@ is the current node, used inside a filter: a query starts with $', 0, 1);
      fail('a query starts with $ (the root node)', 0, n === 0 ? 0 : charEnd(0));
    }
    return { ok: true, query: query(true) };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, error: error.error };
    throw error;
  }
};
