// Every row of docs/tools/specs/backslash-escape.md §10 (numbered as they stand there, 1–56), the rows of §6 and the
// table of §7, then what §5 states and §10 does not show. Control characters, lone surrogates and line separators are
// written as escapes in this source, never as the characters themselves.
import { DIALECTS, detectBackslashEscape, escapeString, quoteFor, quotesFor, unescapeString } from './index';
import { describe, expect, it } from 'vitest';
import type { Dialect, EscapeOptions, Quote, UnescapeResult } from './index';

const esc = (text: string, dialect: Dialect, more: Partial<EscapeOptions> = {}): string =>
  escapeString(text, { dialect, quote: '"', nonAscii: false, withQuotes: false, ...more });
const un = (text: string, dialect: Dialect, withQuotes = false): UnescapeResult =>
  unescapeString(text, { dialect, withQuotes });
/** The decoded text, or the test fails with the error. */
const text = (input: string, dialect: Dialect, withQuotes = false): string => {
  const result = un(input, dialect, withQuotes);
  if (!result.ok) throw new Error(`${dialect}: ${result.error.message}`);
  return result.text;
};
/** The error, or the test fails. */
const error = (input: string, dialect: Dialect, withQuotes = false) => {
  const result = un(input, dialect, withQuotes);
  if (result.ok) throw new Error(`${dialect}: expected an error for ${JSON.stringify(input)}`);
  return result.error;
};
const ok = (result: UnescapeResult) => {
  if (!result.ok) throw new Error(result.error.message);
  return result;
};
const bytes = (s: string): string =>
  Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join(' ');

const HINT_ALL = 'It is an escape in JavaScript, Python, C / C++.';

describe('§10 Escape', () => {
  it('row 1: He said "hi"⏎, JSON', () => {
    expect(esc('He said "hi"\n', 'json')).toBe('He said \\"hi\\"\\n');
  });
  it('row 2: He said "hi"⏎, JavaScript with Quote \'', () => {
    expect(esc('He said "hi"\n', 'js', { quote: "'" })).toBe('He said "hi"\\n');
  });
  it("row 3: it's, JavaScript and Python with Quote '", () => {
    expect(esc("it's", 'js', { quote: "'" })).toBe("it\\'s");
    expect(esc("it's", 'python', { quote: "'" })).toBe("it\\'s");
  });
  it("row 4: it's, JSON and C", () => {
    expect(esc("it's", 'json')).toBe("it's");
    expect(esc("it's", 'c')).toBe("it's");
  });
  it('row 5: C:\\temp\\new, every dialect', () => {
    for (const dialect of DIALECTS) expect(esc('C:\\temp\\new', dialect)).toBe('C:\\\\temp\\\\new');
  });
  const bell = 'bell\u0007 nul\u0000 del\u007f';
  it('row 6: bell, nul, del — JSON', () => {
    expect(esc(bell, 'json')).toBe('bell\\u0007 nul\\u0000 del\u007f');
  });
  it('row 7: bell, nul, del — JavaScript', () => {
    expect(esc(bell, 'js')).toBe('bell\\x07 nul\\0 del\\x7f');
  });
  it('row 8: bell, nul, del — Python', () => {
    expect(esc(bell, 'python')).toBe('bell\\x07 nul\\x00 del\\x7f');
  });
  it('row 9: bell, nul, del — C / C++', () => {
    expect(esc(bell, 'c')).toBe('bell\\a nul\\000 del\\177');
  });
  it('row 10: U+0000 before a digit — JavaScript \\x00, C three octal digits', () => {
    expect(esc('nul\u00001', 'js')).toBe('nul\\x001');
    expect(esc('nul\u00001', 'c')).toBe('nul\\0001');
  });
  it('row 11: vertical tab, form feed, backspace — JSON, JavaScript, Python', () => {
    const input = 'vt\u000b ff\u000c bs\u0008';
    expect(esc(input, 'json')).toBe('vt\\u000b ff\\f bs\\b');
    expect(esc(input, 'js')).toBe('vt\\v ff\\f bs\\b');
    expect(esc(input, 'python')).toBe('vt\\x0b ff\\x0c bs\\x08');
  });
  it('row 12: café 😀 without Escape non-ASCII is unchanged in every dialect', () => {
    for (const dialect of DIALECTS) expect(esc('café \u{1F600}', dialect)).toBe('café \u{1F600}');
  });
  it('row 13: café 😀 with Escape non-ASCII — JSON and JavaScript, a surrogate pair', () => {
    expect(esc('café \u{1F600}', 'json', { nonAscii: true })).toBe('caf\\u00e9 \\ud83d\\ude00');
    expect(esc('café \u{1F600}', 'js', { nonAscii: true })).toBe('caf\\u00e9 \\ud83d\\ude00');
  });
  it('row 14: café 😀 with Escape non-ASCII — Python', () => {
    expect(esc('café \u{1F600}', 'python', { nonAscii: true })).toBe('caf\\xe9 \\U0001f600');
  });
  it('row 15: café 😀 with Escape non-ASCII — C, UTF-8 bytes', () => {
    expect(esc('café \u{1F600}', 'c', { nonAscii: true })).toBe('caf\\303\\251 \\360\\237\\230\\200');
  });
  it('row 16: ÿ with Escape non-ASCII — JavaScript, Python, C', () => {
    expect(esc('ÿ', 'js', { nonAscii: true })).toBe('\\u00ff');
    expect(esc('ÿ', 'python', { nonAscii: true })).toBe('\\xff');
    expect(esc('ÿ', 'c', { nonAscii: true })).toBe('\\303\\277');
  });
  it('row 17: U+0085 — as is / \\x85 / \\x85 / as is', () => {
    expect(esc('\u0085', 'json')).toBe('\u0085');
    expect(esc('\u0085', 'js')).toBe('\\x85');
    expect(esc('\u0085', 'python')).toBe('\\x85');
    expect(esc('\u0085', 'c')).toBe('\u0085');
  });
  it('row 18: U+2028 — as is / \\u2028 / \\u2028', () => {
    expect(esc('\u2028', 'json')).toBe('\u2028');
    expect(esc('\u2028', 'js')).toBe('\\u2028');
    expect(esc('\u2028', 'python')).toBe('\\u2028');
  });
  it('row 19: an unpaired surrogate — \\ud800 in JSON, JavaScript, Python; U+FFFD in C', () => {
    expect(esc('\uD800', 'json')).toBe('\\ud800');
    expect(esc('\uD800', 'js')).toBe('\\ud800');
    expect(esc('\uD800', 'python')).toBe('\\ud800');
    expect(esc('\uD800', 'c')).toBe('\uFFFD');
    expect(bytes(esc('\uD800', 'c'))).toBe('ef bf bd');
  });
  it('row 20: a`${b}` in a JavaScript template — the backtick and ${', () => {
    expect(esc('a`${b}`', 'js', { quote: '`' })).toBe('a\\`\\${b}\\`');
  });
  it('row 21: a"b, JSON, With quotes', () => {
    expect(esc('a"b', 'json', { withQuotes: true })).toBe('"a\\"b"');
  });
  it("row 22: a'b, JavaScript with Quote ', With quotes", () => {
    expect(esc("a'b", 'js', { quote: "'", withQuotes: true })).toBe("'a\\'b'");
  });
});

