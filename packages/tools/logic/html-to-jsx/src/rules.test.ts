// @vitest-environment jsdom
import { scanCode } from './handler.ts';
import {
  describeNotes,
  escapeJsxText,
  htmlToJsx,
  loadAttributeNames,
  parseMarkup,
  reactAttributeName,
  styleToObject,
} from './index.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AttributeNames, JsxOptions } from './index.ts';

// What docs/tools/specs/html-to-jsx.md §5 states and §10 does not show, rule by rule, and the decisions recorded in its
// §15 (comments transparent for whitespace, numbers in styles, the last selected option, custom elements, names JSX
// cannot write, handlers whose code does not balance, the indentation's cap).

/**
 * A document built by hand: `depth` nested `<div>`s around `x`. The logic reads nodes only through their prototypes'
 * getters, so these objects stand for a parsed document; jsdom's parser itself overflows its stack past ~5,000 levels.
 */
class HandNode {
  first: HandNode | null = null;
  constructor(
    readonly type: number,
    readonly name = '',
    readonly text = '',
  ) {}
  get nodeType(): number {
    return this.type;
  }
  get firstChild(): HandNode | null {
    return this.first;
  }
  get nextSibling(): null {
    return null;
  }
  get localName(): string {
    return this.name;
  }
  get namespaceURI(): string {
    return 'http://www.w3.org/1999/xhtml';
  }
  get data(): string {
    return this.text;
  }
  get attributes(): { length: number } {
    return NO_ATTRIBUTES;
  }
  get body(): HandNode | null {
    return this.first;
  }
}
const NO_ATTRIBUTES = Object.create({
  get length() {
    return 0;
  },
}) as { length: number };
const chain = (depth: number): Document => {
  const document = new HandNode(9);
  let at = (document.first = new HandNode(1, 'body'));
  for (let i = 0; i < depth; i++) at = at.first = new HandNode(1, 'div');
  at.first = new HandNode(3, '', 'x');
  return document as unknown as Document;
};

let names: AttributeNames;
beforeAll(async () => {
  names = await loadAttributeNames();
});

const parse = (markup: string): Document => new DOMParser().parseFromString(markup, 'text/html');
const convert = (markup: string, options: JsxOptions = { component: false }) =>
  htmlToJsx(markup, options, parse, names);
const jsx = (markup: string): string => convert(markup).text;
const notes = (markup: string): string[] => describeNotes(convert(markup).notes);
const lines = (...l: string[]): string => `${l.join('\n')}\n`;
const one = (markup: string): string => jsx(markup).trimEnd();

describe('parsing (§5 «Разбор»)', () => {
  it('a document starts with <!doctype or <html in any case, after whitespace', () => {
    expect(parseMarkup('  \n<!DocType html><p>x', parse).document).toBe(true);
    expect(parseMarkup('<HTML lang="en"><body><p>x', parse).document).toBe(true);
    expect(parseMarkup('<htmlx>', parse).document).toBe(false);
    expect(parseMarkup('<p>x</p><html>', parse).document).toBe(false);
    expect(notes('<html><body><p>x</p></body></html>')).toEqual([
      'Converted the contents of <body>; <head> and the doctype were left out.',
    ]);
  });

  it('parts of a table are parsed inside one; a leading comment does not hide the first tag', () => {
    expect(one('<col span="2">')).toBe('<col span={2} />');
    expect(one('<caption>C</caption>')).toBe('<caption>C</caption>');
    expect(one('<thead><tr><th>h</th></tr></thead>')).toBe(
      ['<thead>', '  <tr>', '    <th>h</th>', '  </tr>', '</thead>'].join('\n'),
    );
    expect(one('<!-- row -->\n<tr><td>x</td></tr>')).toBe(
      ['<>', '  {/* row */}', '  <tr>', '    <td>x</td>', '  </tr>', '</>'].join('\n'),
    );
    // Without a wrapper the parser would drop the cells: text first means no wrapper.
    expect(one('text <td>a</td>')).toBe(['<>', '  text a', '</>'].join('\n'));
  });

  it('a fragment is parsed in standards mode: a table closes an open paragraph', () => {
    expect(one('<p>a<table><tr><td>x</td></tr></table>')).toBe(
      [
        '<>',
        '  <p>a</p>',
        '  <table>',
        '    <tbody>',
        '      <tr>',
        '        <td>x</td>',
        '      </tr>',
        '    </tbody>',
        '  </table>',
        '</>',
      ].join('\n'),
    );
  });

  it('a named element cannot stand in for a built-in property (DOM clobbering)', () => {
    expect(
      one(
        '<form id="f"><input name="firstChild"><input name="attributes"><input name="nextSibling"></form><p>after</p>',
      ),
    ).toBe(
      [
        '<>',
        '  <form id="f">',
        '    <input name="firstChild" />',
        '    <input name="attributes" />',
        '    <input name="nextSibling" />',
        '  </form>',
        '  <p>after</p>',
        '</>',
      ].join('\n'),
    );
    expect(jsx('<!doctype html><html><body><img name="body"><form name="body"></form><p>x</p></body></html>')).toBe(
      lines('<>', '  <img name="body" />', '  <form name="body" />', '  <p>x</p>', '</>'),
    );
  });
});

