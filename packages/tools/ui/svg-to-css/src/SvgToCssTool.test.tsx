import { definition } from './definition';
import { detect } from './detect';
import { PREVIEW_FAILED } from './preview';
import { svgToCssSettings } from './settings';
import SvgToCssTool from './SvgToCssTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_INPUT } from '@workspace/tool-logic-svg-to-css';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>';
const RED_CSS =
  "background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Crect width='10' height='10' fill='%23ff0000'/%3E%3C/svg%3E\");";

// Object URLs: jsdom has none. Each one created is remembered with its Blob, so a test can say which are alive.
let live: Map<string, Blob>;
let made = 0;
beforeEach(() => {
  live = new Map();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${++made}`;
    live.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void live.delete(url));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const input = () => screen.getByLabelText('SVG') as HTMLTextAreaElement;
const css = () => screen.getByLabelText('CSS') as HTMLTextAreaElement;
const typeIn = (value: string) => fireEvent.change(input(), { target: { value } });
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const sizes = () => document.querySelector('[data-part="sizes"]')!.textContent!.trim();
const notes = () => [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent);
const preview = () => document.querySelector('[data-preview] img') as HTMLImageElement | null;
const copy = () => screen.getByRole('button', { name: /^(Copy|Copied)$/ }) as HTMLButtonElement;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const clipboard = () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the SVG to CSS tool', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition).toMatchObject({ id: 'svg-to-css', order: 34, output: { origin: 'input' } });
    expect((await definition.load()).default).toBe(SvgToCssTool);
  });

  it('recognises its input from a module of its own (§7)', () => {
    expect(detect(RED)).toBe(true);
    expect(detect('<div><svg></svg></div>')).toBe(false);
  });

  it('renders with no host at all, empty: no result, no sizes, no preview, Copy off (§6)', () => {
    render(<SvgToCssTool />);
    expect(input().placeholder).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…</svg>');
    expect(input().getAttribute('spellcheck')).toBe('false');
    expect(css().getAttribute('spellcheck')).toBe('false');
    expect(css().readOnly).toBe(true);
    expect(css().value).toBe('');
    expect(sizes()).toBe('');
    expect(preview()).toBeNull();
    expect(copy().disabled).toBe(true);
    expect(screen.getByLabelText('Output').textContent).toContain('background-image');
    expect(screen.getByRole('radio', { name: 'URL-encoded' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Minify' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Open file' })).toBeTruthy();
    expect(fileInput().accept).toBe('.svg,image/svg+xml');
  });

  it('opens with text handed over from the start page', () => {
    render(<SvgToCssTool input={RED} />);
    expect(css().value).toBe(RED_CSS);
  });
});

describe('§2 scenarios', () => {
  it('1: the icon — the CSS, the sizes and the preview of the prepared bytes', async () => {
    const writeText = clipboard();
    render(<SvgToCssTool />);
    typeIn(RED);
    expect(css().value).toBe(RED_CSS);
    expect(sizes()).toBe('144 characters · Base64: 174');
    await waitFor(() => expect(preview()).not.toBeNull());
    expect(preview()!.alt).toBe('Preview of the SVG');
    const blob = live.get(preview()!.getAttribute('src')!)!;
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe(RED);
    fireEvent.click(copy());
    await waitFor(() => expect(copy().textContent).toBe('Copied'));
    expect(writeText).toHaveBeenCalledWith(RED_CSS);
  });

  it('2: without xmlns — the same result and the note', () => {
    render(<SvgToCssTool />);
    typeIn(RED.replace(' xmlns="http://www.w3.org/2000/svg"', ''));
    expect(css().value).toBe(RED_CSS);
    expect(notes()).toEqual([
      'Added xmlns="http://www.w3.org/2000/svg": without it a data URI does not render as SVG.',
    ]);
  });

  it('3: a file from an editor — prolog, comment, DOCTYPE and indentation go', () => {
    render(<SvgToCssTool />);
    typeIn(
      `<?xml version="1.0"?>\n<!-- Generator: editor -->\n<!DOCTYPE svg>\n${RED.replace('><rect', '>\n  <rect')}\n`,
    );
    expect(css().value).toBe(RED_CSS);
  });

  it('4: mask-image — the declaration and a second tile showing the mask', async () => {
    render(<SvgToCssTool />);
    typeIn('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>');
    await pick('Output', 'mask-image');
    expect(css().value).toMatch(/^mask-image: url\("data:image\/svg\+xml,%3Csvg /);
    await waitFor(() => expect(preview()).not.toBeNull());
    fireEvent.load(preview()!);
    const mask = document.querySelector('[data-part="mask"]')!;
    expect(mask.getAttribute('aria-label')).toBe('Preview of the SVG as a mask');
    expect(mask.querySelector('mask')!.getAttribute('mask-type')).toBe('alpha');
    expect(mask.querySelector('image')!.getAttribute('href')).toBe(preview()!.getAttribute('src'));
    expect(screen.getByText('As a mask')).toBeTruthy();
  });

  it('5: a long Cyrillic title — Base64 is shorter; switching says which is shorter now', () => {
    render(<SvgToCssTool />);
    typeIn(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Значок поиска по каталогу</title><path d="M0 0h24v24z"/></svg>',
    );
    expect(sizes()).toBe('278 characters · Base64: 230 (shorter)');
    fireEvent.click(screen.getByRole('radio', { name: 'Base64' }));
    expect(sizes()).toBe('230 characters · URL-encoded: 278');
    expect(css().value).toMatch(/^background-image: url\("data:image\/svg\+xml;base64,PHN2Zy/);
  });

  it('6: an unclosed tag — the error with its place, a link that puts the caret there; no result or preview', async () => {
    render(<SvgToCssTool />);
    const text = '<svg xmlns="http://www.w3.org/2000/svg">\n<rect width="1">\n</svg>';
    typeIn(text);
    // jsdom's parser names column 6 (Chrome: 7 — the e2e module).
    expect(status()).toBe('Line 3, column 6: the SVG is not well-formed XML.');
    expect(css().value).toBe('');
    expect(sizes()).toBe('');
    expect(preview()).toBeNull();
    expect(copy().disabled).toBe(true);
    const link = screen.getByRole('button', { name: /Line 3, column 6/ });
    expect(document.querySelector('[data-part="status"]')!.getAttribute('role')).toBe('status');
    fireEvent.click(link);
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(text.lastIndexOf('\n') + 1 + 5);
  });
});

describe('§6 and the options', () => {
  it('another root, and the error without a place is plain words', () => {
    render(<SvgToCssTool />);
    typeIn('<html><body/></html>');
    expect(status()).toBe('The root element is <html>, not <svg>.');
    expect(screen.queryByRole('button', { name: /root element/ })).toBeNull();
  });

  it('scripts or outside references — the note, the result as usual', () => {
    render(<SvgToCssTool />);
    typeIn(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://example.com/a.png"/></svg>',
    );
    expect(css().value).not.toBe('');
    expect(notes()).toEqual([
      'This SVG contains scripts or external references. They do not run in a CSS image, and external files do not load.',
    ]);
  });

  it('Minify off keeps line breaks and tabs (%0A, %09); url() and Data URI forms', async () => {
    render(<SvgToCssTool />);
    typeIn('<svg xmlns="http://www.w3.org/2000/svg">\n\t<rect/>\n</svg>');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minify' }));
    expect(css().value).toContain('%3E%0A%09%3Crect/%3E%0A%3C/svg%3E');
    await pick('Output', 'url()');
    expect(css().value).toMatch(/^url\("data:image\/svg\+xml,.*"\)$/);
    await pick('Output', 'Data URI');
    expect(css().value).toMatch(/^data:image\/svg\+xml,%3Csvg/);
  });

  it('over 4 MiB characters — refused with the words, nothing computed', () => {
    render(<SvgToCssTool />);
    typeIn(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${'x'.repeat(MAX_INPUT)}</desc></svg>`);
    expect(status()).toBe('SVG is larger than 4 MB.');
    expect(css().value).toBe('');
  });

  it('over 256 Ki characters — the result comes 300 ms after the last edit, not on each (then from the converter)', async () => {
    vi.useFakeTimers();
    render(<SvgToCssTool />);
    const big = (fill: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg"><desc>${'x'.repeat(1024 * 1024)}</desc><rect fill="${fill}"/></svg>`;
    typeIn(big('#000001'));
    expect(css().value).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(css().value).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(sizes()).toBe('Working…');
    await act(() => vi.advanceTimersByTimeAsync(1));
    // Over 1 Mi characters of result: the field shows the first 64 Ki, Copy takes all.
    expect(css().value).toHaveLength(65_536);
    expect(notes()[0]).toMatch(/^Showing the first 65,536 of 1,048,\d{3} characters\. Copy takes all of them\.$/);
    typeIn(big('#000002'));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(css().value.startsWith('background-image')).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(101));
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    expect(sizes()).not.toBe('Working…');
    const writeText = clipboard();
    fireEvent.click(copy());
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('%23000002');
    expect(writeText.mock.calls[0]![0].length).toBeGreaterThan(1024 * 1024);
  });

  it('a file over 4 MiB is refused before it is read; a file is read as UTF-8 into the field', async () => {
    render(<SvgToCssTool />);
    const huge = new File(['x'], 'huge.svg');
    Object.defineProperty(huge, 'size', { value: MAX_INPUT + 1 });
    const text = vi.spyOn(huge, 'text');
    fireEvent.change(fileInput(), { target: { files: [huge] } });
    expect(status()).toBe('SVG is larger than 4 MB.');
    expect(text).not.toHaveBeenCalled();
    fireEvent.change(fileInput(), { target: { files: [new File([`\u{FEFF}${RED}`], 'icon.svg')] } });
    await waitFor(() => expect(css().value).toBe(RED_CSS));
  });

  it('a file dropped on the SVG field is read the same way', async () => {
    render(<SvgToCssTool />);
    const file = new File([RED], 'drop.svg', { type: 'image/svg+xml' });
    fireEvent.drop(input(), { dataTransfer: { files: [file], types: ['Files'] } });
    await waitFor(() => expect(css().value).toBe(RED_CSS));
  });
});

