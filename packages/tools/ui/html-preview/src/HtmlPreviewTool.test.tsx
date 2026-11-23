import { definition } from './definition';
import { HINT } from './entries';
import HtmlPreviewTool from './HtmlPreviewTool';
import { htmlPreviewSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  BASE_CSS,
  FRAME_POLICY,
  FRAME_SANDBOX,
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
} from '@workspace/tool-logic-html-preview';
import { memoryHost } from '@workspace/tools-host';
import { FRAME_SANDBOX as KIT_SANDBOX, frameSource } from '@workspace/ui/framed-document';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// docs/tools/specs/html-preview.md §2 (scenarios), §6 (states, word for word), §8 (the page), §12 (limits) and the
// tool's history (D17, docs/tools/history.md §10 row 24). jsdom loads no srcdoc (its frame document is the initial
// empty one) and has no constructed stylesheets: each frame window gets `CSSStyleSheet.replaceSync` and
// `document.adoptedStyleSheets` that keep the text, enough to see what the page puts into the frame; what Chrome does
// with it (the sandbox, the policy, the cascade) is the e2e module's.

const adopted = new WeakMap<Document, string[]>();
beforeAll(() => {
  const frameDocument = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument')!;
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const doc = frameDocument.get!.call(this) as Document | null;
      const view = doc?.defaultView as (Window & typeof globalThis) | null;
      if (doc && view && !('adoptedStyleSheets' in view.Document.prototype)) {
        Object.defineProperty(view.CSSStyleSheet.prototype, 'replaceSync', {
          configurable: true,
          value(this: CSSStyleSheet & { text?: string }, text: string) {
            this.text = text;
          },
        });
        Object.defineProperty(view.Document.prototype, 'adoptedStyleSheets', {
          configurable: true,
          get(this: Document) {
            return adopted.get(this) ?? [];
          },
          set(this: Document, sheets: Array<{ text: string }>) {
            adopted.set(
              this,
              sheets.map(s => s.text),
            );
          },
        });
      }
      return doc;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
});

