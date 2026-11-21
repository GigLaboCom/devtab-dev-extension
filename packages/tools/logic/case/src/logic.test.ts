import {
  CASE_FORMS,
  LIVE_INPUT,
  MAX_INPUT,
  TITLE_SHORT_WORDS,
  convertAll,
  convertCase,
  convertLine,
  splitWords,
} from './logic';
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CaseForm } from './logic';

type Check = readonly [form: CaseForm | 'words', expected: string | readonly string[]];

/**
 * docs/tools/specs/case.md §10, row by row and in its order: the input, then each form the row names with its
 * expected value. `words` is splitWords. Every expected value is the specification's.
 */
const ROWS: ReadonlyArray<readonly [input: string, checks: readonly Check[]]> = [
  [
    'HTTPServer',
    [
      ['words', ['HTTP', 'Server']],
      ['camel', 'httpServer'],
      ['pascal', 'HttpServer'],
      ['snake', 'http_server'],
      ['constant', 'HTTP_SERVER'],
    ],
  ],
  [
    'HTTPServer',
    [
      ['kebab', 'http-server'],
      ['upperKebab', 'HTTP-SERVER'],
      ['train', 'Http-Server'],
      ['dot', 'http.server'],
      ['path', 'http/server'],
    ],
  ],
  [
    'HTTPServer',
    [
      ['title', 'HTTP Server'],
      ['sentence', 'HTTP server'],
      ['lower', 'httpserver'],
      ['upper', 'HTTPSERVER'],
    ],
  ],
  [
    'parseURL2',
    [
      ['words', ['parse', 'URL2']],
      ['camel', 'parseUrl2'],
      ['snake', 'parse_url2'],
      ['title', 'Parse URL2'],
    ],
  ],
  [
    'parseURL2Name',
    [
      ['words', ['parse', 'URL2', 'Name']],
      ['snake', 'parse_url2_name'],
    ],
  ],
  [
    'XMLHttpRequest',
    [
      ['words', ['XML', 'Http', 'Request']],
      ['camel', 'xmlHttpRequest'],
      ['snake', 'xml_http_request'],
      ['sentence', 'XML http request'],
    ],
  ],
  [
    'getID',
    [
      ['camel', 'getId'],
      ['pascal', 'GetId'],
      ['title', 'Get ID'],
    ],
  ],
  ['ABCdef', [['words', ['AB', 'Cdef']]]],
  [
    'iOS',
    [
      ['camel', 'iOs'],
      ['kebab', 'i-os'],
      ['title', 'I OS'],
    ],
  ],
  ['base64Encode', [['snake', 'base64_encode']]],
  ['sha256_hash', [['camel', 'sha256Hash']]],
  ['A1B2', [['snake', 'a1_b2']]],
  ['x1Y', [['snake', 'x1_y']]],
  [
    '2fa_code',
    [
      ['camel', '2faCode'],
      ['pascal', '2faCode'],
    ],
  ],
  [
    'version_1_2',
    [
      ['camel', 'version12'],
      ['kebab', 'version-1-2'],
      ['title', 'Version 1 2'],
    ],
  ],
  [
    'some_mixed-Case.input',
    [
      ['camel', 'someMixedCaseInput'],
      ['path', 'some/mixed/case/input'],
    ],
  ],
  [
    'foo.bar/baz',
    [
      ['snake', 'foo_bar_baz'],
      ['upper', 'FOO.BAR/BAZ'],
    ],
  ],
  [
    'file_name.txt',
    [
      ['camel', 'fileNameTxt'],
      ['lower', 'file_name.txt'],
    ],
  ],
  [
    '__proto__',
    [
      ['camel', 'proto'],
      ['constant', 'PROTO'],
    ],
  ],
  [
    '  hello   world  ',
    [
      ['camel', 'helloWorld'],
      ['title', 'Hello World'],
      ['lower', '  hello   world  '],
    ],
  ],
  [
    'fooBar\tbaz',
    [
      ['snake', 'foo_bar_baz'],
      ['upper', 'FOOBAR\tBAZ'],
    ],
  ],
  [
    "don't stop",
    [
      ['camel', 'dontStop'],
      ['snake', 'dont_stop'],
      ['title', "Don't Stop"],
    ],
  ],
  [
    'it’s fine',
    [
      ['camel', 'itsFine'],
      ['sentence', 'It’s fine'],
    ],
  ],
  [
    "O'Neil",
    [
      ['words', ["O'Neil"]],
      ['snake', 'oneil'],
      ['title', "O'neil"],
    ],
  ],
  [
    "rock 'n' roll",
    [
      ['words', ['rock', 'n', 'roll']],
      ['camel', 'rockNRoll'],
    ],
  ],
  [
    'the lord of the rings',
    [
      ['title', 'The Lord of the Rings'],
      ['sentence', 'The lord of the rings'],
    ],
  ],
  [
    'a tale of two cities',
    [
      ['title', 'A Tale of Two Cities'],
      ['pascal', 'ATaleOfTwoCities'],
    ],
  ],
  ['what is it for', [['title', 'What Is It For']]],
  [
    'use the HTTP API',
    [
      ['title', 'Use the HTTP API'],
      ['sentence', 'Use the HTTP API'],
      ['camel', 'useTheHttpApi'],
    ],
  ],
  [
    'HTTP_SERVER',
    [
      ['title', 'Http Server'],
      ['sentence', 'Http server'],
    ],
  ],
  ['THIS OR THAT', [['title', 'This or That']]],
  [
    'use AND gate',
    [
      ['title', 'Use AND Gate'],
      ['sentence', 'Use AND gate'],
    ],
  ],
  [
    'ABC',
    [
      ['title', 'Abc'],
      ['camel', 'abc'],
    ],
  ],
  [
    'привет мир',
    [
      ['camel', 'приветМир'],
      ['constant', 'ПРИВЕТ_МИР'],
      ['title', 'Привет Мир'],
    ],
  ],
  [
    'ÉCOLE élève',
    [
      ['camel', 'écoleÉlève'],
      ['train', 'École-Élève'],
      ['sentence', 'ÉCOLE élève'],
      ['title', 'ÉCOLE Élève'],
    ],
  ],
  ['école', [['pascal', 'École']]],
  [
    'naïve café',
    [
      ['snake', 'naïve_café'],
      ['upper', 'NAÏVE CAFÉ'],
    ],
  ],
  [
    'ΟΔΟΣ ΣΟΦΟΣ',
    [
      ['snake', 'οδος_σοφος'],
      ['lower', 'οδος σοφος'],
    ],
  ],
  [
    '变量Name',
    [
      ['words', ['变量', 'Name']],
      ['snake', '变量_name'],
    ],
  ],
  [
    'hello 👋 world',
    [
      ['camel', 'helloWorld'],
      ['upper', 'HELLO 👋 WORLD'],
    ],
  ],
  [
    'x²y',
    [
      ['words', ['x²y']],
      ['upper', 'X²Y'],
    ],
  ],
  [
    'Straße',
    [
      ['lower', 'straße'],
      ['upper', 'STRASSE'],
      ['constant', 'STRASSE'],
    ],
  ],
  ['ßa', [['pascal', 'SSa']]],
  [
    'İstanbul',
    [
      ['snake', 'i̇stanbul'],
      ['constant', 'İSTANBUL'],
    ],
  ],
  ['TITLE', [['lower', 'title']]],
  [
    'İI',
    [
      ['lower', 'i̇i'],
      ['title', 'İi'],
    ],
  ],
  [
    'ﬁle name',
    [
      ['pascal', 'FIleName'],
      ['snake', 'ﬁle_name'],
    ],
  ],
  [
    'ǅemal',
    [
      ['pascal', 'Ǆemal'],
      ['lower', 'ǆemal'],
    ],
  ],
  [
    'DE-ÜBER',
    [
      ['camel', 'deÜber'],
      ['title', 'De Über'],
    ],
  ],
  [
    'a\uD800b',
    [
      ['camel', 'aB'],
      ['upper', 'A\uD800B'],
    ],
  ],
  [
    '---',
    [
      ['camel', ''],
      ['upper', '---'],
    ],
  ],
  ['', CASE_FORMS.map(f => [f.id, ''] as const)],
  [
    ' ',
    [
      ['snake', ''],
      ['lower', ' '],
    ],
  ],
  ['fooBar\r\nbaz_qux\n\n  HTTPServer\n', [['snake', 'foo_bar\r\nbaz_qux\n\nhttp_server\n']]],
  ['fooBar\n  x-y\n', [['upper', 'FOOBAR\n  X-Y\n']]],
];