describe('§10 Unescape', () => {
  it('row 23: He said \\"hi\\"\\n, JSON', () => {
    expect(text('He said \\"hi\\"\\n', 'json')).toBe('He said "hi"\n');
  });
  it('row 24: caf\\u00e9 \\ud83d\\ude00, JSON — the pair is one character', () => {
    const result = ok(un('caf\\u00e9 \\ud83d\\ude00', 'json'));
    expect(result.text).toBe('café \u{1F600}');
    expect(result.loneSurrogates).toBe(0);
  });
  it('row 25: a\\/b, JSON', () => {
    expect(text('a\\/b', 'json')).toBe('a/b');
  });
  it('row 26: \\x41, JSON — an error at the backslash, with the dialects that read it', () => {
    const e = error('\\x41', 'json');
    expect(e).toEqual({ message: `unknown escape "\\x" in JSON. ${HINT_ALL}`, offset: 0, line: 1, column: 1 });
  });
  it("row 27: \\', JSON — the same hint", () => {
    expect(error("\\'", 'json').message).toBe(`unknown escape "\\'" in JSON. ${HINT_ALL}`);
  });
  it('row 28: \\q, JSON — no hint', () => {
    expect(error('\\q', 'json').message).toBe('unknown escape "\\q" in JSON.');
  });
  it('row 29: \\u12 — JSON, Python, C', () => {
    for (const dialect of ['json', 'python', 'c'] as const)
      expect(error('\\u12', dialect)).toMatchObject({ message: '\\u needs exactly 4 hex digits', offset: 0 });
  });
  it('row 30: abc\\ — a lone backslash at the end, in every dialect', () => {
    for (const dialect of DIALECTS)
      expect(error('abc\\', dialect)).toEqual({
        message: 'lone backslash at the end',
        offset: 3,
        line: 1,
        column: 4,
      });
  });
  it('row 31: a\\⏎b — an error in JSON, a line continuation in JavaScript and Python', () => {
    expect(error('a\\\nb', 'json')).toMatchObject({
      message: 'a backslash before a line break is not allowed in JSON',
      offset: 1,
    });
    expect(text('a\\\nb', 'js')).toBe('ab');
    expect(text('a\\\nb', 'python')).toBe('ab');
  });
  it('row 32: \\ud800 alone — JSON and Python keep it and count it', () => {
    for (const dialect of ['json', 'python'] as const) {
      const result = ok(un('\\ud800', dialect));
      expect(result.text).toBe('\uD800');
      expect(result.loneSurrogates).toBe(1);
      expect(result.firstLoneSurrogate).toBe(0xd800);
    }
  });
  it('row 33: a raw line break in JSON is taken as is', () => {
    expect(text('line1\nline2', 'json')).toBe('line1\nline2');
  });
  it('row 34: \\x41\\u{1F600}\\v\\0, JavaScript', () => {
    expect(text('\\x41\\u{1F600}\\v\\0', 'js')).toBe('A\u{1F600}\u000b\u0000');
  });
  it('row 35: \\a\\q, JavaScript — identity escapes', () => {
    expect(text('\\a\\q', 'js')).toBe('aq');
  });
  it('row 36: \\101, \\08, \\8 — octal is an error in JavaScript', () => {
    for (const input of ['\\101', '\\08', '\\8'])
      expect(error(input, 'js')).toMatchObject({
        message: 'octal escapes and \\8, \\9 are not allowed in JavaScript strict mode',
        offset: 0,
      });
  });
  it('row 37: \\u{110000}, \\x4, \\u{} — JavaScript', () => {
    expect(error('\\u{110000}', 'js').message).toBe('code point above 10FFFF');
    expect(error('\\x4', 'js').message).toBe('\\x needs exactly 2 hex digits');
    expect(error('\\u{}', 'js').message).toBe('\\u{…} needs hex digits and a closing brace');
  });
  it('row 38: \\`\\${x}, JavaScript', () => {
    expect(text('\\`\\${x}', 'js')).toBe('`${x}');
  });
  it('row 39: \\a\\b\\f\\n\\r\\t\\v, Python', () => {
    expect(text('\\a\\b\\f\\n\\r\\t\\v', 'python')).toBe('\u0007\u0008\u000c\u000a\u000d\u0009\u000b');
  });
  it('row 40: \\x41\\u00e9\\U0001F600, Python', () => {
    expect(text('\\x41\\u00e9\\U0001F600', 'python')).toBe('Aé\u{1F600}');
  });
  it('row 41: \\101\\0\\7 — Python and C', () => {
    expect(text('\\101\\0\\7', 'python')).toBe('A\u0000\u0007');
    expect(text('\\101\\0\\7', 'c')).toBe('A\u0000\u0007');
  });
  it('row 42: \\q\\d, Python — kept with the backslash, listed', () => {
    const result = ok(un('\\q\\d', 'python'));
    expect(result.text).toBe('\\q\\d');
    expect(result.keptUnknown).toEqual(['\\q', '\\d']);
  });
  it('row 43: \\777, Python — U+01FF', () => {
    expect(text('\\777', 'python')).toBe('\u01ff');
  });
  it('row 44: \\N{BULLET}, Python — not supported', () => {
    expect(error('\\N{BULLET}', 'python').message).toBe('named escapes \\N{…} are not supported');
  });
  it('row 45: \\U00110000, Python', () => {
    expect(error('\\U00110000', 'python').message).toBe('code point above 10FFFF');
  });
  it("row 46: \\a\\b\\f\\n\\r\\t\\v\\?\\', C — bytes 07 08 0c 0a 0d 09 0b 3f 27", () => {
    expect(bytes(text("\\a\\b\\f\\n\\r\\t\\v\\?\\'", 'c'))).toBe('07 08 0c 0a 0d 09 0b 3f 27');
  });
  it('row 47: \\303\\251, C — the UTF-8 of é', () => {
    expect(text('\\303\\251', 'c')).toBe('é');
  });
  it('row 48: \\x41\\x00e9, C — A and a byte that is not UTF-8', () => {
    const result = ok(un('\\x41\\x00e9', 'c'));
    expect(result.text).toBe('A\uFFFD');
    expect(result.invalidUtf8).toBe(true);
  });
  it('row 49: \\u00e9\\U0001F600, C', () => {
    expect(text('\\u00e9\\U0001F600', 'c')).toBe('é\u{1F600}');
  });
  it('row 50: \\x100 and \\400, C — more than one byte', () => {
    expect(error('\\x100', 'c').message).toBe('\\x value is larger than FF (one byte)');
    expect(error('\\400', 'c').message).toBe('octal escape is larger than 377 (one byte)');
  });
  it('row 51: \\u0041 and \\ud800, C — not universal character names', () => {
    expect(error('\\u0041', 'c').message).toBe('\\u0041 is not a valid universal character name');
    expect(error('\\ud800', 'c').message).toBe('\\ud800 is not a valid universal character name');
  });
  it('row 52: \\q and \\x, C', () => {
    expect(error('\\q', 'c').message).toBe('unknown escape "\\q" in C / C++.');
    expect(error('\\x', 'c').message).toBe('\\x needs hex digits');
  });
  it('row 53: spaces around "a\\"b", JSON, With quotes', () => {
    expect(text('  "a\\"b"  ', 'json', true)).toBe('a"b');
  });
  it("row 54: 'a', JSON, With quotes — JSON has only the double quote", () => {
    expect(error("'a'", 'json', true)).toEqual({ message: 'Expected text in " quotes', offset: 0, line: 1, column: 1 });
  });
  it('row 55: `x`, JavaScript, With quotes', () => {
    expect(text('`x`', 'js', true)).toBe('x');
  });
  it('row 56: "abc, Python, With quotes', () => {
    expect(error('"abc', 'python', true).message).toBe('Expected text in " or \' quotes');
  });
});

