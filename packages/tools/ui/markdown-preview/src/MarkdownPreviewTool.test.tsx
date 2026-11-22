import { definition } from './definition';
import { FRAME_POLICY, FRAME_SANDBOX, frameSource } from './FramedDocument';
import MarkdownPreviewTool from './MarkdownPreviewTool';
import previewCss from './preview.css?raw';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lintCss } from '@workspace/dna/lint';
import { LIVE_INPUT, MAX_INPUT, SETTLE_MS } from '@workspace/tool-logic-markdown-preview';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

// docs/tools/specs/markdown-preview.md §2 (scenarios), §6 (states, word for word), §8 (the page), §12 (limits), the
// frame (README «Приватность и разрешения»: pasted markup only in a frame that runs nothing) and the tool's history
// (D17, docs/tools/history.md §10 row 23). jsdom loads no srcdoc: its frame document is the initial empty one, which is
// enough to see what the page builds into it; what the browser does with the srcdoc is the e2e module's.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
});

const field = () => screen.getByLabelText('Markdown') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const frame = () => screen.getByTitle('Preview') as HTMLIFrameElement;
const body = () => frame().contentDocument!.body;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const errorLine = () => document.querySelector('[data-part="error"]')!.textContent!.trim();
/** The frame's document is there after its load event; jsdom fires it once the frame is attached. */
const loaded = () => waitFor(() => expect(body().className).toBe('md-preview'));
const settle = () => act(async () => undefined);
const stubClipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(void text));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};
/** The frame's body as markup, without the line breaks between tags (how §10 writes results). */
const shown = () => body().innerHTML.replace(/>\n</g, '><').replace(/\n$/, '');

const README = ['# Project', '', '| Name | Size |', '|:--|--:|', '| a | 1 |', '', '```sh', 'pnpm install', '```'].join(
  '\n',
);

