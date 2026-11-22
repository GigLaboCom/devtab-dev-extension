/**
 * docs/tools/specs/string-inspector.md §10, row by row, then what §5–§7 state and §10 misses. Every invisible,
 * control or bidirectional character and every lone surrogate is written as an escape: this file stays plain to read.
 * The answers that depend on the engine's Unicode data are Node 22.20's (Unicode 16.0, ICU 77.1); where Chrome 159
 * answers otherwise, engine.test.ts says so and the e2e module checks Chrome's answer.
 */
import {
  MAX_MIXED_WORDS,
  MAX_ROWS,
  MAX_VISIBLE,
  categoryName,
  codePointLabel,
  detectStringIssues,
  invisibleKindOf,
  markerOf,
  inspect,
  partsText,
  rowCells,
  rows,
  summarize,
  summaryText,
  tableTsv,
  visibleParts,
  warningLines,
  warnings,
} from './index.ts';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';
import type { Summary } from './index.ts';

const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';
const FAMILY3 = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';
const HEART = '\u{2764}\u{FE0F}';
const THUMBS = '\u{1F44D}';
const SCOTLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';

/** graphemes / code points / UTF-16 units, as §10 writes them. */
const gcu = (s: Summary): string => `${s.graphemes} / ${s.codePoints} / ${s.utf16Units}`;
const visible = (text: string): string => partsText(visibleParts(text));
const lines = (text: string): string[] => warningLines(warnings(text));

