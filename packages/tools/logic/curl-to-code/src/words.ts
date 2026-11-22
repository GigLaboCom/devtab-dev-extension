/**
 * The words of a command line (docs/tools/specs/curl-to-code.md §5, «Слова командной строки»), read the way a shell
 * reads them and never by running anything: POSIX shell quoting with bash's $'…', or the two layers of a Windows `cmd`
 * line ("Copy as cURL (cmd)"). Substitutions and variables are not expanded: their text stays in the word as written and
 * the command is marked (`expansions`). What follows the command — a pipe, `;`, `&`, a redirection, or the next line —
 * is not read; it is returned as `rest`.
 */

export interface Word {
  /** The word's text. Bytes that are not UTF-8 (from $'\xff') are U+FFFD here and kept in `bytes`. */
  text: string;
  /** UTF-16 offset of the start of the word in the input. */
  offset: number;
  /** The word's bytes, only when they are not UTF-8 text (bash's $'\xff', $'\ud800'). */
  bytes?: Uint8Array;
}

export type Words =
  | { ok: true; words: Word[]; form: 'posix' | 'cmd'; rest: string; expansions: boolean }
  | { ok: false; message: string; offset: number };

/**
 * The cmd form (§5 п. 1, narrowed — §15): a word that starts with `^"` (how "Copy as cURL (cmd)" quotes every value),
 * or a line that ends with a blank and `^` (its line continuation). A `^"` inside a POSIX value (`-d '{"re":"^"}'`)
 * does not make a command cmd.
 */
export const isCmdForm = (text: string): boolean => /(?:^|\s)\^"/.test(text) || /\s\^\r?(?:\n|$)/.test(text);

/** Text that came after the command, or '' when it is only blanks and comments. */
const restOf = (text: string): string => {
  const rest = text.trim();
  if (rest === '') return '';
  return rest.split(/\r?\n/).every(line => line.trim() === '' || line.trim().startsWith('#')) ? '' : rest;
};

// ----------------------------------------------------------------------------------------------------------------------
// The word under construction: string pieces, and byte pieces only when $'…' made bytes that are not UTF-8.

const utf8 = new TextEncoder();
// ignoreBOM: a BOM the bytes start with is a character of the word ($'\xef\xbb\xbf…'), not a mark to drop.
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lossy = new TextDecoder('utf-8', { ignoreBOM: true });

class Builder {
  private parts: Array<string | Uint8Array> = [];
  private binary = false;
  started = false;
  offset = 0;
  /** Only unquoted digits so far (a file descriptor before a redirection: `2>`). */
  digitsOnly = true;

  start(offset: number): void {
    if (!this.started) {
      this.started = true;
      this.offset = offset;
    }
  }
  text(s: string, quoted = false): void {
    if (s === '' && !quoted) return;
    if (quoted || !/^\d*$/.test(s)) this.digitsOnly = false;
    this.parts.push(s);
  }
  bytes(b: Uint8Array): void {
    this.digitsOnly = false;
    try {
      this.parts.push(strict.decode(b));
    } catch {
      this.binary = true;
      this.parts.push(b);
    }
  }
  take(): Word {
    let word: Word;
    if (!this.binary) word = { text: (this.parts as string[]).join(''), offset: this.offset };
    else {
      const chunks = this.parts.map(p => (typeof p === 'string' ? utf8.encode(p) : p));
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      word = { text: lossy.decode(bytes), offset: this.offset, bytes };
    }
    this.parts = [];
    this.binary = false;
    this.started = false;
    this.digitsOnly = true;
    return word;
  }
}

// ----------------------------------------------------------------------------------------------------------------------
// POSIX shell (IEEE Std 1003.1-2024 §2.2 Quoting, §2.3 Token Recognition) and bash's $'…'.

const BLANK = new Set([' ', '\t', '\r', '\n']);
const OPERATOR = new Set(['|', ';', '&', '<', '>']);
/** What makes `$` the start of an expansion: a name, a special or positional parameter, ${…}, $(…). A `~` at the
 * start of a word (tilde expansion) marks the command too. */