describe('the Markdown Preview tool', () => {
  it('is described by its definition, which loads it: data, no shortcut, its result is derived from the input', async () => {
    expect(definition).toMatchObject({
      id: 'markdown-preview',
      title: 'Markdown Preview',
      summary: 'See how Markdown renders. Nothing is loaded and nothing runs.',
      keywords: ['markdown', 'md', 'preview', 'render', 'readme', 'commonmark', 'gfm', 'table'],
      order: 23,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect((await definition.load()).default).toBe(MarkdownPreviewTool);
  });

  it('renders with no host at all: the field, its placeholder, the frame and the empty state (§6, §8)', async () => {
    render(<MarkdownPreviewTool />);
    expect(field().placeholder).toBe('# Paste Markdown here');
    expect(field().getAttribute('spellcheck')).toBe('false');
    await loaded();
    expect(body().textContent).toBe('The preview appears here.');
    expect(body().querySelector('.md-empty')).toBeTruthy();
    expect(button('Copy HTML').disabled).toBe(true);
    expect(errorLine()).toBe('');
  });

  it('the preview is a sandboxed frame that may not run scripts, with a policy of its own and the package’s stylesheet', () => {
    render(<MarkdownPreviewTool />);
    const f = frame();
    expect(f.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(FRAME_SANDBOX.split(' ')).not.toContain('allow-scripts');
    expect(FRAME_SANDBOX.split(' ')).not.toContain('allow-top-navigation');
    expect(FRAME_SANDBOX.split(' ')).not.toContain('allow-forms');
    expect(f.getAttribute('src')).toBeNull();
    const srcdoc = f.getAttribute('srcdoc')!;
    expect(srcdoc).toBe(frameSource(srcdoc.match(/<link rel="stylesheet" href="([^"]+)">/)![1]!));
    expect(srcdoc).toContain(`<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`);
    expect(srcdoc).not.toMatch(/<script|blob:|data:/);
    expect(FRAME_POLICY).toContain("script-src 'none'");
    expect(FRAME_POLICY).toContain("img-src 'none'");
    expect(FRAME_POLICY).toContain("default-src 'none'");
    // The stylesheet is a file of the package (Vite gives its address), never inline.
    expect(srcdoc.match(/href="([^"]+)"/)![1]).toMatch(/preview\.css/);
  });

  it('§2.1: a README with a heading, an aligned table and a code block', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type(README);
    await waitFor(() => expect(body().querySelector('h1')?.textContent).toBe('Project'));
    expect([...body().querySelectorAll('th')].map(th => th.className)).toEqual(['md-align-left', 'md-align-right']);
    expect(body().querySelector('pre > code.language-sh')!.textContent).toBe('pnpm install\n');
    expect(body().querySelector('[style]')).toBeNull();
  });

  it('§2.2: task list items are disabled checkboxes, out of the Tab order', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type('- [x] tests\n- [ ] docs');
    await waitFor(() => expect(body().querySelectorAll('input')).toHaveLength(2));
    const boxes = [...body().querySelectorAll('input')];
    expect(boxes.map(b => [b.type, b.disabled, b.checked])).toEqual([
      ['checkbox', true, true],
      ['checkbox', true, false],
    ]);
  });

  it('§2.3: an image is a frame with its text and the address on hover — no <img> anywhere', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type('![CI](https://example.com/badge.svg)');
    await waitFor(() => expect(body().querySelector('.md-image')).toBeTruthy());
    const image = body().querySelector('.md-image')!;
    expect(image.textContent).toBe('CI');
    expect(image.getAttribute('title')).toBe('Image not loaded: https://example.com/badge.svg');
    expect(document.querySelector('img')).toBeNull();
    expect(body().querySelector('img')).toBeNull();
  });

  it('§2.4–2.5: an https link opens in a new tab; a relative one is inactive text', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type('[docs](https://example.com/docs) [guide](./CONTRIBUTING.md)');
    await waitFor(() => expect(body().querySelector('a')).toBeTruthy());
    expect(shown()).toBe(
      '<p><a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">docs</a> ' +
        '<span class="md-link-inactive" title="Not opened: ./CONTRIBUTING.md">guide</span></p>',
    );
  });

  it('§2.6: raw HTML is text', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type('<details><summary>More</summary>…</details>');
    await waitFor(() => expect(body().textContent!.trim()).toBe('<details><summary>More</summary>…</details>'));
    expect(body().querySelector('details')).toBeNull();
  });

  it('§2.7: Copy HTML copies the preview’s HTML, "Copied" until the next change', async () => {
    const writeText = stubClipboard();
    render(<MarkdownPreviewTool />);
    await loaded();
    type('# Hi\n\n*there*');
    await waitFor(() => expect(button('Copy HTML').disabled).toBe(false));
    fireEvent.click(button('Copy HTML'));
    await waitFor(() => expect(button('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('<h1>Hi</h1>\n<p><em>there</em></p>\n');
    type('# Hi\n\n*there!*');
    await waitFor(() => expect(button('Copy HTML')).toBeTruthy());
  });

  it('§6: only spaces and line breaks — an empty preview, Copy HTML off', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type(' \n\n  \n');
    await waitFor(() => expect(body().textContent!.trim()).toBe(''));
    expect(body().childElementCount).toBe(0);
    expect(button('Copy HTML').disabled).toBe(true);
  });

  it('§6: a script tag, a handler and a javascript: link change nothing on the page', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    type('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[js](javascript:alert(1))');
    await waitFor(() => expect(body().querySelectorAll('p')).toHaveLength(3));
    expect(shown()).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>[js](javascript:alert(1))</p>',
    );
    // The tool page itself never holds the preview's markup: only the field, the buttons and the frame.
    expect(document.body.querySelector('p, h1, a, script, img, [onerror]')?.closest('iframe')).toBeFalsy();
    expect(document.body.querySelectorAll('script')).toHaveLength(0);
  });

  it('follows the page’s theme: the frame’s <html> wears data-theme and data-mode, also after a change', async () => {
    document.documentElement.setAttribute('data-theme', 'default-light');
    document.documentElement.setAttribute('data-mode', 'light');
    render(<MarkdownPreviewTool />);
    await loaded();
    const html = frame().contentDocument!.documentElement;
    await waitFor(() => expect(html.getAttribute('data-theme')).toBe('default-light'));
    expect(html.getAttribute('data-mode')).toBe('light');
    document.documentElement.setAttribute('data-theme', 'default-dark');
    document.documentElement.setAttribute('data-mode', 'dark');
    await waitFor(() => expect(html.getAttribute('data-theme')).toBe('default-dark'));
    expect(html.getAttribute('data-mode')).toBe('dark');
  });

  it('its stylesheet keeps the @workspace/dna contract (tokens only, the package’s theme.css)', () => {
    expect(previewCss.length).toBeGreaterThan(500);
    expect(lintCss(previewCss, { file: 'preview.css', imports: ['@workspace/dna/theme.css'] })).toEqual([]);
  });
});