const field = () => screen.getByLabelText('HTML') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const frame = () => screen.getByTitle('HTML preview') as HTMLIFrameElement;
const doc = () => frame().contentDocument!;
const body = () => doc().body;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const line = (part: string) => document.querySelector(`[data-part="${part}"]`)!.textContent!.trim();
const drawn = () => Number(frame().getAttribute('data-rendered') ?? 0);
/** The frame has drawn at least once more than `before`. */
const redrawn = (before: number) => waitFor(() => expect(drawn()).toBeGreaterThan(before));
const loaded = () => waitFor(() => expect(drawn()).toBeGreaterThan(0));
const settle = () => act(async () => undefined);
const stubClipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(void text));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};
const choose = async (option: string) => {
  fireEvent.keyDown(screen.getByLabelText('Width'), { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};

const MAIL = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Your order</title>',
  '<style>.card { color: rgb(255, 0, 0); font-weight: 700 } body { margin: 7px }</style></head>',
  '<body style="background:rgb(244, 244, 244)">',
  '<table class="card" style="border:1px solid rgb(0, 0, 255)"><tr><td>',
  '<img src="https://example.com/logo.png" alt="Logo" width="120" height="40" style="border:0">',
  '<p>Hello, Ann</p><img src="https://example.com/a.png" alt="A"><img src="https://example.com/b.png">',
  '</td></tr></table></body></html>',
].join('');

describe('the HTML Preview tool', () => {
  it('is described by its definition, which loads it: data, no shortcut, its result is derived from the input', async () => {
    expect(definition).toMatchObject({
      id: 'html-preview',
      title: 'HTML Preview',
      summary: 'Render pasted HTML with its styles. Scripts never run and nothing is loaded.',
      keywords: ['html', 'preview', 'render', 'email', 'template', 'snippet', 'css', 'sandbox'],
      order: 24,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect((await definition.load()).default).toBe(HtmlPreviewTool);
  });

  it('recognises a whole HTML document from a module of its own (§7)', async () => {
    const { detect } = await import('./detect');
    for (const yes of ['<!DOCTYPE html><html>…', '<html lang="en">…', '  <!doctype html>', '<HTML>'])
      expect(detect(yes)).toBe(true);
    for (const no of ['<div>x</div>', '<?xml version="1.0"?>', '<svg>', '<htmlx>', '{"a":1}', '# Title', ''])
      expect(detect(no)).toBe(false);
  });

  it('renders with no host at all: the field, its placeholder, Width, Copy HTML off, an empty frame, the hint (§6, §8)', async () => {
    render(<HtmlPreviewTool />);
    expect(field().placeholder).toBe('<p>Paste HTML here</p>');
    expect(field().getAttribute('spellcheck')).toBe('false');
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByLabelText('Width').textContent).toContain('Fit');
    expect(button('Copy HTML').disabled).toBe(true);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(HINT).toBe(
      'Scripts are not run. Images, fonts and external styles are not loaded. Links open in a new tab.',
    );
    await loaded();
    expect(body().childNodes).toHaveLength(0);
    expect(line('removed')).toBe('');
    expect(line('error')).toBe('');
    expect(adopted.get(doc())).toEqual([BASE_CSS]);
  });

  it('the preview is the kit’s sandboxed frame: no scripts, a policy that lets nothing load, no stylesheet, no theme', async () => {
    document.documentElement.setAttribute('data-theme', 'default-dark');
    document.documentElement.setAttribute('data-mode', 'dark');
    render(<HtmlPreviewTool />);
    const f = frame();
    expect(f.getAttribute('sandbox')).toBe(FRAME_SANDBOX);
    expect(FRAME_SANDBOX).toBe(KIT_SANDBOX);
    expect(FRAME_SANDBOX.split(' ')).not.toContain('allow-scripts');
    expect(FRAME_SANDBOX.split(' ')).not.toContain('allow-forms');
    expect(f.getAttribute('src')).toBeNull();
    expect(f.getAttribute('srcdoc')).toBe(frameSource(undefined, FRAME_POLICY));
    expect(f.getAttribute('srcdoc')).not.toMatch(/<link|<script|<style|blob:|data:/);
    await loaded();
    expect(doc().documentElement.hasAttribute('data-theme')).toBe(false);
    expect(doc().documentElement.hasAttribute('data-mode')).toBe(false);
  });

  it('§2.1: a mail template — its <style> adopted, its style attributes set through CSSOM, images as frames', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type(MAIL);
    await waitFor(() => expect(body().querySelector('p')?.textContent).toBe('Hello, Ann'));
    expect(line('removed')).toBe('Not shown: 3 images.');
    expect(adopted.get(doc())).toEqual([
      BASE_CSS,
      '.card { color: rgb(255, 0, 0); font-weight: 700 } body { margin: 7px }',
    ]);
    const frames = [...body().querySelectorAll('.html-preview-image')] as HTMLElement[];
    expect(frames.map(f => [f.textContent, f.title])).toEqual([
      ['Logo', 'Image not loaded: https://example.com/logo.png'],
      ['A', 'Image not loaded: https://example.com/a.png'],
      ['image', 'Image not loaded: https://example.com/b.png'],
    ]);
    expect(frames[0]!.style.width).toBe('120px');
    expect(frames[0]!.style.height).toBe('40px');
    expect((body().querySelector('table') as HTMLElement).style.border).toBe('1px solid rgb(0, 0, 255)');
    expect(body().style.background).toContain('rgb(244, 244, 244)');
    expect(doc().documentElement.lang).toBe('en');
    expect(body().querySelector('[data-preview-style]')).toBeNull();
    expect(doc().querySelector('img, script, style, link, meta, title')).toBeNull();
    // The tool page itself never holds the pasted markup.
    expect(document.body.querySelector('table, img, .html-preview-image')).toBeNull();
  });

  it('§2.2: a server’s error page — its scripts and external stylesheet are not shown, and the line says so', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type(
      '<html><head><link rel="stylesheet" href="https://cdn.example.com/a.css"><script src="https://cdn.example.com/a.js"></script></head>' +
        '<body><h1 style="color:rgb(200, 0, 0)">500 Internal Server Error</h1><script>report()</script></body></html>',
    );
    await waitFor(() => expect(body().querySelector('h1')?.textContent).toBe('500 Internal Server Error'));
    expect(line('removed')).toBe('Not shown: 2 scripts, 1 external stylesheet.');
    expect((body().querySelector('h1') as HTMLElement).style.color).toBe('rgb(200, 0, 0)');
    expect(document.querySelector('[data-part="removed"] svg')).toBeTruthy();
  });

  it('§2.3: an https link opens in a new tab without opener; /account is not opened and says so on hover', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type('<a href="https://example.com">site</a> <a href="/account">account</a>');
    await waitFor(() => expect(body().querySelectorAll('a')).toHaveLength(2));
    const [site, account] = [...body().querySelectorAll('a')];
    expect([site!.getAttribute('href'), site!.target, site!.rel]).toEqual([
      'https://example.com',
      '_blank',
      'noopener noreferrer',
    ]);
    expect(account!.hasAttribute('href')).toBe(false);
    expect(account!.title).toBe('Not opened: /account');
    expect(line('removed')).toBe('Not shown: 1 link that would not open.');
  });

  it('§2.4: Width — 375 px narrows the frame, wider than the column scrolls; Fit fills it again', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    expect(frame().style.width).toBe('');
    await choose('375 px');
    await waitFor(() => expect(frame().style.width).toBe('375px'));
    await choose('1024 px');
    await waitFor(() => expect(frame().style.width).toBe('1024px'));
    expect(document.querySelector('[data-part="viewport"]')!.className).toContain('overflow-x-auto');
    await choose('Fit');
    await waitFor(() => expect(frame().style.width).toBe(''));
  });

  it('§2.5: Copy HTML copies the checked HTML as one document, "Copied" until the next change', async () => {
    const writeText = stubClipboard();
    render(<HtmlPreviewTool />);
    await loaded();
    type(
      '<style>p{color:red}</style><p style="font-weight:700" onclick="x()">x</p><img src="https://example.com/a.png" alt="A">',
    );
    await waitFor(() => expect(button('Copy HTML').disabled).toBe(false));
    fireEvent.click(button('Copy HTML'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toBe(
      '<!doctype html>\n<html><head><style>p{color:red}</style></head><body><p style="font-weight:700">x</p>' +
        '<span class="html-preview-image" title="Image not loaded: https://example.com/a.png">A</span></body></html>',
    );
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    type('<p>y</p>');
    await waitFor(() => expect(button('Copy HTML')).toBeTruthy());
  });

  it('§5.2 step 8: a form’s fields fill, but a press that would send it is held back', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type(
      '<form action="https://example.com/f"><input name="q"><button>Go</button><button type="button">Plain</button></form>',
    );
    await waitFor(() => expect(body().querySelector('form')).toBeTruthy());
    const press = (el: Element, init: EventInit & { key?: string } = {}, kind: 'click' | 'keydown' = 'click') => {
      const event =
        kind === 'click'
          ? new (doc().defaultView!.MouseEvent)('click', { bubbles: true, cancelable: true })
          : new (doc().defaultView!.KeyboardEvent)('keydown', { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const [go, plain] = [...body().querySelectorAll('button')];
    expect(press(go!)).toBe(true);
    expect(press(plain!)).toBe(false);
    expect(press(body().querySelector('input')!, { key: 'Enter' }, 'keydown')).toBe(true);
    expect(press(body().querySelector('input')!, { key: 'a' }, 'keydown')).toBe(false);
    expect(body().querySelector('form')!.hasAttribute('action')).toBe(false);
  });

  it('§6: only spaces — an empty frame, no line, Copy HTML off; plain text is shown as text', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type('plain text');
    await waitFor(() => expect(body().textContent).toBe('plain text'));
    expect(button('Copy HTML').disabled).toBe(false);
    type('  \n\t ');
    await waitFor(() => expect(button('Copy HTML').disabled).toBe(true));
    expect(body().textContent!.trim()).toBe('');
    expect(line('removed')).toBe('');
  });

  it('§6: <base>, <meta refresh>, a fragment link and rtl', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type(
      '<html dir="rtl" lang="he"><head><base href="https://example.com/"><meta http-equiv="refresh" content="0;url=https://example.com/"></head><body><a href="#top">top</a> שלום</body></html>',
    );
    await waitFor(() => expect(body().textContent).toBe('top שלום'));
    expect(doc().documentElement.dir).toBe('rtl');
    expect(doc().documentElement.lang).toBe('he');
    expect(body().querySelector('a')!.title).toBe('Not opened: #top');
    expect(doc().querySelector('base, meta[http-equiv]')).toBeNull();
  });
});

