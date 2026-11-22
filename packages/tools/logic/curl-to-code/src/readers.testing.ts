/**
 * For the package's tests only: readers of string literals for the languages the machine the tool was written on cannot
 * run (Kotlin, C#, PHP, Dart, PowerShell), each written from its language's specification — the rules are cited at each
 * reader. A reader reads one literal at a position and returns what the language would hold, or throws where the
 * language would refuse the source or read something else than text (an unknown escape, a raw line break where none
 * is allowed, an interpolation, an unterminated literal). `scan` reads every literal of a whole program, skipping
 * comments, so a test can check that a generated program has no literal that ends early.
 */

export type Language = 'kotlin' | 'csharp' | 'php' | 'dart' | 'powershell';

/** What a literal reads as: UTF-16 text, or bytes (PHP strings are bytes). */
export type Read = { value: string; end: number } | { bytes: Uint8Array; end: number };

const HEX = /^[0-9A-Fa-f]$/;
const utf8 = new TextEncoder();

const hexRun = (src: string, at: number, min: number, max: number): string => {
  let n = 0;
  while (n < max && at + n < src.length && HEX.test(src[at + n]!)) n++;
  if (n < min) throw new Error(`at ${at}: expected ${min} hex digits`);
  return src.slice(at, at + n);
};

const fromCode = (cp: number): string => {
  if (cp > 0x10ffff) throw new Error(`code point ${cp.toString(16)} out of range`);
  // A surrogate code point stays one UTF-16 unit (String.fromCodePoint would refuse nothing, but be explicit).
  return cp <= 0xffff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
};

// ----------------------------------------------------------------------------------------------------------------------
// Kotlin — Kotlin language specification, «Syntax and grammar» §1.2.4 (string mode): LineStrText is any character but
// `\`, `"` and `$` (a lone `$` not followed by an identifier or `{` is text); LineStrEscapedChar is `\t \b \r \n \' \" \\
// \$` or `\u` with exactly four hex digits; LineStrRef `$identifier` and LineStrExprStart `${` are templates. A line
// string cannot hold a raw line break.

const KOTLIN_ESCAPES: Readonly<Record<string, string>> = {
  t: '\t',
  b: '\b',
  r: '\r',
  n: '\n',
  "'": "'",
  '"': '"',
  '\\': '\\',
  $: '$',
};