describe('<base> and <template> are parsed without what Chrome reports for them (§15)', () => {
  it('<base href> is written as the void element it is; what followed stays its sibling', () => {
    expect(one('<BASE href="https://x.invalid/" target="_blank"><p>after</p></base>')).toBe(
      ['<>', '  <base href="https://x.invalid/" target="_blank" />', '  <p>after</p>', '</>'].join('\n'),
    );
    expect(one('<p>a<base href="/">b</p>')).toBe('<p>a<base href="/" />b</p>');
    expect(one('<svg><base href="x"></base></svg>')).toBe('<svg><base href="x" /></svg>');
  });

  it('<template> keeps its children; its own mode is lost (rows directly inside are dropped, as outside a table)', () => {
    expect(one('<template id="t"><p style="color: red">x</p></template>')).toBe(
      ['<template id="t">', `  <p style={{ color: 'red' }}>x</p>`, '</template>'].join('\n'),
    );
    expect(one('<TEMPLATE><tr><td>c</td></tr></TEMPLATE>')).toBe('<template>c</template>');
  });

  it('the tag names inside text, comments, attributes and scripts come back as written', () => {
    expect(
      jsx(
        '<p title="<base href=x> <template>">t<!-- <base> </template> --></p><script>"<template>" + "<base/>"</script><textarea><base></textarea>',
      ),
    ).toBe(
      lines(
        '<>',
        `  <p title="<base href=x> <template>">t{/* <base> </template> */}</p>`,
        '  <script>{`"<template>" + "<base/>"`}</script>',
        `  <textarea defaultValue="<base>" />`,
        '</>',
      ),
    );
  });

  it('an input that holds the sentinel character keeps it: another one is chosen', () => {
    expect(one('<p title="\u{FDD0}">\u{FDD0}</p><base href="/">')).toBe(
      ['<>', '  <p title="\u{FDD0}">\u{FDD0}</p>', '  <base href="/" />', '</>'].join('\n'),
    );
  });
});

describe('elements (§5 «Элементы»)', () => {
  it('<template> is converted with its content', () => {
    expect(one('<template id="t"><p>in</p></template>')).toBe(
      ['<template id="t">', '  <p>in</p>', '</template>'].join('\n'),
    );
  });

  it('<pre> at any depth: every text node a template literal, exactly', () => {
    expect(jsx('<pre><b> bold `x` ${y} \\n</b>\nnext</pre>')).toBe(
      lines('<pre>', '  <b>{` bold \\`x\\` \\${y} \\\\n`}</b>', '  {`', 'next`}', '</pre>'),
    );
  });

  it('<script> and <style>: backslashes, backticks and ${ escaped; an empty one self-closes', () => {
    expect(one('<script>a = `${b}` + "\\n"</script>')).toBe('<script>{`a = \\`\\${b}\\` + "\\\\n"`}</script>');
    expect(one('<script src="a.js"></script>')).toBe('<script src="a.js" />');
    expect(notes('<script src="a.js"></script>')).toEqual(['A <script> rendered by React on the client does not run.']);
  });

  it('an empty <textarea> self-closes; its content wins over a value attribute', () => {
    expect(one('<textarea name="t"></textarea>')).toBe('<textarea name="t" />');
    expect(one('<textarea value="a">b</textarea>')).toBe('<textarea defaultValue="b" />');
  });

  it('an element JSX cannot name is left out, its children kept, with a note', () => {
    const r = convert('<p>a<x{y}>b</x{y}>c</p>');
    expect(r.text).toBe(lines('<p>abc</p>'));
    expect(describeNotes(r.notes)).toEqual(['Elements JSX cannot name left out, their contents kept: x{y}.']);
    expect(one('<a.b>t</a.b>')).toBe(['<>', '  t', '</>'].join('\n'));
  });
});

