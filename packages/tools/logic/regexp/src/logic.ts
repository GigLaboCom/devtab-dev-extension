/**
 * The RegExp tool's logic (docs/tools/specs/regexp.md §9): the browser's own ECMAScript `RegExp`, nothing parsed or
 * emulated beyond the group names (§5 п. 11) and the pasted literal (§5 п. 29). Pure: no React, no DOM, no chrome.
 *
 * `compileRegexp` only builds the expression (V8 parses, it does not run), so the page may call it on every edit.
 * `runRegexp` runs it — and a pattern can backtrack for ever on a short text — so it runs in the tool's worker only,
 * never on the page's thread. No scan below uses a regular expression of its own on the person's input: every pass is
 * a plain loop, linear in the input.
 */

export type Flag = 'g' | 'i' | 'm' | 's' | 'u' | 'v' | 'y';
export const UI_FLAGS: readonly Flag[] = ['g', 'i', 'm', 's', 'u', 'v', 'y'];

export const MAX_PATTERN = 10_000;
export const MAX_TEXT = 1_000_000;
export const MAX_MATCHES = 10_000;
export const MAX_TABLE_ROWS = 1_000;
export const MAX_RESULT = 5_000_000;
export const DEBOUNCE_MS = 150;
export const TIMEOUT_MS = 1_000;
export const LONG_TIMEOUT_MS = 10_000;
/** How much of a match's text a table shows (§5 п. 20). */
export const MAX_SHOWN_TEXT = 200;

export interface GroupInfo {
  /** 1-based. */
  number: number;
  name?: string;
}

export type Note = 'property-escape-without-u';

export type CompileResult =
  { ok: true; flags: string; literal: string; groups: GroupInfo[]; notes: Note[] } | { ok: false; message: string };

/** Every flag ECMAScript knows, in the order `RegExp.prototype.flags` gives them (ECMA-262, get RegExp.prototype.flags). */
const CANONICAL = 'dgimsuvy';

export const PATTERN_TOO_LONG = 'The pattern is longer than 10,000 characters.';

/** Canonical order (dgimsuvy), no repeats, refuses u+v and unknown letters. */
export const normalizeFlags = (flags: string): { ok: true; flags: string } | { ok: false; message: string } => {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!CANONICAL.includes(flag)) return { ok: false, message: `unknown flag "${flag}"` };
    if (seen.has(flag)) return { ok: false, message: 'a flag is repeated' };
    seen.add(flag);
  }
  if (seen.has('u') && seen.has('v')) return { ok: false, message: 'flags u and v cannot be used together' };
  return { ok: true, flags: [...CANONICAL].filter(f => seen.has(f)).join('') };
};

/** Canonical order of whatever letters are there, unknown ones and repeats dropped. */
const canonical = (flags: string): string => [...CANONICAL].filter(f => flags.includes(f)).join('');

/** UI toggle; turning u on turns v off and the other way round. Never returns d. */
export const toggleFlag = (flags: string, flag: Flag): string => {
  const on = new Set([...canonical(flags)].filter(f => f !== 'd'));
  if (on.has(flag)) on.delete(flag);
  else {
    on.add(flag);
    if (flag === 'u') on.delete('v');
    if (flag === 'v') on.delete('u');
  }
  return [...CANONICAL].filter(f => on.has(f)).join('');
};

/** The person's flags with the tool's own `d` (hasIndices, §4): group positions are always computed. */
const withIndices = (flags: string): string => canonical(`d${flags}`);

