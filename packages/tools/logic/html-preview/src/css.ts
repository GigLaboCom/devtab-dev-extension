/**
 * The pasted CSS, made to load nothing (docs/tools/specs/html-preview.md §5.2 step 2, §15). Every way CSS reaches a
 * resource goes through one of three token shapes: a `url(…)` (a url token, or the function `url(` with a string), a
 * function that takes a string as an address (`image-set()`, `image()`, `src()`, `cross-fade()`, `element()`, their
 * `-webkit-` forms — and `expression()`, which old Internet Explorer ran as script), or the `@import` / `@namespace`
 * rules. The text is tokenized exactly as CSS Syntax Level 3 says a browser does — escapes resolved (`\75 rl(` is a
 * url), comments, strings, bad urls — and every declaration, at-rule or rule that holds one of them is cut out whole;
 * the rest of the text is kept as written. What is left is tokenized again: if anything that loads were still there,
 * nothing at all is kept (it cannot happen; the check is the last word, not the rules above).
 *
 * The only exception is a reference inside the document (`url(#id)`) in the properties that take one without a fetch:
 * `filter`, `clip-path`, `mask`, `fill`, `stroke`, `marker*` (an inline SVG's gradient, filter or clip).
 *
 * Linear in the text; iterative (a megabyte of `{` does not grow the call stack). Pure: no DOM, no CSSOM — the same
 * result in Node and in the page.
 */

type Kind =
  | 'ws'
  | 'comment'
  | 'ident'
  | 'function'
  | 'at'
  | 'hash'
  | 'string'
  | 'bad-string'
  | 'url'
  | 'bad-url'
  | 'delim'
  | 'number'
  | 'cdo'
  | 'cdc'
  | ':'
  | ';'
  | ','
  | '['
  | ']'
  | '('
  | ')'
  | '{'
  | '}';

interface Token {
  kind: Kind;
  start: number;
  end: number;
  /** The name of an ident, function or at-keyword, or the value of a string or url, escapes resolved. */
  value: string;
}

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isHex = (c: number): boolean => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isIdentStart = (c: number): boolean => isLetter(c) || c === 0x5f || c >= 0x80;
const isIdent = (c: number): boolean => isIdentStart(c) || isDigit(c) || c === 0x2d;
const isWhitespace = (c: number): boolean => c === 0x0a || c === 0x09 || c === 0x20;
const isNonPrintable = (c: number): boolean =>
  (c >= 0 && c <= 8) || c === 0x0b || (c >= 0x0e && c <= 0x1f) || c === 0x7f;
const EOF = -1;

/** CSS Syntax §3.3: CR, FF and CR LF become LF; NUL becomes U+FFFD. */
const preprocess = (text: string): string => text.replace(/\r\n?|\f/g, '\n').replace(/\0/g, '�');