describe('attributes (§5 «Атрибуты»)', () => {
  it('names from the table; data-* and aria-* as written; unknown names as written', () => {
    expect(
      one('<label class="a" for="b" tabindex="1" accesskey="k" data-X="1" aria-hidden="true" hx-get="/x">t</label>'),
    ).toBe(
      [
        '<label',
        '  className="a"',
        '  htmlFor="b"',
        '  tabIndex={1}',
        '  accessKey="k"',
        '  data-x="1"',
        '  aria-hidden="true"',
        '  hx-get="/x"',
        '>',
        '  t',
        '</label>',
      ].join('\n'),
    );
    expect(reactAttributeName('class', 'div', names)).toBe('className');
    expect(reactAttributeName('ACCEPT-CHARSET', 'form', names)).toBe('acceptCharset');
    expect(reactAttributeName('xlink:href', 'use', names)).toBe('xlinkHref');
    expect(reactAttributeName('xml:lang', 'text', names)).toBe('xmlLang');
    expect(reactAttributeName('viewBox', 'svg', names)).toBe('viewBox');
    expect(reactAttributeName('hx-get', 'div', names)).toBe('hx-get');
  });

  it('custom elements keep names as written, but class; values stay strings', () => {
    expect(one('<my-el class="a" for="b" tabindex="0" disabled stroke-width="2">y</my-el>')).toBe(
      '<my-el className="a" for="b" tabindex="0" disabled="" stroke-width="2">y</my-el>',
    );
    expect(one('<button is="fancy-button" tabindex="0">b</button>')).toBe(
      '<button is="fancy-button" tabindex="0">b</button>',
    );
    // Hyphenated SVG and MathML names are not custom elements.
    expect(one('<svg><font-face font-family="x"></font-face></svg>')).toBe('<svg><font-face fontFamily="x" /></svg>');
  });

  it('a name JSX cannot write goes into a spread object', () => {
    expect(one('<div @click="go()" :class="c" x-on:click="z">t</div>')).toBe(
      [
        '<div',
        `  {...{ '@click': 'go()' }}`,
        `  {...{ ':class': 'c' }}`,
        `  {...{ 'x-on:click': 'z' }}`,
        '>',
        '  t',
        '</div>',
      ].join('\n'),
    );
    expect(one(`<p {...evil}="1">t</p>`)).toBe(`<p {...{ '{...evil}': '1' }}>t</p>`);
  });

  it('flags are bare whatever the value', () => {
    expect(one('<details open="no"><summary>s</summary></details>')).toBe(
      ['<details open>', '  <summary>s</summary>', '</details>'].join('\n'),
    );
    expect(one('<video autoplay="false" muted controls loop playsinline></video>')).toBe(
      '<video autoPlay muted controls loop playsInline />',
    );
    expect(one('<div hidden="until-found">x</div>')).toBe('<div hidden>x</div>');
    expect(one('<iframe allowfullscreen credentialless></iframe>')).toBe('<iframe allowFullScreen credentialless />');
  });

  it('numbers: only when written as JavaScript writes them', () => {
    expect(one('<td colspan="2" rowspan="-1">x</td>')).toBe('<td colSpan={2} rowSpan={-1}>x</td>');
    expect(one('<input tabindex="007" size="1.50" maxlength="10px">')).toBe(
      '<input tabIndex="007" size="1.50" maxLength="10px" />',
    );
    expect(one('<meter low="0.25" high="0.75" optimum="0.5"></meter>')).toBe(
      '<meter low={0.25} high={0.75} optimum={0.5} />',
    );
  });

  it('uncontrolled fields: value and checked on input, select, textarea only', () => {
    expect(one('<input type="radio" checked value="a">')).toBe(
      '<input type="radio" defaultChecked defaultValue="a" />',
    );
    expect(one('<button value="v">b</button>')).toBe('<button value="v">b</button>');
    expect(one('<select value="b"><option value="b" selected>B</option></select>')).toBe(
      ['<select defaultValue="b">', '  <option value="b">B</option>', '</select>'].join('\n'),
    );
  });

  it('a single select takes the last option marked selected (what the browser shows); a multiple one all', () => {
    expect(one('<select><option selected>a</option><option selected>b</option></select>')).toBe(
      ['<select defaultValue="b">', '  <option>a</option>', '  <option>b</option>', '</select>'].join('\n'),
    );
    expect(
      one(
        '<select multiple><optgroup label="g"><option selected> a  b </option><option selected value="z\'">x</option></optgroup></select>',
      ),
    ).toBe(
      [
        `<select multiple defaultValue={['a b', 'z\\'']}>`,
        '  <optgroup label="g">',
        '    <option>a b</option>',
        `    <option value="z'">x</option>`,
        '  </optgroup>',
        '</select>',
      ].join('\n'),
    );
    // Outside a select, selected stays a flag.
    expect(one('<datalist><option selected value="x"></option></datalist>')).toBe(
      ['<datalist>', '  <option selected value="x" />', '</datalist>'].join('\n'),
    );
  });

  it('values: &quot;, an & that starts a reference, line breaks as JavaScript strings', () => {
    expect(one(`<a title="a &amp;amp; b &amp; c &amp;#1; &amp;#x1f; 'q'" href="?a=1&amp;b=2">t</a>`)).toBe(
      `<a title="a &amp;amp; b & c &amp;#1; &amp;#x1f; 'q'" href="?a=1&b=2">t</a>`,
    );
    expect(one('<div title="one&#10;two \\ \'three\'">x</div>')).toBe(
      `<div title={'one\\ntwo \\\\ \\'three\\''}>x</div>`,
    );
  });

  it('a repeated property keeps the first', () => {
    expect(one('<div class="a" classname="b">x</div>')).toBe('<div className="a">x</div>');
  });
});