describe('\u{A7}10 summarize', () => {
  it('empty: all 0, NFC and NFD', () => {
    expect(summarize('')).toEqual({
      graphemes: 0,
      codePoints: 0,
      utf16Units: 0,
      utf8Bytes: 0,
      utf16Bytes: 0,
      words: 0,
      lines: 0,
      normalization: 'NFC and NFD',
    });
  });

  it('one space: graphemes 1, utf8 1, utf16Bytes 2, words 0, lines 1', () => {
    expect(summarize(' ')).toMatchObject({ graphemes: 1, utf8Bytes: 1, utf16Bytes: 2, words: 0, lines: 1 });
  });

  it('hello: 5 / 5 / 5 / 5 / 10, words 1, NFC and NFD', () => {
    expect(summarize('hello')).toEqual({
      graphemes: 5,
      codePoints: 5,
      utf16Units: 5,
      utf8Bytes: 5,
      utf16Bytes: 10,
      words: 1,
      lines: 1,
      normalization: 'NFC and NFD',
    });
  });

  it('h\u{E9}llo (U+00E9): graphemes 5, code points 5, utf8 6, NFC', () => {
    expect(summarize('h\u{E9}llo')).toMatchObject({ graphemes: 5, codePoints: 5, utf8Bytes: 6, normalization: 'NFC' });
  });

  it('he + U+0301 + llo: graphemes 5, code points 6, units 6, utf8 7, NFD', () => {
    expect(summarize('he\u{301}llo')).toMatchObject({
      graphemes: 5,
      codePoints: 6,
      utf16Units: 6,
      utf8Bytes: 7,
      normalization: 'NFD',
    });
  });

  it('Stra\u{DF}e: 6 / 6 / 6, utf8 7', () => {
    const s = summarize('Stra\u{DF}e');
    expect([gcu(s), s.utf8Bytes]).toEqual(['6 / 6 / 6', 7]);
  });

  it('\u{1F44D}: graphemes 1, code points 1, units 2, utf8 4, words 0', () => {
    expect(summarize(THUMBS)).toMatchObject({ graphemes: 1, codePoints: 1, utf16Units: 2, utf8Bytes: 4, words: 0 });
  });

  it('\u{1F44D}\u{1F3FD}: 1 / 2 / 4, utf8 8', () => {
    const s = summarize('\u{1F44D}\u{1F3FD}');
    expect([gcu(s), s.utf8Bytes]).toEqual(['1 / 2 / 4', 8]);
  });

  it('a family of four: 1 / 7 / 11, utf8 25, utf16Bytes 22', () => {
    const s = summarize(FAMILY);
    expect([gcu(s), s.utf8Bytes, s.utf16Bytes]).toEqual(['1 / 7 / 11', 25, 22]);
  });

  it('\u{1F1F7}\u{1F1FA}: 1 / 2 / 4, utf8 8', () => {
    const s = summarize('\u{1F1F7}\u{1F1FA}');
    expect([gcu(s), s.utf8Bytes]).toEqual(['1 / 2 / 4', 8]);
  });

  it('\u{2764}\u{FE0F}: 1 / 2 / 2, utf8 6; visible as it is, without a marker', () => {
    const s = summarize(HEART);
    expect([gcu(s), s.utf8Bytes]).toEqual(['1 / 2 / 2', 6]);
    expect(visibleParts(HEART)).toEqual([{ text: HEART }]);
  });

  it('a + U+FE0F + b: a[VS16]b; graphemes 2', () => {
    expect(visible('a\u{FE0F}b')).toBe('a[VS16]b');
    expect(summarize('a\u{FE0F}b').graphemes).toBe(2);
  });

  it('a + U+200B + b: utf8 5, words 2; a[ZWSP]b; detect yes', () => {
    expect(summarize('a\u{200B}b')).toMatchObject({ utf8Bytes: 5, words: 2 });
    expect(visible('a\u{200B}b')).toBe('a[ZWSP]b');
    expect(detectStringIssues('a\u{200B}b')).toBe(true);
  });

  it('U+FEFF + x: [BOM]x', () => {
    expect(visible('\u{FEFF}x')).toBe('[BOM]x');
  });

  it('abc + U+D800: utf8 6, code points 4; abc[U+D800]; row 4: Cs, UTF-8 EF BF BD, UTF-16 D800', () => {
    expect(summarize('abc\uD800')).toMatchObject({ utf8Bytes: 6, codePoints: 4 });
    expect(visible('abc\uD800')).toBe('abc[U+D800]');
    const row = rows('abc\uD800')[3];
    expect([row.category, rowCells(row)[6], rowCells(row)[7], row.marker]).toEqual([
      'Cs',
      'EF BF BD',
      'D800',
      'U+D800',
    ]);
  });

  it('U+DC00: utf8 3, units 1', () => {
    expect(summarize('\uDC00')).toMatchObject({ utf8Bytes: 3, utf16Units: 1 });
  });

  it('a\\r\\nb\\nc\\r: graphemes 6, code points 7, lines 4, words 3; a[CR]\u{23CE}b\u{23CE}c[CR]', () => {
    expect(summarize('a\r\nb\nc\r')).toMatchObject({ graphemes: 6, codePoints: 7, lines: 4, words: 3 });
    expect(visible('a\r\nb\nc\r')).toBe('a[CR]\nb\nc[CR]');
  });

  it('a\u{23CE}: lines 2', () => {
    expect(summarize('a\n').lines).toBe(2);
  });

  it('words: "one two  three" 3, "don\'t stop" 2, "fooBar" 1', () => {
    expect(summarize('one two  three').words).toBe(3);
    expect(summarize("don't stop").words).toBe(2);
    expect(summarize('fooBar').words).toBe(1);
  });

  it('foo_bar foo-bar 3.14 v1.2.3: words 5 (foo_bar, foo, bar, 3.14, v1.2.3)', () => {
    expect(summarize('foo_bar foo-bar 3.14 v1.2.3').words).toBe(5);
  });

  it('e-mail a@b.com: words 4 in Node (ICU 77.1); Chrome 159 counts 5 (engine.test.ts)', () => {
    expect(summarize('e-mail a@b.com').words).toBe(4);
  });

  it('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442}, \u{43C}\u{438}\u{440}!: graphemes 12, utf8 21, words 2', () => {
    expect(summarize('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442}, \u{43C}\u{438}\u{440}!')).toMatchObject({
      graphemes: 12,
      utf8Bytes: 21,
      words: 2,
    });
  });

  it('\u{4F60}\u{597D}\u{4E16}\u{754C}: 4 / 4 / 4, utf8 12, words 2 (the dictionary of ICU 77.1, and of Chrome 159)', () => {
    const s = summarize('\u{4F60}\u{597D}\u{4E16}\u{754C}');
    expect([gcu(s), s.utf8Bytes, s.words]).toEqual(['4 / 4 / 4', 12, 2]);
  });

  it('\u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947}: graphemes 3, code points 6, utf8 18', () => {
    expect(summarize('\u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947}')).toMatchObject({
      graphemes: 3,
      codePoints: 6,
      utf8Bytes: 18,
    });
  });

  it('hello \u{1F44B} world: graphemes 13, units 14, utf8 16, words 2', () => {
    expect(summarize('hello \u{1F44B} world')).toMatchObject({
      graphemes: 13,
      utf16Units: 14,
      utf8Bytes: 16,
      words: 2,
    });
  });

  it('\u{DC}n\u{EF}c\u{F6}d\u{E9}: utf8 11, NFC', () => {
    expect(summarize('\u{DC}n\u{EF}c\u{F6}d\u{E9}')).toMatchObject({ utf8Bytes: 11, normalization: 'NFC' });
  });

  it('\u{395}\u{3BB}\u{3BB}\u{3AC}\u{3B4}\u{3B1}: utf8 12, NFC; no warnings', () => {
    const text = '\u{395}\u{3BB}\u{3BB}\u{3AC}\u{3B4}\u{3B1}';
    expect(summarize(text)).toMatchObject({ utf8Bytes: 12, normalization: 'NFC' });
    expect(lines(text)).toEqual([]);
  });
});