/** CSS Syntax §4: the token stream of `css` (already preprocessed). */
const tokenize = (css: string): Token[] => {
  const tokens: Token[] = [];
  const n = css.length;
  let i = 0;
  const at = (k: number): number => (k < n ? css.charCodeAt(k) : EOF);
  const validEscape = (k: number): boolean => at(k) === 0x5c && at(k + 1) !== 0x0a && at(k + 1) !== EOF;
  const startsIdent = (k: number): boolean => {
    const c = at(k);
    if (c === 0x2d) return isIdentStart(at(k + 1)) || at(k + 1) === 0x2d || validEscape(k + 1);
    if (isIdentStart(c)) return true;
    return validEscape(k);
  };
  const startsNumber = (k: number): boolean => {
    const c = at(k);
    if (c === 0x2b || c === 0x2d) return isDigit(at(k + 1)) || (at(k + 1) === 0x2e && isDigit(at(k + 2)));
    if (c === 0x2e) return isDigit(at(k + 1));
    return isDigit(c);
  };
  /** After the backslash: the escaped code point; `i` moves past the escape. */
  const escape = (): string => {
    const c = at(i);
    if (c === EOF) return '�';
    if (isHex(c)) {
      let hex = '';
      while (hex.length < 6 && isHex(at(i))) hex += css[i++];
      if (isWhitespace(at(i))) i++;
      const cp = parseInt(hex, 16);
      return cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? '�' : String.fromCodePoint(cp);
    }
    // A code point outside the BMP is two UTF-16 units: keep them together.
    const cp = css.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    return String.fromCodePoint(cp);
  };
  const name = (): string => {
    let out = '';
    for (;;) {
      const c = at(i);
      if (isIdent(c)) {
        const run = i;
        while (isIdent(at(i))) i++;
        out += css.slice(run, i);
      } else if (validEscape(i)) {
        i++;
        out += escape();
      } else return out;
    }
  };
  const push = (kind: Kind, start: number, value = ''): void => {
    tokens.push({ kind, start, end: i, value });
  };
  const badUrlRemnants = (): void => {
    for (;;) {
      const c = at(i);
      if (c === 0x29 || c === EOF) {
        if (c === 0x29) i++;
        return;
      }
      if (validEscape(i)) {
        i++;
        escape();
      } else i++;
    }
  };
  const url = (start: number): void => {
    while (isWhitespace(at(i))) i++;
    let value = '';
    for (;;) {
      const c = at(i);
      if (c === 0x29) {
        i++;
        return push('url', start, value);
      }
      if (c === EOF) return push('url', start, value);
      if (isWhitespace(c)) {
        while (isWhitespace(at(i))) i++;
        if (at(i) === 0x29) {
          i++;
          return push('url', start, value);
        }
        if (at(i) === EOF) return push('url', start, value);
        badUrlRemnants();
        return push('bad-url', start);
      }
      if (c === 0x22 || c === 0x27 || c === 0x28 || isNonPrintable(c)) {
        badUrlRemnants();
        return push('bad-url', start);
      }
      if (c === 0x5c) {
        if (validEscape(i)) {
          i++;
          value += escape();
        } else {
          badUrlRemnants();
          return push('bad-url', start);
        }
        continue;
      }
      const run = i;
      i++;
      while (i < n) {
        const d = css.charCodeAt(i);
        if (d === 0x29 || d === 0x22 || d === 0x27 || d === 0x28 || d === 0x5c || isWhitespace(d) || isNonPrintable(d))
          break;
        i++;
      }
      value += css.slice(run, i);
    }
  };
  const identLike = (start: number): void => {
    const value = name();
    if (value.toLowerCase() === 'url' && at(i) === 0x28) {
      i++;
      while (isWhitespace(at(i)) && isWhitespace(at(i + 1))) i++;
      const c = at(i);
      const d = at(i + 1);
      if (c === 0x22 || c === 0x27 || (isWhitespace(c) && (d === 0x22 || d === 0x27)))
        return push('function', start, value);
      return url(start);
    }
    if (at(i) === 0x28) {
      i++;
      return push('function', start, value);
    }
    push('ident', start, value);
  };
  const numeric = (start: number): void => {
    if (at(i) === 0x2b || at(i) === 0x2d) i++;
    while (isDigit(at(i))) i++;
    if (at(i) === 0x2e && isDigit(at(i + 1))) {
      i++;
      while (isDigit(at(i))) i++;
    }
    const e = at(i);
    const sign = at(i + 1) === 0x2b || at(i + 1) === 0x2d;
    if ((e === 0x45 || e === 0x65) && (isDigit(at(i + 1)) || (sign && isDigit(at(i + 2))))) {
      i += sign ? 2 : 1;
      while (isDigit(at(i))) i++;
    }
    if (startsIdent(i)) name();
    else if (at(i) === 0x25) i++;
    push('number', start);
  };
  const string = (start: number, quote: number): void => {
    i++;
    let value = '';
    for (;;) {
      const c = at(i);
      if (c === quote) {
        i++;
        return push('string', start, value);
      }
      if (c === EOF) return push('string', start, value);
      if (c === 0x0a) return push('bad-string', start, value);
      if (c === 0x5c) {
        if (at(i + 1) === EOF) {
          i++;
          continue;
        }
        if (at(i + 1) === 0x0a) {
          i += 2;
          continue;
        }
        i++;
        value += escape();
        continue;
      }
      // a run of plain characters at once
      const run = i;
      while (i < n) {
        const d = css.charCodeAt(i);
        if (d === quote || d === 0x0a || d === 0x5c) break;
        i++;
      }
      value += css.slice(run, i);
    }
  };

  while (i < n) {
    const start = i;
    const c = at(i);
    if (c === 0x2f && at(i + 1) === 0x2a) {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      push('comment', start);
    } else if (isWhitespace(c)) {
      while (isWhitespace(at(i))) i++;
      push('ws', start);
    } else if (c === 0x22 || c === 0x27) string(start, c);
    else if (c === 0x23) {
      i++;
      if (isIdent(at(i)) || validEscape(i)) push('hash', start, name());
      else push('delim', start);
    } else if (c === 0x28 || c === 0x29 || c === 0x2c || c === 0x3a || c === 0x3b) {
      i++;
      push(css[start] as Kind, start);
    } else if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i++;
      push(css[start] as Kind, start);
    } else if (c === 0x2b || c === 0x2e) {
      if (startsNumber(i)) numeric(start);
      else {
        i++;
        push('delim', start);
      }
    } else if (c === 0x2d) {
      if (startsNumber(i)) numeric(start);
      else if (at(i + 1) === 0x2d && at(i + 2) === 0x3e) {
        i += 3;
        push('cdc', start);
      } else if (startsIdent(i)) identLike(start);
      else {
        i++;
        push('delim', start);
      }
    } else if (c === 0x3c) {
      if (css.startsWith('!--', i + 1)) {
        i += 4;
        push('cdo', start);
      } else {
        i++;
        push('delim', start);
      }
    } else if (c === 0x40) {
      i++;
      if (startsIdent(i)) push('at', start, name());
      else push('delim', start);
    } else if (c === 0x5c) {
      if (validEscape(i)) identLike(start);
      else {
        i++;
        push('delim', start);
      }
    } else if (isDigit(c)) numeric(start);
    else if (isIdentStart(c)) identLike(start);
    else {
      // One code point (two UTF-16 units outside the BMP).
      i += (css.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
      push('delim', start);
    }
  }
  return tokens;
};

