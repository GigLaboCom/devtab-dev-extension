// @vitest-environment jsdom
// docs/tools/specs/svg-to-css.md §10, row by row, with the specification's expected values; §6 and the notes word for
// word; §7's table for detectSvg; then what §5 states and §10 does not show. The XML check uses jsdom's DOMParser (the
// logic takes the parser as a parameter); what Chrome draws from each URI is the e2e module's (scripts/e2e-tools).
import {
  ACTIVE_CONTENT,
  ADDED_XLINK,
  ADDED_XMLNS,
  LIVE_INPUT,
  MAX_INPUT,
  TOO_LARGE,
  checkSvg,
  describeNotes,
  detectSvg,
  encodeSvgPayload,
  ensureNamespaces,
  formatSizes,
  minifySvg,
  swapAttributeQuotes,
  svgToCss,
} from '.';
import { describe, expect, it } from 'vitest';
import type { SvgOptions, SvgResult } from '.';

const parse = (text: string): Document => new DOMParser().parseFromString(text, 'image/svg+xml');
const DEFAULTS: SvgOptions = { output: 'background-image', encoding: 'url', minify: true };
const run = (text: string, options: Partial<SvgOptions> = {}): SvgResult =>
  svgToCss(text, { ...DEFAULTS, ...options }, parse);
const ok = (text: string, options: Partial<SvgOptions> = {}) => {
  const r = run(text, options);
  if (!r.ok) throw new Error(r.error.message);
  return r;
};

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const B = 'background-image: url("data:image/svg+xml,';
const END = '");';
const icon = (fill: string, extra = '') =>
  `<svg ${NS} viewBox="0 0 10 10">${extra}<rect width="10" height="10" fill="${fill}"/></svg>`;
const ICON_URI = (hex: string) =>
  `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Crect width='10' height='10' fill='%23${hex}'/%3E%3C/svg%3E`;