describe('event handlers (§5 «Атрибуты» п. 2)', () => {
  it('names in any case; the special three', () => {
    expect(one('<input ONCHANGE="f()" onfocusin="g()" onfocusout="h()">')).toBe(
      ['<input', '  onChange={() => { f() }}', '  onFocus={() => { g() }}', '  onBlur={() => { h() }}', '/>'].join(
        '\n',
      ),
    );
  });

  it('code that does not balance is left out with a note; balanced code is kept as written', () => {
    const r = convert('<a onclick="}}); evil(); ({" onmouseover="x(\'" onkeydown="/* no end">t</a>');
    expect(r.text).toBe(lines('<a>t</a>'));
    expect(describeNotes(r.notes)).toEqual([
      'Event attributes whose code does not balance left out: onclick, onmouseover, onkeydown.',
    ]);
    expect(one('<a onclick="if (/}/.test(s)) { go(`${a}}`) }">t</a>')).toBe(
      '<a onClick={() => { if (/}/.test(s)) { go(`${a}}`) } }}>t</a>',
    );
  });

  it('a // comment that runs to the end gets a line break before the closing braces; an empty handler', () => {
    expect(one('<a onclick="go() // note">t</a>')).toBe(
      ['<a', '  onClick={() => { go() // note', '}}', '>', '  t', '</a>'].join('\n'),
    );
    expect(one('<a onclick=" ; ">t</a>')).toBe('<a onClick={() => {}}>t</a>');
    expect(one('<a onclick="track(events)">t</a>')).toBe('<a onClick={() => { track(events) }}>t</a>');
  });

  it('scanCode: brackets, strings, templates, regular expressions, comments', () => {
    expect(scanCode('a(b[c]{d})').balanced).toBe(true);
    expect(scanCode('a(').balanced).toBe(false);
    expect(scanCode('a)').balanced).toBe(false);
    expect(scanCode('"a}"').balanced).toBe(true);
    expect(scanCode("'a").balanced).toBe(false);
    expect(scanCode('`a ${ `b ${c}` } }`').balanced).toBe(true);
    expect(scanCode('x = a / b / c').balanced).toBe(true);
    expect(scanCode('return /[}/]/.test(x)').balanced).toBe(true);
    expect(scanCode('/* } */ x').balanced).toBe(true);
    expect(scanCode('x // }')).toEqual({ balanced: true, lineCommentAtEnd: true });
    expect(scanCode('x // }\n}').balanced).toBe(false);
  });
});