/** Functions that take an address as a string (or ran script, `expression`): never kept. */
const LOADING_FUNCTIONS = new Set([
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  '-moz-element',
  'expression',
]);

/** Properties whose `url(#id)` points into the document and fetches nothing. */
const LOCAL_REFERENCE = /^(?:filter|clip-path|mask|fill|stroke|marker|marker-start|marker-mid|marker-end)$/;

/** At-rules that load (`@import`) or name an address (`@namespace`): cut whole. */
const ADDRESS_RULES = new Set(['import', 'namespace']);

/** Closers of the bracketed groups: `{`, `[`, `(` and a function each end at their match (or at the end). */
const closers = (tokens: Token[]): Int32Array => {
  const match = new Int32Array(tokens.length).fill(-1);
  const stack: number[] = [];
  const want: Partial<Record<Kind, Kind>> = { '{': '}', '[': ']', '(': ')', function: ')' };
  for (let k = 0; k < tokens.length; k++) {
    const kind = tokens[k]!.kind;
    if (want[kind]) stack.push(k);
    // A closer ends the innermost group only when it is that group's own; any other is a token inside it (CSS Syntax
    // §5.4.8: a block runs to its mirror, whatever else comes).
    else if ((kind === '}' || kind === ']' || kind === ')') && stack.length > 0) {
      const open = stack[stack.length - 1]!;
      if (want[tokens[open]!.kind] === kind) match[stack.pop()!] = k;
    }
  }
  for (const open of stack) match[open] = tokens.length;
  return match;
};

/**
 * Is token `k` one that loads? A url, a bad url (a browser drops it, but nothing is lost by dropping it first), a
 * function of LOADING_FUNCTIONS, `attr()` asking for a url.
 */
const loads = (tokens: Token[], match: Int32Array, k: number): boolean => {
  const t = tokens[k]!;
  if (t.kind === 'url' || t.kind === 'bad-url') return true;
  if (t.kind === 'at') return ADDRESS_RULES.has(t.value.toLowerCase());
  if (t.kind !== 'function') return false;
  const fn = t.value.toLowerCase();
  if (LOADING_FUNCTIONS.has(fn)) return true;
  if (fn === 'attr') {
    const end = Math.min(match[k]!, tokens.length);
    for (let j = k + 1; j < end; j++)
      if (tokens[j]!.kind === 'ident' && tokens[j]!.value.toLowerCase() === 'url') return true;
  }
  return false;
};

/** `url(#id)` (either form) at `k`: a reference into the document. */
const localReference = (tokens: Token[], k: number): boolean => {
  const t = tokens[k]!;
  if (t.kind === 'url') return t.value.startsWith('#');
  if (t.kind === 'function' && t.value.toLowerCase() === 'url') {
    let j = k + 1;
    while (tokens[j]?.kind === 'ws') j++;
    return tokens[j]?.kind === 'string' && tokens[j]!.value.startsWith('#');
  }
  return false;
};

export interface CleanCss {
  /** The text with every declaration, rule and at-rule that would load cut out; the rest as written. */
  css: string;
  /** `@import` rules cut (each would have been an external stylesheet). */
  imports: number;
  /** Declarations, rules and other at-rules cut because they held something that loads. */
  removed: number;
}

const isBlank = (kind: Kind): boolean => kind === 'ws' || kind === 'comment';

