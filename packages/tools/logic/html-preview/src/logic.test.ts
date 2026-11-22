// @vitest-environment jsdom
// docs/tools/specs/html-preview.md §10, row by row, with the specification's expected values; §5.5 and §7 word for
// word; then what §5.2 says and §10 does not show. The input is parsed by jsdom's DOMParser (the logic takes the
// document whose window parses); what Chrome does with the result in the frame is the e2e module's.
import {
  FRAME_POLICY,
  FRAME_SANDBOX,
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  detectHtmlDocument,
  emptyCounts,
  isOpenableHref,
  removedText,
  sanitizeHtml,
  serializeSanitized,
} from '.';
import { describe, expect, it } from 'vitest';
import type { RemovedCounts } from '.';

const check = (input: string) => sanitizeHtml(input, document);
/** The body's markup after the check, as §10 writes it. */
const body = (input: string) => check(input).body.innerHTML;
const counts = (partial: Partial<RemovedCounts>): RemovedCounts => ({ ...emptyCounts(), ...partial });

describe('§10', () => {
  it('row 1: the empty input — an empty body, no sheets, no line', () => {
    const r = check('');
    expect(r.body.innerHTML).toBe('');
    expect(r.sheets).toEqual([]);
    expect(removedText(r.counts)).toBe('');
  });

  it('row 2: <p>Hello</p> and plain text stay as they are', () => {
    expect(body('<p>Hello</p>')).toBe('<p>Hello</p>');
    expect(body('plain text')).toBe('plain text');
  });

  it('row 3: a <style> and a style attribute become a sheet and an inline style', () => {
    const r = check('<style>p{color:red}</style><p style="font-weight:700">x</p>');
    expect(r.body.innerHTML).toBe('<p data-preview-style="0">x</p>');
    expect(r.sheets).toEqual(['p{color:red}']);
    expect(r.inline).toEqual(['font-weight:700']);
  });

  it('row 4: @import is cut and counted as an external stylesheet', () => {
    const r = check('<style>@import url("https://e.com/a.css"); .a{color:blue}</style><p class="a">x</p>');
    expect(r.sheets).toEqual([' .a{color:blue}']);
    expect(removedText(r.counts)).toBe('Not shown: 1 external stylesheet.');
  });

  it('row 5: <link rel="stylesheet"> goes and is counted', () => {
    const r = check('<link rel="stylesheet" href="https://e.com/a.css"><p>x</p>');
    expect(r.body.innerHTML).toBe('<p>x</p>');
    expect(removedText(r.counts)).toBe('Not shown: 1 external stylesheet.');
  });

  it('row 6: a script goes and is counted', () => {
    const r = check('<script>alert(1)</script><p>x</p>');
    expect(r.body.innerHTML).toBe('<p>x</p>');
    expect(removedText(r.counts)).toBe('Not shown: 1 script.');
  });

  it('row 7: an image becomes a frame with its alternative text, address and size', () => {
    const r = check('<img src="https://e.com/logo.png" alt="Logo" width="120" height="40">');
    expect(r.body.innerHTML).toBe(
      '<span class="html-preview-image" title="Image not loaded: https://e.com/logo.png" data-preview-style="0">Logo</span>',
    );
    expect(r.inline).toEqual([';width:120px;height:40px']);
    expect(removedText(r.counts)).toBe('Not shown: 1 image.');
  });

  it('row 8: a data: image is a frame with the text "image"', () => {
    const r = check('<img src="data:image/png;base64,AAAA">');
    expect(r.body.innerHTML).toBe(
      '<span class="html-preview-image" title="Image not loaded: data:image/png;base64,AAAA">image</span>',
    );
  });

  it('row 9: <picture> keeps one frame; its sources go', () => {
    const r = check('<picture><source srcset="a.webp"><img src="a.png" alt="A"></picture>');
    expect(r.body.innerHTML).toBe(
      '<picture><span class="html-preview-image" title="Image not loaded: a.png">A</span></picture>',
    );
    expect(removedText(r.counts)).toBe('Not shown: 1 image.');
  });

  it('row 10: handlers go and are counted', () => {
    const r = check('<p onclick="x()" onmouseover="y()">x</p>');
    expect(r.body.innerHTML).toBe('<p>x</p>');
    expect(removedText(r.counts)).toBe('Not shown: 2 event handlers.');
  });

  it('row 11: http(s) and mailto links open in a new tab; the rest are not opened', () => {
    const r = check(
      '<a href="https://e.com/x">ok</a> <a href="./rel.html">rel</a> <a href="#top">top</a> <a href="javascript:alert(1)">js</a> <a href="MAILTO:a@b.c" target="_top">m</a>',
    );
    expect(r.body.innerHTML).toBe(
      '<a href="https://e.com/x" target="_blank" rel="noopener noreferrer">ok</a> ' +
        '<a title="Not opened: ./rel.html">rel</a> ' +
        '<a title="Not opened: #top">top</a> ' +
        '<a title="Not opened: javascript:alert(1)">js</a> ' +
        '<a href="MAILTO:a@b.c" target="_blank" rel="noopener noreferrer">m</a>',
    );
    expect(removedText(r.counts)).toBe('Not shown: 3 links that would not open.');
  });

  it('row 12: a form loses its action and target; its fields stay', () => {
    expect(body('<form action="https://e.com/f" target="_blank"><input name="q"><button>Go</button></form>')).toBe(
      '<form><input name="q"><button>Go</button></form>',
    );
  });

  it('row 13: iframe, object and embed go and are counted', () => {
    const r = check('<iframe src="https://e.com"></iframe><object data="x.swf"></object><embed src="y">');
    expect(r.body.innerHTML).toBe('');
    expect(removedText(r.counts)).toBe('Not shown: 3 embedded frames or objects.');
  });

  it('row 14: <meta refresh> and <base> go', () => {
    const r = check('<meta http-equiv="refresh" content="0;url=https://e.com/"><base href="https://e.com/"><p>x</p>');
    expect(r.body.innerHTML).toBe('<p>x</p>');
    expect(removedText(r.counts)).toBe('');
  });

  it('row 15: a video keeps its controls; its source, poster and track go', () => {
    const r = check('<video src="https://e.com/v.mp4" controls poster="p.png"><track src="t.vtt"></video>');
    expect(r.body.innerHTML).toBe('<video controls=""></video>');
    expect(removedText(r.counts)).toBe('Not shown: 2 media sources.');
  });

  it('row 16: an SVG’s <use> and <a> lose their addresses', () => {
    const r = check(
      '<svg viewBox="0 0 10 10"><use href="https://e.com/s.svg#i"/><a href="https://e.com"><circle r="5"/></a></svg>',
    );
    expect(r.body.innerHTML).toBe('<svg viewBox="0 0 10 10"><use></use><a><circle r="5"></circle></a></svg>');
  });

  it('row 17: <html> and <body> keep lang, dir, class; the body’s style is a number; its handler is counted', () => {
    const r = check('<html lang="de" dir="ltr" class="x" data-x="1"><body class="b" onload="x()" style="margin:0">…');
    expect(r.htmlAttrs).toEqual([
      ['lang', 'de'],
      ['dir', 'ltr'],
      ['class', 'x'],
    ]);
    expect(r.bodyAttrs).toEqual([
      ['class', 'b'],
      ['data-preview-style', '0'],
    ]);
    expect(r.inline).toEqual(['margin:0']);
    expect(removedText(r.counts)).toBe('Not shown: 1 event handler.');
  });

  it('row 18: a data-preview-style in the input is not trusted; the element gets its own number', () => {
    const r = check('<p data-preview-style="0" style="color:red">spoof</p>');
    expect(r.body.innerHTML).toBe('<p data-preview-style="0">spoof</p>');
    expect(r.inline).toEqual(['color:red']);
    const two = check('<p data-preview-style="1">a</p><p style="color:red">b</p>');
    expect(two.body.innerHTML).toBe('<p>a</p><p data-preview-style="0">b</p>');
  });

  it('row 19: a template goes with its script; noscript’s content is shown', () => {
    expect(body('<template><script>alert(1)</script></template><noscript><p>No JS</p></noscript>')).toBe(
      '<p>No JS</p>',
    );
  });

  it('row 24: removedText of all zeros is empty', () => {
    expect(removedText(emptyCounts())).toBe('');
  });

  it('row 25: detectHtmlDocument (§7)', () => {
    for (const yes of ['<!DOCTYPE html><html>…', '<html lang="en">…', '  <!doctype html>', '<HTML>', '<html'])
      expect(detectHtmlDocument(yes), yes).toBe(true);
    for (const no of [
      '<div>x</div>',
      '<?xml version="1.0"?>',
      '<svg viewBox="0 0 1 1">',
      '<htmlx>',
      '{"a":1}',
      '# Title',
      '',
    ])
      expect(detectHtmlDocument(no), no).toBe(false);
  });
});