describe('§6 errors and edge cases', () => {
  it('an empty input gives an empty result in both directions', () => {
    for (const dialect of DIALECTS) {
      expect(esc('', dialect)).toBe('');
      expect(ok(un('', dialect)).text).toBe('');
    }
  });
  it('only spaces: the same spaces both ways; with quotes an error', () => {
    for (const dialect of DIALECTS) {
      expect(esc('   ', dialect)).toBe('   ');
      expect(text('   ', dialect)).toBe('   ');
      expect(error('   ', dialect, true).message).toMatch(/^Expected text in .* quotes$/);
    }
    // No first non-space character: the place is the end of the input.
    expect(error('   ', 'json', true)).toMatchObject({ offset: 3, column: 4 });
    expect(error('', 'json', true)).toMatchObject({ offset: 0, column: 1 });
  });
  it('\\q in JSON and C, JavaScript, Python', () => {
    expect(error('\\q', 'json').message).toBe('unknown escape "\\q" in JSON.');
    expect(error('\\q', 'c').message).toBe('unknown escape "\\q" in C / C++.');
    expect(text('\\q', 'js')).toBe('q');
  });
  it('\\ud800 in JavaScript too: kept and counted', () => {
    const result = ok(un('\\ud800', 'js'));
    expect([result.text, result.loneSurrogates, result.firstLoneSurrogate]).toEqual(['\uD800', 1, 0xd800]);
  });
  it('\\xe9 in C: U+FFFD, not UTF-8', () => {
    const result = ok(un('\\xe9', 'c'));
    expect([result.text, result.invalidUtf8]).toEqual(['\uFFFD', true]);
  });
  it('U+2028 in Escape: as is in JSON, \\u2028 in JavaScript', () => {
    expect(esc('a\u2028b', 'json')).toBe('a\u2028b');
    expect(esc('a\u2028b', 'js')).toBe('a\\u2028b');
  });
});