/**
 * The CSS of a `<style>` (`sheet`) or of a `style` attribute (`declarations`), made to load nothing: what holds a url
 * or an address is cut out whole, the rest kept as written.
 */
export const cleanCss = (text: string, mode: 'sheet' | 'declarations'): CleanCss => {
  const css = preprocess(text);
  const tokens = tokenize(css);
  const match = closers(tokens);
  // dangerBefore[k]: how many tokens that load come before token k (a range's count in O(1)).
  const dangerBefore = new Int32Array(tokens.length + 1);
  for (let k = 0; k < tokens.length; k++) dangerBefore[k + 1] = dangerBefore[k]! + (loads(tokens, match, k) ? 1 : 0);
  const danger = (from: number, to: number): number => dangerBefore[to]! - dangerBefore[from]!;

  const cut: Array<[number, number]> = []; // token ranges [from, to) left out
  let imports = 0;
  let removed = 0;
  /** May the declaration in tokens [from, to) stay although it holds a url? Only local references in their properties. */
  const onlyLocal = (from: number, to: number): boolean => {
    const first = tokens[from]!;
    if (first.kind !== 'ident' || !LOCAL_REFERENCE.test(first.value.toLowerCase())) return false;
    for (let k = from; k < to; k++) if (loads(tokens, match, k) && !localReference(tokens, k)) return false;
    return true;
  };

  // Each list: a range of tokens whose items (declarations, rules, at-rules) are judged one by one; a rule's block is a
  // list of its own (style rules nest, at-rules hold rules or declarations).
  const lists: Array<[number, number]> = [[0, tokens.length]];
  while (lists.length > 0) {
    const [from, to] = lists.pop()!;
    let k = from;
    while (k < to) {
      const kind = tokens[k]!.kind;
      if (isBlank(kind) || kind === 'cdo' || kind === 'cdc' || kind === ';' || kind === '}') {
        k++;
        continue;
      }
      // The item: up to a `;` (included) or through a `{…}` block, whichever comes first at its own level.
      const start = k;
      let block = -1;
      while (k < to) {
        const t = tokens[k]!.kind;
        if (t === ';') {
          k++;
          break;
        }
        if (t === '{') {
          block = k;
          k = Math.min(match[k]! + 1, to);
          break;
        }
        if (t === '[' || t === '(' || t === 'function') k = Math.min(match[k]! + 1, to);
        else k++;
      }
      const end = k;
      const first = tokens[start]!;
      // What is cut takes the white space before it along (`a: b; cut: url(x); c: d` → `a: b; c: d`).
      let lead = start;
      while (lead > from && tokens[lead - 1]!.kind === 'ws') lead--;
      if (first.kind === 'at' && ADDRESS_RULES.has(first.value.toLowerCase())) {
        if (first.value.toLowerCase() === 'import') imports++;
        else removed++;
        cut.push([lead, end]);
      } else if (block >= 0 && mode === 'sheet') {
        // A rule: its prelude decides whether it stays at all; then its block is judged item by item.
        if (danger(start, block) > 0) {
          removed++;
          cut.push([lead, end]);
        } else if (danger(block, end) > 0) lists.push([block + 1, Math.min(match[block]!, end)]);
      } else if (danger(start, end) > 0 && !onlyLocal(start, end)) {
        removed++;
        cut.push([lead, end]);
      }
    }
  }

  cut.sort((a, b) => a[0] - b[0]);
  let out = cut.length === 0 ? css : '';
  let next = 0; // the first token not yet written
  for (const [from, to] of cut) {
    if (from > next) out += css.slice(tokens[next]!.start, tokens[from]!.start);
    next = Math.max(next, to);
  }
  if (cut.length > 0 && next < tokens.length) out += css.slice(tokens[next]!.start);
  // The last word: what is left is tokenized again, and must hold nothing that loads.
  if (cssLoads(out)) return { css: '', imports, removed: removed + 1 };
  return { css: out, imports, removed };
};

/** Does the CSS hold anything that loads — a url that is not `#id`, a loading function, `@import`, `@namespace`? */
export const cssLoads = (css: string): boolean => {
  const tokens = tokenize(preprocess(css));
  const match = closers(tokens);
  for (let k = 0; k < tokens.length; k++) if (loads(tokens, match, k) && !localReference(tokens, k)) return true;
  return false;
};

/** Does the text of a presentation attribute (an SVG's `fill`, `filter`, …) hold an address that is not `#id`? */
export const attributeLoads = (value: string): boolean =>
  // every url and loading function needs a parenthesis
  value.includes('(') && cssLoads(value);
