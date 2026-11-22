/**
 * I-Regexp (RFC 9485), the pattern language of `match()` and `search()` (RFC 9535 §2.4.6, §2.4.7;
 * docs/tools/specs/json-query.md §5 п. 20–21). A pattern is checked against the grammar of RFC 9485 §3 by an own
 * parser and, when it conforms, written as the source of a JavaScript RegExp for the `u` flag (RFC 9485 §5.3):
 *
 *   `.` outside a class → `[^\n\r]`   (JavaScript's `.` also refuses U+2028 and U+2029)
 *   `\-` outside a class → `-`         (the `u` flag does not take it there)
 *   match: `^(?:…)$`, search: as is
 *
 * `^` and `$` outside a class are NormalChar in the grammar of RFC 9485 §3, but its mapping (§5.3) passes them through
 * unescaped, so in JavaScript they are anchors — and the RFC 9535 compliance suite expects exactly that
 * (`match(@, '^ab.*')` matches "abc"). The mapping is followed: an unescaped `^` / `$` is an anchor.
 *
 * Anything outside I-Regexp (`\d`, `(?:`, `{,2}`, back references, lazy quantifiers…) is refused with the reason; the
 * functions are then false, not an error (the pattern may come from the document). Iterative (the nesting of groups
 * is a counter), linear in the pattern.
 */

export type IRegexpCheck = { ok: true; source: string } | { ok: false; message: string; offset: number };

const CATEGORIES = new Set(
  'L Lu Ll Lt Lm Lo M Mn Mc Me N Nd Nl No P Pc Pd Ps Pe Pi Pf Po Z Zs Zl Zp S Sm Sc Sk So C Cc Cf Co Cn'.split(' '),
);

/** SingleCharEsc (RFC 9485 §3): the character after the backslash, mapped to its value. */
const SINGLE: Record<string, string> = {
  '(': '(',
  ')': ')',
  '*': '*',
  '+': '+',
  '-': '-',
  '.': '.',
  '?': '?',
  '[': '[',
  '\\': '\\',
  ']': ']',
  '^': '^',
  n: '\n',
  r: '\r',
  t: '\t',
  '{': '{',
  '|': '|',
  '}': '}',
};

const KNOWN_ESCAPES: Record<string, string> = {
  d: '\\d is not part of it (write [0-9])',
  D: '\\D is not part of it',
  w: '\\w is not part of it',
  W: '\\W is not part of it',
  s: '\\s is not part of it',
  S: '\\S is not part of it',
  b: '\\b is not part of it',
  B: '\\B is not part of it',
};