describe('§7 detectBackslashEscape', () => {
  it.each(['He said \\"hi\\"\\n', 'line1\\nline2\\ttab', 'caf\\u00e9\\u0021'])('yes: %s', input => {
    expect(detectBackslashEscape(input)).toBe(true);
  });
  it.each([
    ['C:\\new\\table', 'a path'],
    ['\\\\server\\share\\new', 'a network path'],
    ['\\d+\\s*', 'a regular expression'],
    ['{"a":"x\\ny\\t"}', 'JSON'],
    ['just \\n once', 'one escape'],
    ['hello%20world', 'URL encoding'],
    ['&lt;div&gt;', 'HTML entities'],
    ['SGVsbG8sIFdvcmxkIQ==', 'Base64'],
  ])('no: %s (%s)', input => {
    expect(detectBackslashEscape(input)).toBe(false);
  });
  it('the edges are trimmed; a real line break, an empty text and more than 65,536 characters are not', () => {
    expect(detectBackslashEscape('  \\n\\t  ')).toBe(true);
    expect(detectBackslashEscape('a\\nb\nc\\t')).toBe(false);
    expect(detectBackslashEscape('a\\nb\rc\\t')).toBe(false);
    expect(detectBackslashEscape('')).toBe(false);
    expect(detectBackslashEscape('   ')).toBe(false);
    const long = `\\n\\t${'x'.repeat(65_536 - 4)}`;
    expect(detectBackslashEscape(long)).toBe(true);
    expect(detectBackslashEscape(`${long}x`)).toBe(false);
  });
  it('other tools’ inputs are not taken: hex escapes (hex-ascii), hex, numbers, regular expressions, JSON strings', () => {
    for (const input of [
      '\\x48\\x65\\x6c\\x6c\\x6f',
      '48 65 6c 6c 6f',
      '48656c6c6f',
      '0x1F',
      '^\\d{3}-\\d{4}$',
      '\\w+\\s\\"',
      '"\\\\d+"',
      'Tom &amp; Jerry',
      'https://x.com/?a=1&b=2',
      '[1, "\\n\\t"]',
      '\\u12\\n',
    ])
      expect(detectBackslashEscape(input), input).toBe(false);
  });
  it('a JSON string with its quotes is taken (two escapes)', () => {
    expect(detectBackslashEscape('"He said \\"hi\\""')).toBe(true);
  });
});