const run = (input: string, form: CaseForm | 'words'): string | string[] =>
  form === 'words' ? splitWords(input) : convertCase(input, form);

describe('docs/tools/specs/case.md §10', () => {
  ROWS.forEach(([input, checks], index) => {
    it(`${JSON.stringify(input)}: ${checks.map(([f]) => f).join(' / ')}`, () => {
      for (const [form, expected] of checks) {
        expect(run(input, form), `${JSON.stringify(input)} → ${form}`).toEqual(expected);
        // The page takes every form from convertAll: it gives the same.
        if (form !== 'words') expect(convertAll(input)[form]).toBe(expected);
      }
      expect(index).toBeGreaterThanOrEqual(0);
    });
  });

  it('ends each Greek word with the final sigma U+03C2', () => {
    expect([...convertCase('ΟΔΟΣ ΣΟΦΟΣ', 'snake')].filter(c => c === 'ς')).toHaveLength(2);
    expect(convertCase('ΟΔΟΣ ΣΟΦΟΣ', 'lower')).toBe('οδος σοφος');
  });

  it('the built-in functions the "JS" rows name give the same values', () => {
    expect('ΟΔΟΣ ΣΟΦΟΣ'.toLowerCase()).toBe('οδος σοφος');
    expect('Straße'.toUpperCase()).toBe('STRASSE');
    expect('İstanbul'.toLowerCase()).toBe('i̇stanbul');
    expect('TITLE'.toLowerCase()).toBe('title');
    expect('TITLE'.toLocaleLowerCase('tr')).toBe('tıtle');
    expect('İI'.toLowerCase()).toBe('i̇i');
    expect('ﬁ'.toUpperCase()).toBe('FI');
    expect('ǅ'.toUpperCase()).toBe('Ǆ');
    expect('ǅ'.toLowerCase()).toBe('ǆ');
  });

  it('covers its 53 rows (two of them name two inputs, written here as two entries)', () => {
    expect(ROWS).toHaveLength(55);
  });
});