describe('the HTML Preview tool’s limits (§6, §12)', () => {
  it('follows every edit up to 256 Ki, and 300 ms after the last edit above it', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    vi.useFakeTimers();
    const live = `<p>${'a'.repeat(LIVE_INPUT - 7)}</p>`;
    expect(live.length).toBe(LIVE_INPUT);
    let before = drawn();
    type(live);
    await act(async () => undefined);
    expect(drawn()).toBeGreaterThan(before);
    before = drawn();
    type(`<p>${'b'.repeat(LIVE_INPUT - 6)}</p>`);
    await act(async () => vi.advanceTimersByTime(SETTLE_MS - 1));
    expect(drawn()).toBe(before);
    await act(async () => vi.advanceTimersByTime(1));
    expect(drawn()).toBeGreaterThan(before);
    expect(body().textContent!.startsWith('b')).toBe(true);
  });

  it(
    'above 1 Mi the frame is empty and the field says why, at once; one character fewer is drawn',
    { timeout: 30_000 },
    async () => {
      render(<HtmlPreviewTool />);
      await loaded();
      type('x'.repeat(MAX_INPUT + 1));
      await waitFor(() => expect(line('error')).toBe('HTML is larger than 1 MB. HTML Preview works with up to 1 MB.'));
      expect(body().textContent).toBe('');
      expect(button('Copy HTML').disabled).toBe(true);
      const before = drawn();
      type('y'.repeat(MAX_INPUT));
      expect(line('error')).toBe('');
      await redrawn(before);
      await waitFor(() => expect(body().textContent!.length).toBe(MAX_INPUT));
    },
  );
});