describe('§5: what §10 does not show — Escape', () => {
  it('the quote: only the chosen one is escaped, and JSON and C always use "', () => {
    expect(esc(`"'\``, 'js', { quote: '"' })).toBe(`\\"'\``);
    expect(esc(`"'\``, 'js', { quote: "'" })).toBe(`"\\'\``);
    expect(esc(`"'\``, 'js', { quote: '`' })).toBe(`"'\\\``);
    expect(esc(`"'\``, 'python', { quote: "'" })).toBe(`"\\'\``);
    expect(esc(`"'\``, 'json', { quote: "'" })).toBe(`\\"'\``);
    expect(esc(`"'\``, 'c', { quote: '`' })).toBe(`\\"'\``);
    // Python has no backtick: the double quote takes its place.
    expect(esc(`"'\``, 'python', { quote: '`', withQuotes: true })).toBe(`"\\"'\`"`);
  });
  it('quotesFor and quoteFor', () => {
    expect(quotesFor('json')).toEqual(['"']);
    expect(quotesFor('js')).toEqual(['"', "'", '`']);
    expect(quotesFor('python')).toEqual(['"', "'"]);
    expect(quotesFor('c')).toEqual(['"']);
    expect(quoteFor('python', '`')).toBe('"');
    expect(quoteFor('js', '`')).toBe('`');
  });
  it('${ is escaped only in a template; a lone $ or { is not', () => {
    expect(esc('$ { ${', 'js', { quote: '`' })).toBe('$ { \\${');
    expect(esc('${', 'js', { quote: '"' })).toBe('${');
  });
  it('/ is not escaped; ? is not escaped in C (no trigraphs)', () => {
    for (const dialect of DIALECTS) expect(esc('a/b??=', dialect)).toBe('a/b??=');
  });
  it('JavaScript: \\0 is \\x00 before any decimal digit, \\0 before anything else', () => {
    for (const digit of '0123456789') expect(esc(`\u0000${digit}`, 'js')).toBe(`\\x00${digit}`);
    expect(esc('\u0000a', 'js')).toBe('\\0a');
    expect(esc('\u0000', 'js')).toBe('\\0');
    expect(esc('\u0000\u0000', 'js')).toBe('\\0\\0');
  });
  it('every C0 control in each dialect', () => {
    const all = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
    expect(esc(all, 'json')).toBe(JSON.stringify(all).slice(1, -1));
    expect(esc(all, 'js')).toBe(
      '\\0\\x01\\x02\\x03\\x04\\x05\\x06\\x07\\b\\t\\n\\v\\f\\r\\x0e\\x0f\\x10\\x11\\x12\\x13\\x14\\x15\\x16\\x17\\x18\\x19\\x1a\\x1b\\x1c\\x1d\\x1e\\x1f',
    );
    expect(esc(all, 'python')).toBe(
      '\\x00\\x01\\x02\\x03\\x04\\x05\\x06\\x07\\x08\\t\\n\\x0b\\x0c\\r\\x0e\\x0f\\x10\\x11\\x12\\x13\\x14\\x15\\x16\\x17\\x18\\x19\\x1a\\x1b\\x1c\\x1d\\x1e\\x1f',
    );
    expect(esc(all, 'c')).toBe(
      '\\000\\001\\002\\003\\004\\005\\006\\a\\b\\t\\n\\v\\f\\r\\016\\017\\020\\021\\022\\023\\024\\025\\026\\027\\030\\031\\032\\033\\034\\035\\036\\037',
    );
  });
  it('U+0080–U+009F: \\xhh in JavaScript and Python, as is in JSON and C', () => {
    expect(esc('\u0080\u009f', 'js')).toBe('\\x80\\x9f');
    expect(esc('\u0080\u009f', 'python')).toBe('\\x80\\x9f');
    expect(esc('\u0080\u009f', 'json')).toBe('\u0080\u009f');
    expect(esc('\u0080\u009f', 'c')).toBe('\u0080\u009f');
  });
  it('Escape non-ASCII takes every code point above U+007F a row of the first table keeps as is', () => {
    expect(esc('\u0085\u00a0\u2028\uFEFF', 'json', { nonAscii: true })).toBe('\\u0085\\u00a0\\u2028\\ufeff');
    expect(esc('\u0085\u00a0\u2028', 'js', { nonAscii: true })).toBe('\\x85\\u00a0\\u2028');
    expect(esc('\u0085\u00a0\u0100\u2028\u{10FFFF}', 'python', { nonAscii: true })).toBe(
      '\\x85\\xa0\\u0100\\u2028\\U0010ffff',
    );
    expect(esc('\u0085\u2028', 'c', { nonAscii: true })).toBe('\\302\\205\\342\\200\\250');
    // An unpaired surrogate stays \udhhh, and in C becomes U+FFFD's bytes.
    expect(esc('\uDC00', 'python', { nonAscii: true })).toBe('\\udc00');
    expect(esc('\uDC00', 'c', { nonAscii: true })).toBe('\\357\\277\\275');
  });
  it('a surrogate pair is one character; a high surrogate before another high one is unpaired', () => {
    expect(esc('\uD83D\uD83D\uDE00', 'json')).toBe('\\ud83d\u{1F600}');
    expect(esc('\uDE00\uD83D', 'js')).toBe('\\ude00\\ud83d');
    expect(esc('\uD83D\uD83D\uDE00', 'json', { nonAscii: true })).toBe('\\ud83d\\ud83d\\ude00');
  });
  it('JSON is exactly JSON.stringify(text).slice(1, -1)', () => {
    const samples = ['\u007f\u0085\u2028\u2029', '</script>', 'a\\b"c', '\uD800x\uDFFF', '\u{1F600}\u0000\u001f'];
    for (const s of samples) expect(esc(s, 'json')).toBe(JSON.stringify(s).slice(1, -1));
  });
  it('With quotes wraps in the chosen quote, JSON and C in "', () => {
    expect(esc('x', 'json', { quote: "'", withQuotes: true })).toBe('"x"');
    expect(esc('x', 'c', { withQuotes: true })).toBe('"x"');
    expect(esc('x`', 'js', { quote: '`', withQuotes: true })).toBe('`x\\``');
    expect(esc("x'", 'python', { quote: "'", withQuotes: true })).toBe("'x\\''");
    expect(esc('', 'json', { withQuotes: true })).toBe('""');
  });
});