describe('docs/tools/specs/case.md §6', () => {
  it('an empty input: every form is empty', () => {
    expect(Object.values(convertAll(''))).toEqual(CASE_FORMS.map(() => ''));
  });

  it('only spaces, or no word characters: forms 1–11 empty, lower and upper the input', () => {
    for (const input of ['   ', '---', '__', '👋']) {
      const all = convertAll(input);
      for (const f of CASE_FORMS.slice(0, 11)) expect(all[f.id], `${input} ${f.id}`).toBe('');
      expect(all.lower).toBe(input);
      expect(all.upper).toBe(input);
    }
  });

  it('two spaces either side and three between', () => {
    expect(convertCase('  hello   world  ', 'snake')).toBe('hello_world');
  });

  it('an empty line and the last line break stay, the indent goes', () => {
    expect(convertCase('fooBar\nbaz_qux\n\n  HTTPServer\n', 'snake')).toBe('foo_bar\nbaz_qux\n\nhttp_server\n');
  });

  it('letters of any script are word characters', () => {
    expect(splitWords('привет мир')).toEqual(['привет', 'мир']);
    expect(splitWords('ÉCOLE élève')).toEqual(['ÉCOLE', 'élève']);
  });

  it('iOS splits before O; there are no exceptions for proper names', () => {
    expect(convertCase('iOS', 'snake')).toBe('i_os');
  });

  it('a lone surrogate is a separator and stays in lower and upper', () => {
    expect(convertCase('a\uD800b', 'lower')).toBe('a\uD800b');
    expect(splitWords('a\uDC00b')).toEqual(['a', 'b']);
  });
});