describe('style (§5 «Стиль»)', () => {
  it('names: camel case, vendor prefixes, -ms- in lower case, a custom property as written', () => {
    expect(styleToObject('Margin-Top: 1px; -moz-user-select: none; -ms-grid-row: 1; --Gap-X: 2px').text).toBe(
      `{ marginTop: '1px', MozUserSelect: 'none', msGridRow: 1, '--Gap-X': '2px' }`,
    );
  });

  it('numbers: 0 everywhere, others only where React adds no unit; written as JavaScript writes them', () => {
    expect(
      styleToObject('margin: 0; width: 10; z-index: 2; line-height: 1.5; flex: 1; opacity: 0.50; --n: 3').text,
    ).toBe(`{ margin: 0, width: '10', zIndex: 2, lineHeight: 1.5, flex: 1, opacity: '0.50', '--n': '3' }`);
  });

  it('!important in any case and spacing, a kept declaration only', () => {
    expect(styleToObject('color: red ! IMPORTANT')).toEqual({ text: `{ color: 'red' }`, important: true });
    expect(styleToObject('color: blue')).toEqual({ text: `{ color: 'blue' }`, important: false });
  });

  it('quotes, parentheses, comments; declarations that cannot be read are left out', () => {
    expect(
      styleToObject(
        `background: url("a;b).png") , url(c/*d*/e.png); content: 'x;y' ; /* gone; */ color : red; nocolon; : x; y:`,
      ).text,
    ).toBe(`{ background: 'url("a;b).png") , url(c/*d*/e.png)', content: '\\'x;y\\'', color: 'red' }`);
    expect(styleToObject('').text).toBeNull();
    expect(styleToObject(' ; nothing ; ').text).toBeNull();
    expect(one('<p style="">x</p>')).toBe('<p>x</p>');
    expect(one('<p style="garbage">x</p>')).toBe('<p>x</p>');
  });

  it('a name that is not an identifier is quoted; a value with a line break is escaped', () => {
    expect(styleToObject("col{or: red; font-family: 'A\\'B',\n serif").text).toBe(
      `{ 'col{or': 'red', fontFamily: '\\'A\\\\\\'B\\',\\n serif' }`,
    );
  });
});

describe('text and whitespace (§5 «Текст и пробелы»)', () => {
  it('escapes { } < >, an & before a reference, U+00A0; characters JSX trims or breaks on as references', () => {
    expect(escapeJsxText('{a} <b> &amp; & &#1; &x &copy;')).toBe(
      `{'{'}a{'}'} {'<'}b{'>'} &amp;amp; & &amp;#1; &x &amp;copy;`,
    );
    expect(escapeJsxText('\u{A0}a\u{3000}b\u{2028}c\u{FEFF}\u{B}')).toBe('&nbsp;a&#x3000;b&#x2028;c&#xFEFF;&#xB;');
  });

  it('whitespace at the edges of the children goes; between inline neighbours it stays', () => {
    expect(one('<p>  a  <b> b </b>  c  </p>')).toBe('<p>a <b>b</b> c</p>');
    expect(one('<span>a</span> <span>b</span>')).toBe(
      ['<>', '  <span>a</span>', `  {' '}`, '  <span>b</span>', '</>'].join('\n'),
    );
  });

  it('next to a block element: a run with a line break or touching text goes; a bare space between two stays', () => {
    expect(one('<div><div>a</div> b <div>c</div></div>')).toBe(
      ['<div>', '  <div>a</div>', '  b', '  <div>c</div>', '</div>'].join('\n'),
    );
    expect(one('<div><div>a</div> <div>c</div></div>')).toBe(
      ['<div>', '  <div>a</div>', `  {' '}`, '  <div>c</div>', '</div>'].join('\n'),
    );
    expect(one('<div><div>a</div>\n<div>c</div></div>')).toBe(
      ['<div>', '  <div>a</div>', '  <div>c</div>', '</div>'].join('\n'),
    );
  });

  it('comments are transparent: whitespace on both sides of one is one space, kept between inline neighbours', () => {
    expect(one('<p>a <!-- c --> b</p>')).toBe('<p>a{/* c */} b</p>');
    expect(one('<p><b>x</b>\n  <!-- c -->\n  <i>y</i></p>')).toBe('<p><b>x</b>{/* c */} <i>y</i></p>');
    expect(one('<div>\n  <!-- c -->\n  <p>x</p>\n</div>')).toBe(
      ['<div>', '  {/* c */}', '  <p>x</p>', '</div>'].join('\n'),
    );
  });

  it('an inline element’s edge whitespace moves outside it and joins its neighbours’ (it would show)', () => {
    expect(one('<p>Click<a href="#"> here </a>now</p>')).toBe('<p>Click <a href="#">here</a> now</p>');
    expect(one('<p>a <b> <i> x </i> </b> c</p>')).toBe('<p>a <b><i>x</i></b> c</p>');
    expect(one('<p>a<span> </span>b</p>')).toBe('<p>a <span />b</p>');
    // At the edges of a block or of a button (a box of its own) it does not show.
    expect(one('<p><a> x </a></p>')).toBe('<p><a>x</a></p>');
    expect(one('<p>x<button> Save </button>y</p>')).toBe('<p>x<button>Save</button>y</p>');
  });

  it('inside SVG, whitespace between shapes is formatting and goes; inside <text> it is text', () => {
    expect(
      jsx(
        '<svg>\n  <g>\n    <path d="M0"/>\n    <path d="M1"/>\n  </g>\n  <text> a <tspan> b </tspan>c</text>\n</svg>',
      ),
    ).toBe(lines('<svg>', '  <g><path d="M0" /><path d="M1" /></g>', '  <text>a <tspan>b</tspan> c</text>', '</svg>'));
  });

  it('significant spaces in a multi-line element get lines of their own', () => {
    expect(one('<div>Text <b>bold</b> more<div>block</div></div>')).toBe(
      ['<div>', '  Text', `  {' '}`, '  <b>bold</b>', `  {' '}`, '  more', '  <div>block</div>', '</div>'].join('\n'),
    );
  });
});