describe('the HTML Preview tool’s nesting limit (§12, §15)', () => {
  it('markup nested deeper than 512 levels is refused with a word next to the field; 510 levels are drawn', async () => {
    render(<HtmlPreviewTool />);
    await loaded();
    type('<b><div></b>'.repeat(300));
    await waitFor(() =>
      expect(line('error')).toBe(
        'HTML nests elements more than 512 levels deep. HTML Preview works with up to 512 levels.',
      ),
    );
    expect(body().childNodes).toHaveLength(0);
    expect(button('Copy HTML').disabled).toBe(true);
    type('<div>'.repeat(510));
    await waitFor(() => expect(line('error')).toBe(''));
    await waitFor(() => expect(body().querySelectorAll('div')).toHaveLength(510));
  });
});

describe('the HTML Preview tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('html-preview', definition.history!).list({})).entries;

  it('declares one open kind, Previewed', () => {
    expect(definition.history).toMatchObject({ kinds: [{ id: 'preview', title: 'Previewed' }], schema: 1 });
    expect(definition.history!.kinds.some(k => k.secret)).toBe(false);
  });

  it('records an edit as a snapshot when the page goes away — with its title and width — and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<HtmlPreviewTool host={host} />);
    await loaded();
    type('<html><head><title>Welcome mail</title></head><body><p>Hi</p></body></html>');
    await choose('768 px');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('Welcome mail · 75 characters');
    render(<HtmlPreviewTool host={host} />).unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy HTML at once, with the HTML and the width — never what the frame showed', async () => {
    stubClipboard();
    const host = memoryHost();
    render(<HtmlPreviewTool host={host} />);
    await loaded();
    type('<p>Order shipped</p>');
    await waitFor(() => expect(button('Copy HTML').disabled).toBe(false));
    fireEvent.click(button('Copy HTML'));
    await waitFor(async () => expect((await entriesOf(host)).some(e => e.label?.endsWith('HTML copied'))).toBe(true));
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('HTML copied'))!;
    expect(copied.label).toBe('Order shipped · 20 characters · HTML copied');
    const opened = await host.history.forOwner('html-preview', definition.history!).open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({ width: 'fit', action: 'copy' });
    expect(Object.keys(opened.blobs)).toEqual(['input']);
    expect(await opened.blobs.input!.text()).toBe('<p>Order shipped</p>');
  });

  it('opens an entry back into the tool with its width, and opening records nothing', async () => {
    const host = memoryHost();
    const first = render(<HtmlPreviewTool host={host} />);
    await loaded();
    type('<h1>Notes</h1>');
    await choose('375 px');
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);

    const second = render(<HtmlPreviewTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Notes · 14 characters.')).toBeTruthy();
    expect(field().value).toBe('<h1>Notes</h1>');
    await waitFor(() => expect(frame().style.width).toBe('375px'));
    await waitFor(() => expect(body().querySelector('h1')?.textContent).toBe('Notes'));
    second.unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    const { unmount } = render(<HtmlPreviewTool host={host} input={'<!doctype html><p>From the start page</p>'} />);
    await settle();
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
  });
});