describe('§5 beyond the rows of §10', () => {
  it('§5.1: \\r\\n, \\n and a lone \\r are line breaks, each returned as it was', () => {
    expect(convertCase('fooBar\rbazQux\r\nx\n', 'kebab')).toBe('foo-bar\rbaz-qux\r\nx\n');
    expect(convertCase('a\n\r\nb', 'constant')).toBe('A\n\r\nB');
    expect(convertCase('\n', 'camel')).toBe('\n');
    expect(convertCase('a b\nc d', 'title')).toBe('A B\nC D');
  });

  it('§5.1: each line is converted on its own (title rules count first and last per line)', () => {
    expect(convertCase('the end\nof the line', 'title')).toBe('The End\nOf the Line');
    // Rule 1 looks for lowercase in the line itself: the second line shouts, the first does not.
    expect(convertCase('use HTTP\nUSE HTTP', 'title')).toBe('Use HTTP\nUse Http');
  });

  it('§5.2: runs of capitals and acronyms', () => {
    expect(splitWords('userID')).toEqual(['user', 'ID']);
    expect(splitWords('HTTPSProxy')).toEqual(['HTTPS', 'Proxy']);
    expect(splitWords('IOStream')).toEqual(['IO', 'Stream']);
    expect(splitWords('HTTPSServer')).toEqual(['HTTPS', 'Server']);
    expect(splitWords('PDFs')).toEqual(['PD', 'Fs']);
    expect(splitWords('ALLCAPS')).toEqual(['ALLCAPS']);
    expect(splitWords('URL2Name')).toEqual(['URL2', 'Name']);
    expect(splitWords('HTTP2Server')).toEqual(['HTTP2', 'Server']);
    expect(splitWords('parseUrl')).toEqual(['parse', 'Url']);
  });

  it('§5.2: digits stick to the letters on both sides; a break after a digit only before a capital', () => {
    expect(splitWords('v2Api')).toEqual(['v2', 'Api']);
    expect(splitWords('ipv4')).toEqual(['ipv4']);
    expect(splitWords('ipv4Address')).toEqual(['ipv4', 'Address']);
    expect(splitWords('utf8string')).toEqual(['utf8string']);
    expect(splitWords('2fa_code')).toEqual(['2fa', 'code']);
    expect(splitWords('sha256_hash')).toEqual(['sha256', 'hash']);
    expect(splitWords('version_1_2')).toEqual(['version', '1', '2']);
    expect(splitWords('x½y')).toEqual(['x½y']);
    expect(convertCase('base64Encode', 'camel')).toBe('base64Encode');
  });

  it('§5.2: repeated, leading and trailing separators do not make empty words', () => {
    expect(splitWords('__a--b..c//d  ')).toEqual(['a', 'b', 'c', 'd']);
    expect(convertCase('_private', 'camel')).toBe('private');
    expect(convertCase('--flag-name', 'snake')).toBe('flag_name');
    expect(convertCase('a___b', 'kebab')).toBe('a-b');
  });

  it('§5.2: apostrophes — inside a chunk only between word characters, never a boundary after one', () => {
    expect(splitWords("'quoted'")).toEqual(['quoted']);
    expect(splitWords("a''b")).toEqual(['a', 'b']);
    expect(splitWords("it's")).toEqual(["it's"]);
    expect(splitWords('O’Neil')).toEqual(['O’Neil']);
    expect(splitWords("D'ARTAGNAN")).toEqual(["D'ARTAGNAN"]);
    // Only U+0027 and U+2019: a modifier letter apostrophe (U+02BC) is a letter without case, a backtick a separator.
    expect(splitWords('don`t')).toEqual(['don', 't']);
    expect(convertCase("don't", 'constant')).toBe('DONT');
    expect(convertCase("don't", 'train')).toBe('Dont');
  });

  it('§5.2: marks are skipped when looking at the neighbours', () => {
    // E + U+0301 behaves as the capital É.
    expect(splitWords('caféBar')).toEqual(['café', 'Bar']);
    expect(splitWords('HTTPÉcole')).toEqual(['HTTP', 'École']);
    expect(splitWords('ÉCOLE')).toEqual(['ÉCOLE']);
    expect(convertCase('ÉCOLE élève', 'title')).toBe('ÉCOLE Élève');
  });

  it('§5.2: letters without case do not split by case, but a capital after one starts a word', () => {
    expect(splitWords('变量abc')).toEqual(['变量abc']);
    expect(splitWords('مرحباWorld')).toEqual(['مرحبا', 'World']);
    expect(splitWords('カタカナName')).toEqual(['カタカナ', 'Name']);
    expect(convertCase('变量 名字', 'camel')).toBe('变量名字');
    expect(convertCase('变量 名字', 'title')).toBe('变量 名字');
  });

  it('§5.2: code points outside the Basic Multilingual Plane are one character each', () => {
    // Deseret: U+10428 is lowercase of U+10400.
    expect(splitWords('𐐨𐐀')).toEqual(['𐐨', '𐐀']);
    expect(splitWords('a𐐀b')).toEqual(['a', '𐐀b']);
    expect(convertCase('𐐨𐐀', 'snake')).toBe('𐐨_𐐨');
    expect(convertCase('𐐨 𐐨', 'pascal')).toBe('𐐀𐐀');
    // A CJK ideograph of Extension B is a letter without case; an emoji outside the BMP is a separator.
    expect(splitWords('𠀀Name')).toEqual(['𠀀', 'Name']);
    expect(convertCase('foo😀bar', 'camel')).toBe('fooBar');
    expect(convertCase('foo😀bar', 'upper')).toBe('FOO😀BAR');
  });

  it('§5.3: case mapping does not depend on the language', () => {
    expect(convertCase('TITLE ISTANBUL', 'camel')).toBe('titleIstanbul');
    expect(convertCase('istanbul', 'constant')).toBe('ISTANBUL');
    expect(convertCase('ıi', 'upper')).toBe('II');
    expect(convertCase('STRASSE', 'lower')).toBe('strasse');
  });

  it('§5.3: "with a capital" lowers the rest of the word with its context (the final sigma)', () => {
    expect(convertCase('ΟΣ', 'pascal')).toBe('Ος');
    expect(convertCase('ΟΔΟΣ ΣΟΦΟΣ', 'title')).toBe('Οδος Σοφος');
    expect(convertCase('ΟΔΟΣ ΣΟΦΟΣ', 'camel')).toBe('οδοςΣοφος');
    expect(convertCase('élève', 'pascal')).toBe('Élève');
    expect(convertCase('ﬁle', 'pascal')).toBe('FIle');
  });

  it('§5.3: an acronym has two letters or more, all uppercase', () => {
    expect(convertCase('use A tool', 'title')).toBe('Use a Tool');
    expect(convertCase('use OS2 now', 'sentence')).toBe('Use OS2 now');
    expect(convertCase('use ÉCOLE now', 'sentence')).toBe('Use ÉCOLE now');
    expect(convertCase('the 变量AB thing', 'title')).toBe('The 变量 AB Thing');
  });

  it('§5.4.1: every short word, lowercase inside a line, capitalised first and last', () => {
    const inner = [...TITLE_SHORT_WORDS].map(w => `x ${w} y`);
    for (const line of inner) expect(convertCase(line, 'title')).toBe(`X ${line.split(' ')[1]} Y`);
    expect(TITLE_SHORT_WORDS.size).toBe(22);
    expect(convertCase('of mice and men', 'title')).toBe('Of Mice and Men');
    expect(convertCase('what to look at', 'title')).toBe('What to Look At');
    expect(convertCase('THE END OF THE ROAD', 'title')).toBe('The End of the Road');
    expect(convertCase('go with the flow from here', 'title')).toBe('Go With the Flow From Here');
    expect(convertCase('peace_and_quiet', 'title')).toBe('Peace and Quiet');
    expect(convertCase('A_TALE_OF_TWO', 'title')).toBe('A Tale of Two');
    expect(convertCase('war AND peace', 'title')).toBe('War AND Peace');
  });

  it('§5.4.2: sentence case does not add a full stop', () => {
    expect(convertCase('hello world', 'sentence')).toBe('Hello world');
    expect(convertCase('HELLO WORLD', 'sentence')).toBe('Hello world');
  });

  it('§5.5: lower and upper change only the letters', () => {
    expect(convertCase('  Foo.Bar/baz 👋\t-x-  ', 'upper')).toBe('  FOO.BAR/BAZ 👋\t-X-  ');
    expect(convertCase('  Foo.Bar/BAZ 👋\t-X-  ', 'lower')).toBe('  foo.bar/baz 👋\t-x-  ');
  });

  it('§9: the forms in interface order with their labels', () => {
    expect(CASE_FORMS.map(f => `${f.id}:${f.label}`)).toEqual([
      'camel:camelCase',
      'pascal:PascalCase',
      'snake:snake_case',
      'constant:CONSTANT_CASE',
      'kebab:kebab-case',
      'upperKebab:UPPER-KEBAB-CASE',
      'train:Train-Case',
      'dot:dot.case',
      'path:path/case',
      'title:Title Case',
      'sentence:Sentence case',
      'lower:lower case',
      'upper:UPPER CASE',
    ]);
    expect(LIVE_INPUT).toBe(65_536);
    expect(MAX_INPUT).toBe(524_288);
  });

  it('§9: convertLine is one line; convertAll is convertCase of every form', () => {
    expect(convertLine('fooBar', 'snake')).toBe('foo_bar');
    const text = 'fooBar\r\n  x-y\rHTTPServer\n\nthe end of it\n';
    const all = convertAll(text);
    for (const f of CASE_FORMS) expect(all[f.id]).toBe(convertCase(text, f.id));
  });
});