describe('layout (§5 «Раскладка»)', () => {
  it('an element without children and attributes never splits, however deep', () => {
    const deep = `${'<span>'.repeat(60)}<br>${'</span>'.repeat(60)}`;
    expect(
      jsx(deep)
        .split('\n')
        .find(l => l.includes('<br'))!
        .trim(),
    ).toBe('<br />');
  });

  it('indentation stops growing at 40 levels (80 columns)', () => {
    const out = jsx(`${'<div>'.repeat(50)}x${'</div>'.repeat(50)}`);
    const widest = Math.max(...out.split('\n').map(l => l.length - l.trimStart().length));
    expect(widest).toBe(80);
  });

  it('Wrap in a component — empty input stays empty; text is a fragment', () => {
    expect(convert('', { component: true }).text).toBe('');
    expect(convert('hi', { component: true }).text).toBe(
      lines('export default function Component() {', '  return (', '    <>', '      hi', '    </>', '  );', '}'),
    );
  });
});

describe('limits (§12): no recursion, no quadratic step', () => {
  it('3,000 levels parsed by jsdom convert (jsdom’s own parser slows quadratically and overflows its stack near 10,000)', () => {
    const depth = 3_000;
    const out = jsx(`${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}`);
    expect(out.match(/<div>/g)).toHaveLength(depth);
    expect(out.split('\n')).toHaveLength(2 * depth + 2);
  }, 60_000);

  it('100,000 levels of a tree built by hand convert without a stack overflow, in linear time', () => {
    const time = (depth: number): number => {
      const document = chain(depth);
      const started = performance.now();
      const out = htmlToJsx('<div>', { component: false }, () => document, names).text;
      const ms = performance.now() - started;
      expect(out.match(/<div>/g)).toHaveLength(depth);
      expect(out.split('\n')).toHaveLength(2 * depth + 2);
      return ms;
    };
    time(10_000);
    const small = time(25_000);
    const large = time(100_000);
    // Four times the depth: linear would be about 4×; quadratic 16×. The bound leaves room for a loaded machine.
    expect(large / Math.max(small, 1)).toBeLessThan(12);
  }, 60_000);

  it('a megabyte of the worst inputs for the scanners stays fast', () => {
    const mb = 1 << 20;
    const cases = [
      `<p onclick="x()${' '.repeat(mb)};">t</p>`,
      `<p onclick="${'// c\n'.repeat(mb / 5)}x()">t</p>`,
      `<p style="color: red${' '.repeat(mb)}x">t</p>`,
      `<p style="${'a:b;'.repeat(mb / 4)}">t</p>`,
      `<p>${'&amp;'.repeat(mb / 5)}</p>`,
      `<p>${' {} '.repeat(mb / 4)}</p>`,
      `<p title="${'"'.repeat(1)}${'&amp;x'.repeat(mb / 6)}">t</p>`,
      `<pre>${'`${'.repeat(mb / 3)}</pre>`,
      `${'<!--'.repeat(mb / 4)}`,
      `${'<b>a</b> '.repeat(mb / 9)}`,
    ];
    for (const markup of cases) {
      const started = performance.now();
      convert(markup);
      expect(performance.now() - started, markup.slice(0, 40)).toBeLessThan(8000);
    }
  }, 60_000);
});