const readKotlin = (src: string, at: number): Read => {
  if (src[at] !== '"') throw new Error(`at ${at}: not a string`);
  let out = '';
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"') return { value: out, end: i + 1 };
    if (c === '\n' || c === '\r') throw new Error(`at ${i}: raw line break`);
    if (c === '$') {
      if (/[\p{L}_`{]/u.test(src[i + 1] ?? '')) throw new Error(`at ${i}: template`);
      out += c;
      continue;
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = src[++i];
    if (e === 'u') {
      const h = hexRun(src, i + 1, 4, 4);
      out += String.fromCharCode(parseInt(h, 16));
      i += 4;
    } else if (e !== undefined && e in KOTLIN_ESCAPES) out += KOTLIN_ESCAPES[e];
    else throw new Error(`at ${i}: unknown escape \\${e}`);
  }
  throw new Error('unterminated string');
};

// ----------------------------------------------------------------------------------------------------------------------
// C# — ECMA-334 7th edition §6.4.5.6: a regular string literal is any character but `"`, `\` and a new-line character
// (CR, LF, U+0085, U+2028, U+2029, §6.3.2), a simple escape (`\' \" \\ \0 \a \b \f \n \r \t \v`), a hexadecimal escape
// `\x` with one to four hex digits, or a Unicode escape `\u` with four or `\U` with eight. A character literal (`'\r'`)
// is read by `scan` and skipped.

const CSHARP_ESCAPES: Readonly<Record<string, string>> = {
  "'": "'",
  '"': '"',
  '\\': '\\',
  '0': '\0',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};
const CSHARP_NEW_LINE = /[\r\n\u{85}\u{2028}\u{2029}]/u;

const readCsharpBody = (src: string, at: number, quote: string): Read => {
  let out = '';
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === quote) return { value: out, end: i + 1 };
    if (CSHARP_NEW_LINE.test(c)) throw new Error(`at ${i}: new-line character in a literal`);
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = src[++i];
    if (e === 'x') {
      const h = hexRun(src, i + 1, 1, 4);
      out += String.fromCharCode(parseInt(h, 16));
      i += h.length;
    } else if (e === 'u') {
      out += String.fromCharCode(parseInt(hexRun(src, i + 1, 4, 4), 16));
      i += 4;
    } else if (e === 'U') {
      out += fromCode(parseInt(hexRun(src, i + 1, 8, 8), 16));
      i += 8;
    } else if (e !== undefined && e in CSHARP_ESCAPES) out += CSHARP_ESCAPES[e];
    else throw new Error(`at ${i}: unknown escape \\${e}`);
  }
  throw new Error('unterminated string');
};

const readCsharp = (src: string, at: number): Read => {
  if (src[at] !== '"') throw new Error(`at ${at}: not a string`);
  return readCsharpBody(src, at, '"');
};

// ----------------------------------------------------------------------------------------------------------------------
// PHP — PHP Manual, «Strings». Single quoted: `\'` is a quote, `\\` a backslash, every other backslash is itself.
// Double quoted: `\n \r \t \v \e \f \\ \$ \"`, `\[0-7]{1,3}` (octal, the byte's low eight bits), `\x[0-9A-Fa-f]{1,2}`,
// `\u{[0-9A-Fa-f]+}` (the code point's UTF-8); any other backslash is itself; `$` followed by a name start
// ([a-zA-Z_\x80-\xff]) and `{$` interpolate. A PHP string is bytes; raw characters are their UTF-8.

const PHP_ESCAPES: Readonly<Record<string, number>> = {
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  e: 27,
  f: 12,
  '\\': 0x5c,
  $: 0x24,
  '"': 0x22,
};

const readPhp = (src: string, at: number): Read => {
  const q = src[at];
  const bytes: number[] = [];
  const text = (s: string): void => void bytes.push(...utf8.encode(s));
  if (q === "'") {
    for (let i = at + 1; i < src.length; i++) {
      const c = src[i]!;
      if (c === "'") return { bytes: Uint8Array.from(bytes), end: i + 1 };
      if (c === '\\' && (src[i + 1] === "'" || src[i + 1] === '\\')) text(src[++i]!);
      else if (/[\ud800-\udbff]/.test(c) && /[\udc00-\udfff]/.test(src[i + 1] ?? '')) text(c + src[++i]);
      else text(c);
    }
    throw new Error('unterminated string');
  }
  if (q !== '"') throw new Error(`at ${at}: not a string`);
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"') return { bytes: Uint8Array.from(bytes), end: i + 1 };
    if (c === '$' && /[A-Za-z_\x80-￿]/.test(src[i + 1] ?? '')) throw new Error(`at ${i}: interpolation`);
    if (c === '{' && src[i + 1] === '$') throw new Error(`at ${i}: interpolation`);
    if (c !== '\\') {
      if (/[\ud800-\udbff]/.test(c) && /[\udc00-\udfff]/.test(src[i + 1] ?? '')) text(c + src[++i]);
      else text(c);
      continue;
    }
    const e = src[i + 1] ?? '';
    if (e in PHP_ESCAPES) {
      bytes.push(PHP_ESCAPES[e]!);
      i++;
    } else if (/[0-7]/.test(e)) {
      const m = /^[0-7]{1,3}/.exec(src.slice(i + 1))![0];
      bytes.push(parseInt(m, 8) & 0xff);
      i += m.length;
    } else if (e === 'x' && HEX.test(src[i + 2] ?? '')) {
      const h = hexRun(src, i + 2, 1, 2);
      bytes.push(parseInt(h, 16));
      i += 1 + h.length;
    } else if (e === 'u' && src[i + 2] === '{') {
      const close = src.indexOf('}', i + 3);
      const h = src.slice(i + 3, close);
      if (close < 0 || !/^[0-9A-Fa-f]+$/.test(h)) throw new Error(`at ${i}: bad \\u{…}`);
      const cp = parseInt(h, 16);
      if (cp >= 0xd800 && cp <= 0xdfff) throw new Error(`at ${i}: surrogate in \\u{…}`);
      text(String.fromCodePoint(cp));
      i = close;
    } else text('\\');
  }
  throw new Error('unterminated string');
};

// ----------------------------------------------------------------------------------------------------------------------
// Dart — Dart Programming Language Specification §17.7: in a single-line string, `\n \r \f \b \t \v`, `\x` with exactly
// two hex digits, `\u` with exactly four or `\u{…}` with one to six, and `\k` for any other k is k; a raw line break is
// not allowed; `$identifier` and `${…}` interpolate (§17.7.1). The quote may be ' or ".

const DART_ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', f: '\f', b: '\b', t: '\t', v: '\v' };

const readDart = (src: string, at: number): Read => {
  const q = src[at];
  if (q !== "'" && q !== '"') throw new Error(`at ${at}: not a string`);
  let out = '';
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === q) return { value: out, end: i + 1 };
    if (c === '\n' || c === '\r') throw new Error(`at ${i}: raw line break`);
    if (c === '$') {
      if (/[A-Za-z_{]/.test(src[i + 1] ?? '')) throw new Error(`at ${i}: interpolation`);
      throw new Error(`at ${i}: a lone $ is an error in Dart`);
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = src[++i] ?? '';
    if (e === 'x') {
      out += String.fromCharCode(parseInt(hexRun(src, i + 1, 2, 2), 16));
      i += 2;
    } else if (e === 'u' && src[i + 1] === '{') {
      const h = hexRun(src, i + 2, 1, 6);
      if (src[i + 2 + h.length] !== '}') throw new Error(`at ${i}: bad \\u{…}`);
      out += fromCode(parseInt(h, 16));
      i += 2 + h.length;
    } else if (e === 'u') {
      out += String.fromCharCode(parseInt(hexRun(src, i + 1, 4, 4), 16));
      i += 4;
    } else if (e === '\n' || e === '\r') throw new Error(`at ${i}: escaped line break`);
    else out += DART_ESCAPES[e] ?? e;
  }
  throw new Error('unterminated string');
};

// ----------------------------------------------------------------------------------------------------------------------
// PowerShell — the language specification §2.3.5.2 and about_Quoting_Rules / about_Special_Characters. Single-quote
// characters: U+0027, U+2018, U+2019, U+201A, U+201B; in a single-quoted string two of them in a row are one (the
// second), everything else is itself. Double-quote characters: U+0022, U+201C, U+201D, U+201E; in a double-quoted string
// two of them in a row are one, a backtick escapes the next character (`` `0 `a `b `e `f `n `r `t `v `` and `` `u{…} ``
// with one to six hex digits, PowerShell 6+; any other character is itself), and `$` starts a variable or a
// subexpression unless escaped — the reader refuses an unescaped `$` followed by anything a variable can start with.

const PS_SINGLE = "'\u{2018}\u{2019}\u{201a}\u{201b}";
const PS_DOUBLE = '"\u{201c}\u{201d}\u{201e}';
const PS_ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  e: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

const readPowershell = (src: string, at: number): Read => {
  const q = src[at] ?? '';
  let out = '';
  if (PS_SINGLE.includes(q)) {
    for (let i = at + 1; i < src.length; i++) {
      const c = src[i]!;
      if (PS_SINGLE.includes(c)) {
        if (PS_SINGLE.includes(src[i + 1] ?? '\0')) out += src[++i];
        else return { value: out, end: i + 1 };
      } else out += c;
    }
    throw new Error('unterminated string');
  }
  if (!PS_DOUBLE.includes(q)) throw new Error(`at ${at}: not a string`);
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (PS_DOUBLE.includes(c)) {
      if (PS_DOUBLE.includes(src[i + 1] ?? '\0')) out += src[++i];
      else return { value: out, end: i + 1 };
    } else if (c === '$') {
      if (/[\p{L}\p{N}_{(?$^:]/u.test(src[i + 1] ?? '')) throw new Error(`at ${i}: variable`);
      out += c;
    } else if (c === '`') {
      const e = src[++i] ?? '';
      if (e === 'u' && src[i + 1] === '{') {
        const h = hexRun(src, i + 2, 1, 6);
        if (src[i + 2 + h.length] !== '}') throw new Error(`at ${i}: bad \`u{…}`);
        const cp = parseInt(h, 16);
        if (cp >= 0xd800 && cp <= 0xdfff) throw new Error(`at ${i}: surrogate in \`u{…}`);
        out += fromCode(cp);
        i += 2 + h.length;
      } else out += PS_ESCAPES[e] ?? e;
    } else out += c;
  }
  throw new Error('unterminated string');
};

// ----------------------------------------------------------------------------------------------------------------------

export const READERS: Readonly<Record<Language, (src: string, at: number) => Read>> = {
  kotlin: readKotlin,
  csharp: readCsharp,
  php: readPhp,
  dart: readDart,
  powershell: readPowershell,
};

const QUOTES: Readonly<Record<Language, string>> = {
  kotlin: '"',
  csharp: '"',
  php: '"\'',
  dart: '"\'',
  powershell: PS_SINGLE + PS_DOUBLE,
};

/**
 * Every literal of a program, in order, as text (PHP: its bytes as UTF-8 text when they are UTF-8, else Latin-1). Line
 * comments (`//`, or `#` in PowerShell and PHP) are skipped; a C# or Kotlin character literal is read and left out.
 */
export const scan = (language: Language, src: string): string[] => {
  const out: string[] = [];
  const comment = language === 'powershell' ? '#' : '//';
  for (let i = 0; i < src.length;) {
    if (src.startsWith(comment, i) || (language === 'php' && src[i] === '#')) {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    const c = src[i]!;
    if ((language === 'csharp' || language === 'kotlin') && c === "'") {
      const r = readCsharpBody(src, i, "'");
      i = r.end;
      continue;
    }
    if (QUOTES[language].includes(c)) {
      const r = READERS[language](src, i);
      out.push('value' in r ? r.value : new TextDecoder().decode(r.bytes));
      i = r.end;
      continue;
    }
    i++;
  }
  return out;
};
