/**
 * docs/tools/specs/code-format.md §10, row by row, with the libraries the tool ships (Prettier 3.9.10 standalone and its
 * plugins, saxes 6.0.0) loaded here in Node and handed to the logic the way the tool's worker hands them; §6 and §7.
 */
import {
  DEFAULT_SETTINGS,
  HTML_NOTE,
  LANGUAGES,
  LANGUAGE_EXTENSIONS,
  LARGE_MESSAGE,
  MAX_INPUT,
  OPTIONS_OF,
  PRETTIER_PLUGINS,
  RESULT_TOO_LARGE_MESSAGE,
  TOO_DEEP_MESSAGE,
  UNDETECTED_MESSAGE,
  decodeTextFile,
  describeText,
  detectCodeFormat,
  detectLanguage,
  effectiveIndent,
  formatWithPrettier,
  formatXml,
  languageOfFile,
  loadingMessage,
  mapPrettierError,
  positionOf,
  prettierOptions,
  printXml,
  tooLargeMessage,
} from './index';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as html from 'prettier/plugins/html';
import * as markdown from 'prettier/plugins/markdown';
import * as postcss from 'prettier/plugins/postcss';
import * as yaml from 'prettier/plugins/yaml';
import * as prettier from 'prettier/standalone';
import { SaxesParser } from 'saxes';
import { describe, expect, it } from 'vitest';
import type { CodeLanguage, FormatResult, FormatSettings, SaxParserClass } from './index';

const MODULES = { babel, estree, postcss, html, markdown, yaml };