describe('§10, row by row', () => {
  it('row 1: the red icon, 144 / 174', () => {
    const r = ok(icon('#ff0000'));
    expect(r.text).toBe(`${B}${ICON_URI('ff0000')}${END}`);
    expect(r.sizes).toEqual({ url: 144, base64: 174 });
    expect(r.notes).toEqual([]);
    expect(formatSizes(r.sizes, 'url')).toBe('144 characters · Base64: 174');
  });

  it('row 2: without xmlns — added first, with the note', () => {
    const r = ok('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#00ff00"/></svg>');
    expect(r.text).toBe(`${B}${ICON_URI('00ff00')}${END}`);
    expect(describeNotes(r.notes)).toEqual([
      'Added xmlns="http://www.w3.org/2000/svg": without it a data URI does not render as SVG.',
    ]);
  });

  it('row 3: prolog, generator comment, DOCTYPE and indentation go — as row 1, 144 / 174', () => {
    const r = ok(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: editor -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <rect width="10" height="10" fill="#0000ff"/>\n</svg>\n',
    );
    expect(r.text).toBe(`${B}${ICON_URI('0000ff')}${END}`);
    expect(r.sizes).toEqual({ url: 144, base64: 174 });
  });

  it('row 4: a value with an apostrophe stays in "…" and its quotes are %22; CSS keeps its quotes, 276 / 310', () => {
    const r = ok(
      `<svg ${NS} viewBox="0 0 10 10"><style>rect{fill:url("#g")}</style><linearGradient id="g"><stop stop-color="#ff00ff"/></linearGradient><rect width="10" height="10" data-x="it's"/></svg>`,
    );
    expect(r.text).toContain('%3Cstyle%3Erect{fill:url(%22%23g%22)}%3C/style%3E');
    expect(r.text).toContain("data-x=%22it's%22/%3E");
    expect(r.sizes).toEqual({ url: 276, base64: 310 });
  });

  it('row 5: % is %25 and # is %23, 152 / 182', () => {
    const r = ok(`<svg ${NS} viewBox="0 0 10 10"><rect width="100%" height="100%" fill="#00ffff"/></svg>`);
    expect(r.text).toContain("width='100%25' height='100%25' fill='%2300ffff'");
    expect(r.sizes).toEqual({ url: 152, base64: 182 });
  });

  it('row 6: Cyrillic and an emoji as UTF-8 bytes, 216 / 218', () => {
    const r = ok(icon('#ffff00', '<title>Значок 🙂</title>'));
    expect(r.text).toContain('%3Ctitle%3E%D0%97%D0%BD%D0%B0%D1%87%D0%BE%D0%BA %F0%9F%99%82%3C/title%3E');
    expect(r.sizes).toEqual({ url: 216, base64: 218 });
  });

  it('row 7: a long Cyrillic title — Base64 is shorter and says so', () => {
    // The specification recorded the sizes, not the input (`<path …/>`); this one gives them (§10 now names it).
    const r = ok(
      `<svg ${NS} viewBox="0 0 24 24"><title>Значок поиска по каталогу</title><path d="M0 0h24v24z"/></svg>`,
    );
    expect(formatSizes(r.sizes, 'url')).toBe('278 characters · Base64: 230 (shorter)');
    expect(formatSizes(r.sizes, 'base64')).toBe('230 characters · URL-encoded: 278');
  });

  it('row 8: xlink:href without xmlns:xlink — declared last on the root, with the note', () => {
    const r = ok(
      `<svg ${NS} viewBox="0 0 10 10"><defs><rect id="r" width="10" height="10" fill="#800000"/></defs><use xlink:href="#r"/></svg>`,
    );
    expect(r.text).toContain(
      "viewBox='0 0 10 10' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Cdefs%3E%3Crect id='r' width='10' height='10' fill='%23800000'/%3E%3C/defs%3E%3Cuse xlink:href='%23r'/%3E",
    );
    expect(describeNotes(r.notes)).toEqual([ADDED_XLINK]);
  });

  it('row 9: the space between two tspans is kept', () => {
    const r = ok(
      `<svg ${NS} viewBox="0 0 10 10"><rect width="10" height="10" fill="#008000"/><text x="0" y="9"><tspan>a</tspan> <tspan>b</tspan></text></svg>`,
    );
    expect(r.text).toContain('%3Ctspan%3Ea%3C/tspan%3E %3Ctspan%3Eb%3C/tspan%3E');
  });

  it('row 10: Minify off — line breaks and tabs are %0A and %09, 153 / 178', () => {
    const r = ok(`<svg ${NS} viewBox="0 0 10 10">\n\t<rect width="10" height="10" fill="#000080"/>\n</svg>`, {
      minify: false,
    });
    expect(r.text).toBe(
      `${B}%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%0A%09%3Crect width='10' height='10' fill='%23000080'/%3E%0A%3C/svg%3E${END}`,
    );
    expect(r.sizes).toEqual({ url: 153, base64: 178 });
  });

  it('row 11: Base64 — the UTF-8 of the prepared text, quotes not swapped', () => {
    const r = ok(icon('#808000'), { encoding: 'base64' });
    expect(r.text).toBe(
      'background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMCAxMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjODA4MDAwIi8+PC9zdmc+");',
    );
    expect(r.sizes).toEqual({ url: 144, base64: 174 });
    expect(formatSizes(r.sizes, 'base64')).toBe('174 characters · URL-encoded: 144 (shorter)');
  });

  it('row 12: mask-image', () => {
    expect(
      ok(`<svg ${NS} viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`, { output: 'mask-image' }).text,
    ).toBe(
      `mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='5'/%3E%3C/svg%3E");`,
    );
  });

  it('rows 13–14: url() and Data URI', () => {
    expect(ok(`<svg ${NS}/>`, { output: 'url' }).text).toBe(
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E")`,
    );
    const r = ok(`<svg ${NS}/>`, { output: 'data-uri' });
    expect(r.text).toBe(`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E`);
    expect(r.dataUri).toBe(r.text);
  });

  it('row 15: a backslash is %5C', () => {
    expect(ok(icon('#c0c0c0', '<desc>C:\\path</desc>')).text).toContain('%3Cdesc%3EC:%5Cpath%3C/desc%3E');
  });

  it('row 16: U+FEFF first — as without it', () => {
    expect(ok(`\u{FEFF}${icon('#ff8000')}`)).toEqual(ok(icon('#ff8000')));
  });

  // Rows 17–19 (a raw #, only # encoded, a data: URI without xmlns) are what Chrome draws: scripts/e2e-tools/svg-to-css.mjs.

  it('row 20: an unclosed tag — the place from the parser, carried back to the input (jsdom: column 6)', () => {
    const text = `<svg ${NS}>\n<rect width="1">\n</svg>`;
    expect(run(text)).toEqual({
      ok: false,
      error: { message: 'Line 3, column 6: the SVG is not well-formed XML.', line: 3, column: 6 },
    });
    expect(checkSvg(text, parse)).toEqual({
      message: 'Line 3, column 6: the SVG is not well-formed XML.',
      line: 3,
      column: 6,
    });
  });

  it('row 21: an svg root without a namespace passes the check, and xmlns is added', () => {
    expect(checkSvg('<svg viewBox="0 0 1 1"><rect/></svg>', parse)).toBeNull();
    expect(ok('<svg viewBox="0 0 1 1"><rect/></svg>').notes).toEqual([{ kind: 'added', attribute: 'xmlns' }]);
  });

  it('row 22: another root', () => {
    expect(run('<html><body/></html>')).toEqual({
      ok: false,
      error: { message: 'The root element is <html>, not <svg>.' },
    });
  });

  it('row 23: empty and blank input give the empty result', () => {
    const empty = { ok: true, text: '', dataUri: '', svg: '', sizes: { url: 0, base64: 0 }, notes: [] };
    expect(run('')).toEqual(empty);
    expect(run('   ')).toEqual(empty);
    expect(run('\u{FEFF}\n\t ')).toEqual(empty);
  });

  it('row 24: 1.34 MiB (30,000 circles) — linear: ten times the input costs at most about ten times as much', () => {
    // The specification's milliseconds are Node's on one machine; the e2e module measures Chrome. Here: the shape.
    const circles = (n: number) =>
      `<svg ${NS} viewBox="0 0 1000 1000">${Array.from({ length: n }, (_, i) => `<circle cx="${i % 1000}" cy="${(i / 1000) | 0}" r="5" fill="#123456"/>`).join('')}\n</svg>`;
    const big = circles(30_000);
    expect(big.length / 1024 / 1024).toBeCloseTo(1.34, 1);
    const time = (text: string, encoding: 'url' | 'base64') => {
      const t0 = performance.now();
      const r = ok(text, { encoding });
      return { ms: performance.now() - t0, r };
    };
    time(circles(3_000), 'url');
    const small = Math.min(...[0, 1, 2].map(() => time(circles(3_000), 'url').ms));
    const large = Math.min(...[0, 1, 2].map(() => time(big, 'url').ms));
    // Linear is ×10; a quadratic step would be ×100. ×40 leaves room for a loaded machine and the collector.
    expect(large / small).toBeLessThan(40);
    expect(time(big, 'base64').r.sizes.base64).toBeGreaterThan(big.length);
  });

  it('row 25: the limits the component holds (4 MiB + 1 is refused there with this text)', () => {
    // 256 Ki, not the specification's 1 Mi: measured in Chrome (§15).
    expect(LIVE_INPUT).toBe(256 * 1024);
    expect(MAX_INPUT).toBe(4 * 1024 * 1024);
    expect(TOO_LARGE).toBe('SVG is larger than 4 MB.');
  });
});