describe('the preview’s object URLs', () => {
  it('one per result, revoked on a new result, on an error and when the page goes away; a failed load says so', async () => {
    const { unmount } = render(<SvgToCssTool />);
    typeIn(RED);
    await waitFor(() => expect(preview()).not.toBeNull());
    const first = preview()!.getAttribute('src')!;
    expect([...live.keys()]).toEqual([first]);
    typeIn(RED.replace('#ff0000', '#00ff00'));
    await waitFor(() => expect(preview()?.getAttribute('src')).not.toBe(first));
    expect(live.has(first)).toBe(false);
    expect(live.size).toBe(1);
    fireEvent.error(preview()!);
    expect(screen.getByText(PREVIEW_FAILED)).toBeTruthy();
    expect(css().value).not.toBe('');
    typeIn('<svg>');
    await waitFor(() => expect(live.size).toBe(0));
    typeIn(RED);
    await waitFor(() => expect(live.size).toBe(1));
    unmount();
    expect(live.size).toBe(0);
  });
});

describe('history (D17)', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('svg-to-css', definition.history!).list()).entries;

  it('an edit is a snapshot (written when the page goes away), Copy a commit; the SVG and the result are blobs', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<SvgToCssTool host={host} />);
    typeIn(RED);
    fireEvent.click(copy());
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [copied] = await entriesOf(host);
    expect(copied!.label).toBe('background-image · URL-encoded · 144 characters · copied');
    const opened = await host.history.forOwner('svg-to-css', definition.history!).open(copied!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await opened.blobs.svg!.text()).toBe(RED);
    expect(await opened.blobs.result!.text()).toBe(RED_CSS);
    expect(opened.payload).toEqual({
      output: 'background-image',
      encoding: 'url',
      minify: true,
      sizes: { url: 144, base64: 174 },
      action: 'copy',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Base64' }));
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2));
    expect((await entriesOf(host)).map(e => e.label)).toContain('background-image · Base64 · 174 characters');
  });

  it('a file opened is a commit, without its name; an error and an empty field are not written', async () => {
    const host = memoryHost();
    const view = render(<SvgToCssTool host={host} />);
    fireEvent.change(fileInput(), { target: { files: [new File([RED], 'secret-logo.svg')] } });
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('background-image · URL-encoded · 144 characters · file opened');
    expect(JSON.stringify(entry)).not.toContain('secret-logo');
    typeIn('<svg>');
    typeIn('');
    view.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('an SVG over 1 MiB is not kept, and the page says so', async () => {
    const host = memoryHost();
    const view = render(<SvgToCssTool host={host} />);
    vi.useFakeTimers();
    typeIn(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${'я'.repeat(600_000)}</desc></svg>`);
    await act(() => vi.advanceTimersByTimeAsync(300));
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    expect(notes()).toContain('This SVG is over 1 MiB: History does not keep it.');
    view.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(0);
  });

  it('opens an entry back with its SVG and options; opening records nothing', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<SvgToCssTool host={host} />);
    typeIn(RED);
    await pick('Output', 'mask-image');
    fireEvent.click(screen.getByRole('radio', { name: 'Base64' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minify' }));
    fireEvent.click(copy());
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    first.unmount();
    await waitFor(async () => expect((await entriesOf(host)).length).toBeGreaterThanOrEqual(1));
    const count = (await entriesOf(host)).length;
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    render(<SvgToCssTool host={host} restore={{ id: copied.id }} />);
    expect(
      await screen.findByText('Opened from History: mask-image · Base64 · not minified · 174 characters · copied.'),
    ).toBeTruthy();
    expect(input().value).toBe(RED);
    expect(css().value).toMatch(/^mask-image: url\("data:image\/svg\+xml;base64,/);
    expect(screen.getByRole('checkbox', { name: 'Minify' }).getAttribute('aria-checked')).toBe('false');
    cleanup();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(count);
  });
});

describe('saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('svg-to-css').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('svg-to-css').save(svgToCssSettings.schema, values as never);
    await host.settings.forTool('svg-to-css').flush();
  };
  const shows = () => ({
    output: screen.getByLabelText('Output').textContent,
    encoding: screen.getByRole('radio', { name: 'Base64' }).getAttribute('aria-checked') === 'true' ? 'base64' : 'url',
    minify: screen.getByRole('checkbox', { name: 'Minify' }).getAttribute('aria-checked'),
  });
  const DEFAULTS = { output: 'background-image', encoding: 'url', minify: 'true' };

  it('saves nothing until an option changes, never the SVG; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<SvgToCssTool host={host} />);
    typeIn(RED);
    await host.settings.forTool('svg-to-css').flush();
    expect(savedOf(host)).toBeUndefined();
    await pick('Output', 'mask-image');
    fireEvent.click(screen.getByRole('radio', { name: 'Base64' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Minify' }));
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { output: 'mask-image', encoding: 'base64', minify: false } });
    expect(JSON.stringify(savedOf(host))).not.toContain('svg xmlns');

    render(<SvgToCssTool host={host} input={RED} />);
    expect(shows()).toEqual({ output: 'mask-image', encoding: 'base64', minify: 'false' });
    expect(css().value).toMatch(/^mask-image: url\("data:image\/svg\+xml;base64,/);
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, { output: 'border-image', encoding: 'base64', minify: 'no', unknown: 1 });
    render(<SvgToCssTool host={host} />);
    expect(shows()).toEqual({ ...DEFAULTS, encoding: 'base64' });
  });

  it('an entry opened from History and a pasted SVG win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    await host.history
      .forOwner('svg-to-css', definition.history!)
      .session()
      .commit({
        kind: 'convert',
        payload: { output: 'url', encoding: 'url', minify: true, sizes: { url: 144, base64: 174 }, action: 'copy' },
        label: 'url() · URL-encoded · 144 characters · copied',
        blobs: { svg: new Blob([RED]), result: new Blob(['url()']) },
      });
    const [entry] = (await host.history.forOwner('svg-to-css', definition.history!).list()).entries;
    await seed(host, { output: 'data-uri', encoding: 'base64', minify: false });
    const opened = render(<SvgToCssTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: url() · URL-encoded · 144 characters · copied.')).toBeTruthy();
    expect(shows()).toEqual({ output: 'url()', encoding: 'url', minify: 'true' });
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { output: 'data-uri', encoding: 'base64', minify: false } });

    // A paste from the start page: its SVG, with the saved options.
    render(<SvgToCssTool host={host} input={RED} />);
    expect(shows()).toEqual({ output: 'Data URI', encoding: 'base64', minify: 'false' });
    expect(css().value).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(savedOf(host)).toEqual({ schema: 1, values: { output: 'data-uri', encoding: 'base64', minify: false } });
  });

  it('reset puts every option back to its default and keeps the SVG; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { output: 'mask-image', encoding: 'base64' });
    render(<SvgToCssTool host={host} />);
    typeIn(RED);
    expect(css().value).toMatch(/^mask-image: url\("data:image\/svg\+xml;base64,/);
    await act(async () => host.settings.forTool('svg-to-css').reset());
    expect(shows()).toEqual(DEFAULTS);
    expect(input().value).toBe(RED);
    expect(css().value).toBe(RED_CSS);
    expect(savedOf(host)).toBeUndefined();
  });
});