describe('§5: what §10 does not show — Unescape', () => {
  it('every dialect reads \\\\ and \\" ', () => {
    for (const dialect of DIALECTS) expect(text('\\\\\\"', dialect)).toBe('\\"');
  });
  it("the table of §5: \\' \\` \\/ \\v \\a \\? in each dialect", () => {
    expect(error("\\'", 'json').message).toContain('unknown escape');
    expect(text("\\'", 'js')).toBe("'");
    expect(text("\\'", 'python')).toBe("'");
    expect(text("\\'", 'c')).toBe("'");
    expect(error('\\`', 'json').message).toBe('unknown escape "\\`" in JSON.');
    expect(text('\\`', 'js')).toBe('`');
    expect(ok(un('\\`', 'python'))).toMatchObject({ text: '\\`', keptUnknown: ['\\`'] });
    expect(error('\\`', 'c').message).toBe('unknown escape "\\`" in C / C++.');
    expect(text('\\/', 'js')).toBe('/');
    expect(ok(un('\\/', 'python'))).toMatchObject({ text: '\\/', keptUnknown: ['\\/'] });
    expect(error('\\/', 'c').message).toBe('unknown escape "\\/" in C / C++. It is an escape in JSON.');
    expect(error('\\v', 'json').message).toBe(`unknown escape "\\v" in JSON. ${HINT_ALL}`);
    for (const dialect of ['js', 'python', 'c'] as const) expect(text('\\v', dialect)).toBe('\u000b');
    expect(error('\\a', 'json').message).toBe('unknown escape "\\a" in JSON. It is an escape in Python, C / C++.');
    expect(error('\\?', 'json').message).toBe('unknown escape "\\?" in JSON. It is an escape in C / C++.');
    expect(text('\\?', 'js')).toBe('?');
    expect(ok(un('\\?', 'python'))).toMatchObject({ text: '\\?', keptUnknown: ['\\?'] });
    expect(text('\\?', 'c')).toBe('?');
  });
  it('\\0, \\1…\\7, \\8, \\9: JSON hints where they are escapes', () => {
    expect(error('\\0', 'json').message).toBe(`unknown escape "\\0" in JSON. ${HINT_ALL}`);
    expect(error('\\1', 'json').message).toBe('unknown escape "\\1" in JSON. It is an escape in Python, C / C++.');
    expect(error('\\8', 'json').message).toBe('unknown escape "\\8" in JSON.');
    expect(error('\\U0001F600', 'json').message).toBe(
      'unknown escape "\\U" in JSON. It is an escape in Python, C / C++.',
    );
    expect(error('\\N{BULLET}', 'json').message).toBe('unknown escape "\\N" in JSON.');
  });
  it('JavaScript: \\0 at the end and before a non-digit is U+0000; \\9 and \\0 before 8 or 9 are errors', () => {
    expect(text('\\0', 'js')).toBe('\u0000');
    expect(text('\\0a', 'js')).toBe('\u0000a');
    expect(error('\\9', 'js').message).toContain('strict mode');
    expect(error('\\09', 'js').message).toContain('strict mode');
    // \0 right before the closing quote is not before a digit.
    expect(text('"\\0"', 'js', true)).toBe('\u0000');
  });
  it('JavaScript: \\u{…} with leading zeros, a surrogate, missing digits or brace; \\U and \\N are identities', () => {
    expect(text('\\u{0000000041}', 'js')).toBe('A');
    expect(ok(un('\\u{D800}', 'js'))).toMatchObject({ text: '\uD800', loneSurrogates: 1 });
    expect(text('\\u{D83D}\\u{DE00}', 'js')).toBe('\u{1F600}');
    expect(error('\\u{41', 'js').message).toBe('\\u{…} needs hex digits and a closing brace');
    expect(error('\\u{4G}', 'js').message).toBe('\\u{…} needs hex digits and a closing brace');
    expect(error(`\\u{${'f'.repeat(40)}}`, 'js').message).toBe('code point above 10FFFF');
    expect(error('\\u12', 'js').message).toBe('\\u needs exactly 4 hex digits');
    expect(text('\\U0001F600', 'js')).toBe('U0001F600');
    expect(text('\\N{BULLET}', 'js')).toBe('N{BULLET}');
    expect(text('\\😀', 'js')).toBe('😀');
  });
  it('line continuations: CR LF, CR and LF everywhere but JSON; U+2028 and U+2029 in JavaScript only', () => {
    for (const dialect of ['js', 'python', 'c'] as const)
      for (const lineBreak of ['\n', '\r\n', '\r']) expect(text(`a\\${lineBreak}b`, dialect)).toBe('ab');
    expect(text('a\\\u2028b\\\u2029c', 'js')).toBe('abc');
    expect(ok(un('a\\\u2028b', 'python'))).toMatchObject({ text: 'a\\\u2028b', keptUnknown: ['\\\u2028'] });
    expect(error('a\\\u2028b', 'c').message).toBe('unknown escape "\\\u2028" in C / C++.');
    expect(error('a\\\r\nb', 'json').message).toBe('a backslash before a line break is not allowed in JSON');
  });
  it('Python: an octal escape takes at most three digits; \\8 and \\9 are kept', () => {
    expect(text('\\1012', 'python')).toBe('A2');
    expect(text('\\08', 'python')).toBe('\u00008');
    expect(text('\\0', 'python')).toBe('\u0000');
    expect(ok(un('\\8\\9\\8', 'python'))).toMatchObject({ text: '\\8\\9\\8', keptUnknown: ['\\8', '\\9'] });
  });
  it('Python: \\x and \\U cut short; \\N anything; \\u{…} is not Python', () => {
    expect(error('\\x4', 'python').message).toBe('\\x needs exactly 2 hex digits');
    expect(error('\\xg0', 'python').message).toBe('\\x needs exactly 2 hex digits');
    expect(error('\\U0001F6', 'python').message).toBe('\\U needs exactly 8 hex digits');
    expect(error('\\N', 'python').message).toBe('named escapes \\N{…} are not supported');
    expect(error('\\u{41}', 'python').message).toBe('\\u needs exactly 4 hex digits');
  });
  it('Python: surrogate escapes are code points — a "pair" of escapes is two unpaired surrogates', () => {
    expect(ok(un('\\ud83d\\ude00', 'python'))).toMatchObject({
      text: '\uD83D\uDE00',
      loneSurrogates: 2,
      firstLoneSurrogate: 0xd83d,
    });
    expect(ok(un('\\U0000dc00', 'python'))).toMatchObject({ loneSurrogates: 1, firstLoneSurrogate: 0xdc00 });
    // A real 😀 in the text is one code point.
    expect(ok(un('\u{1F600}\\n', 'python'))).toMatchObject({ loneSurrogates: 0, firstLoneSurrogate: null });
    // An unpaired surrogate in the plain text counts too.
    expect(ok(un('x\uDE00\\t', 'python'))).toMatchObject({ loneSurrogates: 1, firstLoneSurrogate: 0xde00 });
  });
  it('JSON and JavaScript: surrogate escapes that pair up make one character; the rest are counted', () => {
    expect(ok(un('\\ud83d\\ude00', 'json'))).toMatchObject({ loneSurrogates: 0, firstLoneSurrogate: null });
    expect(ok(un('\\ude00\\ud83d', 'json'))).toMatchObject({ loneSurrogates: 2, firstLoneSurrogate: 0xde00 });
    expect(ok(un('\\ud83d\\ud83d\\ude00', 'js'))).toMatchObject({ loneSurrogates: 1, firstLoneSurrogate: 0xd83d });
    // An escape pairs with a real surrogate next to it: the text is what a JavaScript string holds.
    expect(ok(un('\\ud83d\uDE00', 'json'))).toMatchObject({ text: '\u{1F600}', loneSurrogates: 0 });
  });
  it('Python keeps up to every distinct unknown escape, in order, each once', () => {
    expect(ok(un('\\q\\d\\q\\w\\😀', 'python')).keptUnknown).toEqual(['\\q', '\\d', '\\w', '\\😀']);
  });
  it('C: octal escapes followed by a digit, greedy \\x, the universal names C11 allows', () => {
    expect(text('\\0001', 'c')).toBe('\u00001');
    expect(text('\\38', 'c')).toBe('\u00038');
    expect(text('\\x00000041', 'c')).toBe('A');
    // Greedy: "\x41B" is one escape (0x41B), not A and B.
    expect(error('\\x41B', 'c').message).toBe('\\x value is larger than FF (one byte)');
    expect(text('\\x41\\x42', 'c')).toBe('AB');
    expect(text('\\u0024\\u0040\\u0060\\u00a0', 'c')).toBe('$@`\u00a0');
    expect(error('\\u009f', 'c').message).toBe('\\u009f is not a valid universal character name');
    expect(error('\\U0000D800', 'c').message).toBe('\\U0000D800 is not a valid universal character name');
    expect(error('\\U00110000', 'c').message).toBe('code point above 10FFFF');
    expect(error('\\U0001F6', 'c').message).toBe('\\U needs exactly 8 hex digits');
    expect(error('\\8', 'c').message).toBe('unknown escape "\\8" in C / C++.');
    expect(error('\\e', 'c').message).toBe('unknown escape "\\e" in C / C++.');
    expect(error('\\N{BULLET}', 'c').message).toBe('unknown escape "\\N" in C / C++.');
    expect(error('\\u{41}', 'c').message).toBe('\\u needs exactly 4 hex digits');
  });
  it('C: plain text goes in as UTF-8 and mixes with byte escapes; a BOM is kept', () => {
    expect(text('caf\\303\\251 é', 'c')).toBe('café é');
    expect(text('\\357\\273\\277a', 'c')).toBe('\uFEFFa');
    expect(ok(un('\\303', 'c'))).toMatchObject({ text: '\uFFFD', invalidUtf8: true });
    expect(ok(un('\uFFFD', 'c'))).toMatchObject({ text: '\uFFFD', invalidUtf8: false });
    // A lone surrogate in the plain text has no UTF-8: it becomes U+FFFD's bytes, which are valid UTF-8.
    expect(ok(un('\uD800', 'c'))).toMatchObject({ text: '\uFFFD', invalidUtf8: false, loneSurrogates: 0 });
  });
  it('\\\\n is a backslash and n — one pass', () => {
    for (const dialect of DIALECTS) expect(text('\\\\n', dialect)).toBe('\\n');
  });
  it('the place of an error: line and UTF-16 column of the backslash', () => {
    expect(error('ab\nc😀\\x41', 'json')).toMatchObject({ offset: 6, line: 2, column: 4 });
    expect(error('a\n\n  \\q', 'c')).toMatchObject({ offset: 5, line: 3, column: 3 });
    expect(error('\\n\\q', 'json')).toMatchObject({ offset: 2, line: 1, column: 3 });
  });
  it('With quotes: the quotes each dialect accepts, the place of the error, what is inside', () => {
    expect(text(" 'a\\'b' ", 'js', true)).toBe("a'b");
    expect(text("'a'", 'python', true)).toBe('a');
    expect(text('""', 'c', true)).toBe('');
    expect(error('`x`', 'python', true).message).toBe('Expected text in " or \' quotes');
    expect(error("'x", 'js', true).message).toBe('Expected text in ", \' or ` quotes');
    expect(error('"x\'', 'js', true).message).toBe('Expected text in ", \' or ` quotes');
    expect(error('b"x"', 'python', true)).toMatchObject({ message: 'Expected text in " or \' quotes', offset: 0 });
    expect(error('\n  x', 'json', true)).toMatchObject({ offset: 3, line: 2, column: 3 });
    expect(error('"', 'json', true).message).toBe('Expected text in " quotes');
    // The closing quote escaped: what is inside ends with a lone backslash, at its place.
    expect(error('"abc\\"', 'json', true)).toMatchObject({ message: 'lone backslash at the end', offset: 4 });
    // Errors inside are placed in the whole input.
    expect(error('  "\\q"', 'json', true)).toMatchObject({ offset: 3, column: 4 });
  });
});