describe('the Markdown Preview tool’s limits (§6, §12)', () => {
  it('follows every edit up to 64 Ki, and 300 ms after the last edit above it', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    vi.useFakeTimers();
    type('a'.repeat(LIVE_INPUT));
    expect(body().textContent!.trim()).toHaveLength(LIVE_INPUT);
    type('b'.repeat(LIVE_INPUT + 1));
    expect(body().textContent!.startsWith('a')).toBe(true); // still the previous preview
    act(() => vi.advanceTimersByTime(SETTLE_MS - 10));
    expect(body().textContent!.startsWith('a')).toBe(true);
    // Above 64 Ki markdown-it works off the page (here, without workers, a frame later on the page).
    await act(() => vi.advanceTimersByTimeAsync(20));
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(body().textContent!.trim()).toBe('b'.repeat(LIVE_INPUT + 1));
  });

  it('above 1 Mi the preview is empty and the field says why, at once; one character fewer is drawn', async () => {
    render(<MarkdownPreviewTool />);
    await loaded();
    vi.useFakeTimers();
    type('x'.repeat(MAX_INPUT + 1));
    expect(errorLine()).toBe('Text is larger than 1 MB. Markdown Preview works with up to 1 MB.');
    expect(body().childElementCount).toBe(0);
    expect(button('Copy HTML').disabled).toBe(true);
    type('x'.repeat(MAX_INPUT));
    expect(errorLine()).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS + 10));
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(body().textContent!.trim()).toHaveLength(MAX_INPUT);
  });
});

describe('the Markdown Preview tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('markdown-preview', definition.history!).list({})).entries;

  it('declares one open kind, Previewed', () => {
    expect(definition.history).toMatchObject({ kinds: [{ id: 'preview', title: 'Previewed' }], schema: 1 });
    expect(definition.history!.kinds.some(k => k.secret)).toBe(false);
  });

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<MarkdownPreviewTool host={host} />);
    type('# Release notes\n\nText');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('Release notes · 21 characters');
    render(<MarkdownPreviewTool host={host} />).unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy HTML at once, with the Markdown — never the HTML', async () => {
    stubClipboard();
    const host = memoryHost();
    render(<MarkdownPreviewTool host={host} />);
    await loaded();
    type('- [x] done');
    await waitFor(() => expect(button('Copy HTML').disabled).toBe(false));
    fireEvent.click(button('Copy HTML'));
    await waitFor(async () => expect((await entriesOf(host)).some(e => e.label?.endsWith('HTML copied'))).toBe(true));
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('HTML copied'))!;
    expect(copied.label).toBe('done · 10 characters · HTML copied');
    const opened = await host.history.forOwner('markdown-preview', definition.history!).open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({ action: 'copy' });
    expect(Object.keys(opened.blobs)).toEqual(['input']);
    expect(await opened.blobs.input!.text()).toBe('- [x] done');
  });

  it('opens an entry back into the tool, and opening records nothing', async () => {
    const host = memoryHost();
    const first = render(<MarkdownPreviewTool host={host} />);
    type('## Notes\n\n**bold**');
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);

    const second = render(<MarkdownPreviewTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Notes · 18 characters.')).toBeTruthy();
    expect(field().value).toBe('## Notes\n\n**bold**');
    await waitFor(() => expect(body().querySelector('strong')?.textContent).toBe('bold'));
    second.unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    const { unmount } = render(<MarkdownPreviewTool host={host} input={'# From the start page'} />);
    await settle();
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
  });
});