describe('\u{A7}10 warnings, visible text and rows', () => {
  it('p + U+0430 + ypal: mixed scripts (Cyrillic, Latin); row 2: U+0430, Cyrillic, D0 B0', () => {
    const text = 'p\u{430}ypal';
    expect(warnings(text).mixedScripts).toEqual([{ word: text, index: 0, scripts: ['Cyrillic', 'Latin'] }]);
    expect(lines(text)).toEqual([`Mixed scripts in 1 word: "${text}" (Cyrillic, Latin).`]);
    const cells = rowCells(rows(text)[1]);
    expect([cells[2], cells[5], cells[6]]).toEqual(['U+0430', 'Cyrillic', 'D0 B0']);
  });

  it('\u{3A1}ython (\u{3A1} is U+03A1): mixed scripts (Greek, Latin)', () => {
    expect(warnings('\u{3A1}ython').mixedScripts[0].scripts).toEqual(['Greek', 'Latin']);
  });

  it('U+202E abc U+202C: [RLO]abc[PDF]; detect yes', () => {
    expect(visible('\u{202E}abc\u{202C}')).toBe('[RLO]abc[PDF]');
    expect(detectStringIssues('\u{202E}abc\u{202C}')).toBe(true);
  });

  it('U+2066 a U+2069: [LRI]a[PDI]', () => {
    expect(visible('\u{2066}a\u{2069}')).toBe('[LRI]a[PDI]');
  });

  it('a<tab>b: a[TAB]b', () => {
    expect(visible('a\tb')).toBe('a[TAB]b');
  });

  it('U+00A0: utf8 2; [NBSP]', () => {
    expect(summarize('\u{A0}').utf8Bytes).toBe(2);
    expect(visible('\u{A0}')).toBe('[NBSP]');
  });

  it('a U+2003 b, U+3000 x: a[U+2003]b, [U+3000]x', () => {
    expect(visible('a\u{2003}b')).toBe('a[U+2003]b');
    expect(visible('\u{3000}x')).toBe('[U+3000]x');
  });

  it('x U+00AD y: x[SHY]y; words 1', () => {
    expect(visible('x\u{AD}y')).toBe('x[SHY]y');
    expect(summarize('x\u{AD}y').words).toBe(1);
  });

  it('x U+2028 y: x[U+2028]y; lines 1', () => {
    expect(visible('x\u{2028}y')).toBe('x[U+2028]y');
    expect(summarize('x\u{2028}y').lines).toBe(1);
  });

  it('x U+0000 y: x[NUL]y', () => {
    expect(visible('x\u0000y')).toBe('x[NUL]y');
  });

  it('U+3164: [U+3164]; words 1 (a letter to the segmenter)', () => {
    expect(visible('\u{3164}')).toBe('[U+3164]');
    expect(summarize('\u{3164}').words).toBe(1);
  });

  it('\u{201C}quoted\u{201D} \u{2014} dash: \u{201C} looks like ", \u{201D} like ", \u{2014} like -', () => {
    const r = rows('\u{201C}quoted\u{201D} \u{2014} dash');
    expect([r[0].lookalike, r[7].lookalike, r[9].lookalike, r[1].lookalike]).toEqual(['"', '"', '-', null]);
  });

  it('\u{FF21}\u{FF22}\u{FF23}: look like A, B, C; script Latin', () => {
    expect(rows('\u{FF21}\u{FF22}\u{FF23}').map(r => [r.lookalike, r.script])).toEqual([
      ['A', 'Latin'],
      ['B', 'Latin'],
      ['C', 'Latin'],
    ]);
  });

  it('e + U+0301: two rows, both grapheme 1; U+0301 is Mn, Inherited, UTF-8 CC 81', () => {
    const r = rows('e\u{301}');
    expect(r.map(x => x.grapheme)).toEqual([1, 1]);
    const cells = rowCells(r[1]);
    expect([cells[2], r[1].category, cells[5], cells[6]]).toEqual(['U+0301', 'Mn', 'Inherited', 'CC 81']);
    expect(cells[1]).toBe('\u{25CC}\u{301}');
  });

  it('\u{1F44D}\u{1F3FD}: U+1F44D So Common F0 9F 91 8D D83D DC4D \\u{1F44D}; U+1F3FD Sk', () => {
    const [a, b] = rows('\u{1F44D}\u{1F3FD}');
    expect(rowCells(a).slice(2)).toEqual([
      'U+1F44D',
      '\u{2014}',
      'So Other Symbol',
      'Common',
      'F0 9F 91 8D',
      'D83D DC4D',
      '\\u{1F44D}',
    ]);
    expect([b.codePoint, b.category]).toEqual([0x1f3fd, 'Sk']);
  });

  it('\u{1D11E}: U+1D11E, UTF-8 F0 9D 84 9E, UTF-16 D834 DD1E', () => {
    const cells = rowCells(rows('\u{1D11E}')[0]);
    expect([cells[2], cells[6], cells[7]]).toEqual(['U+1D11E', 'F0 9D 84 9E', 'D834 DD1E']);
  });

  it('\u{20AC}: U+20AC, Sc, E2 82 AC, \\u20AC', () => {
    const r = rows('\u{20AC}')[0];
    const cells = rowCells(r);
    expect([cells[2], r.category, cells[6], cells[8]]).toEqual(['U+20AC', 'Sc', 'E2 82 AC', '\\u20AC']);
  });

  it('\\t\u{23CE}: CHARACTER TABULATION and LINE FEED, Cc, both marked (control)', async () => {
    const { loadNames } = await import('./names.ts');
    const r = rows('\t\n', MAX_ROWS, await loadNames());
    expect(r.map(x => [x.name, x.category, x.invisible, x.marker])).toEqual([
      ['CHARACTER TABULATION', 'Cc', 'control', 'TAB'],
      ['LINE FEED', 'Cc', 'control', 'LF'],
    ]);
  });

  it('U+0000: NULL, marker NUL', async () => {
    const { loadNames } = await import('./names.ts');
    const [r] = rows('\u0000', MAX_ROWS, await loadNames());
    expect([r.name, r.marker]).toEqual(['NULL', 'NUL']);
  });

  it('U+202E: RIGHT-TO-LEFT OVERRIDE, Cf, E2 80 AE', async () => {
    const { loadNames } = await import('./names.ts');
    const [r] = rows('\u{202E}', MAX_ROWS, await loadNames());
    expect([r.name, r.category, rowCells(r)[6]]).toEqual(['RIGHT-TO-LEFT OVERRIDE', 'Cf', 'E2 80 AE']);
  });

  it('the 83 names of \u{A7}5.3 and the 95 of ASCII: 178 in all; 26 flagged code points have no abbreviation and show U+XXXX', async () => {
    const { loadNames } = await import('./names.ts');
    const names = await loadNames();
    expect(names.size).toBe(178);
    for (let cp = 0x20; cp <= 0x7e; cp++) expect(names.has(cp), codePointLabel(cp)).toBe(true);
    const flagged = [...names.keys()].filter(cp => cp < 0x20 || cp > 0x7e);
    expect(flagged).toHaveLength(83);
    expect(flagged.filter(cp => cp !== 0xfffd).every(cp => invisibleKindOf(cp) !== null)).toBe(true);
    expect(flagged.filter(cp => markerOf(cp) === codePointLabel(cp))).toHaveLength(26);
    expect(
      [0x0007, 0x0019, 0x0085, 0x00a0, 0x200d, 0x202e, 0x2069, 0x3164, 0x2800, 0xfeff, 0xfffd, 0x0020, 0x007e].map(cp =>
        names.get(cp),
      ),
    ).toEqual([
      'ALERT',
      'END OF MEDIUM',
      'NEXT LINE',
      'NO-BREAK SPACE',
      'ZERO WIDTH JOINER',
      'RIGHT-TO-LEFT OVERRIDE',
      'POP DIRECTIONAL ISOLATE',
      'HANGUL FILLER',
      'BRAILLE PATTERN BLANK',
      'ZERO WIDTH NO-BREAK SPACE',
      'REPLACEMENT CHARACTER',
      'SPACE',
      'TILDE',
    ]);
    expect([0x0009, 0x0019, 0x000a, 0xfeff].map(markerOf)).toEqual(['TAB', 'EM', 'LF', 'BOM']);
  });

  it('detect says no to emoji, Hebrew, JSON, Base64, NBSP, a soft hyphen and a flag of tag characters', () => {
    for (const text of [
      'hello',
      FAMILY3,
      HEART,
      THUMBS,
      '\u{5E9}\u{5DC}\u{5D5}\u{5DD}',
      '{"a":1}',
      'SGVsbG8=',
      'nbsp\u{A0}here',
      'soft\u{AD}hyphen',
      SCOTLAND,
    ])
      expect(detectStringIssues(text), JSON.stringify(text)).toBe(false);
  });

  it('detect says yes to a ZWSP, a BOM, an override and a lone surrogate (\u{A7}7)', () => {
    for (const text of [
      'a\u{200B}b',
      '\u{FEFF}hi',
      '\u{202E}evil',
      'x\uD800',
      '\uDC00x',
      'a\u{2060}b',
      '\u{180E}',
      '\u{2066}',
    ])
      expect(detectStringIssues(text), JSON.stringify(text)).toBe(true);
    expect(detectStringIssues('\u{1F44D}')).toBe(false);
  });
});