/** A character outside a class, written for a JavaScript pattern with the `u` flag. */
const literalOutside = (ch: string): string => (/[\^$\\.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch);
/** The same inside a class. */
const literalInside = (ch: string): string => (/[\\\][^-]/.test(ch) ? `\\${ch}` : ch);

const controlOut = (ch: string): string => (ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : ch);

class Refuse {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** Checks a pattern against RFC 9485 and, when it is an I-Regexp, gives its JavaScript source (for the `u` flag). */
export const checkIRegexp = (pattern: string): IRegexpCheck => {
  const n = pattern.length;
  let i = 0;
  let out = '';
  let open = 0;
  /** An atom was just written: a quantifier may follow. */
  let quantifiable = false;

  const refuse = (message: string, at = i): never => {
    throw new Refuse(message, at);
  };
  const charAt = (at: number): string => String.fromCodePoint(pattern.codePointAt(at)!);

  /** `\p{…}` / `\P{…}` at `i` (the backslash); returns the JavaScript text. */
  const property = (): string => {
    const start = i;
    const negated = pattern[i + 1] === 'P';
    if (pattern[i + 2] !== '{') refuse(`\\${pattern[i + 1]} needs a category in braces, as in \\p{Lu}`, start);
    const close = pattern.indexOf('}', i + 3);
    if (close < 0) refuse('unterminated \\p{…}', start);
    const name = pattern.slice(i + 3, close);
    if (!CATEGORIES.has(name))
      refuse(`\\${negated ? 'P' : 'p'}{${name}} is not a category of I-Regexp (L, Lu, Nd, P, Zs, …)`, start);
    i = close + 1;
    return `\\${negated ? 'P' : 'p'}{${name}}`;
  };

  /** A backslash escape at `i`; `inside` a class or not. Returns the JavaScript text. */
  const escape = (inside: boolean): string => {
    const next = pattern[i + 1];
    if (next === undefined) refuse('\\ at the end of the pattern');
    if (next === 'p' || next === 'P') return property();
    const value = SINGLE[next!];
    if (value === undefined) {
      const known = KNOWN_ESCAPES[next!];
      if (known) refuse(known);
      if (/[1-9]/.test(next!)) refuse(`back references (\\${next}) are not part of it`);
      refuse(`\\${charAt(i + 1)} is not an escape of I-Regexp`);
    }
    i += 2;
    if (value === '\n' || value === '\r' || value === '\t') return controlOut(value);
    if (!inside && value === '-') return '-';
    return inside ? literalInside(value!) : literalOutside(value!);
  };

  /** A class `[…]` at `i`. */
  const charClass = (): string => {
    const start = i;
    i++;
    let text = '[';
    if (pattern[i] === '^') {
      text += '^';
      i++;
    }
    let first = true;
    for (;;) {
      if (i >= n) refuse('unterminated class: the closing ] is missing', start);
      const c = pattern[i]!;
      if (c === ']') {
        if (first) refuse('an empty class [] is not part of it', start);
        i++;
        return `${text}]`;
      }
      if (c === '-') {
        // Only first or last (RFC 9485 §3: ( "-" / CCE1 ) *CCE1 [ "-" ]).
        if (!(first || pattern[i + 1] === ']')) refuse('- inside a class is allowed only first or last', i);
        text += '\\-';
        i++;
        first = false;
        continue;
      }
      if (c === '[') refuse('[ inside a class must be escaped: \\[', i);
      // CCchar [ "-" CCchar ], or a category escape.
      let low: number;
      if (c === '\\') {
        if (pattern[i + 1] === 'p' || pattern[i + 1] === 'P') {
          text += property();
          first = false;
          continue;
        }
        const at = i;
        const esc = escape(true);
        low = valueOf(esc, at);
        text += esc;
      } else {
        const ch = charAt(i);
        if (ch.length === 1 && ch >= '\u{D800}' && ch <= '\u{DFFF}') refuse('a lone surrogate is not a character', i);
        low = ch.codePointAt(0)!;
        text += literalInside(ch);
        i += ch.length;
      }
      first = false;
      if (pattern[i] === '-' && pattern[i + 1] !== ']' && i + 1 < n) {
        const dash = i;
        i++;
        let high: number;
        if (pattern[i] === '\\') {
          if (pattern[i + 1] === 'p' || pattern[i + 1] === 'P') refuse('a range cannot end in a category', i);
          const at = i;
          const esc = escape(true);
          high = valueOf(esc, at);
          text += `-${esc}`;
        } else {
          if (pattern[i] === '[') refuse('[ inside a class must be escaped: \\[', i);
          if (pattern[i] === '-') refuse('- inside a class is allowed only first or last', i);
          const ch = charAt(i);
          high = ch.codePointAt(0)!;
          text += `-${literalInside(ch)}`;
          i += ch.length;
        }
        if (high < low) refuse('the range is out of order', dash);
      }
    }
  };

  /** The code point an escape written inside a class stands for (for ranges). */
  const valueOf = (esc: string, at: number): number => {
    if (esc === '\\n') return 10;
    if (esc === '\\r') return 13;
    if (esc === '\\t') return 9;
    if (esc.startsWith('\\p') || esc.startsWith('\\P')) return refuse('a range cannot use a category', at);
    return (esc.length === 2 && esc[0] === '\\' ? esc[1]! : esc).codePointAt(0)!;
  };

  /** `{n}`, `{n,}`, `{n,m}` at `i`. */
  const range = (): string => {
    const start = i;
    const m = /^\{([0-9]+)(,([0-9]*))?\}/.exec(pattern.slice(i, i + 64));
    if (!m)
      refuse(pattern[i + 1] === ',' ? '{,n} is not part of it: write {0,n}' : 'a quantifier {…} is malformed', start);
    const low = BigInt(m![1]!);
    if (m![3] !== undefined && m![3] !== '' && BigInt(m![3]) < low)
      refuse('the quantifier is out of order: {n,m} needs n ≤ m', start);
    i += m![0].length;
    return m![0];
  };

  try {
    while (i < n) {
      const c = pattern[i]!;
      if (c === '(') {
        if (pattern[i + 1] === '?') refuse('(?…) groups are not part of it');
        open++;
        out += '(';
        i++;
        quantifiable = false;
        continue;
      }
      if (c === ')') {
        if (open === 0) refuse('unmatched )');
        open--;
        out += ')';
        i++;
        quantifiable = true;
        continue;
      }
      if (c === '|') {
        out += '|';
        i++;
        quantifiable = false;
        continue;
      }
      if (c === '*' || c === '+' || c === '?' || c === '{') {
        if (!quantifiable) refuse(c === '{' ? '{ must be escaped: \\{' : `nothing to repeat before ${c}`);
        out += c === '{' ? range() : c;
        if (c !== '{') i++;
        const next = pattern[i];
        if (next === '?' || next === '+') refuse(`${c}${next} is not part of it (no lazy or possessive quantifiers)`);
        if (next === '*' || next === '{') refuse('a quantifier cannot follow a quantifier');
        quantifiable = false;
        continue;
      }
      if (c === '}' || c === ']') refuse(`${c} must be escaped: \\${c}`);
      if (c === '.') {
        out += '[^\\n\\r]';
        i++;
      } else if (c === '^' || c === '$') {
        out += c;
        i++;
      } else if (c === '[') out += charClass();
      else if (c === '\\') out += escape(false);
      else {
        const ch = charAt(i);
        if (ch.length === 1 && ch >= '\u{D800}' && ch <= '\u{DFFF}') refuse('a lone surrogate is not a character');
        out += controlOut(literalOutside(ch));
        i += ch.length;
      }
      quantifiable = true;
    }
    if (open > 0) refuse('unterminated group: a ) is missing', n);
    return { ok: true, source: out };
  } catch (error) {
    if (error instanceof Refuse) return { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
};

/** The RegExp of an I-Regexp for `match` (the whole string) or `search` (any part); null when it is not one. */
export const iRegexp = (pattern: string, mode: 'match' | 'search'): RegExp | null => {
  const checked = checkIRegexp(pattern);
  if (!checked.ok) return null;
  try {
    return new RegExp(mode === 'match' ? `^(?:${checked.source})$` : checked.source, 'u');
  } catch {
    // A quantifier bound the engine cannot hold ({99999999999}): not a pattern this engine can run.
    return null;
  }
};