describe('the scenarios of §2, as logic', () => {
  it('§2.1: a JSON log line, then unescaped again', () => {
    const first = text('Request failed:\\n\\t{\\"code\\": 42, \\"msg\\": \\"caf\\\\u00e9\\"}', 'json');
    expect(first).toBe('Request failed:\n\t{"code": 42, "msg": "caf\\u00e9"}');
    expect(text(first, 'json').split('\n')[1]).toBe('\t{"code": 42, "msg": "café"}');
  });
  it("§2.2: SQL into a JavaScript string in ' quotes", () => {
    expect(esc("SELECT *\nFROM t\nWHERE name = 'x'", 'js', { quote: "'", withQuotes: true })).toBe(
      "'SELECT *\\nFROM t\\nWHERE name = \\'x\\''",
    );
  });
  it('§2.3: a Windows path for Python', () => {
    expect(esc('C:\\temp\\new', 'python')).toBe('C:\\\\temp\\\\new');
  });
  it('§2.4: \\x41 is an error in JSON with a hint, A in JavaScript', () => {
    expect(error('\\x41', 'json').message).toBe(`unknown escape "\\x" in JSON. ${HINT_ALL}`);
    expect(text('\\x41', 'js')).toBe('A');
  });
  it('§2.5: "caf\\303\\251" from C source, with quotes', () => {
    expect(text('"caf\\303\\251"', 'c', true)).toBe('café');
  });
  it('§2.6: ASCII-only JSON', () => {
    expect(esc('café \u{1F600}', 'json', { nonAscii: true })).toBe('caf\\u00e9 \\ud83d\\ude00');
  });
});

describe('Quote values the interface offers', () => {
  it('each dialect’s quotes round-trip through With quotes', () => {
    for (const dialect of DIALECTS)
      for (const quote of quotesFor(dialect) as Quote[]) {
        const wrapped = esc(`a${quote}b\\`, dialect, { quote, withQuotes: true });
        expect(text(wrapped, dialect, true)).toBe(`a${quote}b\\`);
      }
  });
});