describe('§5 «Проверка» and §6', () => {
  it('several roots are not well-formed', () => {
    const r = run(`<svg ${NS}/><svg ${NS}/>`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toMatch(/^Line 1, column \d+: the SVG is not well-formed XML\.$/);
  });

  it('a prefix other than xlink without a declaration is a parse error', () => {
    const r = run(`<svg ${NS}><g inkscape:label="a"/></svg>`);
    expect(!r.ok && r.error.message).toMatch(/the SVG is not well-formed XML\.$/);
  });

  it('the error place counts what was trimmed and what was added: a mismatch on the root line', () => {
    // Leading blank lines and a BOM, no xmlns (added before the parse, taken out of the column again).
    const text = '\u{FEFF}\n\n<svg viewBox="0 0 1 1"><rect></svg>';
    const r = checkSvg(text, parse);
    expect(r?.line).toBe(3);
    // The parser points into `</svg>`; carried back it lands on the same characters of the input.
    const parsedColumn = (() => {
      const e = checkSvg(`<svg ${NS} viewBox="0 0 1 1"><rect></svg>`, parse)!;
      return e.column! - (NS.length + 1);
    })();
    expect(r?.column).toBe(parsedColumn);
  });

  it('without a place the message has none', () => {
    const fake = (): Document => {
      const doc = parse('<x/>');
      const error = doc.createElementNS('http://www.w3.org/1999/xhtml', 'parsererror');
      error.textContent = 'something went wrong';
      doc.documentElement.append(error);
      return doc;
    };
    expect(checkSvg('<svg/>', fake)).toEqual({ message: 'The SVG is not well-formed XML.' });
  });

  it('Chrome’s message gives the place too (line L at column C)', () => {
    const chrome = (): Document => {
      const doc = parse('<svg xmlns="http://www.w3.org/2000/svg"/>');
      const error = doc.createElementNS('http://www.w3.org/1999/xhtml', 'parsererror');
      error.textContent =
        'This page contains the following errors:error on line 3 at column 7: Opening and ending tag mismatch';
      doc.documentElement.append(error);
      return doc;
    };
    expect(checkSvg(`<svg ${NS}>\n<rect width="1">\n</svg>`, chrome)).toEqual({
      message: 'Line 3, column 7: the SVG is not well-formed XML.',
      line: 3,
      column: 7,
    });
  });

  it('an element named parsererror of the SVG itself is not an error', () => {
    expect(checkSvg(`<svg ${NS}><parsererror/></svg>`, parse)).toBeNull();
  });
});

describe('§5 «Чистка»: what goes and what stays', () => {
  it('the declaration, comments and a DOCTYPE without declarations go; white space between tags goes', () => {
    expect(
      minifySvg(
        '<?xml version="1.0"?>\n<!-- a -->\n<!DOCTYPE svg [\n  <!-- inside -->\n]>\n<svg>\n  <g>\n    <rect/>\n  </g>\n</svg>\n',
      ),
    ).toBe('<svg><g><rect/></g></svg>');
  });

  it('a DOCTYPE whose subset declares entities or attribute defaults stays', () => {
    const entity = '<!DOCTYPE svg [<!ENTITY ns "http://www.w3.org/2000/svg">]><svg xmlns="&ns;"/>';
    expect(minifySvg(entity)).toBe(entity);
    const defaults = '<!DOCTYPE svg [<!ATTLIST rect fill CDATA "red">]><svg><rect/></svg>';
    expect(minifySvg(defaults)).toBe(defaults);
  });

  it('inside tags: single spaces between attributes, none before > or />; line breaks and tabs in values are spaces', () => {
    expect(minifySvg('<svg\n   viewBox = "0 0 1 1"\n  >\n<path d="M0 0\r\n\tL1 1" />\n</svg >')).toBe(
      '<svg viewBox="0 0 1 1"><path d="M0 0  L1 1"/></svg>',
    );
  });

  it('white space inside <text>, <foreignObject>, <style> and <script> is not touched', () => {
    const text = '<text x="0">\n  <tspan>a</tspan>   <tspan>b  c</tspan>\n</text>';
    const style = '<style>\n  g  rect { fill: red }\n</style>';
    const script = '<script>\n  var a = 1;\n</script>';
    const fo = '<foreignObject>\n <div xmlns="http://www.w3.org/1999/xhtml"><b>a</b> <i>b</i></div>\n</foreignObject>';
    for (const inner of [text, style, script, fo])
      expect(minifySvg(`<svg>\n  ${inner}\n  <rect/>\n</svg>`)).toBe(`<svg>${inner}<rect/></svg>`);
  });

  it('CDATA, other processing instructions and text that is not only white space stay as written', () => {
    const svg = '<svg><style><![CDATA[\n  a  >  b {}\n]]></style><?pi  x  ?><desc>  two  spaces  </desc></svg>';
    expect(minifySvg(svg)).toBe(svg);
  });

  it('a comment inside text goes and its neighbours join (the text drawn is the same)', () => {
    expect(minifySvg('<svg><text>a<!-- x -->b</text></svg>')).toBe('<svg><text>ab</text></svg>');
  });

  it('a comment-like string inside CDATA is not a comment', () => {
    const svg = '<svg><script><![CDATA[ "<!-- not -->" ]]></script></svg>';
    expect(minifySvg(svg)).toBe(svg);
  });

  it('xml:space="preserve" outside text does not keep white space between elements (not drawn); inside text it is kept', () => {
    expect(minifySvg('<svg xml:space="preserve">\n  <g>\n    <text>  a  </text>\n  </g>\n</svg>')).toBe(
      '<svg xml:space="preserve"><g><text>  a  </text></g></svg>',
    );
  });

  it('attribute values, order, numbers and editors’ attributes are not touched', () => {
    const svg =
      '<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10.000" height="1e1" viewBox=" 0  0 10 10"><g inkscape:label="Layer  1" id="a" class="x  y"/></svg>';
    expect(minifySvg(svg)).toBe(svg);
  });
});

describe('§5 «Пространства имён»', () => {
  it('xmlns first, after the root’s name; xmlns:xlink last, before white space and >', () => {
    expect(ensureNamespaces('<svg viewBox="0 0 1 1" >\n<use xlink:href="#a"/></svg>')).toEqual({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink" >\n<use xlink:href="#a"/></svg>',
      added: ['xmlns', 'xmlns:xlink'],
    });
    expect(ensureNamespaces('<svg/>').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('nothing is added when both are there, or when xlink: appears only in text', () => {
    const svg = `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>`;
    expect(ensureNamespaces(svg)).toEqual({ svg, added: [] });
    expect(ensureNamespaces(`<svg ${NS}><desc>see xlink:href</desc></svg>`).added).toEqual([]);
  });

  it('past a prolog, and only on an svg root', () => {
    expect(ensureNamespaces('<?xml version="1.0"?><!-- <svg> --><svg/>').svg).toBe(
      '<?xml version="1.0"?><!-- <svg> --><svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    expect(ensureNamespaces('<html/>').added).toEqual([]);
  });
});

describe('§5 «Кодирование»', () => {
  it('quotes: "…" without an apostrophe become \'…\' in tags only', () => {
    expect(swapAttributeQuotes(`<?pi a="b"?><svg a="1" b="it's" c='x"y'><desc>"q"</desc></svg>`)).toBe(
      `<?pi a="b"?><svg a='1' b="it's" c='x"y'><desc>"q"</desc></svg>`,
    );
  });

  it('exactly these ASCII characters are encoded: controls, DEL, % # " \\ & < >', () => {
    const encoded: string[] = [];
    for (let c = 0; c < 128; c++)
      if (encodeSvgPayload(String.fromCharCode(c)) !== String.fromCharCode(c)) encoded.push(String.fromCharCode(c));
    const controls = Array.from({ length: 32 }, (_, c) => String.fromCharCode(c));
    expect(encoded).toEqual([...controls, '"', '#', '%', '&', '<', '>', '\\', '\u{7F}']);
    expect(encodeSvgPayload('\t\n\r')).toBe('%09%0A%0D');
    expect(encodeSvgPayload(` '(){}=:/;,?!*+$@[]^\`|~`)).toBe(` '(){}=:/;,?!*+$@[]^\`|~`);
  });

  it('above U+007F: the UTF-8 bytes, hex in capitals; an unpaired surrogate is U+FFFD', () => {
    expect(encodeSvgPayload('é€🙂')).toBe('%C3%A9%E2%82%AC%F0%9F%99%82');
    expect(encodeSvgPayload('a\u{D800}b\u{DC00}')).toBe('a%EF%BF%BDb%EF%BF%BD');
  });

  it('& is %26: the Data URI goes into an HTML attribute unchanged (§15)', () => {
    expect(ok(icon('#000', '<desc>a &amp; b</desc>'), { output: 'data-uri' }).text).toContain('a %26amp; b');
  });
});

describe('§5 «Предпросмотр», step 3: the note on scripts and outside references', () => {
  const noted = (inner: string, root = '') =>
    ok(`<svg ${NS}${root}>${inner}</svg>`).notes.some(n => n.kind === 'active-content');
  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an event attribute', '<rect onclick="x()"/>'],
    ['onload on the root', '', ' onload="x()"'],
    ['an https: image', '<image href="https://example.com/a.png"/>'],
    ['a protocol-relative use', '<use xlink:href="//example.com/s.svg#a" xmlns:xlink="http://www.w3.org/1999/xlink"/>'],
    ['a relative image (does not load from a data: URI either)', '<image href="a.png"/>'],
    ['javascript:', '<a href="javascript:x()"><rect/></a>'],
    ['CSS url() in a style attribute', '<rect style="fill:url(https://example.com/p.svg#p)"/>'],
    ['CSS url() in a presentation attribute', '<rect filter="url(//example.com/f.svg#f)"/>'],
    ['CSS @import', '<style>@import "https://example.com/a.css";</style>'],
    ['CSS url() in a style element (CDATA)', '<style><![CDATA[ rect { fill: url("https://x.example/p") } ]]></style>'],
  ])('%s', (_name, inner, root = '') => {
    expect(noted(inner, root)).toBe(true);
  });

  it.each([
    ['a fragment', '<use href="#a"/><rect fill="url(#g)"/>'],
    ['a data: image', '<image href="data:image/png;base64,AAAA"/>'],
    ['words in text', '<text>one = https://example.com</text>'],
    ['a script in a comment', '<!-- <script>x</script> -->'],
  ])('not for %s', (_name, inner) => {
    expect(noted(inner)).toBe(false);
  });

  it('a stylesheet instruction and an external entity', () => {
    expect(
      ok(`<?xml-stylesheet href="https://example.com/a.css"?><svg ${NS}/>`, { minify: false }).notes,
    ).toContainEqual({ kind: 'active-content' });
    expect(describeNotes([{ kind: 'active-content' }])).toEqual([ACTIVE_CONTENT]);
    expect(ACTIVE_CONTENT).toBe(
      'This SVG contains scripts or external references. They do not run in a CSS image, and external files do not load.',
    );
    expect(ADDED_XMLNS).toBe('Added xmlns="http://www.w3.org/2000/svg": without it a data URI does not render as SVG.');
  });
});

describe('§7 detectSvg', () => {
  it.each([
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', true],
    ['<?xml version="1.0"?>\n<!-- x -->\n<svg viewBox="0 0 1 1"/>', true],
    ['<svgfoo>', false],
    ['<div><svg>…</svg></div>', false],
    ['data:image/svg+xml,%3Csvg…', false],
    ['PHN2ZyB4bWxucz0i…', false],
    ['<html>…</html>', false],
  ])('%j → %s', (text, expected) => {
    expect(detectSvg(text)).toBe(expected);
  });

  it('near misses and what the rule says around them', () => {
    expect(detectSvg('\u{FEFF}  <svg>\n</svg>\n  ')).toBe(true);
    expect(detectSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [<!ENTITY a "b">]><svg/>')).toBe(true);
    expect(detectSvg('<!DOCTYPE html><svg/>')).toBe(false);
    expect(detectSvg('<svg>')).toBe(false);
    expect(detectSvg('<svg/><p>x</p>')).toBe(false);
    expect(detectSvg('<SVG></SVG>')).toBe(false);
    expect(detectSvg('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>')).toBe(false);
    expect(detectSvg('<!-- unclosed <svg/>')).toBe(false);
    // Only the first and last 4 KiB are read: a long prolog hides the root.
    expect(detectSvg(`<!--${'x'.repeat(5000)}--><svg/>`)).toBe(false);
    expect(detectSvg(`<svg>${'<rect/>'.repeat(100_000)}</svg>`)).toBe(true);
  });
});