describe('\u{A7}6 edge cases', () => {
  it('empty: no warnings, no visible text, no rows', () => {
    expect(lines('')).toEqual([]);
    expect(visibleParts('')).toEqual([]);
    expect(rows('')).toEqual([]);
  });

  it('one space is not marked', () => {
    expect(visibleParts(' ')).toEqual([{ text: ' ' }]);
    expect(lines(' ')).toEqual([]);
  });

  it('U+00A0: 1 invisible character: NBSP.', () => {
    expect(lines('\u{A0}')).toEqual(['1 invisible character: NBSP.']);
  });

  it('a family of four: its ZWJ are not marked; \u{2764}\u{FE0F}: VS16 is not marked; a + VS16 + b is', () => {
    expect(rows(FAMILY).map(r => r.invisible)).toEqual([null, null, null, null, null, null, null]);
    expect(lines(FAMILY)).toEqual([]);
    expect(lines(HEART)).toEqual([]);
    expect(lines('a\u{FE0F}b')).toEqual(['1 invisible character: VS16.']);
  });

  it('abc + U+D800: the lone surrogate is an invisible character and has its own warning', () => {
    expect(lines('abc\uD800')).toEqual([
      '1 invisible character: U+D800.',
      '1 lone surrogate: not valid Unicode. UTF-8 counts each as U+FFFD (3 bytes).',
    ]);
    expect(warnings('abc\uD800').loneSurrogates).toBe(1);
  });

  it('a\\r\\nb\\nc\\r: the CR markers; \\n is never counted', () => {
    expect(lines('a\r\nb\nc\r')).toEqual(['2 invisible characters: CR \u{D7}2.']);
  });

  it('U+202E abc U+202C: the bidirectional warning', () => {
    expect(lines('\u{202E}abc\u{202C}')).toEqual([
      '2 invisible characters: RLO, PDF.',
      'Bidirectional controls (RLO, PDF) can change the order in which text is displayed.',
    ]);
  });

  it('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}, \u{4F60}\u{597D}\u{4E16}\u{754C}, \u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947}: no warnings; \u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947} is 3 characters and 6 code points', () => {
    for (const text of [
      '\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}',
      '\u{4F60}\u{597D}\u{4E16}\u{754C}',
      '\u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947}',
    ])
      expect(lines(text)).toEqual([]);
  });

  it('U+3164 is marked and is a word', () => {
    expect(lines('\u{3164}')).toEqual(['1 invisible character: U+3164.']);
  });
});

