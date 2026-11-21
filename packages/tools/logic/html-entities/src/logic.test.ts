import {
  LIVE_INPUT,
  MAX_INPUT,
  MAX_UNKNOWN_CHECKED,
  containsReferences,
  decodeHtml,
  detectHtmlEntities,
  encodeHtml,
  loadReferenceTable,
  mayContainNames,
  parseTable,
} from './index.ts';
import { NAMED_REFERENCES } from './namedReferences.generated.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EncodeOptions, ReferenceTable } from './index.ts';

// docs/tools/specs/html-entities.md: every row of §10 is a test with its expected value, then what §5 states and §10
// does not show, §7's examples for detectHtmlEntities and the bounds of §12.

let table: ReferenceTable;
beforeAll(async () => {
  table = await loadReferenceTable();
});

const ONLY: EncodeOptions = { scope: 'special', format: 'decimal' };
const DEC: EncodeOptions = { scope: 'nonAscii', format: 'decimal' };
const HEX: EncodeOptions = { scope: 'nonAscii', format: 'hex' };
const enc = (text: string, options: EncodeOptions): string => encodeHtml(text, options).text;
const dec = (text: string): string => decodeHtml(text, table).text;

describe('§10 encoding', () => {
  it('<a href="x">Tom & \'Jerry\'</a>, Only', () => {
    expect(enc(`<a href="x">Tom & 'Jerry'</a>`, ONLY)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });
  it('5 > 3 && 2 < 4, Only', () => {
    expect(enc('5 > 3 && 2 < 4', ONLY)).toBe('5 &gt; 3 &amp;&amp; 2 &lt; 4');
  });
  it('café 😀: Only — unchanged; Decimal; Hex', () => {
    expect(enc('café 😀', ONLY)).toBe('café 😀');
    expect(enc('café 😀', DEC)).toBe('caf&#233; &#128512;');
    expect(enc('café 😀', HEX)).toBe('caf&#xE9; &#x1F600;');
  });
  it('a b — “q”, Hex', () => {
    expect(enc('a b — “q”', HEX)).toBe('a&#xA0;b &#x2014; &#x201C;q&#x201D;');
  });
  it('e + U+0301, Decimal: the combining mark is a code point of its own', () => {
    expect(enc('é', DEC)).toBe('e&#769;');
  });
  it('line1\\nline2\\t, Also non-ASCII: unchanged', () => {
    expect(enc('line1\nline2\t', DEC)).toBe('line1\nline2\t');
    expect(enc('line1\nline2\t', HEX)).toBe('line1\nline2\t');
  });
  it('&amp; — &amp;amp;, containsReferences yes', () => {
    expect(enc('&amp;', ONLY)).toBe('&amp;amp;');
    expect(containsReferences('&amp;', table)).toBe(true);
  });
  it('&copy 2024 — &amp;copy 2024, containsReferences yes', () => {
    expect(enc('&copy 2024', ONLY)).toBe('&amp;copy 2024');
    expect(containsReferences('&copy 2024', table)).toBe(true);
  });
  it('AT&T — AT&amp;T, containsReferences no', () => {
    expect(enc('AT&T', ONLY)).toBe('AT&amp;T');
    expect(containsReferences('AT&T', table)).toBe(false);
  });
  it('\\uD800x: &#65533;x under Also non-ASCII, unchanged under Only', () => {
    expect(enc('\uD800x', DEC)).toBe('&#65533;x');
    expect(enc('\uD800x', ONLY)).toBe('\uD800x');
  });
  it('\\u0080x\\u009F, Also non-ASCII: unchanged, keptC1 2', () => {
    expect(encodeHtml('\u0080x\u009F', DEC)).toEqual({ text: '\u0080x\u009F', keptC1: 2 });
  });
  it('\\u007F\\u0080€, Hex: \\u007F\\u0080&#x20AC;, keptC1 1', () => {
    expect(encodeHtml('\u007F\u0080€', HEX)).toEqual({ text: '\u007F\u0080&#x20AC;', keptC1: 1 });
  });
  it('why C1 stays (§5.3): &#x80; decodes to €', () => {
    expect(dec('&#x80;')).toBe('€');
  });
  it('empty: empty in both modes', () => {
    expect(encodeHtml('', ONLY)).toEqual({ text: '', keptC1: 0 });
    expect(encodeHtml('', HEX)).toEqual({ text: '', keptC1: 0 });
    expect(decodeHtml('', table)).toEqual({ text: '', unknown: [] });
  });
});

describe('§10 decoding', () => {
  const rows: Array<[string, string]> = [
    ['&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;', '<p>Tom & Jerry</p>'],
    ['&quot;&#39;&apos;', `"''`],
    ['&eacute;&#233;&#xE9;&#XE9;', 'éééé'],
    ['&copy 2024', '© 2024'],
    ['&amp', '&'],
    ['&lt3', '<3'],
    ['&notit;', '¬it;'],
    ['&ampx;', '&x;'],
    ['&copy=1', '©=1'],
    ['AT&T &unknown; & x', 'AT&T &unknown; & x'],
    ['&AMP;&Amp;', '&&Amp;'],
    ['&#128512;&#x1F600;', '😀😀'],
    ['&#0;&#x110000;&#xD800;', '���'],
    ['&#99999999999999;', '�'],
    ['&#128;&#x9F;&#150;', '€Ÿ–'],
    ['&#x81;&#x8D;&#x8F;&#x90;&#x9D;', '\u0081\u008D\u008F\u0090\u009D'],
    ['&#x7F;', '\u007F'],
    ['&#13;', '\r'],
    ['&#65', 'A'],
    ['&#0065;', 'A'],
    ['&#x;', '&#x;'],
    ['&amp;lt;', '&lt;'],
    ['&NotEqualTilde;', '≂̸'],
    ['&nbsp;', ' '],
    ['&hellip;', '…'],
    ['  &lt;  ', '  <  '],
    ['\n&lt;', '\n<'],
    ['a\u0000b', 'a\u0000b'],
    ['</textarea><img src=x onerror=alert(1)>&amp;', '</textarea><img src=x onerror=alert(1)>&'],
  ];
  it.each(rows)('%j → %j', (input, expected) => {
    expect(dec(input)).toBe(expected);
  });
  it('AT&T &unknown; & x: unknown = ["&unknown;"]', () => {
    expect(decodeHtml('AT&T &unknown; & x', table).unknown).toEqual(['&unknown;']);
  });
  it('the unknown names, distinct, in order of first appearance', () => {
    expect(decodeHtml('&unknown; &amp; &copyx; &foo; &foo; &Amp;', table).unknown).toEqual([
      '&unknown;',
      '&foo;',
      '&Amp;',
    ]);
  });
  it('&#0;&#x110000;&#xD800;: no unknown names (§6: no note)', () => {
    expect(decodeHtml('&#0;&#x110000;&#xD800;', table).unknown).toEqual([]);
  });
});

describe('§5 encoding, beyond §10', () => {
  it('the five are escaped under Also non-ASCII too, and as the same references', () => {
    expect(enc(`&<>"'`, DEC)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(enc(`&<>"'`, HEX)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('one reference per code point outside the BMP, never two surrogates', () => {
    expect(enc('𝔄', HEX)).toBe('&#x1D504;');
    expect(enc('𝔄', DEC)).toBe('&#120068;');
  });
  it('a lone low surrogate and a high one at the end become U+FFFD', () => {
    expect(enc('\uDC00a\uD83D', HEX)).toBe('&#xFFFD;a&#xFFFD;');
  });
  it('no leading zeros, capital hex digits', () => {
    expect(enc(' Āꯍ', HEX)).toBe('&#xA0;&#x100;&#xABCD;');
    expect(enc(' ', DEC)).toBe('&#160;');
  });
  it('ASCII stays, controls, DEL, CR and CR LF included (§3: Encode keeps \\r)', () => {
    const ascii = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i))
      .join('')
      .replace(/[&<>"']/g, '');
    expect(enc(ascii, DEC)).toBe(ascii);
    expect(enc('a\r\nb\rc', HEX)).toBe('a\r\nb\rc');
  });
  it('C1 is counted only under Also non-ASCII; under Only it is just text', () => {
    expect(encodeHtml('\u0085', ONLY)).toEqual({ text: '\u0085', keptC1: 0 });
    expect(encodeHtml('\u0085 ', DEC)).toEqual({ text: '\u0085&#160;', keptC1: 1 });
  });
  it('no name other than the five is written (§5.5): … and U+00A0 become numbers', () => {
    expect(enc('… ', DEC)).toBe('&#8230;&#160;');
  });
  it('round trip: what Encode writes, Decode reads back', () => {
    const text = `<p class="a">Tom & 'Jerry' — café 😀 é ≂̸</p>\n\t~`;
    for (const options of [ONLY, DEC, HEX]) expect(dec(enc(text, options))).toBe(text);
  });
});

describe('§5 decoding, beyond §10', () => {
  it('names are case-sensitive', () => {
    expect(dec('&Eacute;&eacute;&EACUTE;')).toBe('Éé&EACUTE;');
  });
  it('a name without its semicolon decodes only when it is a legacy name', () => {
    expect(dec('&hellip &nbsp &frac12x')).toBe('&hellip   ½x');
  });
  it('the longest legacy prefix wins', () => {
    expect(dec('&notin;&notin &noti')).toBe('∉¬in ¬i');
  });
  it('names that stand for two code points', () => {
    expect(dec('&fjlig;&nvlt;&ThickSpace;')).toBe('fj<⃒  ');
  });
  it('an attribute value keeps a name without its semicolon before = or a letter or digit (named character reference state)', () => {
    const attr = (s: string): string => decodeHtml(s, table, { context: 'attribute' }).text;
    expect(attr('?a=1&copy=2&lang=en')).toBe('?a=1&copy=2&lang=en');
    expect(attr('&notit; &copy2 &copy &copy;=')).toBe('&notit; &copy2 © ©=');
    expect(attr('&amp;lt=')).toBe('&lt=');
    expect(dec('?a=1&copy=2&lang=en')).toBe('?a=1©=2&lang=en');
  });
  it('numbers: hexadecimal in either case, x in either case, leading zeros, no digits', () => {
    expect(dec('&#xe9;&#Xe9;&#x00E9;&#0000233&#&#x &#xG;')).toBe('éééé&#&#x &#xG;');
  });
  it('a long run of digits past U+10FFFF stays U+FFFD, hexadecimal too', () => {
    expect(dec(`&#${'9'.repeat(400)};&#x${'F'.repeat(400)};&#x10FFFF;`)).toBe('��\u{10FFFF}');
  });
  it('noncharacters and the other controls are kept (a parse error, not a replacement)', () => {
    expect(dec('&#xFFFE;&#x1;&#x9;&#x8;')).toBe('￾\u0001\t\u0008');
  });
  it('all 32 numbers of 0x80–0x9F read as the standard’s table says', () => {
    const got = Array.from({ length: 32 }, (_, i) =>
      dec(`&#${0x80 + i};`)
        .codePointAt(0)!
        .toString(16),
    );
    expect(got.join(' ')).toBe(
      '20ac 81 201a 192 201e 2026 2020 2021 2c6 2030 160 2039 152 8d 17d 8f 90 2018 2019 201c 201d 2022 2013 2014 2dc 2122 161 203a 153 9d 17e 178',
    );
  });
  it('CR and CR LF become LF before decoding (§3, §13.2.3.5); a reference to CR stays CR', () => {
    expect(dec('a\r\nb\rc\n&#13;\r')).toBe('a\nb\nc\n\r\n');
  });
  it('a name longer than any in the table is unknown, and nothing breaks', () => {
    const long = `&${'a'.repeat(40)};`;
    expect(decodeHtml(long, table)).toEqual({ text: long, unknown: [long] });
    expect(dec(`&notaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;`)).toBe('¬aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;');
  });
  it('unknown: only &letter…; pieces; a digit first or no semicolon is not listed', () => {
    expect(decodeHtml('&1abc; &abc &abc; &a1b2;', table).unknown).toEqual(['&abc;', '&a1b2;']);
  });
  it(`unknown: at most ${MAX_UNKNOWN_CHECKED} distinct names are collected`, () => {
    const text = Array.from({ length: 1500 }, (_, i) => `&x${i}; &x${i};`).join(' ');
    const { unknown } = decodeHtml(text, table);
    expect(unknown).toHaveLength(MAX_UNKNOWN_CHECKED);
    expect(unknown[0]).toBe('&x0;');
    expect(unknown.at(-1)).toBe('&x999;');
  });
  it('decoding is done once: the result is not decoded again', () => {
    expect(dec('&amp;amp;&amp;#38;')).toBe('&amp;&#38;');
  });
  it('containsReferences: numbers without the table, names with it; AT&T and & alone — no', () => {
    expect(containsReferences('price 5&#8364', table)).toBe(true);
    expect(containsReferences('a & b && c &unknown; &#x;', table)).toBe(false);
    expect(containsReferences('&ampx', table)).toBe(true);
  });
  it('mayContainNames: an & before a letter', () => {
    expect(mayContainNames('a & b &#38; &1')).toBe(false);
    expect(mayContainNames('x&y')).toBe(true);
  });
});

describe('the table (§13.5 of the HTML Standard)', () => {
  it('has the 2,231 entries of the standard’s list: 2,125 names, 106 also without a semicolon', () => {
    expect(table.size).toBe(2231);
    expect([...table.keys()].filter(k => k.endsWith(';'))).toHaveLength(2125);
    expect([...table.keys()].filter(k => !k.endsWith(';'))).toHaveLength(106);
    expect([...table.values()].filter(v => [...v].length === 2)).toHaveLength(93);
  });
  it('every entry decodes to its value, alone and in a sentence', () => {
    for (const [key, value] of table) {
      expect(dec(`&${key}`)).toBe(value);
      expect(dec(`(&${key})`)).toBe(`(${value})`);
    }
  });
  it('is parsed again the same way, and loaded once', async () => {
    expect(parseTable(NAMED_REFERENCES)).toEqual(table);
    expect(await loadReferenceTable()).toBe(table);
  });
  it('detect does not import it: detect.ts reads the short list of names only', () => {
    const source = readFileSync(new URL('./detect.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(imports).toEqual(['./detectNames.generated.ts']);
  });
});

describe('§7 detectHtmlEntities', () => {
  it.each(['&lt;div&gt;', 'Tom &amp; Jerry', 'price: 5&#8364;', '{"a":"&amp;"}', '  &eacute;t&eacute;  ', '&ampx;'])(
    'yes: %j',
    text => {
      expect(detectHtmlEntities(text)).toBe(true);
    },
  );
  it.each([
    'AT&T',
    'a & b',
    'hello',
    '&copy 2024',
    '&unknown;',
    '<p>&nbsp;</p>',
    '<!-- &amp; -->',
    '&amp; </p>',
    'https://x.com/?a=1&b=2',
    'https://example.com/search?q=a&amp=1&lang=en',
    'hello%20world',
    'He said \\"hi\\"',
    'if (a && b) { return x; }',
    'const s = "&";',
    '',
    '   ',
    'SGVsbG8sIFdvcmxkIQ==',
    '{"a": 1}',
  ])('no: %j', text => {
    expect(detectHtmlEntities(text)).toBe(false);
  });
  // What the other tools recognise must not look like this tool's input (a host offers pasted text to every detect).
  it.each([
    ['hex-ascii', '48 65 6c 6c 6f 20 26 20 57'],
    ['hex-ascii, C array', '{ 0x48, 0x65, 0x26 }'],
    ['backslash-escape', 'Line 1\\nLine 2\\t\\u00e9 \\x26amp;'],
    ['uuid', '550e8400-e29b-41d4-a716-446655440000'],
    ['cron', '*/15 * * * *'],
    ['color', 'rgb(255 136 0 / 50%)'],
    ['number-base', '0xFF'],
    ['unix-time', '1700000000'],
    ['url, encoded', 'https://example.com/search?q=tom%20%26%20jerry&page=2'],
    ['url, a query with names', 'https://example.com/?copy=1&not=2&amp=3'],
    ['C source', 'int *p = &value; if (a && b) return *p;'],
    ['Rust source', 'fn f(x: &str) -> &str; let y = &mut z;'],
    ['shell', 'make && ./run --flag=a&b; echo done'],
  ])('no: %s', (_, text) => {
    expect(detectHtmlEntities(text)).toBe(false);
  });
  it('an HTML-escaped URL copied from a page source is text with references: yes', () => {
    expect(detectHtmlEntities('https://example.com/?a=1&amp;b=2')).toBe(true);
  });
  it('more than 64 Ki after trimming: no; exactly 64 Ki: yes', () => {
    const fill = (n: number): string => `&amp;${'a'.repeat(n - 5)}`;
    expect(detectHtmlEntities(fill(65_536))).toBe(true);
    expect(detectHtmlEntities(fill(65_537))).toBe(false);
    expect(detectHtmlEntities(`   ${fill(65_536)}   `)).toBe(true);
  });
});

// The limits are generous on purpose: the suite runs beside the whole workspace's tests. A quadratic scan of 300,000
// characters would take minutes, not a second; alone, each shape takes a few milliseconds to a few dozen.
describe('§12 bounds: linear on large inputs with many ampersands', () => {
  const time = (fn: () => void): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  const shapes = {
    ampersands: '&'.repeat(300_000),
    'names without semicolons': '&a'.repeat(150_000),
    'long unknown names': `&${'b'.repeat(299_998)};`,
    'legacy prefix then letters': `&not${'x'.repeat(299_996)}`,
    'hashes without digits': '&#x'.repeat(100_000),
    'long numbers': `&#${'9'.repeat(299_998)}`,
    'mixed references': '&amp;&lt;&#233;&#x1F600;&copy &unknown;&'.repeat(7_500),
  };
  it.each(Object.entries(shapes))(
    '300,000 characters of %s: decode, containsReferences, encode under 1.5 s',
    (_, text) => {
      expect(text.length).toBeGreaterThanOrEqual(299_999);
      expect(text.length).toBeLessThanOrEqual(300_000);
      const ms = time(() => {
        decodeHtml(text, table);
        decodeHtml(text, table, { context: 'attribute' });
        containsReferences(text, table);
        encodeHtml(text, DEC);
        encodeHtml(text, ONLY);
      });
      expect(ms).toBeLessThan(1500);
    },
  );
  it('detect on 64 Ki of the worst shapes: under 500 ms each', () => {
    for (const text of [
      `${'&'.repeat(65_535)}x`,
      '&a'.repeat(32_768),
      `&${'a'.repeat(31)}`.repeat(2_048),
      '&#1234567'.repeat(7_281),
    ]) {
      let answer = true;
      expect(time(() => (answer = detectHtmlEntities(text)))).toBeLessThan(500);
      expect(answer).toBe(false);
    }
  });
  it(`the limits: live up to ${LIVE_INPUT}, refused above ${MAX_INPUT}; 5 Mi decodes and encodes in Node under 5 s`, () => {
    expect(LIVE_INPUT).toBe(1_048_576);
    expect(MAX_INPUT).toBe(5_242_880);
    const big = '&lt;p&gt;Tom &amp; Jerry &copy 2024 &#x1F600;&unknown;'.repeat(100_000).slice(0, MAX_INPUT);
    expect(big).toHaveLength(MAX_INPUT);
    const ms = time(() => {
      decodeHtml(big, table);
      encodeHtml(big, HEX);
    });
    expect(ms).toBeLessThan(5000);
  });
});