/** The engine's message without its `Invalid regular expression: /<pattern>/<flags>: ` start (§5 п. 7). */
const engineMessage = (error: unknown, pattern: string, flags: string): string => {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = `Invalid regular expression: /${pattern}/${flags}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
};

/**
 * Names of capturing groups in order (§5 п. 11); undefined for an unnamed group. A scan, not a parser: `\` and the next
 * character are skipped; inside a class `[…]` parentheses do not count (with v classes nest); `(` not followed by `?`
 * is an unnamed group, `(?<name>` a named one unless `<` is followed by `=` or `!` (a lookbehind); other `(?…` are not
 * groups.
 */
export const scanGroupNames = (pattern: string, unicodeSets: boolean): Array<string | undefined> => {
  const names: Array<string | undefined> = [];
  let depth = 0;
  // The next `>` at or after a position, found once and reused: many `(?<` without a `>` stay linear.
  let close = -2;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (depth > 0) {
      if (ch === ']') depth--;
      else if (ch === '[' && unicodeSets) depth++;
      continue;
    }
    if (ch === '[') {
      depth = 1;
      continue;
    }
    if (ch !== '(') continue;
    if (pattern[i + 1] !== '?') {
      names.push(undefined);
      continue;
    }
    if (pattern[i + 2] !== '<' || pattern[i + 3] === '=' || pattern[i + 3] === '!') continue;
    if (close !== -1 && close < i + 3) close = pattern.indexOf('>', i + 3);
    if (close < 0) continue;
    names.push(pattern.slice(i + 3, close));
    i = close;
  }
  return names;
};

/**
 * Is there an unescaped `\p{` or `\P{` (§5 п. 9)? Without u or v it is the letter p and the braces (ECMA-262 Annex B),
 * inside a class as well as outside one, so both are looked at.
 */
const hasPropertyEscape = (pattern: string): boolean => {
  for (let i = 0; i < pattern.length - 2; i++) {
    if (pattern[i] !== '\\') continue;
    const next = pattern[i + 1];
    if ((next === 'p' || next === 'P') && pattern[i + 2] === '{') return true;
    i++;
  }
  return false;
};

/** The number of capturing groups, from the engine (§5 п. 10): an empty first branch matches at once. */
const countGroups = (pattern: string, flags: string): number => {
  const plain = [...flags].filter(f => f !== 'g' && f !== 'y').join('');
  return (new RegExp(`|${pattern}`, plain).exec('') ?? ['']).length - 1;
};

interface Compiled {
  re: RegExp;
  flags: string;
  literal: string;
  groups: GroupInfo[];
  notes: Note[];
}

const compile = (pattern: string, flags: string): Compiled | { message: string } => {
  if (pattern.length > MAX_PATTERN) return { message: PATTERN_TOO_LONG };
  const normal = normalizeFlags(flags);
  if (!normal.ok) return { message: normal.message };
  const own = normal.flags.replace('d', '');
  const engineFlags = withIndices(own);
  let re: RegExp;
  try {
    re = new RegExp(pattern, engineFlags);
  } catch (error) {
    return { message: engineMessage(error, pattern, engineFlags) };
  }
  const count = countGroups(pattern, engineFlags);
  const names = scanGroupNames(pattern, own.includes('v'));
  const named = names.length === count;
  const groups: GroupInfo[] = [];
  for (let n = 1; n <= count; n++) {
    const name = named ? names[n - 1] : undefined;
    groups.push(name === undefined ? { number: n } : { number: n, name });
  }
  const notes: Note[] =
    !own.includes('u') && !own.includes('v') && hasPropertyEscape(pattern) ? ['property-escape-without-u'] : [];
  return { re, flags: own, literal: `/${re.source}/${own}`, groups, notes };
};

/** §5 п. 6–11. Does not run the expression. */
export const compileRegexp = (pattern: string, flags: string): CompileResult => {
  const c = compile(pattern, flags);
  if (!('re' in c)) return { ok: false, message: c.message };
  return { ok: true, flags: c.flags, literal: c.literal, groups: c.groups, notes: c.notes };
};

export interface GroupMatch extends GroupInfo {
  /** null when the group did not take part in this match. */
  start: number | null;
  end: number | null;
  text: string | null;
}

export interface Match {
  /** 0-based number of the match. */
  index: number;
  /** UTF-16 offsets, [start, end). */
  start: number;
  end: number;
  /** 1-based; column in UTF-16 units. */
  line: number;
  column: number;
  text: string;
  groups: GroupMatch[];
}

export interface RunRequest {
  pattern: string;
  /** As the UI holds them, without d. */
  flags: string;
  text: string;
  /** null when Replace is off. */
  replacement: string | null;
}

export type RunResult =
  | {
      ok: true;
      flags: string;
      literal: string;
      matches: Match[];
      /** More than MAX_MATCHES matches exist. */
      truncated: boolean;
      /** A match boundary splits a surrogate pair (§5 п. 16). */
      splitsPair: boolean;
      replaced: string | null;
      replacedTooLarge: boolean;
    }
  | { ok: false; message: string };

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Does offset `at` fall between the two halves of a surrogate pair? */
const splitsPairAt = (text: string, at: number): boolean =>
  at > 0 && at < text.length && isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at));

/** ECMA-262 AdvanceStringIndex: one code unit, or one code point with u or v. */
const advance = (text: string, index: number, fullUnicode: boolean): number => {
  if (!fullUnicode || index + 1 >= text.length) return index + 1;
  return isHigh(text.charCodeAt(index)) && isLow(text.charCodeAt(index + 1)) ? index + 2 : index + 1;
};

/**
 * The matches of `re` on `text` in order, as `exec` with `g` (the steps of String.prototype.matchAll: an empty match
 * moves on by AdvanceStringIndex; with `y` the run stops at the first place with no match) or one `exec` from 0 without
 * `g`. `visit` returns false to stop. `re` is not changed.
 */
const eachMatch = (text: string, re: RegExp, visit: (m: RegExpExecArray) => boolean): void => {
  const own = new RegExp(re.source, re.flags);
  own.lastIndex = 0;
  if (!own.global) {
    const m = own.exec(text);
    if (m) visit(m);
    return;
  }
  const fullUnicode = own.unicode || own.flags.includes('v');
  for (;;) {
    const m = own.exec(text);
    if (!m) return;
    if (m[0] === '') own.lastIndex = advance(text, own.lastIndex, fullUnicode);
    if (!visit(m)) return;
  }
};

/** What the worker runs. May take unbounded time on a bad pattern: never on the main thread. */
export const runRegexp = (request: RunRequest): RunResult => {
  const c = compile(request.pattern, request.flags);
  if (!('re' in c)) return { ok: false, message: c.message };
  const { text } = request;
  const matches: Match[] = [];
  let truncated = false;
  let splitsPair = false;
  // Line and column in one pass (§5 п. 15): counting resumes where the previous match left off.
  let line = 1;
  let lineStart = 0;
  let nextBreak = text.indexOf('\n');
  eachMatch(text, c.re, m => {
    if (matches.length === MAX_MATCHES) {
      truncated = true;
      return false;
    }
    const start = m.index;
    const end = start + m[0].length;
    while (nextBreak !== -1 && nextBreak < start) {
      line++;
      lineStart = nextBreak + 1;
      nextBreak = text.indexOf('\n', lineStart);
    }
    if (splitsPairAt(text, start) || splitsPairAt(text, end)) splitsPair = true;
    const indices = m.indices;
    matches.push({
      index: matches.length,
      start,
      end,
      line,
      column: start - lineStart + 1,
      text: m[0],
      groups: c.groups.map(g => {
        const at = indices?.[g.number];
        const captured = m[g.number];
        return {
          ...g,
          start: at ? at[0] : null,
          end: at ? at[1] : null,
          text: captured === undefined ? null : captured,
        };
      }),
    });
    return true;
  });
  let replaced: string | null = null;
  let replacedTooLarge = false;
  if (request.replacement !== null) {
    replaced = replaceAll(text, c.re, request.replacement, MAX_RESULT);
    replacedTooLarge = replaced === null;
  }
  return { ok: true, flags: c.flags, literal: c.literal, matches, truncated, splitsPair, replaced, replacedTooLarge };
};

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** ECMA-262 GetSubstitution. */
export const substitute = (
  matched: string,
  str: string,
  position: number,
  captures: ReadonlyArray<string | undefined>,
  namedCaptures: Record<string, string | undefined> | undefined,
  replacement: string,
): string => {
  const tailPos = Math.min(position + matched.length, str.length);
  // The next `>` for `$<name>`, found once and reused (many `$<` without a `>` stay linear).
  let close = -2;
  let out = '';
  let i = 0;
  while (i < replacement.length) {
    const dollar = replacement.indexOf('$', i);
    if (dollar < 0) {
      out += replacement.slice(i);
      break;
    }
    out += replacement.slice(i, dollar);
    i = dollar;
    const next = replacement[i + 1];
    if (next === '$') {
      out += '$';
      i += 2;
    } else if (next === '&') {
      out += matched;
      i += 2;
    } else if (next === '`') {
      out += str.slice(0, position);
      i += 2;
    } else if (next === "'") {
      out += str.slice(tailPos);
      i += 2;
    } else if (next !== undefined && isDigit(next.charCodeAt(0))) {
      let digitCount = i + 2 < replacement.length && isDigit(replacement.charCodeAt(i + 2)) ? 2 : 1;
      let index = Number(replacement.slice(i + 1, i + 1 + digitCount));
      if (index > captures.length && digitCount === 2) {
        digitCount = 1;
        index = Number(replacement[i + 1]);
      }
      const ref = replacement.slice(i, i + 1 + digitCount);
      out += index >= 1 && index <= captures.length ? (captures[index - 1] ?? '') : ref;
      i += 1 + digitCount;
    } else if (next === '<') {
      if (namedCaptures !== undefined && close !== -1 && close < i + 2) close = replacement.indexOf('>', i + 2);
      if (namedCaptures === undefined || close < 0) {
        out += '$<';
        i += 2;
      } else {
        const name = replacement.slice(i + 2, close);
        const own = Object.prototype.hasOwnProperty.call(namedCaptures, name);
        out += own ? (namedCaptures![name] ?? '') : '';
        i = close + 1;
      }
    } else {
      out += '$';
      i += 1;
    }
  }
  return out;
};

/** String.prototype.replace through substitute; null once the result passes `limit`. */
export const replaceAll = (text: string, re: RegExp, replacement: string, limit: number): string | null => {
  const parts: string[] = [];
  let length = 0;
  let from = 0;
  let over = false;
  const push = (part: string): boolean => {
    length += part.length;
    if (length > limit) return false;
    parts.push(part);
    return true;
  };
  eachMatch(text, re, m => {
    const captures = m.slice(1) as Array<string | undefined>;
    const named = m.groups as Record<string, string | undefined> | undefined;
    if (!push(text.slice(from, m.index)) || !push(substitute(m[0], text, m.index, captures, named, replacement))) {
      over = true;
      return false;
    }
    from = m.index + m[0].length;
    return true;
  });
  if (over || !push(text.slice(from))) return null;
  return parts.join('');
};

export type Segment =
  | { kind: 'plain'; start: number; end: number }
  | { kind: 'match' | 'empty'; start: number; end: number; match: number };

/** The text cut into plain text, matches and empty matches, in order (§5 п. 17). Matches never overlap. */
export const segments = (text: string, matches: readonly Match[]): Segment[] => {
  const out: Segment[] = [];
  let at = 0;
  for (const m of matches) {
    if (m.start > at) out.push({ kind: 'plain', start: at, end: m.start });
    out.push({ kind: m.start === m.end ? 'empty' : 'match', start: m.start, end: m.end, match: m.index });
    at = Math.max(at, m.end);
  }
  if (at < text.length) out.push({ kind: 'plain', start: at, end: text.length });
  return out;
};

const isLineTerminator = (ch: string): boolean => ch === '\n' || ch === '\r' || ch === ' ' || ch === ' ';

/**
 * §5 п. 29: the pattern and the flags of a pasted literal, or null when it is not one. The body is read as a
 * JavaScript RegularExpressionLiteral reads it: `\` takes the next character, a `/` inside a class `[…]` does not end
 * it, no line terminator. The flags are letters, valid, without repeats or u with v; `d` is dropped (§4).
 */
export const splitLiteral = (pasted: string): { pattern: string; flags: string } | null => {
  const text = pasted.trim();
  if (text[0] !== '/') return null;
  let inClass = false;
  let end = -1;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]!;
    if (isLineTerminator(ch)) return null;
    if (ch === '\\') {
      i++;
      if (i >= text.length || isLineTerminator(text[i]!)) return null;
    } else if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') inClass = true;
    else if (ch === '/') {
      end = i;
      break;
    }
  }
  if (end <= 1) return null;
  const flags = text.slice(end + 1);
  for (const ch of flags) if (ch < 'a' || ch > 'z') return null;
  const normal = normalizeFlags(flags);
  if (!normal.ok) return null;
  return { pattern: text.slice(1, end), flags: normal.flags.replace('d', '') };
};

/** JSON.stringify, cut to 200 characters with «…». */
export const showMatchText = (text: string): string => {
  // Only the start is needed: a long match is cut before it is quoted.
  const shown = JSON.stringify(text.length > MAX_SHOWN_TEXT ? text.slice(0, MAX_SHOWN_TEXT + 1) : text);
  return shown.length > MAX_SHOWN_TEXT ? `${shown.slice(0, MAX_SHOWN_TEXT - 1)}…` : shown;
};

/** `1,234` — the thousands separator of the texts (§8). */
export const formatCount = (n: number): string => n.toLocaleString('en-US');

/** The status line (§8): `No matches`, `1 match`, `N matches`, `10,000+ matches (the first 10,000 are shown)`. */
export const matchCountText = (count: number, truncated: boolean): string => {
  if (truncated) return `${formatCount(MAX_MATCHES)}+ matches (the first ${formatCount(MAX_MATCHES)} are shown)`;
  if (count === 0) return 'No matches';
  return count === 1 ? '1 match' : `${formatCount(count)} matches`;
};

/** Flags in words, as the line next to the toggles says them (§8): `global, multiline`. */
export const FLAG_NAMES: Readonly<Record<Flag, string>> = {
  g: 'global',
  i: 'ignore case',
  m: 'multiline',
  s: 'dotAll',
  u: 'unicode',
  v: 'unicodeSets',
  y: 'sticky',
};

export const flagWords = (flags: string): string =>
  UI_FLAGS.filter(f => flags.includes(f))
    .map(f => FLAG_NAMES[f])
    .join(', ');