describe('§5.5 the line «Not shown»', () => {
  it('names only what is there, in its order, singular at one', () => {
    expect(removedText(counts({ scripts: 1, handlers: 1, images: 1, stylesheets: 1, imports: 1 }))).toBe(
      'Not shown: 1 script, 1 event handler, 1 image, 2 external stylesheets.',
    );
    expect(removedText(counts({ frames: 1, media: 1, inactiveLinks: 1 }))).toBe(
      'Not shown: 1 embedded frame or object, 1 media source, 1 link that would not open.',
    );
    expect(
      removedText(
        counts({ scripts: 2, handlers: 3, images: 4, stylesheets: 5, frames: 6, media: 7, inactiveLinks: 8 }),
      ),
    ).toBe(
      'Not shown: 2 scripts, 3 event handlers, 4 images, 5 external stylesheets, 6 embedded frames or objects, 7 media sources, 8 links that would not open.',
    );
  });

  it('does not name what the CSS lost (its url()s are not part of the line)', () => {
    expect(removedText(counts({ styleUrls: 3 }))).toBe('');
  });
});

describe('§7 detection on large and odd inputs', () => {
  it('reads the start only: a megabyte answers at once, and a document after 1 Ki of spaces is not one', () => {
    const start = performance.now();
    expect(detectHtmlDocument(`<!doctype html>${'x'.repeat(4 * MAX_INPUT)}`)).toBe(true);
    expect(detectHtmlDocument(`${' '.repeat(2048)}<html>`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('a byte order mark and line breaks before the document are trimmed', () => {
    expect(detectHtmlDocument('\uFEFF\n<!doctype html>')).toBe(true);
    expect(detectHtmlDocument('<!doctype htmlx>')).toBe(false);
    expect(detectHtmlDocument('<!doctype\nhtml>')).toBe(true);
  });
});

describe('§5.2 step 7: isOpenableHref', () => {
  it('http, https, mailto in any case, edges trimmed; nothing hidden inside', () => {
    for (const yes of ['https://e.com', 'http://e.com', 'MAILTO:a@b.c', '  https://e.com/x  ', 'HtTpS://e.com'])
      expect(isOpenableHref(yes), yes).toBe(true);
    for (const no of [
      './rel.html',
      '#top',
      '/account',
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'vbscript:x',
      'data:text/html,x',
      'ftp://e.com',
      'chrome://settings',
      'https://e.com/a b',
      'https://e.com/\u0000',
      'http\n://e.com',
      '',
    ])
      expect(isOpenableHref(no), JSON.stringify(no)).toBe(false);
  });
});

describe('§9 constants', () => {
  it('the limits, the sandbox and the frame’s policy', () => {
    expect([LIVE_INPUT, MAX_INPUT, SETTLE_MS]).toEqual([262144, 1048576, 300]);
    expect(FRAME_SANDBOX).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    for (const directive of ['default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'media-src', 'frame-src'])
      expect(FRAME_POLICY).toContain(`${directive} 'none'`);
    expect(FRAME_POLICY).not.toContain("'self'");
  });
});

describe('§5.6 Copy HTML', () => {
  it('one document: the kept attributes, one <style> with the sheets, the body with its styles written back', () => {
    const r = check(
      '<html lang="en"><head><style>p{color:red}</style><style>.b{margin:0}</style></head><body class="b" style="margin:7px"><p style="font-weight:700">x</p><img src="https://e.com/a.png" alt="A" width="12"></body></html>',
    );
    expect(serializeSanitized(r)).toBe(
      '<!doctype html>\n<html lang="en"><head><style>p{color:red}\n.b{margin:0}</style></head>' +
        '<body class="b" style="margin:7px"><p style="font-weight:700">x</p>' +
        '<span class="html-preview-image" title="Image not loaded: https://e.com/a.png" style=";width:12px">A</span></body></html>',
    );
  });

  it('without sheets, an empty head', () => {
    expect(serializeSanitized(check('<p>x</p>'))).toBe(
      '<!doctype html>\n<html><head></head><body><p>x</p></body></html>',
    );
  });
});