const format = (
  language: CodeLanguage,
  text: string,
  settings: Partial<FormatSettings> = {},
): Promise<FormatResult> => {
  const all = { ...DEFAULT_SETTINGS, ...settings };
  if (language === 'xml') return Promise.resolve(formatXml(SaxesParser as unknown as SaxParserClass, text, all.indent));
  return formatWithPrettier(
    prettier,
    PRETTIER_PLUGINS[language].map(name => MODULES[name]),
    language,
    text,
    all,
  );
};
const ok = async (language: CodeLanguage, text: string, settings: Partial<FormatSettings> = {}): Promise<string> => {
  const r = await format(language, text, settings);
  if (!r.ok) throw new Error(`expected a result, got ${JSON.stringify(r.error)}`);
  return r.text;
};
/** `L:C message`, as the page shows it after `Line L, column C: `. */
const fails = async (language: CodeLanguage, text: string, settings: Partial<FormatSettings> = {}): Promise<string> => {
  const r = await format(language, text, settings);
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.text)}`);
  return 'line' in r.error ? `${r.error.line}:${r.error.column} ${r.error.message}` : r.error.message;
};

describe('§10 JavaScript', () => {
  it('formats with the defaults', async () => {
    expect(await ok('javascript', 'const a={b:1,c:[1,2,3]};function f(x){return x*2}')).toBe(
      'const a = { b: 1, c: [1, 2, 3] };\nfunction f(x) {\n  return x * 2;\n}\n',
    );
  });

  it('4 spaces, single quotes, no semicolons, no trailing commas, width 40', async () => {
    expect(
      await ok('javascript', "const someLongName = callSomething(argumentOne, 'two', argumentThree);", {
        indent: 4,
        singleQuote: true,
        semi: false,
        trailingComma: 'none',
        lineWidth: 40 as 80,
      }),
    ).toBe("const someLongName = callSomething(\n    argumentOne,\n    'two',\n    argumentThree\n)\n");
  });

  it('trailing commas: ES5 and All at width 40', async () => {
    const call = 'f(aaaaaaaaaaaa, bbbbbbbbbbbbbbbb, cccccccccccccccc)';
    expect(await ok('javascript', call, { trailingComma: 'es5', lineWidth: 40 as 80 })).toBe(
      'f(\n  aaaaaaaaaaaa,\n  bbbbbbbbbbbbbbbb,\n  cccccccccccccccc\n);\n',
    );
    expect(await ok('javascript', call, { trailingComma: 'all', lineWidth: 40 as 80 })).toBe(
      'f(\n  aaaaaaaaaaaa,\n  bbbbbbbbbbbbbbbb,\n  cccccccccccccccc,\n);\n',
    );
  });

  it('Tab', async () => {
    expect(await ok('javascript', 'if(a){b()}', { indent: 'tab' })).toBe('if (a) {\n\tb();\n}\n');
  });

  it('JSX without a mode of its own', async () => {
    expect(await ok('javascript', 'const A=()=><div className="x"><span>{a}</span></div>')).toBe(
      'const A = () => (\n  <div className="x">\n    <span>{a}</span>\n  </div>\n);\n',
    );
  });

  it('keeps comments', async () => {
    expect(await ok('javascript', '// hi\nconst a=1 /* c */')).toBe('// hi\nconst a = 1; /* c */\n');
  });

  it('errors at their place, the column in UTF-16 units (§6)', async () => {
    expect(await fails('javascript', 'const a = {\n  b: 1,,\n};')).toBe('2:8 Unexpected token');
    expect(await fails('javascript', 'const s = "🙂🙂"; let = ;')).toBe('1:25 Unexpected token');
    expect(await fails('javascript', 'function f( {')).toBe('1:14 Unexpected token');
  });
});

describe('§10 TypeScript (babel-ts)', () => {
  it('interfaces and enums', async () => {
    expect(await ok('typescript', 'interface A{a:number;b?:string}\nenum E{A,B}')).toBe(
      'interface A {\n  a: number;\n  b?: string;\n}\nenum E {\n  A,\n  B,\n}\n',
    );
  });

  it('a generic arrow function and TSX', async () => {
    expect(await ok('typescript', 'const t=<T,>(a:T):T=>a')).toBe('const t = <T,>(a: T): T => a;\n');
    expect(await ok('typescript', 'const a = <Row key={i.id} {...i} />')).toBe(
      'const a = <Row key={i.id} {...i} />;\n',
    );
  });

  it('an error at its place', async () => {
    expect(await fails('typescript', 'let a: = 1')).toBe('1:8 Unexpected token');
  });

  // §5 п. 2: of fourteen samples, three behave differently with Prettier's typescript parser; with babel-ts these are
  // the results (the typescript module is not shipped, so the comparison itself is the specification's, not repeated).
  // `using` and a class's `accessor` are read (corrected in §15: the probe put `accessor` outside a class).
  it('the §5 п. 2 cases: super() without extends is refused, an old-style cast, using and accessor are read', async () => {
    expect(await fails('typescript', 'class A { constructor() { super(); } }')).toMatch(
      /^1:27 `super\(\)` is only valid/,
    );
    expect(await ok('typescript', 'const v = <string>w;')).toBe('const v = <string>w;\n');
    expect(await ok('typescript', 'using r = open();')).toBe('using r = open();\n');
    expect(await ok('typescript', 'class A { accessor x = 1 }')).toBe('class A {\n  accessor x = 1;\n}\n');
  });
});

describe('§10 CSS, SCSS, LESS', () => {
  it('minified CSS (§2.1)', async () => {
    expect(await ok('css', 'a{color:red;background:BLUE}b,c{margin:0 0 0 0}')).toBe(
      'a {\n  color: red;\n  background: BLUE;\n}\nb,\nc {\n  margin: 0 0 0 0;\n}\n',
    );
  });

  it('single quotes', async () => {
    expect(await ok('css', 'a{font-family:"Inter"}', { singleQuote: true })).toBe("a {\n  font-family: 'Inter';\n}\n");
  });

  it('errors at their place, the column in UTF-16 units', async () => {
    expect(await fails('css', 'a{color:red')).toBe('1:1 Unclosed block');
    expect(await fails('css', 'a{color:red;}}')).toBe('1:14 Unexpected }');
    expect(await fails('css', '/* 🙂🙂 */ a{color:red;}}')).toBe('1:25 Unexpected }');
  });

  it('SCSS and LESS', async () => {
    expect(await ok('scss', '$c:red;.a{&:hover{color:$c}@include m(1)}')).toBe(
      '$c: red;\n.a {\n  &:hover {\n    color: $c;\n  }\n  @include m(1);\n}\n',
    );
    expect(await ok('less', '@c:red;.a{.m();&:hover{color:@c}}')).toBe(
      '@c: red;\n.a {\n  .m();\n  &:hover {\n    color: @c;\n  }\n}\n',
    );
  });
});

describe('§10 HTML', () => {
  it('a document', async () => {
    expect(
      await ok(
        'html',
        '<!doctype html><html><head><title>x</title></head><body><div><p>Hello <b>world</b></p></div></body></html>',
      ),
    ).toBe(
      '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body>\n    <div>\n      <p>Hello <b>world</b></p>\n    </div>\n  </body>\n</html>\n',
    );
  });

  it('code in <script>, <style> and style attributes is formatted', async () => {
    expect(await ok('html', '<div><script>let a={b:1}</script><style>a{color:red}</style></div>')).toBe(
      '<div>\n  <script>\n    let a = { b: 1 };\n  </script>\n  <style>\n    a {\n      color: red;\n    }\n  </style>\n</div>\n',
    );
    expect(await ok('html', '<div style="color:red;margin:0"></div>')).toBe(
      '<div style="color: red; margin: 0"></div>\n',
    );
  });

  it('a script that does not parse is left as it is, with no error (§5 п. 3)', async () => {
    expect(await ok('html', '<div><script>let a = {;</script></div>')).toBe(
      '<div>\n  <script>\n    let a = {;\n  </script>\n</div>\n',
    );
  });

  it('an unexpected closing tag at its place', async () => {
    expect(await fails('html', '<div>\n<span>a</p>\n</div>')).toBe(
      '2:8 Unexpected closing tag "p". It may happen when the tag has already been closed by another tag.',
    );
  });

  it('Whitespace: Ignore and CSS', async () => {
    const text = '<div><span>a</span> <span>b</span></div>';
    expect(await ok('html', text, { whitespace: 'ignore' })).toBe(
      '<div>\n  <span>a</span>\n  <span>b</span>\n</div>\n',
    );
    expect(await ok('html', text, { whitespace: 'css' })).toBe('<div><span>a</span> <span>b</span></div>\n');
  });

  it('HTML rules, not XML: an implied end tag is no error', async () => {
    expect(await ok('html', '<div><p>x</div>')).toBe('<div><p>x</p></div>\n');
  });
});

describe('§10 Markdown', () => {
  it('lists and a table', async () => {
    expect(await ok('markdown', '# Title\n*  one\n*  two\n\n| a | b |\n|-|-|\n| long cell | x |')).toBe(
      '# Title\n\n- one\n- two\n\n| a         | b   |\n| --------- | --- |\n| long cell | x   |\n',
    );
  });

  it('Prose wrap: Always at width 40', async () => {
    expect(
      await ok('markdown', 'A long paragraph of text that goes on and on beyond the width limit for sure.', {
        proseWrap: 'always',
        lineWidth: 40 as 80,
      }),
    ).toBe('A long paragraph of text that goes on\nand on beyond the width limit for sure.\n');
  });

  it('code blocks are not formatted (§5 п. 4)', async () => {
    expect(await ok('markdown', '```js\nconst a={b:1}\n```')).toBe('```js\nconst a={b:1}\n```\n');
  });
});

describe('§10 YAML', () => {
  it('keeps comments, aligns indents and spaces', async () => {
    expect(await ok('yaml', 'a:   1\nlist:\n- x\n-   y\n# comment\nb: {c: 1, d: [1,2]}')).toBe(
      'a: 1\nlist:\n  - x\n  - y\n# comment\nb: { c: 1, d: [1, 2] }\n',
    );
  });

  it('4 spaces; Tab falls back to 2 spaces', async () => {
    expect(await ok('yaml', 'a:\n  b:\n    - 1', { indent: 4 })).toBe('a:\n    b:\n        - 1\n');
    expect(await ok('yaml', 'a:\n    b: 1', { indent: 'tab' })).toBe('a:\n  b: 1\n');
  });

  it('an error at its place', async () => {
    expect(await fails('yaml', 'a: [1, 2\nb: 3')).toBe(
      '2:1 Flow sequence in block collection must be sufficiently indented and end with a ]',
    );
  });
});

describe('§10 XML (saxes and the printer)', () => {
  it('a SOAP-like answer: each element on its own line, mixed content on one (§2.4)', async () => {
    expect(
      await ok(
        'xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><note id="1"><to>Ann</to><body>Hi <b>there</b></body><empty/></note>',
      ),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<note id="1">\n  <to>Ann</to>\n  <body>Hi <b>there</b></body>\n  <empty/>\n</note>\n',
    );
  });

  it('4 spaces and Tab', async () => {
    expect(await ok('xml', '<a><b>t</b></a>', { indent: 4 })).toBe('<a>\n    <b>t</b>\n</a>\n');
    expect(await ok('xml', '<a><b>t</b></a>', { indent: 'tab' })).toBe('<a>\n\t<b>t</b>\n</a>\n');
  });

  it('DOCTYPE, a processing instruction and CDATA', async () => {
    expect(
      await ok('xml', '<!DOCTYPE note SYSTEM "Note.dtd"><?xml-stylesheet href="a.css"?><note><![CDATA[x < y]]></note>'),
    ).toBe('<!DOCTYPE note SYSTEM "Note.dtd">\n<?xml-stylesheet href="a.css"?>\n<note><![CDATA[x < y]]></note>\n');
  });

  it('entities of the internal subset', async () => {
    expect(await ok('xml', '<!DOCTYPE a [<!ENTITY e "x">]><a>&e; &amp; &#169;</a>')).toBe(
      '<!DOCTYPE a [<!ENTITY e "x">]>\n<a>&e; &amp; &#169;</a>\n',
    );
  });

  it('namespaces as written', async () => {
    expect(await ok('xml', '<r xmlns:h="http://www.w3.org/TR/html4/"><h:td>x</h:td></r>')).toBe(
      '<r xmlns:h="http://www.w3.org/TR/html4/">\n  <h:td>x</h:td>\n</r>\n',
    );
  });

  it('text keeps its spaces', async () => {
    expect(await ok('xml', '<a>\n   <b>  spaced   text  </b>\n</a>')).toBe('<a>\n  <b>  spaced   text  </b>\n</a>\n');
  });

  it('tags: one space between attributes, the quotes as written, /> with no space', async () => {
    expect(await ok('xml', `<a  x="1"   y='2' ><b></b><c\n   z="3"/></a>`)).toBe(
      `<a x="1" y='2'>\n  <b></b>\n  <c z="3"/>\n</a>\n`,
    );
  });

  it('xml:space="preserve" keeps its content on one line', async () => {
    expect(await ok('xml', '<a><pre xml:space="preserve">  x\n  y</pre><b>c</b></a>')).toBe(
      '<a>\n  <pre xml:space="preserve">  x\n  y</pre>\n  <b>c</b>\n</a>\n',
    );
  });

  it('errors just after the construct the parser stumbled on (§5 п. 9)', async () => {
    expect(await fails('xml', '<a>\n  <b></a>')).toBe('2:10 unexpected close tag');
    expect(await fails('xml', '<a><b>')).toBe('1:7 unclosed tag: b');
    expect(await fails('xml', '<a/><b/>')).toBe('1:8 documents may contain only one root');
    expect(await fails('xml', '<a x=1/>')).toBe('1:7 unquoted attribute value');
    expect(await fails('xml', '<a x="1" x="2"/>')).toBe('1:17 duplicate attribute: x');
    expect(await fails('xml', '<a>&nbsp;</a>')).toBe('1:10 undefined entity');
    expect(await fails('xml', '<a>1 < 2</a>')).toBe('1:8 disallowed character in tag name');
    expect(await fails('xml', '<a>🙂</b>')).toBe('1:10 unexpected close tag');
    expect(await fails('xml', 'hello')).toBe('1:6 text data outside of root node');
  });

  it('CRLF and CR line ends become LF, also inside content kept as written (§3)', async () => {
    expect(await ok('xml', '<a>\r\n<b xml:space="preserve">x\r\ny\rz</b>\r\n</a>')).toBe(
      '<a>\n  <b xml:space="preserve">x\ny\nz</b>\n</a>\n',
    );
    expect(await fails('xml', '<a>\r\n  <b></a>')).toBe('2:10 unexpected close tag');
  });

  it('an element holding only whitespace prints empty; comments inside an element keep their line', () => {
    expect(printXml('<a>\n  <b>  </b>\n  <!-- c -->\n  <c/>\n</a>', 2)).toBe(
      '<a>\n  <b></b>\n  <!-- c -->\n  <c/>\n</a>\n',
    );
  });

  it('deep nesting: saxes and the printer do not recurse; a result over the limit is refused in words', async () => {
    const deep = (n: number) => `${'<a>'.repeat(n)}x${'</a>'.repeat(n)}`;
    const printed = await ok('xml', deep(2_000));
    expect(printed.split('\n')).toHaveLength(2_000 * 2);
    expect(printed.split('\n')[1_999]).toBe(`${'  '.repeat(1_999)}<a>x</a>`);
    expect(printXml(deep(3_000), 2, 1_000_000)).toBeNull();
    expect(await fails('xml', deep(100_000))).toBe(RESULT_TOO_LARGE_MESSAGE);
  });

  it('prints in time linear in the input (a quadratic printer would fail here)', () => {
    const doc = (n: number) => `<r>${'<item id="1"><name>x</name><v>1</v></item>'.repeat(n)}</r>`;
    const time = (text: string) => {
      const start = performance.now();
      printXml(text, 2);
      return performance.now() - start;
    };
    time(doc(2_000));
    const small = Math.max(time(doc(10_000)), 1);
    const big = time(doc(160_000));
    // 16 times the input: a linear printer takes about 16 times as long, a quadratic one about 256 times.
    expect(big / small).toBeLessThan(80);
  });
});

describe('§10 the empty input', () => {
  it.each(LANGUAGES)('%s: blank input, blank result', async language => {
    expect(await ok(language, '   ')).toBe('');
    expect(await ok(language, '')).toBe('');
  });
});

describe('§5 п. 1 and §4: languages, modules and options', () => {
  it('maps each language to its parser and its Prettier plugins', () => {
    expect(PRETTIER_PLUGINS).toEqual({
      javascript: ['babel', 'estree'],
      typescript: ['babel', 'estree'],
      css: ['postcss'],
      scss: ['postcss'],
      less: ['postcss'],
      html: ['html', 'babel', 'estree', 'postcss'],
      markdown: ['markdown'],
      yaml: ['yaml'],
    });
    expect(prettierOptions('typescript', DEFAULT_SETTINGS)).toMatchObject({ parser: 'babel-ts' });
    expect(prettierOptions('javascript', DEFAULT_SETTINGS)).toEqual({
      parser: 'babel',
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: false,
      trailingComma: 'all',
    });
    expect(prettierOptions('css', DEFAULT_SETTINGS)).toEqual({
      parser: 'css',
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      singleQuote: false,
    });
    expect(prettierOptions('html', { ...DEFAULT_SETTINGS, whitespace: 'strict' })).toEqual({
      parser: 'html',
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      htmlWhitespaceSensitivity: 'strict',
    });
    expect(prettierOptions('markdown', { ...DEFAULT_SETTINGS, proseWrap: 'never', lineWidth: 120 })).toEqual({
      parser: 'markdown',
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
      proseWrap: 'never',
    });
    expect(prettierOptions('yaml', { ...DEFAULT_SETTINGS, indent: 'tab', singleQuote: true })).toEqual({
      parser: 'yaml',
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
      singleQuote: true,
    });
  });

  it('the defaults of §4', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      indent: 2,
      lineWidth: 80,
      semi: true,
      singleQuote: false,
      trailingComma: 'all',
      whitespace: 'css',
      proseWrap: 'preserve',
    });
  });

  it('which options each language shows (§4, §8)', () => {
    const shown = (l: CodeLanguage) =>
      Object.entries(OPTIONS_OF[l])
        .filter(([, on]) => on)
        .map(([name]) => name);
    expect(shown('javascript')).toEqual(['tabs', 'lineWidth', 'semi', 'quotes', 'trailingComma']);
    expect(shown('typescript')).toEqual(shown('javascript'));
    expect(shown('css')).toEqual(['tabs', 'lineWidth', 'quotes']);
    expect(shown('html')).toEqual(['tabs', 'lineWidth', 'whitespace']);
    expect(shown('markdown')).toEqual(['tabs', 'lineWidth', 'proseWrap']);
    expect(shown('yaml')).toEqual(['lineWidth', 'quotes']);
    expect(shown('xml')).toEqual(['tabs']);
    expect(effectiveIndent('yaml', 'tab')).toBe(2);
    expect(effectiveIndent('xml', 'tab')).toBe('tab');
  });

  it('a file extension chooses the language (§3)', () => {
    const cases: Array<[string, CodeLanguage | null]> = [
      ['a.js', 'javascript'],
      ['a.MJS', 'javascript'],
      ['a.cjs', 'javascript'],
      ['A.jsx', 'javascript'],
      ['a.ts', 'typescript'],
      ['a.mts', 'typescript'],
      ['a.cts', 'typescript'],
      ['a.tsx', 'typescript'],
      ['a.css', 'css'],
      ['a.scss', 'scss'],
      ['a.less', 'less'],
      ['index.html', 'html'],
      ['index.htm', 'html'],
      ['a.xml', 'xml'],
      ['a.svg', 'xml'],
      ['a.xsd', 'xml'],
      ['a.xsl', 'xml'],
      ['a.xslt', 'xml'],
      ['Info.plist', 'xml'],
      ['README.md', 'markdown'],
      ['a.markdown', 'markdown'],
      ['a.yaml', 'yaml'],
      ['a.yml', 'yaml'],
      ['a.json', null],
      ['Makefile', null],
      ['a.txt', null],
    ];
    for (const [name, language] of cases) expect([name, languageOfFile(name)]).toEqual([name, language]);
    expect(LANGUAGE_EXTENSIONS.markdown).toBe('md');
    expect(LANGUAGE_EXTENSIONS.javascript).toBe('js');
  });

  it('a file is strict UTF-8', () => {
    expect(decodeTextFile(new TextEncoder().encode('\uFEFFa: 1'))).toEqual({ ok: true, text: 'a: 1' });
    expect(decodeTextFile(new Uint8Array([0x61, 0xff, 0x62]))).toEqual({
      ok: false,
      message: 'The file is not valid UTF-8 text.',
    });
  });
});

describe('§6 the texts', () => {
  it('limits per language, words of §6 and §12', () => {
    expect(tooLargeMessage('javascript')).toBe(
      'Input is larger than 2 MB. Formatting works with up to 2 MB of JavaScript.',
    );
    expect(tooLargeMessage('markdown')).toBe(
      'Input is larger than 256 KB. Formatting works with up to 256 KB of Markdown.',
    );
    expect(tooLargeMessage('xml')).toBe('Input is larger than 8 MB. Formatting works with up to 8 MB of XML.');
    expect(MAX_INPUT.yaml).toBe(2 * 1024 * 1024);
    expect(tooLargeMessage('less')).toBe('Input is larger than 256 KB. Formatting works with up to 256 KB of LESS.');
    expect(RESULT_TOO_LARGE_MESSAGE).toBe('The result would be larger than 64 MB.');
    expect(LARGE_MESSAGE).toBe('Large input: press Run (Ctrl+Enter) to format it.');
    expect(UNDETECTED_MESSAGE).toBe("Choose a language: this text doesn't look like any of them.");
    expect(HTML_NOTE).toBe("Code inside <script> and <style> that doesn't parse is left as it is.");
    expect(loadingMessage('css')).toBe('Loading the CSS formatter…');
  });

  it('a Prettier error: the first line, without (L:C), CssSyntaxError: and the address; the place from loc', () => {
    expect(
      mapPrettierError('a\nbc', {
        message: 'CssSyntaxError: Unknown word (2:2) For more info see https://example.com/x\n> 1 | a',
        loc: { start: { line: 2, column: 2 } },
      }),
    ).toEqual({ message: 'Unknown word', offset: 3, line: 2, column: 2 });
    expect(
      mapPrettierError('a', { message: 'Unclosed block (1:1)\n  > 1 | a{', loc: { start: { line: 1, column: 1 } } }),
    ).toEqual({ message: 'Unclosed block', offset: 0, line: 1, column: 1 });
    expect(mapPrettierError('a', { message: 'Something without a place' })).toEqual({
      message: 'Something without a place',
    });
    expect(mapPrettierError('a', { name: 'RangeError', message: 'Maximum call stack size exceeded' })).toEqual({
      message: TOO_DEEP_MESSAGE,
    });
    expect(mapPrettierError('a', { name: 'RangeError', message: 'Invalid string length' })).toEqual({
      message: RESULT_TOO_LARGE_MESSAGE,
    });
    // CRLF line ends count as one.
    expect(mapPrettierError('a\r\nbc', { message: 'X (2:2)', loc: { start: { line: 2, column: 2 } } })).toEqual({
      message: 'X',
      offset: 4,
      line: 2,
      column: 2,
    });
  });

  it('positions in UTF-16 units', () => {
    expect(positionOf('🙂x\ny', 3)).toEqual({ line: 1, column: 4 });
    expect(positionOf('a\r\nb\rc', 6)).toEqual({ line: 3, column: 2 });
  });

  it('describes a result', () => {
    expect(describeText('javascript', 'a;\nb;\n')).toBe('JavaScript · 2 lines');
    expect(describeText('xml', '<a/>\n')).toBe('XML · 1 line');
  });
});

describe('§7 detectLanguage', () => {
  const samples: Array<[string, CodeLanguage | null]> = [
    ['<?xml version="1.0"?><a/>', 'xml'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0"/></svg>', 'xml'],
    ['<note><to>A</to></note>', 'xml'],
    ['<!DOCTYPE html><html></html>', 'html'],
    ['<div class="x">hi</div>', 'html'],
    ['# Title\n\nText', 'markdown'],
    ['```js\nx\n```', 'markdown'],
    ['a{color:red}', 'css'],
    ['.a { margin: 0; }\n@media (max-width: 600px) { .a { margin: 1px } }', 'css'],
    ['$c: red;\n.a { color: $c; }', 'scss'],
    ['.a { @include m; }', 'scss'],
    ['@c: red;\n.a { color: @c; }', 'less'],
    ['.a { .mixin(); }', 'less'],
    ['interface A { a: number }', 'typescript'],
    ['function f(a: string): void {}', 'typescript'],
    ['const x = [1, 2] as const;', 'typescript'],
    ['const a = 1;', 'javascript'],
    ['import x from "y"', 'javascript'],
    ['function f() { return 1 }', 'javascript'],
    ['a: 1\nb: [1, 2]', 'yaml'],
    ['hello world', null],
    ['{"a": 1}', null],
    ['SELECT * FROM t', null],
    ['id,name\n1,Ann', null],
  ];
  it.each(samples)('%j → %s (24 of 24)', (text, language) => {
    expect(detectLanguage(text)).toBe(language);
  });

  it('more of §5 п. 7: the BOM and leading whitespace, comments before HTML, an arrow function, JSON with keywords', () => {
    expect(detectLanguage('\uFEFF  \n<?xml version="1.0"?><a/>')).toBe('xml');
    expect(detectLanguage('<!-- top -->\n<div>x</div>')).toBe('html');
    expect(detectLanguage('<svg><div>x</div></svg>')).toBe('html');
    expect(detectLanguage('items.map(x => x * 2)')).toBe('javascript');
    expect(detectLanguage('{"function": "return", "const": 1}')).toBeNull();
    expect(detectLanguage('[1, 2, 3]')).toBeNull();
    expect(detectLanguage('type Point = { x: number }')).toBe('typescript');
    expect(detectLanguage('a\n{ color: red }')).toBe('css');
    expect(detectLanguage('---\n# Front\n')).toBe('markdown');
    expect(detectLanguage('   ')).toBeNull();
  });

  it('only the first 16 Ki characters are looked at', () => {
    expect(detectLanguage(`${' '.repeat(10)}${'x '.repeat(9000)}const a = 1;`)).toBeNull();
  });

  it('stays linear on hostile input (a backtracking expression would take seconds)', () => {
    const hostile = [
      `a{${':'.repeat(200_000)}`,
      'a\n'.repeat(200_000),
      `type X${' '.repeat(200_000)}`,
      `@a:${'x'.repeat(200_000)}`,
      `<!--${'<!--'.repeat(50_000)}`,
      '\n'.repeat(400_000),
      ` ${'$'.repeat(200_000)}`,
    ];
    for (const text of hostile) {
      const start = performance.now();
      detectLanguage(text);
      detectCodeFormat(text);
      expect(performance.now() - start, text.slice(0, 20)).toBeLessThan(1_000);
    }
  });
});

describe('§7 detect: the registry’s, not taking other tools’ input', () => {
  it('YAML is yaml-json’s; one-line HTML is left to html-entities and html-to-jsx', () => {
    expect(detectCodeFormat('a: 1\nb: [1, 2]')).toBe(false);
    expect(detectCodeFormat('apiVersion: v1\nkind: Pod\nmetadata:\n  name: web')).toBe(false);
    expect(detectCodeFormat('<div class="x">hi</div>')).toBe(false);
    expect(detectCodeFormat('<!DOCTYPE html><html></html>')).toBe(true);
    expect(detectCodeFormat('<div>\n  <p>hi</p>\n</div>')).toBe(true);
    expect(detectCodeFormat('<note><to>A</to></note>')).toBe(true);
    // A one-line element that is not on the HTML list is XML, and XML has no one-line exception (§15).
    expect(detectCodeFormat('<b>bold</b>')).toBe(true);
    expect(detectCodeFormat('a{color:red}')).toBe(true);
    expect(detectCodeFormat('const a = 1;')).toBe(true);
    expect(detectCodeFormat('# Title\n\nText')).toBe(true);
  });

  it('says no to the other tools’ inputs', () => {
    const others = [
      '{"a": 1}', // json
      '[{"id": 1, "name": "Ann"}]', // json
      'SGVsbG8sIHdvcmxkIQ==', // base64
      'https://example.com/a?b=c&d=e', // url
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', // jwt
      '1700000000', // unix-time
      '2026-11-22T10:00:00Z', // unix-time
      '0190d6a8-8c5e-7c3b-9f5e-2b1c3d4e5f60', // uuid
      'SELECT id, name FROM users WHERE id = 1', // sql-format
      'id,name\n1,Ann\n2,Bob', // json-csv
      '0 9 * * 1-5', // cron
      '#ff8800', // color
      'rgb(255 136 0)', // color
      'helloWorld', // case
      '0x1F', // number-base
      '48656c6c6f', // hex-ascii
      '&lt;div&gt; &amp; &copy;', // html-entities
      '"He said \\"hi\\"\\n"', // backslash-escape
      'apple\nbanana\ncherry', // lines
      'hello world', // nothing
    ];
    for (const text of others) expect([text, detectCodeFormat(text)]).toEqual([text, false]);
  });
});
