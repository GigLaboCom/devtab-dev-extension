// @vitest-environment jsdom
// The allowlist builds nodes of a Document passed in (§9); jsdom gives the test one, the logic never reaches for it.
import { LIVE_INPUT, MAX_INPUT, SETTLE_MS, createRenderer, isOpenableHref, renderMarkdown, toSafeFragment } from '.';
import { describe, expect, it } from 'vitest';

/** The HTML after §5.6, without the line breaks between tags (how §10 writes its results). */
const safe = (markdown: string): string => serialize(toSafeFragment(renderMarkdown(markdown), document));
const serialize = (fragment: DocumentFragment): string => {
  const holder = document.createElement('div');
  holder.append(fragment);
  return holder.innerHTML.replace(/>\n</g, '><').replace(/\n$/, '');
};
const openable = (href: string, text: string, title?: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer"${title === undefined ? '' : ` title="${title}"`}>${text}</a>`;

describe('docs/tools/specs/markdown-preview.md §10', () => {
  it('row 1: empty input — nothing', () => {
    expect(renderMarkdown('')).toBe('');
    expect(safe('')).toBe('');
  });

  it('row 2: ATX and Setext headings', () => {
    expect(safe('# Title')).toBe('<h1>Title</h1>');
    expect(safe('Setext\n===')).toBe('<h1>Setext</h1>');
  });

  it('row 3: emphasis, strong, strikethrough, code', () => {
    expect(safe('*em* **strong** ~~gone~~ `code`')).toBe(
      '<p><em>em</em> <strong>strong</strong> <s>gone</s> <code>code</code></p>',
    );
  });

  it('row 4: an ordered list keeps its start', () => {
    expect(safe('3. three\n4. four')).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  });

  it('row 5: task lists — three tasks, the fourth item is not one', () => {
    expect(safe('- [ ] todo\n- [x] done\n- [X] Done\n- not [ ] a task')).toBe(
      '<ul>' +
        '<li class="task-list-item"><input type="checkbox" disabled="">todo</li>' +
        '<li class="task-list-item"><input type="checkbox" disabled="" checked="">done</li>' +
        '<li class="task-list-item"><input type="checkbox" disabled="" checked="">Done</li>' +
        '<li>not [ ] a task</li>' +
        '</ul>',
    );
  });

  it('row 6: column alignment becomes classes, never a style attribute', () => {
    const html = safe('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    expect(html).toBe(
      '<table><thead><tr>' +
        '<th class="md-align-left">a</th><th class="md-align-center">b</th><th class="md-align-right">c</th>' +
        '</tr></thead><tbody><tr>' +
        '<td class="md-align-left">1</td><td class="md-align-center">2</td><td class="md-align-right">3</td>' +
        '</tr></tbody></table>',
    );
    expect(renderMarkdown('| a |\n|:-:|\n| 1 |')).not.toContain('style');
  });

  it('row 7: a table without alignment has no classes', () => {
    expect(safe('a | b\n--|--\n1 | 2')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
  });

  it('row 8: a fenced block keeps its language class, its text escaped', () => {
    expect(safe('```js\nconst x = 1 < 2;\n```')).toBe(
      '<pre><code class="language-js">const x = 1 &lt; 2;\n</code></pre>',
    );
  });

  it('row 9: indented code', () => {
    expect(safe('    indented code')).toBe('<pre><code>indented code\n</code></pre>');
  });

  it('row 10: two trailing spaces break the line, a single newline does not', () => {
    expect(safe('line one  \nline two')).toBe('<p>line one<br>\nline two</p>');
    expect(safe('soft\nbreak')).toBe('<p>soft\nbreak</p>');
  });

  it('row 11: an http(s) link opens in a new tab, with its title', () => {
    expect(safe('[ok](https://example.com "T")')).toBe(`<p>${openable('https://example.com', 'ok', 'T')}</p>`);
  });

  it('row 12: mailto, a bare mail address, an autolink and an upper-case scheme are openable', () => {
    expect(safe('[mail](mailto:a@b.c)')).toBe(`<p>${openable('mailto:a@b.c', 'mail')}</p>`);
    expect(safe('a@b.com')).toBe(`<p>${openable('mailto:a@b.com', 'a@b.com')}</p>`);
    expect(safe('<https://example.com>')).toBe(`<p>${openable('https://example.com', 'https://example.com')}</p>`);
    expect(safe('HTTP://EXAMPLE.COM/X')).toBe(`<p>${openable('HTTP://EXAMPLE.COM/X', 'HTTP://EXAMPLE.COM/X')}</p>`);
  });

  it('row 13: a reference link', () => {
    expect(safe('[ref]\n\n[ref]: https://example.com/r')).toBe(`<p>${openable('https://example.com/r', 'ref')}</p>`);
  });

  it('row 14: a relative link and a fragment are inactive text with the address on hover', () => {
    expect(safe('[rel](./other.md) [frag](#section)')).toBe(
      '<p><span class="md-link-inactive" title="Not opened: ./other.md">rel</span> ' +
        '<span class="md-link-inactive" title="Not opened: #section">frag</span></p>',
    );
  });

  it('row 15: javascript: and data: links stay as their source text', () => {
    expect(safe('[js](javascript:alert(1))')).toBe('<p>[js](javascript:alert(1))</p>');
    expect(safe('[data](data:text/html,x)')).toBe('<p>[data](data:text/html,x)</p>');
  });

  it('row 16: a script tag is text', () => {
    expect(safe('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('row 17: tags with handlers are text', () => {
    expect(safe('<b onclick="x()">bold</b>')).toBe('<p>&lt;b onclick="x()"&gt;bold&lt;/b&gt;</p>');
    expect(safe('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('row 18: an image is a frame with its alternative text, never an <img>', () => {
    expect(safe('![logo](https://example.com/logo.png "Logo")')).toBe(
      '<p><span class="md-image" title="Image not loaded: https://example.com/logo.png">logo</span></p>',
    );
  });

  it('row 19: a data: image without alternative text says "image"', () => {
    expect(safe('![](data:image/png;base64,AAAA)')).toBe(
      '<p><span class="md-image" title="Image not loaded: data:image/png;base64,AAAA">image</span></p>',
    );
  });

  it('row 20: www. without a scheme is text; the full stop after a link is not part of it', () => {
    expect(safe('visit www.example.com or https://example.org/x?y=1.')).toBe(
      `<p>visit www.example.com or ${openable('https://example.org/x?y=1', 'https://example.org/x?y=1')}.</p>`,
    );
  });

  it('row 21: character references', () => {
    expect(safe('&copy; &amp; &#x41; &nosuch;')).toBe('<p>© &amp; A &amp;nosuch;</p>');
  });

  it('row 22: a backslash escape', () => {
    expect(safe('\\*not em\\*')).toBe('<p>*not em*</p>');
  });

  it('row 23: a footnote is a reference link to its text, inactive', () => {
    expect(safe('footnote[^1]\n\n[^1]: note')).toBe(
      '<p>footnote<span class="md-link-inactive" title="Not opened: note">^1</span></p>',
    );
  });

  it('row 24: the allowlist on hostile HTML directly', () => {
    const hostile =
      '<p onclick="x()" style="color:red" class="evil md-image">a' +
      '<img src="https://e.invalid/x.png" onerror="parent.pwned=1">' +
      '<script>parent.pwned=1</script>' +
      '<a href="javascript:alert(1)">j</a>' +
      '<span class="md-image" title="Image not loaded: https://e.com/y.png">alt</span>' +
      '<iframe src="https://e.invalid/"></iframe>' +
      '<svg><use href="https://e.invalid/s.svg#i"></use></svg>' +
      '<input type="text" value="v">' +
      '<span class="x">plain</span>' +
      '<a href="https://ok.com" target="_top">ok</a></p>';
    expect(serialize(toSafeFragment(hostile, document))).toBe(
      '<p>a<span class="md-link-inactive" title="Not opened: javascript:alert(1)">j</span>' +
        '<span class="md-image" title="Image not loaded: https://e.com/y.png">alt</span>plain' +
        '<a href="https://ok.com" target="_blank" rel="noopener noreferrer">ok</a></p>',
    );
  });
});

describe('§5.4: which addresses open', () => {
  it.each([
    'https://example.com',
    'http://example.com/x?y=1#z',
    'HTTP://EXAMPLE.COM/X',
    'HtTpS://example.com',
    'mailto:a@b.c',
    'MAILTO:a@b.c',
  ])('%s opens', href => expect(isOpenableHref(href)).toBe(true));

  it.each([
    './other.md',
    '#section',
    '/absolute/path',
    '//example.com/protocol-relative',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:x',
    'data:text/html,x',
    'file:///etc/passwd',
    'ftp://example.com/',
    'chrome://settings',
    'chrome-extension://abc/x.html',
    'blob:https://example.com/1',
    ' https://example.com',
    '\u0001https://example.com',
    'https://exa\tmple.com',
    'https://example.com/\n',
    'java%09script:alert(1)',
    'https',
    '',
  ])('%j does not', href => expect(isOpenableHref(href)).toBe(false));
});

describe('§9 and §12: the constants and the renderer', () => {
  it('limits: 64 Ki live, 1 Mi at most, 300 ms settle', () => {
    expect([LIVE_INPUT, MAX_INPUT, SETTLE_MS]).toEqual([65_536, 1_048_576, 300]);
  });

  it('createRenderer is markdown-it with the options of §5.1', () => {
    const md = createRenderer();
    expect(md.options).toMatchObject({ html: false, linkify: true, typographer: false, breaks: false });
    // A fresh renderer renders what the shared one does.
    expect(md.render('- [x] a')).toBe(renderMarkdown('- [x] a'));
  });
});