describe('\u{A7}5 beyond the examples', () => {
  it('lines: \\r\\n is one break, a lone \\r one, U+2028, U+2029 and U+0085 none', () => {
    expect(summarize('a\rb').lines).toBe(2);
    expect(summarize('a\r\n').lines).toBe(2);
    expect(summarize('\n\n').lines).toBe(3);
    expect(summarize('a\u{2029}b\u0085c').lines).toBe(1);
    expect(visible('a\u{2029}b\u0085c')).toBe('a[U+2029]b[NEL]c');
  });

  it('every kind of \u{A7}5.3 gets its marker', () => {
    const cases: Array<[string, string]> = [
      ['\u0019', '[EM]'],
      ['\u001F', '[US]'],
      ['\u007F', '[DEL]'],
      ['\u0080', '[U+0080]'],
      ['\u{202F}', '[NNBSP]'],
      ['\u{205F}', '[MMSP]'],
      ['\u{1680}', '[U+1680]'],
      ['\u{34F}', '[CGJ]'],
      ['\u{180E}', '[MVS]'],
      ['\u{2060}', '[WJ]'],
      ['\u{2061}', '[U+2061]'],
      ['\u{FFFC}', '[U+FFFC]'],
      ['\u{200C}', '[ZWNJ]'],
      ['\u{200D}', '[ZWJ]'],
      ['\u{61C}', '[ALM]'],
      ['\u{200E}', '[LRM]'],
      ['\u{200F}', '[RLM]'],
      ['\u{202A}\u{202B}\u{202D}', '[LRE][RLE][LRO]'],
      ['\u{2067}\u{2068}', '[RLI][FSI]'],
      ['\u{115F}\u{1160}\u{2800}\u{FFA0}', '[U+115F][U+1160][U+2800][U+FFA0]'],
      ['\u{FE00}', '[VS1]'],
      ['\u{E0100}', '[VS17]'],
      ['\u{E01EF}', '[VS256]'],
      ['\u{E0041}', '[U+E0041]'],
      ['\u{1D173}', '[U+1D173]'],
      ['\u{2029}', '[U+2029]'],
    ];
    for (const [text, shown] of cases) expect(visible(text), JSON.stringify(text)).toBe(shown);
    expect(rows('\u{200C}\u{202E}\u{115F}\u{FE00}\u{E0041}\uD800\u{3000}\u0007').map(r => r.invisible)).toEqual([
      'joiner',
      'bidi',
      'filler',
      'variation',
      'tag',
      'surrogate',
      'space',
      'control',
    ]);
  });

  it('U+FFFD has a name and no marker', async () => {
    const { loadNames } = await import('./names.ts');
    const [r] = rows('\u{FFFD}', MAX_ROWS, await loadNames());
    expect([r.name, r.invisible, r.marker]).toEqual(['REPLACEMENT CHARACTER', null, null]);
  });

  it('ZWNJ is marked even inside an emoji; tag characters of a flag are not', () => {
    expect(lines('\u{1F468}\u{200C}\u{1F469}')).toEqual(['1 invisible character: ZWNJ.']);
    expect(lines(SCOTLAND)).toEqual([]);
    expect(lines('a\u{E0041}')).toEqual(['1 invisible character: U+E0041.']);
    expect(visible(SCOTLAND)).toBe(SCOTLAND);
  });

  it('a ZWJ outside an emoji is marked; inside one it is not', () => {
    expect(visible('a\u{200D}b')).toBe('a[ZWJ]b');
    expect(visible(`x${FAMILY}y`)).toBe(`x${FAMILY}y`);
  });

  it('invisible: markers in order of appearance, \u{D7}k, five kinds at most and then "and k more kinds"', () => {
    expect(lines('\u{200B}\u{A0}\u{200B}')).toEqual(['3 invisible characters: ZWSP \u{D7}2, NBSP.']);
    expect(lines('\u{200B}\u{A0}\u{AD}\u{2060}\u{FEFF}\u{200C}\u{200E}')[0]).toBe(
      '7 invisible characters: ZWSP, NBSP, SHY, WJ, BOM and 2 more kinds.',
    );
    expect(lines('\u{200B}\u{A0}\u{AD}\u{2060}\u{FEFF}\u{200C}')[0]).toBe(
      '6 invisible characters: ZWSP, NBSP, SHY, WJ, BOM and 1 more kind.',
    );
  });

  it('bidirectional controls: in order, without repeats', () => {
    expect(warnings('\u{202E}\u{2066}\u{202E}\u{2069}').bidi).toEqual(['RLO', 'LRI', 'PDI']);
  });

  it('mixed scripts: up to three different words, the count of all, scripts alphabetically', () => {
    const text = 'p\u{430}ypal \u{3A1}ython p\u{430}ypal \u{570}ello g\u{43E}\u{43E}gle';
    const w = warnings(text);
    expect(w.mixedScripts.map(m => m.index)).toEqual([0, 7, 14, 21, 27]);
    expect(lines(text)).toEqual([
      'Mixed scripts in 5 words: "p\u{430}ypal" (Cyrillic, Latin), "\u{3A1}ython" (Greek, Latin), "\u{570}ello" (Armenian, Latin).',
    ]);
    expect(MAX_MIXED_WORDS).toBe(3);
  });

  it('mixed scripts: Japanese, Cyrillic or Greek alone, digits and marks are no mix', () => {
    for (const text of [
      '\u{65E5}\u{672C}\u{8A9E}\u{3072}\u{3089}\u{304C}\u{306A}\u{30AB}\u{30BF}\u{30AB}\u{30CA}',
      '\u{43F}\u{440}\u{438}\u{432}\u{435}\u{442}123',
      'caf\u{E9} na\u{EF}ve',
      'Moscow\u{301}',
      '\u{3B1}\u{3B2}\u{3B3}',
    ])
      expect(warnings(text).mixedScripts, text).toEqual([]);
  });

  it('a quoted word shows its invisible characters as markers and stops after 40 code points', () => {
    expect(lines('p\u{430}y\u{202E}pal')).toEqual(
      [
        '2 invisible characters: RLO \u{D7} 1'.replace(' \u{D7} 1', '') + '.',
        'Bidirectional controls (RLO) can change the order in which text is displayed.',
        'Mixed scripts in 1 word: "p\u{430}y[RLO]pal" (Cyrillic, Latin).',
      ].map((l, i) => (i === 0 ? '1 invisible character: RLO.' : l)),
    );
    const long = `\u{430}${'b'.repeat(100)}`;
    expect(lines(long)).toEqual([`Mixed scripts in 1 word: "\u{430}${'b'.repeat(39)}\u{2026}" (Cyrillic, Latin).`]);
  });

  it('look-alikes: n characters, five different at most; one character in the singular', () => {
    expect(lines('\u{201C}quoted\u{201D} \u{2014} dash')).toEqual([
      '3 characters look like ASCII: \u{201C} \u{2192} ", \u{201D} \u{2192} ", \u{2014} \u{2192} -.',
    ]);
    expect(lines('a\u{2013}b')).toEqual(['1 character looks like ASCII: \u{2013} \u{2192} -.']);
    expect(lines('\u{2018}\u{2019}\u{201B}\u{2032}\u{2BC}\u{37E}')[0]).toBe(
      "6 characters look like ASCII: \u{2018} \u{2192} ', \u{2019} \u{2192} ', \u{201B} \u{2192} ', \u{2032} \u{2192} ', \u{2BC} \u{2192} ' and 1 more kind.",
    );
    expect(
      rows(
        '\u{37E}\u{2236}\u{2024}\u{2044}\u{2215}\u{2216}\u{29F5}\u{2223}\u{1C0}\u{2C6}\u{2C4}\u{2DC}\u{2217}\u{FF01}\u{FF5E}',
      )
        .map(r => r.lookalike)
        .join(''),
    ).toBe(';:.//\\\\||^^~*!~');
  });

  it('look-alike letters of Cyrillic and Greek are not warned on their own (\u{A7}5.5 item 4)', () => {
    expect(lines('\u{430} \u{43E} \u{3A1}')).toEqual([]);
  });

  it('private use, unassigned and noncharacters have a warning of their own (spec \u{A7}15)', () => {
    expect(lines('x\u{E000}\u{FFFF}\u{378}\u{E000}')).toEqual([
      '4 code points are private-use, unassigned or noncharacters: U+E000, U+FFFF, U+0378.',
    ]);
    expect(lines('\u{10FFFD}')).toEqual(['1 code point is private-use, unassigned or noncharacters: U+10FFFD.']);
    expect(rows('\u{E000}\u{FFFF}').map(r => r.category)).toEqual(['Co', 'Cn']);
  });

  it('category names: the 30 values of PropertyValueAliases.txt, with spaces', () => {
    expect(['Ll', 'Cf', 'Cs', 'Cn', 'Lu', 'Mc', 'Pd', 'Zs', 'Co', 'Nl'].map(categoryName)).toEqual([
      'Ll Lowercase Letter',
      'Cf Format',
      'Cs Surrogate',
      'Cn Unassigned',
      'Lu Uppercase Letter',
      'Mc Spacing Mark',
      'Pd Dash Punctuation',
      'Zs Space Separator',
      'Co Private Use',
      'Nl Letter Number',
    ]);
    expect(categoryName('Xx')).toBe('Xx');
  });

  it('scripts: the first of the list, Common and Inherited, else Other', () => {
    expect(
      rows(
        'a\u{3B1}\u{431}\u{561}\u{5D0}\u{627}\u{915}\u{995}\u{E01}\u{10D0}\u{AC00}\u{3042}\u{30A2}\u{4E00} \u{301}\u{1200}',
      ).map(r => r.script),
    ).toEqual([
      'Latin',
      'Greek',
      'Cyrillic',
      'Armenian',
      'Hebrew',
      'Arabic',
      'Devanagari',
      'Bengali',
      'Thai',
      'Georgian',
      'Hangul',
      'Hiragana',
      'Katakana',
      'Han',
      'Common',
      'Inherited',
      'Other',
    ]);
  });

  it('escapes: \\u and four hex digits up to U+FFFF, \\u{\u{2026}} above, upper case', () => {
    expect(rows('\u{E9}\u{FFFF}\u{10000}\u{1F44D}').map(r => r.escape)).toEqual([
      '\\u00E9',
      '\\uFFFF',
      '\\u{10000}',
      '\\u{1F44D}',
    ]);
  });

  it('numbers are shown with "," between thousands; Copy summary copies the lines as shown', () => {
    const s = summarize('a'.repeat(12_345));
    expect(summaryText(s)).toBe(
      [
        'Characters: 12,345',
        'Code points: 12,345',
        'UTF-16 code units: 12,345',
        'UTF-8 bytes: 12,345',
        'UTF-16 bytes: 24,690',
        'Words: 1',
        'Lines: 1',
        'Normalization: NFC and NFD',
      ].join('\n'),
    );
  });

  it('Copy table: a header line, then a line per row; the marker in Char, # on every row', () => {
    expect(tableTsv(rows('e\u{301}\u{200B}'))).toBe(
      [
        '#\tChar\tCode point\tName\tCategory\tScript\tUTF-8\tUTF-16\tEscape',
        '1\te\tU+0065\t\u{2014}\tLl Lowercase Letter\tLatin\t65\t0065\t\\u0065',
        '1\t\u{25CC}\u{301}\tU+0301\t\u{2014}\tMn Nonspacing Mark\tInherited\tCC 81\t0301\t\\u0301',
        '2\tZWSP\tU+200B\t\u{2014}\tCf Format\tCommon\tE2 80 8B\t200B\t\\u200B',
      ].join('\n'),
    );
  });

  it('the table stops at its limit and the visible text at its own', () => {
    const text = 'ab\u{200B}'.repeat(4_000);
    expect(rows(text)).toHaveLength(MAX_ROWS);
    expect(rows(text, 5).map(r => r.grapheme)).toEqual([1, 2, 3, 4, 5]);
    const parts = visibleParts(text);
    const shown = parts.reduce((n, p) => n + ('text' in p ? p.text.length : 1), 0);
    expect(shown).toBe(MAX_VISIBLE);
    expect(rows(text, 0)).toEqual([]);
  });

  it('normalisation: NFC, NFD, Neither; the four forms say what they would change', () => {
    expect(summarize('\u{E9}e\u{301}').normalization).toBe('Neither');
    const { forms } = inspect('\u{FB01} e\u{301}');
    expect(forms).toEqual([
      { form: 'NFC', changes: true, codePoints: 3, utf8Bytes: 6 },
      { form: 'NFD', changes: false, codePoints: 4, utf8Bytes: 7 },
      { form: 'NFKC', changes: true, codePoints: 4, utf8Bytes: 5 },
      { form: 'NFKD', changes: true, codePoints: 5, utf8Bytes: 6 },
    ]);
    expect(inspect('abc').forms?.every(f => !f.changes)).toBe(true);
  });

  it('a run of more than 256 combining marks is not normalised (it would take seconds)', () => {
    const flood = `Z${'\u{301}\u{316}'.repeat(200)}`;
    const r = inspect(flood);
    expect([r.summary.normalization, r.forms]).toEqual(['Not checked', null]);
    expect(r.summary.codePoints).toBe(401);
    expect(inspect(`Z${'\u{301}\u{316}'.repeat(128)}`).summary.normalization).toBe('Neither');
  });

  it('inspect gives what summarize and warnings give', () => {
    const text = `p\u{430}ypal ${FAMILY} a\u{200B}b \u{201C}x\u{201D}`;
    const r = inspect(text);
    expect(r.summary).toEqual(summarize(text));
    expect(r.warnings).toEqual(warnings(text));
  });
});