/** A small seeded generator (mulberry32): the property tests are the same on every run. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('invariants (property tests over seeded random inputs)', () => {
  // Letters with a simple one-to-one case pair (Latin, Latin-1, Cyrillic, Greek without the final sigma), digits.
  const LOWER = 'abcdefghijklmnopqrstuvwxyzéüçñøабвгдежзиклмнопрстуфхцчшщыэюяαβγδεζηθικλμνξοπρτυφχψω';
  const DIGITS = '0123456789';
  const SEPARATORS = [' ', '_', '-', '.', '/', '  ', ' - ', '\t', ', ', '__'];
  const ANY = `${LOWER}${LOWER.toUpperCase()}${DIGITS} _-./'’👋变量́ßﬁİıǅ`;
  const CODE_FORMS: readonly CaseForm[] = [
    'camel',
    'pascal',
    'snake',
    'constant',
    'kebab',
    'upperKebab',
    'train',
    'dot',
    'path',
  ];

  const LETTERS = [...LOWER];
  const CHARS = [...ANY];
  // Each property collects its counter-examples and asserts once: one `expect` per case is slow on a loaded machine.
  const failures: string[] = [];
  const same = (got: unknown, want: unknown, what: string): void => {
    if (JSON.stringify(got) !== JSON.stringify(want) && failures.length < 20)
      failures.push(`${what}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  };
  beforeEach(() => {
    failures.length = 0;
  });

  /** A word as §5.4 promises it splits back: two letters or more, starting with a cased letter, digits only at the end. */
  const word = (random: () => number): string => {
    const letters = 2 + Math.floor(random() * 6);
    let w = '';
    for (let i = 0; i < letters; i++) w += LETTERS[Math.floor(random() * LETTERS.length)];
    if (random() < 0.2) w += DIGITS[Math.floor(random() * 10)];
    return w;
  };

  const anyText = (random: () => number): string => {
    let s = '';
    const n = Math.floor(random() * 24);
    for (let i = 0; i < n; i++) s += CHARS[Math.floor(random() * CHARS.length)];
    return s;
  };

  it('the word list is the same whichever form the words came in (forms 1–9, §5.4)', () => {
    const random = seeded(14);
    for (let run = 0; run < 2_000; run++) {
      const words = Array.from({ length: 1 + Math.floor(random() * 5) }, () => word(random));
      const source = words.join(SEPARATORS[Math.floor(random() * SEPARATORS.length)]!);
      for (const form of CODE_FORMS) {
        const converted = convertLine(source, form);
        same(
          splitWords(converted).map(w => w.toLowerCase()),
          words,
          `${source} → ${form}: ${converted}`,
        );
        // And every form of the converted name gives what the source gave.
        for (const other of CASE_FORMS.slice(0, 11))
          same(convertLine(converted, other.id), convertLine(source, other.id), `${converted} → ${other.id}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('converting a converted line to the same form changes nothing', () => {
    const random = seeded(4);
    for (let run = 0; run < 5_000; run++) {
      const words = Array.from({ length: 1 + Math.floor(random() * 4) }, () => word(random));
      for (const source of [words.join(' '), anyText(random)])
        for (const form of ['snake', 'kebab', 'dot', 'path', 'lower', 'upper'] as const) {
          const once = convertLine(source, form);
          same(convertLine(once, form), once, `${JSON.stringify(source)} → ${form}`);
        }
      // The forms that capitalise or join with nothing: idempotent for words that split back, not for any text (below).
      for (const form of ['camel', 'pascal', 'train', 'constant', 'upperKebab'] as const) {
        const once = convertLine(words.join(' '), form);
        same(convertLine(once, form), once, `${words.join(' ')} → ${form}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('title and sentence case are idempotent when the result keeps a lowercase letter', () => {
    const random = seeded(10);
    for (let run = 0; run < 5_000; run++) {
      // Without ß and ﬁ, whose capital is two letters (below).
      const source = (random() < 0.5 ? anyText(random) : Array.from({ length: 3 }, () => word(random)).join(' '))
        .replaceAll('ß', 's')
        .replaceAll('ﬁ', 'f');
      for (const form of ['title', 'sentence'] as const) {
        const once = convertLine(source, form);
        if (/\p{Ll}/u.test(once)) same(convertLine(once, form), once, `${JSON.stringify(source)} → ${form}`);
      }
    }
    expect(failures).toEqual([]);
    // Where it is not: rule 1 keeps an acronym only while the line has a lowercase letter, and the result may have none.
    expect(convertLine('iOS', 'title')).toBe('I OS');
    expect(convertLine('I OS', 'title')).toBe('I Os');
  });

  it('where the word list does not survive a conversion (the specification’s §15)', () => {
    // One-letter words, and words that start with a digit or a letter without case, merge when joined with nothing.
    expect(convertLine('a b c', 'camel')).toBe('aBC');
    expect(splitWords('aBC')).toEqual(['a', 'BC']);
    expect(convertLine('aBC', 'camel')).toBe('aBc');
    expect(convertLine('version 2', 'camel')).toBe('version2');
    expect(splitWords('version2')).toEqual(['version2']);
    // In upper case a digit or a letter without case comes before a capital, which starts a word.
    expect(convertLine('2fa_code', 'constant')).toBe('2FA_CODE');
    expect(convertLine('2FA_CODE', 'snake')).toBe('2_fa_code');
    expect(convertLine('base64encode', 'constant')).toBe('BASE64ENCODE');
    expect(splitWords('BASE64ENCODE')).toEqual(['BASE64', 'ENCODE']);
    // A capital that is two letters (ß → SS, ﬁ → FI) followed by lowercase ends an acronym.
    expect(convertLine('ﬁle name', 'pascal')).toBe('FIleName');
    expect(splitWords('FIleName')).toEqual(['F', 'Ile', 'Name']);
    expect(convertLine('ßa', 'train')).toBe('SSa');
    expect(convertLine('SSa', 'train')).toBe('S-Sa');
  });

  it('lines are independent: converting a text equals converting its lines and joining them', () => {
    const random = seeded(7);
    const breaks = ['\n', '\r\n', '\r'];
    for (let run = 0; run < 500; run++) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 4) }, () => anyText(random));
      const glue = lines.map((_, i) => (i === 0 ? '' : breaks[Math.floor(random() * 3)]!));
      const text = lines.map((l, i) => glue[i] + l).join('');
      for (const f of CASE_FORMS)
        same(convertCase(text, f.id), lines.map((l, i) => glue[i] + convertLine(l, f.id)).join(''), `${text} ${f.id}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('the same answers under any locale (§5.3)', () => {
  it('Node under a Turkish locale gives what this process gives', () => {
    // logic.ts imports nothing and uses erasable syntax only, so Node runs it as it is.
    const file = fileURLToPath(new URL('./logic.ts', import.meta.url));
    const inputs = ['TITLE', 'İstanbul', 'İI', 'istanbul ILIK', 'ΟΔΟΣ ΣΟΦΟΣ', 'Straße', 'ǅemal', 'XMLHttpRequest'];
    const script = `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(JSON.stringify([Intl.DateTimeFormat().resolvedOptions().locale, 'TITLE'.toLocaleLowerCase('tr'), ${JSON.stringify(inputs)}.map(m.convertAll)]))`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', NODE_OPTIONS: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [locale, turkish, results] = JSON.parse(out) as [string, string, Array<Record<CaseForm, string>>];
    // The child really runs Turkish, and has the Turkish rules at hand — the module does not use them.
    expect(locale).toBe('tr-TR');
    expect(turkish).toBe('tıtle');
    expect(results).toEqual(inputs.map(convertAll));
    expect(results[0]!.lower).toBe('title');
    expect(results[3]!.constant).toBe('ISTANBUL_ILIK');
  });
});

describe('large input (§12) and the regular expressions on it', () => {
  const time = (f: () => unknown): number => {
    const t = performance.now();
    f();
    return performance.now() - t;
  };
  const LINE = 300_000;

  it.each([
    ['one chunk that splits every two letters', 'aB'.repeat(LINE / 2)],
    ['one acronym', 'A'.repeat(LINE)],
    ['a capital, then marks', `A${'́'.repeat(LINE - 2)}b`],
    ['capitals with marks between', 'Á'.repeat(LINE / 2)],
    ['apostrophes inside a chunk', "a'".repeat(LINE / 2)],
    ['runs of apostrophes', `a${"'".repeat(LINE - 2)}b`],
    ['separators only', '_-./ '.repeat(LINE / 5)],
    ['words and separators', 'fooBar_'.repeat(LINE / 7)],
    ['letters outside the BMP', '𐐨𐐀'.repeat(LINE / 4)],
    ['emoji', '👋a'.repeat(LINE / 3)],
    ['lone surrogates', '\uD800a'.repeat(LINE / 2)],
    ['line breaks only', '\r\n\r'.repeat(LINE / 3)],
  ])('a 300,000-character line of %s is converted in linear time', (_, line) => {
    expect(line.length).toBeGreaterThanOrEqual(LINE - 3);
    const ms = time(() => convertAll(line));
    expect(ms).toBeLessThan(1_500);
  });

  it('the largest accepted input (512 Ki) converts all 13 forms within a second', () => {
    const big = 'someVariableName42 HTTPServer_value-x 17\n'.repeat(Math.ceil(MAX_INPUT / 41)).slice(0, MAX_INPUT);
    convertAll(big.slice(0, 1000));
    const ms = time(() => convertAll(big));
    expect(ms).toBeLessThan(1_000);
  });

  it('a 1 MB worst case stays linear', () => {
    const worst = 'Aá'.repeat(350_000);
    const ms = time(() => convertAll(worst));
    expect(ms).toBeLessThan(3_000);
  });
});
