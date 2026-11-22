// The pasted CSS made to load nothing (css.ts; docs/tools/specs/html-preview.md §5.2 step 2, §15): every way CSS
// reaches an address — url() in every property and spelling, image-set(), image(), src(), cross-fade(), @import,
// @namespace, @font-face — is cut whole; what does not load stays exactly as written; references into the document
// (`url(#id)`) stay in the properties that take them without a fetch.
import { attributeLoads, cleanCss, cssLoads } from './css';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';

const sheet = (css: string) => cleanCss(css, 'sheet');
const decls = (css: string) => cleanCss(css, 'declarations');
/** Is there anything left that a browser would fetch? (`url(#…)` aside.) */
const loadsAnything = (css: string) => cssLoads(css);

describe('cleanCss: what loads is cut, every spelling', () => {
  const urls = [
    'url(http://x.invalid/a.png)',
    'URL(http://x.invalid/a.png)',
    'url( "http://x.invalid/a.png" )',
    "url('http://x.invalid/a.png')",
    'url(\n"http://x.invalid/a.png"\n)',
    '\\75 rl(http://x.invalid/a.png)',
    'u\\72l(http://x.invalid/a.png)',
    '\\55 RL(http://x.invalid/a.png)',
    'url(http://x.invalid/a b)',
    'url(http://x.invalid/a"b)',
    'url(http://x.invalid/\\)a.png)',
    'image-set("http://x.invalid/a.png" 1x)',
    '-webkit-image-set(url(http://x.invalid/a.png) 1x)',
    'IMAGE-SET("http://x.invalid/a.png" type("image/png"))',
    'image("http://x.invalid/a.png")',
    'cross-fade(url(http://x.invalid/a.png), red 50%)',
    '-webkit-cross-fade(url(http://x.invalid/a.png), url(http://x.invalid/b.png), 50%)',
    'src("http://x.invalid/a.png")',
    'element(#x)',
    'expression(alert(1))',
    'attr(data-u url)',
  ];
  const properties = [
    'background',
    'background-image',
    'list-style',
    'list-style-image',
    'cursor',
    'content',
    'mask',
    'mask-image',
    '-webkit-mask-image',
    '-webkit-mask-box-image',
    'border-image',
    'border-image-source',
    'filter',
    'shape-outside',
    'offset-path',
    'clip-path',
    '--custom',
  ];

  it.each(urls)('%s — in every property, in a sheet and in a style attribute', value => {
    for (const property of properties) {
      const rule = `p { color: red; ${property}: ${value}; margin: 0 }`;
      const s = sheet(rule);
      expect(s.css, rule).toBe('p { color: red; margin: 0 }');
      expect(s.removed).toBe(1);
      const d = decls(`color: red; ${property}: ${value}; margin: 0`);
      expect(d.css).toBe('color: red; margin: 0');
      expect(loadsAnything(s.css) || loadsAnything(d.css)).toBe(false);
    }
  });

  it('a url left open runs to the end of the text, as the browser reads it', () => {
    expect(sheet('p { color: red; background: url(http://x.invalid/a.png; margin: 0 }').css).toBe('p { color: red;');
  });

  it('the last declaration of a block, without its semicolon', () => {
    expect(sheet('a{color:red;background:url(x)}').css).toBe('a{color:red;}');
    expect(decls('color:red;background:url(x)').css).toBe('color:red;');
  });

  it('@import in every form, counted; @namespace too', () => {
    for (const rule of [
      '@import url(http://x.invalid/a.css);',
      '@import "http://x.invalid/a.css";',
      "@IMPORT 'http://x.invalid/a.css' screen;",
      '@\\69mport "http://x.invalid/a.css";',
      '@import url(http://x.invalid/a.css) layer(base) supports(display: grid) screen;',
    ]) {
      const s = sheet(`${rule} .a{color:blue}`);
      expect(s.css, rule).toBe(' .a{color:blue}');
      expect(s.imports).toBe(1);
    }
    expect(sheet('@media screen { @import "x.css"; .a{color:blue} }').css).toBe('@media screen { .a{color:blue} }');
    expect(sheet('@namespace svg url(http://www.w3.org/2000/svg); a{color:red}').css).toBe(' a{color:red}');
    expect(sheet('@import "a.css"').imports).toBe(1);
  });

  it('@font-face loses its src; local() alone is kept', () => {
    expect(
      sheet("@font-face { font-family: X; src: url(http://x.invalid/a.woff2) format('woff2'), local(Arial); }").css,
    ).toBe('@font-face { font-family: X; }');
    expect(sheet('@font-face { font-family: X; src: local(Arial); }').css).toBe(
      '@font-face { font-family: X; src: local(Arial); }',
    );
  });

  it('other at-rules that take an image or an address: @counter-style, @page, @property', () => {
    expect(sheet('@counter-style c { system: cyclic; symbols: url(http://x.invalid/a.png); }').css).toBe(
      '@counter-style c { system: cyclic; }',
    );
    expect(sheet('@page { margin: 1cm; background: url(http://x.invalid/a.png) }').css).toBe('@page { margin: 1cm;}');
    expect(
      sheet("@property --x { syntax: '<image>'; inherits: false; initial-value: url(http://x.invalid/a.png) }").css,
    ).toBe("@property --x { syntax: '<image>'; inherits: false;}");
  });

  it('inside @media, @supports, @layer, @container and nested rules', () => {
    expect(
      sheet(
        '@media (min-width: 600px) { .a { background: url(x); color: red } @supports (display:grid) { .b { cursor: url(c.cur), auto } } }',
      ).css,
    ).toBe('@media (min-width: 600px) { .a { color: red } @supports (display:grid) { .b {} } }');
    expect(sheet('@layer base { a { list-style: url(x) } } @container (width > 1px) { b { mask: url(m) } }').css).toBe(
      '@layer base { a {} } @container (width > 1px) { b {} }',
    );
    expect(sheet('a { color: red; &:hover { background: url(x) } .c & { color: blue } }').css).toBe(
      'a { color: red; &:hover {} .c & { color: blue } }',
    );
  });

  it('a rule whose prelude holds an address goes whole', () => {
    expect(sheet('a:is(url(x)) { color: red } b { color: blue }').css).toBe(' b { color: blue }');
  });

  it('attribute selectors that would read a value through a request keep their rule, lose the request', () => {
    const css = 'input[value^="a"] { background: url(http://leak.invalid/a) } input[value^="b"] { color: red }';
    expect(sheet(css).css).toBe('input[value^="a"] {} input[value^="b"] { color: red }');
  });

  it('a string in a custom property stays; image-set() that would use it goes', () => {
    expect(sheet(':root { --u: "http://x.invalid/a.png" } p { background-image: image-set(var(--u) 1x) }').css).toBe(
      ':root { --u: "http://x.invalid/a.png" } p {}',
    );
  });

  it('a custom property holding a block with a url loses that url', () => {
    const out = sheet('a { --x: { color: red; background: url(x) }; color: blue }').css;
    expect(loadsAnything(out)).toBe(false);
    expect(out).toContain('color: blue');
  });
});

