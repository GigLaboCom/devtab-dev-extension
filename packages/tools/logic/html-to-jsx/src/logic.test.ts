// @vitest-environment jsdom
import { describeNotes, htmlToJsx, loadAttributeNames } from './index.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AttributeNames, JsxOptions } from './index.ts';

// docs/tools/specs/html-to-jsx.md §10, every row, with its expected value (`⏎` there is `\n` here, and the result's
// last `\n` is written out); then §6. The markup is parsed by jsdom's DOMParser — the logic takes the parser as a
// parameter; the e2e module runs the same rows through Chrome's and compares character for character.

let names: AttributeNames;
beforeAll(async () => {
  names = await loadAttributeNames();
});

const parse = (markup: string): Document => new DOMParser().parseFromString(markup, 'text/html');
const convert = (markup: string, options: JsxOptions = { component: false }) =>
  htmlToJsx(markup, options, parse, names);
const jsx = (markup: string, options?: JsxOptions): string => convert(markup, options).text;
const notes = (markup: string): string[] => describeNotes(convert(markup).notes);
const lines = (...l: string[]): string => `${l.join('\n')}\n`;

describe('§10 — the specification’s examples', () => {
  it('scenario 1: class and for', () => {
    expect(jsx('<label class="field" for="email">Email</label>')).toBe(
      lines('<label className="field" htmlFor="email">Email</label>'),
    );
  });

  it('void elements self-close; several roots make a fragment', () => {
    expect(jsx('<img src="a.png" alt="A"><br><input type="text" name="q">')).toBe(
      lines('<>', '  <img src="a.png" alt="A" />', '  <br />', '  <input type="text" name="q" />', '</>'),
    );
  });

  it('style to an object: camel case, vendor prefixes, a custom property, numbers, url() with a semicolon', () => {
    expect(
      jsx(
        `<div style="color: red; margin-top: 4px; -webkit-line-clamp: 2; -ms-flex: 1; --gap: 8px; opacity: 0.5; background: url('a;b.png')">x</div>`,
      ),
    ).toBe(
      lines(
        '<div',
        `  style={{ color: 'red', marginTop: '4px', WebkitLineClamp: 2, msFlex: 1, '--gap': '8px', opacity: 0.5, background: 'url(\\'a;b.png\\')' }}`,
        '>',
        '  x',
        '</div>',
      ),
    );
  });

  it('!important is dropped, with its note', () => {
    const r = convert('<p style="color: red !important">x</p>');
    expect(r.text).toBe(lines(`<p style={{ color: 'red' }}>x</p>`));
    expect(describeNotes(r.notes)).toEqual([
      '!important was dropped from inline styles: React style objects cannot carry it.',
    ]);
  });

  it('a repeated property: the last wins (COLOR is color)', () => {
    expect(jsx('<p style="color: red; COLOR: blue; margin: 0">x</p>')).toBe(
      lines(`<p style={{ color: 'blue', margin: 0 }}>x</p>`),
    );
  });

  it('handlers: arrow functions, (event) when the code names it, dblclick, an unknown one left out', () => {
    const r = convert('<button onclick="save(event); return false;" ondblclick="zoom()" onfoo="x()">Save</button>');
    expect(r.text).toBe(
      lines(
        '<button',
        '  onClick={(event) => { save(event); return false }}',
        '  onDoubleClick={() => { zoom() }}',
        '>',
        '  Save',
        '</button>',
      ),
    );
    expect(describeNotes(r.notes)).toEqual([
      '2 inline event handlers became arrow functions with the same code: check them.',
      'Unknown event attributes left out: onfoo.',
    ]);
  });

  it('a handler on SVG; one handler’s note in the singular', () => {
    const r = convert('<svg onclick="go()"><circle r="1"/></svg>');
    expect(r.text).toBe(lines('<svg onClick={() => { go() }}><circle r="1" /></svg>'));
    expect(describeNotes(r.notes)).toEqual([
      '1 inline event handler became an arrow function with the same code: check it.',
    ]);
  });

  it('a checkbox: defaultChecked, a flag, numbers, defaultValue; a long tag splits', () => {
    expect(jsx('<input type="checkbox" checked disabled="disabled" tabindex="0" maxlength="10" value="on">')).toBe(
      lines(
        '<input',
        '  type="checkbox"',
        '  defaultChecked',
        '  disabled',
        '  tabIndex={0}',
        '  maxLength={10}',
        '  defaultValue="on"',
        '/>',
      ),
    );
  });

  it('an entity decoded by the parser; disabled="false" is still disabled', () => {
    expect(jsx('<input value="a&amp;b" disabled="false">')).toBe(lines('<input defaultValue="a&b" disabled />'));
  });

  it('a comment child; */ inside it cannot end it', () => {
    expect(jsx('<div><!-- note: a */ b --><span>a</span></div>')).toBe(
      lines('<div>{/* note: a * / b */}<span>a</span></div>'),
    );
  });

  it('a comment alone is a fragment', () => {
    expect(jsx('<!-- only a comment -->')).toBe(lines('<>', '  {/* only a comment */}', '</>'));
  });

  it('braces and angle brackets in text are expressions; & that starts no reference stays', () => {
    expect(jsx('<p>Use {name} and a < b &amp; c > d</p>')).toBe(
      lines(`<p>Use {'{'}name{'}'} and a {'<'} b & c {'>'} d</p>`),
    );
  });

  it('non-breaking spaces, a decoded ©, an & that would start a reference, < and >', () => {
    expect(jsx('<p>Tom&nbsp;&amp;&nbsp;Jerry &copy; 2026 &amp;copy; &lt;tag&gt;</p>')).toBe(
      lines(`<p>Tom&nbsp;&&nbsp;Jerry © 2026 &amp;copy; {'<'}tag{'>'}</p>`),
    );
  });

  it('inline elements on one line', () => {
    expect(jsx('<p>Hello <b>world</b> and <i>you</i>!</p>')).toBe(lines('<p>Hello <b>world</b> and <i>you</i>!</p>'));
  });

  it('source line breaks between inline elements become spaces', () => {
    expect(jsx('<p>\n  Hello\n  <a href="#">there</a>\n  <em>friend</em>\n</p>')).toBe(
      lines('<p>Hello <a href="#">there</a> <em>friend</em></p>'),
    );
  });

  it('block children one per line; whitespace between blocks goes', () => {
    expect(jsx('<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>')).toBe(
      lines('<ul>', '  <li>One</li>', '  <li>Two</li>', '</ul>'),
    );
  });

  it('<pre>: the text exactly, in a template literal', () => {
    expect(jsx('<pre>  line 1\n    line {2}</pre>')).toBe(lines('<pre>', '  {`  line 1', '    line {2}`}', '</pre>'));
  });

  it('two blocks at the root', () => {
    expect(jsx('<h1>Title</h1>\n<p>Text</p>')).toBe(lines('<>', '  <h1>Title</h1>', '  <p>Text</p>', '</>'));
  });

  it('an SVG icon: names from the table, xmlns:xlink, SVG names as the parser cased them', () => {
    expect(
      jsx(
        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><path stroke-width="2" fill-rule="evenodd" d="M0 0h24"/><use xlink:href="#a"/><linearGradient id="g"><stop stop-color="#fff" offset="0"/></linearGradient></svg>',
      ),
    ).toBe(
      lines(
        '<svg',
        '  viewBox="0 0 24 24"',
        '  xmlns="http://www.w3.org/2000/svg"',
        '  xmlnsXlink="http://www.w3.org/1999/xlink"',
        '>',
        '  <path strokeWidth="2" fillRule="evenodd" d="M0 0h24" />',
        '  <use xlinkHref="#a" />',
        '  <linearGradient id="g"><stop stopColor="#fff" offset="0" /></linearGradient>',
        '</svg>',
      ),
    );
  });

  it('selected on an option becomes defaultValue on its select, with the note', () => {
    const r = convert('<select name="s"><option value="a">A</option><option value="b" selected>B</option></select>');
    expect(r.text).toBe(
      lines(
        '<select name="s" defaultValue="b">',
        '  <option value="a">A</option>',
        '  <option value="b">B</option>',
        '</select>',
      ),
    );
    expect(describeNotes(r.notes)).toEqual(['selected on <option> became defaultValue on its <select>.']);
  });

  it('<textarea>: its content becomes defaultValue, a line break as a JavaScript string', () => {
    expect(jsx('<textarea rows="3">Hello\nworld</textarea>')).toBe(
      lines(`<textarea rows={3} defaultValue={'Hello\\nworld'} />`),
    );
  });

  it('data-*, aria-*, unknown names as written; an empty element self-closes', () => {
    expect(jsx('<div data-id="7" aria-label="Close" role="button" hx-get="/x"></div>')).toBe(
      lines('<div data-id="7" aria-label="Close" role="button" hx-get="/x" />'),
    );
  });

  it('a table row is parsed inside a table', () => {
    expect(jsx('<tr><td colspan="2">x</td></tr>')).toBe(lines('<tr>', '  <td colSpan={2}>x</td>', '</tr>'));
  });

  it('table cells are parsed inside a row', () => {
    expect(jsx('<td>a</td><td>b</td>')).toBe(lines('<>', '  <td>a</td>', '  <td>b</td>', '</>'));
  });

  it('<meta> and <title> stay where they are', () => {
    expect(jsx('<meta charset="utf-8"><title>T</title><p>x</p>')).toBe(
      lines('<>', '  <meta charSet="utf-8" />', '  <title>T</title>', '  <p>x</p>', '</>'),
    );
  });

  it('a whole document: its body, with the note', () => {
    const r = convert('<!DOCTYPE html><html><head><title>T</title></head><body><main>Hi</main></body></html>');
    expect(r.text).toBe(lines('<main>Hi</main>'));
    expect(describeNotes(r.notes)).toEqual(['Converted the contents of <body>; <head> and the doctype were left out.']);
  });

  it('Wrap in a component — one root', () => {
    expect(jsx('<p>Hi</p>', { component: true })).toBe(
      lines('export default function Component() {', '  return (', '    <p>Hi</p>', '  );', '}'),
    );
  });

  it('Wrap in a component — a fragment', () => {
    expect(jsx('<p>a</p><p>b</p>', { component: true })).toBe(
      lines(
        'export default function Component() {',
        '  return (',
        '    <>',
        '      <p>a</p>',
        '      <p>b</p>',
        '    </>',
        '  );',
        '}',
      ),
    );
  });

  it('<style> and <script>: their content in a template literal; the script’s note', () => {
    const r = convert('<style>.a { color: red }</style><script>if (a < b) { go(`x`) }</script>');
    expect(r.text).toBe(
      lines('<>', '  <style>{`.a { color: red }`}</style>', '  <script>{`if (a < b) { go(\\`x\\`) }`}</script>', '</>'),
    );
    expect(describeNotes(r.notes)).toEqual(['A <script> rendered by React on the client does not run.']);
  });

  it('a long opening tag: one attribute per line', () => {
    expect(
      jsx(
        '<a class="button button-primary button-large" href="https://example.com/a/very/long/path?with=query&amp;and=more" target="_blank" rel="noopener">Go</a>',
      ),
    ).toBe(
      lines(
        '<a',
        '  className="button button-primary button-large"',
        '  href="https://example.com/a/very/long/path?with=query&and=more"',
        '  target="_blank"',
        '  rel="noopener"',
        '>',
        '  Go',
        '</a>',
      ),
    );
  });

  it('a card: block children one per line, a long paragraph on lines of its own', () => {
    expect(
      jsx(
        '<div class="card"><h2 class="title">Name</h2><p class="body">Some text that is long enough to need its own line in the output here.</p></div>',
      ),
    ).toBe(
      lines(
        '<div className="card">',
        '  <h2 className="title">Name</h2>',
        '  <p className="body">',
        '    Some text that is long enough to need its own line in the output here.',
        '  </p>',
        '</div>',
      ),
    );
  });

  it('contenteditable without a value is "true"; spellcheck stays a string', () => {
    expect(jsx('<div contenteditable spellcheck="false">x</div>')).toBe(
      lines('<div contentEditable="true" spellCheck="false">x</div>'),
    );
  });

  it('a double quote in a value is &quot;', () => {
    expect(jsx(`<div title='say "hi"'>x</div>`)).toBe(lines('<div title="say &quot;hi&quot;">x</div>'));
  });

  it('Cyrillic and emoji stay as they are', () => {
    expect(jsx('<p title="🙂 ok">Привет, 🙂</p>')).toBe(lines('<p title="🙂 ok">Привет, 🙂</p>'));
  });

  it('text alone is a fragment', () => {
    expect(jsx('just text')).toBe(lines('<>', '  just text', '</>'));
  });

  it('an unclosed element is closed by the parser', () => {
    expect(jsx('<div><p>open')).toBe(lines('<div>', '  <p>open</p>', '</div>'));
  });

  it('a < b, a lone </p>, an unfinished tag, misnested tags — as the parser reads them', () => {
    expect(jsx('a < b')).toBe(lines('<>', `  a {'<'} b`, '</>'));
    expect(jsx('</p>')).toBe(lines('<p />'));
    expect(jsx('<div')).toBe('');
    expect(jsx('<b><i>x</b></i>')).toBe(lines('<b><i>x</i></b>'));
  });

  it('an image with onerror: converted, nothing loaded or run (jsdom: no resources; Chrome: the e2e)', () => {
    expect(jsx('<img src="x" onerror="alert(1)">')).toBe(lines('<img src="x" onError={() => { alert(1) }} />'));
  });

  it('empty and blank input: an empty result', () => {
    expect(convert('')).toEqual({ text: '', notes: [] });
    expect(convert('   \n  ')).toEqual({ text: '', notes: [] });
  });

  it('a table of 5,000 rows (0.5 MiB) converts', () => {
    const rows = Array.from(
      { length: 5000 },
      (_, i) => `<tr><td class="c">Row ${i}</td><td>${'x'.repeat(60)}</td></tr>`,
    );
    const markup = `<table>${rows.join('\n')}</table>`;
    expect(markup.length).toBeGreaterThan(500_000);
    const out = jsx(markup);
    expect(out.startsWith('<table>\n  <tbody>\n    <tr>\n')).toBe(true);
    expect(out.match(/<tr>/g)).toHaveLength(5000);
  });
});

describe('§6 — what a person sees', () => {
  it('rows of the table not covered above', () => {
    expect(jsx('<tr><td colspan="2">x</td></tr>')).toBe(lines('<tr>', '  <td colSpan={2}>x</td>', '</tr>'));
    expect(jsx('<p class="кот">Ёж 🙂</p>')).toBe(lines('<p className="кот">Ёж 🙂</p>'));
    expect(notes('<p>x</p>')).toEqual([]);
  });
});