describe('the HTML Preview tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('html-preview').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('html-preview').save(htmlPreviewSettings.schema, values as never);
    await host.settings.forTool('html-preview').flush();
  };
  const shows = () => screen.getByLabelText('Width').textContent;

  it('opens with Fit and saves nothing until the width changes; reopened, it is as left, the field empty', async () => {
    const host = memoryHost();
    const first = render(<HtmlPreviewTool host={host} />);
    await loaded();
    expect(shows()).toBe('Fit');
    type('<p>Hi</p>');
    await host.settings.forTool('html-preview').flush();
    expect(savedOf(host)).toBeUndefined();
    await choose('768 px');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { width: '768' } });

    render(<HtmlPreviewTool host={host} />);
    expect(shows()).toBe('768 px');
    expect(field().value).toBe('');
    expect(frame().style.width).toBe('768px');
  });

  it('a saved width it cannot show is Fit; the frame keeps its sandbox and policy whatever is saved', async () => {
    const host = memoryHost();
    await seed(host, { width: '1280', unknown: 1 });
    const first = render(<HtmlPreviewTool host={host} />);
    expect(shows()).toBe('Fit');
    expect(frame().style.width).toBe('');
    first.unmount();

    await seed(host, { width: '1024' });
    render(<HtmlPreviewTool host={host} />);
    expect(frame().style.width).toBe('1024px');
    expect(frame().getAttribute('sandbox')).toBe(FRAME_SANDBOX);
    expect(frame().getAttribute('srcdoc')).toBe(frameSource(undefined, FRAME_POLICY));
  });

  it('an entry opened from History and a pasted text win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    await host.history
      .forOwner('html-preview', definition.history!)
      .session()
      .commit({
        kind: 'preview',
        label: 'Notes',
        payload: { width: 'fit', action: 'copy' } as never,
        blobs: { input: new Blob(['<h1>Notes</h1>']) },
      });
    const [entry] = (await host.history.forOwner('html-preview', definition.history!).list({})).entries;
    await seed(host, { width: '375' });
    const opened = render(<HtmlPreviewTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Notes.')).toBeTruthy();
    await waitFor(() => expect(shows()).toBe('Fit'));
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { width: '375' } });

    // A paste from the start page: its HTML, with the saved width.
    render(<HtmlPreviewTool host={host} input="<p>Pasted</p>" />);
    expect(shows()).toBe('375 px');
    expect(field().value).toBe('<p>Pasted</p>');
    expect(savedOf(host)).toEqual({ schema: 1, values: { width: '375' } });
  });

  it('reset puts the width back to Fit and keeps the HTML', async () => {
    const host = memoryHost();
    await seed(host, { width: '1024' });
    render(<HtmlPreviewTool host={host} />);
    type('<p>Kept</p>');
    await act(async () => host.settings.forTool('html-preview').reset());
    expect(shows()).toBe('Fit');
    expect(frame().style.width).toBe('');
    expect(field().value).toBe('<p>Kept</p>');
    expect(savedOf(host)).toBeUndefined();
  });
});