describe('cleanCss: what does not load stays as written', () => {
  it('a mail template’s CSS, byte for byte', () => {
    const css = [
      '/* reset */ body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }',
      'table, td { border-collapse: collapse; mso-table-lspace: 0pt; }',
      '@media only screen and (max-width: 600px) { .wrapper { width: 100% !important; } }',
      '.btn:hover { background-color: #0a66c2; color: #fff; }',
      "a[href^='tel'] { color: inherit; }",
      '.u > * + * { margin-top: 1em }',
      '@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }',
      ':root { --gap: calc(1rem + 2px); }',
      '.c::after { content: "url(not-an-address)"; }',
      '.d { font-family: "Helvetica Neue", Arial, sans-serif; }',
      '<!-- .e { color: red } -->',
    ].join('\n');
    const out = sheet(css);
    expect(out).toEqual({ css, imports: 0, removed: 0 });
  });

  it('a comment between "u" and "rl(" is not a url (the browser does not fetch it either)', () => {
    expect(sheet('a { background: u/**/rl(x) }').css).toBe('a { background: u/**/rl(x) }');
  });

  it('references into the document stay where they fetch nothing', () => {
    for (const keep of [
      'filter: url(#blur)',
      'clip-path: url("#c")',
      'mask: url(#m)',
      'fill: url(#grad)',
      'stroke: url( "#g" )',
      'marker-end: url(#arrow)',
    ])
      expect(decls(keep).css, keep).toBe(keep);
    for (const cut of ['background: url(#x)', 'filter: url(http://x.invalid/f.svg#f)', 'filter: url(#f) url(x.svg#g)'])
      expect(decls(cut).css, cut).toBe('');
  });

  it('CR, CR LF and form feeds become LF; NUL becomes U+FFFD (CSS Syntax §3.3)', () => {
    expect(sheet('a{color:red}\r\nb{}\rc{}\fd{}\0').css).toBe('a{color:red}\nb{}\nc{}\nd{}�');
  });
});

describe('attributeLoads (an SVG’s presentation attributes)', () => {
  it('a url that is not a reference into the document', () => {
    expect(attributeLoads('url(#grad)')).toBe(false);
    expect(attributeLoads('red')).toBe(false);
    expect(attributeLoads('url(http://x.invalid/a.svg#g)')).toBe(true);
    expect(attributeLoads('u\\72l(http://x.invalid/a)')).toBe(true);
    expect(attributeLoads('image-set("x" 1x)')).toBe(true);
  });
});

describe('cleanCss on large and hostile inputs', () => {
  // The shape of the cost, not milliseconds (`growth`: a megabyte against eight inputs of 128 Ki, timed in turn):
  // linear is about 1, quadratic about 8, on a free machine or a loaded one.
  it.each([
    ['nested blocks', (n: number) => '{'.repeat(n)],
    ['nested functions', (n: number) => 'a{b:' + 'f('.repeat(n / 2)],
    ['urls', (n: number) => 'a{' + 'b:url(x);'.repeat(n / 9)],
    ['an unterminated comment', (n: number) => `a{}/*${'x'.repeat(n)}`],
    ['an unterminated string', (n: number) => `a{b:"${'x'.repeat(n)}`],
    ['escapes', (n: number) => 'a{b:' + '\\75'.repeat(n / 3)],
    ['declarations', (n: number) => 'a{' + 'color:red;'.repeat(n / 10) + '}'],
  ])('%s: linear — a megabyte costs about what eight times 128 Ki do', { timeout: 60_000 }, (name, make) => {
    if (name === 'nested blocks') {
      // A million open blocks: the block stack grows to a million entries, which costs more per character than eight
      // stacks of 128 Ki (measured 1.4–2.5 free, 3.6 under load) — still far from quadratic. A wider factor keeps the
      // two apart: quadratic would measure about 16.
      expect(growth(sheet, make, 64 * 1024, { factor: 16 })).toBeLessThan(8);
    } else expect(growth(sheet, make, 128 * 1024)).toBeLessThan(GROWTH_BOUND);
    expect(loadsAnything(sheet(make(1024 * 1024)).css)).toBe(false);
  });
});