describe('\u{A7}12 a megabyte', () => {
  const unit =
    'The quick brown fox \u{201C}jumps\u{201D}. \u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{4F60}\u{597D} ' +
    `${FAMILY} a\u{200B}b p\u{430}ypal e\u{301}\n`;
  const sample = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  // The shape of the cost, not milliseconds (`growth`: the large text against as many small ones of the same total
  // size, timed in turn): linear about 1, quadratic about the factor, work that reads only the start about 1/factor.
  it('grows with the text, not with its square (the shape, not milliseconds)', { timeout: 60_000 }, () => {
    expect(growth(inspect, sample, 64 * 1024, { factor: 16, rounds: 3 })).toBeLessThan(GROWTH_BOUND);
  });

  it('the table and the visible text read only the start of a megabyte', { timeout: 60_000 }, () => {
    const shown = (text: string) => [rows(text), visibleParts(text)];
    // 64 times the text: reading only the start measures about 1/64, reading all of it about 1.
    expect(growth(shown, sample, 16 * 1024, { factor: 64 })).toBeLessThan(0.25);
  });

  it('detect is one linear expression: a megabyte without a match, and one with it at the end', () => {
    const plain = 'x'.repeat(1024 * 1024);
    expect(detectStringIssues(plain)).toBe(false);
    expect(detectStringIssues(`${plain}\uD800`)).toBe(true);
  });
});