const EXPANDS = /[A-Za-z_0-9{(@*#?!$-]/;
/** Ends a run of ordinary characters outside quotes. */
const SPECIAL_UNQUOTED = /[\s'"\\$`#|;&<>]/g;

/**
 * Where a substitution that starts at `i` ends (exclusive): `$(…)` and `${…}` to their matching bracket, `` `…` `` to
 * the next unescaped backtick — quotes and backslashes inside skipped. -1 when it is not closed.
 */
const substitutionEnd = (text: string, i: number): number => {
  if (text[i] === '`') {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === '`') return j + 1;
    }
    return -1;
  }
  const open = text[i + 1]!;
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') j++;
    else if (c === "'") {
      const end = text.indexOf("'", j + 1);
      if (end < 0) return -1;
      j = end;
    } else if (c === '"') {
      for (j++; j < text.length && text[j] !== '"'; j++) if (text[j] === '\\') j++;
      if (j >= text.length) return -1;
    } else if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return -1;
};

const HEX = /^[0-9A-Fa-f]$/;

/** UTF-8 of a code point as bash writes it: also for surrogates and values above U+10FFFF (not valid UTF-8 then). */
const pushCodePoint = (out: number[], cp: number): void => {
  if (cp < 0x80) out.push(cp);
  else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
  else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  else if (cp < 0x200000)
    out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  else if (cp < 0x4000000)
    out.push(
      0xf8 | (cp >> 24),
      0x80 | ((cp >> 18) & 0x3f),
      0x80 | ((cp >> 12) & 0x3f),
      0x80 | ((cp >> 6) & 0x3f),
      0x80 | (cp & 0x3f),
    );
  else
    out.push(
      0xfc | (cp >>> 30),
      0x80 | ((cp >> 24) & 0x3f),
      0x80 | ((cp >> 18) & 0x3f),
      0x80 | ((cp >> 12) & 0x3f),
      0x80 | ((cp >> 6) & 0x3f),
      0x80 | (cp & 0x3f),
    );
};

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  e: 27,
  E: 27,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  '\\': 92,
  "'": 39,
  '"': 34,
  '?': 63,
};

/**
 * The bytes of bash's $'…' body (`text` from `start` to the closing quote at `end`): the escapes of §5 п. 2, `\cX`
 * (control-X, as bash), and a NUL ends the string (bash cuts arguments there).
 */
const ansiC = (text: string, start: number, end: number): Uint8Array => {
  const out: number[] = [];
  for (let i = start; i < end; i++) {
    const c = text[i]!;
    if (c !== '\\') {
      const cp = text.codePointAt(i)!;
      if (cp > 0xffff) i++;
      pushCodePoint(out, cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
      continue;
    }
    const e = text[i + 1];
    if (e === undefined || i + 1 >= end) {
      out.push(92);
      continue;
    }
    i++;
    const simple = SIMPLE_ESCAPES[e];
    if (simple !== undefined) out.push(simple);
    else if (e === 'x' || e === 'u' || e === 'U') {
      const max = e === 'x' ? 2 : e === 'u' ? 4 : 8;
      let digits = '';
      while (digits.length < max && i + 1 < end && HEX.test(text[i + 1]!)) digits += text[++i];
      if (digits === '') out.push(92, e.charCodeAt(0));
      else if (e === 'x') out.push(Number.parseInt(digits, 16));
      else pushCodePoint(out, Number.parseInt(digits, 16));
    } else if (e >= '0' && e <= '7') {
      let digits = e;
      while (digits.length < 3 && i + 1 < end && text[i + 1]! >= '0' && text[i + 1]! <= '7') digits += text[++i];
      out.push(Number.parseInt(digits, 8) & 0xff);
    } else if (e === 'c' && i + 1 < end) {
      const x = text[++i]!;
      out.push(x === '?' ? 0x7f : x.toUpperCase().charCodeAt(0) & 0x1f);
    } else {
      out.push(92);
      pushCodePoint(out, text.codePointAt(i)!);
      if (text.codePointAt(i)! > 0xffff) i++;
    }
  }
  const nul = out.indexOf(0);
  return Uint8Array.from(nul < 0 ? out : out.slice(0, nul));
};

const splitPosix = (text: string): Words => {
  const words: Word[] = [];
  const word = new Builder();
  let expansions = false;
  let rest = '';
  const n = text.length;
  // Once a substitution is found unclosed, later ones are not searched for: each search runs to the end of the text,
  // and a paste of megabytes of `$(` would take quadratic time (the command is broken for a shell anyway).
  let unclosed = false;
  const closeOf = (j: number): number => {
    if (unclosed) return -1;
    const stop = substitutionEnd(text, j);
    if (stop < 0) unclosed = true;
    return stop;
  };
  const end = (): void => {
    if (word.started) words.push(word.take());
  };

  let i = 0;
  scan: while (i < n) {
    const c = text[i]!;
    if (BLANK.has(c)) {
      end();
      if (c === '\n' && words.length > 0) {
        rest = restOf(text.slice(i));
        break;
      }
      i++;
      continue;
    }
    if (OPERATOR.has(c)) {
      // `2>file`: the digits before a redirection are a file descriptor, not a word.
      if ((c === '<' || c === '>') && word.started && word.digitsOnly) word.take();
      end();
      rest = restOf(text.slice(i));
      break;
    }
    if (c === '~' && !word.started && /^~[\w.+-]*(?:\/|\s|$)/.test(text.slice(i, i + 64))) expansions = true;
    if (c === '#' && !word.started) {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (c === '\\' && (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n'))) {
      // A line continuation: both characters go, and a word goes on across it.
      i += text[i + 1] === '\n' ? 2 : 3;
      continue;
    }
    word.start(i);
    if (c === '\\') {
      if (i + 1 < n) {
        const cp = text.codePointAt(i + 1)!;
        const width = cp > 0xffff ? 2 : 1;
        word.text(text.slice(i + 1, i + 1 + width), true);
        i += 1 + width;
      } else {
        word.text('\\', true);
        i++;
      }
      continue;
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) return { ok: false, message: 'unterminated single quote', offset: i };
      word.text(text.slice(i + 1, close), true);
      i = close + 1;
      continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      let close = i + 2;
      while (close < n && text[close] !== "'") close += text[close] === '\\' ? 2 : 1;
      if (close >= n) return { ok: false, message: "unterminated $'…' string", offset: i };
      word.bytes(ansiC(text, i + 2, close));
      word.text('', true);
      i = close + 1;
      continue;
    }
    if (c === '"' || (c === '$' && text[i + 1] === '"')) {
      // bash's $"…" (a translated string) reads as "…".
      const open = c === '"' ? i : i + 1;
      let j = open + 1;
      let piece = '';
      let run = j;
      for (;;) {
        if (j >= n) return { ok: false, message: 'unterminated double quote', offset: open };
        const d = text[j]!;
        if (d === '"') break;
        if (d === '\\') {
          const e = text[j + 1];
          if (e === '\n' || e === '$' || e === '`' || e === '"' || e === '\\') {
            piece += text.slice(run, j) + (e === '\n' ? '' : e);
            j += 2;
            run = j;
          } else if (e === '\r' && text[j + 2] === '\n') {
            piece += text.slice(run, j);
            j += 3;
            run = j;
          } else j += 2;
          continue;
        }
        if (d === '`' || (d === '$' && EXPANDS.test(text[j + 1] ?? ''))) {
          expansions = true;
          if (d === '`' || text[j + 1] === '(' || text[j + 1] === '{') {
            const stop = closeOf(j);
            if (stop > 0) {
              j = stop;
              continue;
            }
          }
        }
        j++;
      }
      word.text(piece + text.slice(run, j), true);
      i = j + 1;
      continue;
    }
    if (c === '`' || (c === '$' && EXPANDS.test(text[i + 1] ?? ''))) {
      expansions = true;
      if (c === '`' || text[i + 1] === '(' || text[i + 1] === '{') {
        const stop = closeOf(i);
        if (stop > 0) {
          word.text(text.slice(i, stop), true);
          i = stop;
          continue scan;
        }
      }
      word.text(c, true);
      i++;
      continue;
    }
    // A run of ordinary characters.
    SPECIAL_UNQUOTED.lastIndex = i + 1;
    const stop = SPECIAL_UNQUOTED.exec(text)?.index ?? n;
    word.text(text.slice(i, stop));
    i = stop;
  }
  end();
  return { ok: true, words, form: 'posix', rest, expansions };
};

// ----------------------------------------------------------------------------------------------------------------------
// Windows cmd (§5 п. 3): cmd.exe's carets and quotes first, then the C runtime's argument rules.

const splitCmd = (text: string): Words => {
  // Layer 1 — cmd.exe: what reaches the program, each character with its place in the input.
  const chars: string[] = [];
  const places: number[] = [];
  let quoted = false;
  let expansions = false;
  let rest = '';
  const n = text.length;
  const emit = (ch: string, at: number): void => {
    chars.push(ch);
    places.push(at);
  };
  const lineBreak = (i: number): number => (text[i] === '\n' ? 1 : text[i] === '\r' && text[i + 1] === '\n' ? 2 : 0);
  for (let i = 0; i < n;) {
    const c = text[i]!;
    const nl = lineBreak(i);
    if (nl > 0) {
      if (chars.some(ch => ch !== ' ' && ch !== '\t')) {
        rest = restOf(text.slice(i));
        break;
      }
      i += nl;
      continue;
    }
    if (!quoted && c === '^') {
      const cont = lineBreak(i + 1);
      if (cont > 0) {
        // A caret at the end of a line joins the next one, whose first character is escaped: a second line break
        // right after it is a line break in the value (how "Copy as cURL (cmd)" writes one).
        i += 1 + cont;
        const second = lineBreak(i);
        if (second > 0) {
          emit('\n', i);
          i += second;
        } else if (i < n) {
          emit(text[i]!, i);
          i++;
        }
        continue;
      }
      if (i + 1 < n) emit(text[i + 1]!, i);
      i += 2;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && OPERATOR.has(c) && c !== ';') {
      rest = restOf(text.slice(i));
      break;
    } else if (c === '%' && /^%[A-Za-z_][A-Za-z0-9_]*%/.test(text.slice(i, i + 256))) expansions = true;
    emit(c, i);
    i++;
  }

  // Layer 2 — the C runtime: blanks split outside quotes; backslashes count only before a quote.
  const words: Word[] = [];
  const m = chars.length;
  let k = 0;
  while (k < m) {
    while (k < m && (chars[k] === ' ' || chars[k] === '\t' || chars[k] === '\r')) k++;
    if (k >= m) break;
    const offset = places[k]!;
    let value = '';
    let inQuotes = false;
    while (k < m) {
      const c = chars[k]!;
      if (!inQuotes && (c === ' ' || c === '\t' || c === '\r')) break;
      if (c === '\\') {
        let slashes = 0;
        while (k < m && chars[k] === '\\') {
          slashes++;
          k++;
        }
        if (chars[k] === '"') {
          value += '\\'.repeat(slashes >> 1);
          if (slashes % 2 === 1) {
            value += '"';
            k++;
          }
        } else value += '\\'.repeat(slashes);
        continue;
      }
      if (c === '"') {
        if (inQuotes && chars[k + 1] === '"') {
          value += '"';
          k += 2;
          continue;
        }
        inQuotes = !inQuotes;
        k++;
        continue;
      }
      value += c;
      k++;
    }
    words.push({ text: value, offset });
  }
  return { ok: true, words, form: 'cmd', rest, expansions };
};

/** The words of a command line, in the POSIX or the cmd form (`isCmdForm`). */
export const splitWords = (text: string): Words => (isCmdForm(text) ? splitCmd(text) : splitPosix(text));
