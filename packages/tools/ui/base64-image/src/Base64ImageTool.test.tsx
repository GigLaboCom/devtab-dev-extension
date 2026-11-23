import Base64ImageTool from './Base64ImageTool';
import { definition } from './definition';
import { detect } from './detect';
import { DAMAGED } from './parts';
import { base64ImageSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_IMAGE_BYTES, MAX_INPUT_CHARS } from '@workspace/tool-logic-base64-image';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The specification's samples (docs/tools/specs/base64-image.md §10): a 3 × 2 picture of six flat colours, invented.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGP4z8DAAMH//4PohoYGAEfPB3vT+rJCAAAAAElFTkSuQmCC';
const JPEG_HEAD_B64 = '/9j/4AAESkb/wAARCAJYAyADASIAAhEBAxEB';
const SVG_ACTIVE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" onload="alert(1)"><rect/></svg>';
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const fileOf = (bytes: Uint8Array, name: string, type = '') =>
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type });
const HEIC = Uint8Array.from([0, 0, 0, 20, ...Array.from('ftypheicmif1heic', c => c.charCodeAt(0))]);

// Object URLs: jsdom has none. Each one created is remembered, so a test can say which are still alive.
let live: Set<string>;
let made = 0;
beforeEach(() => {
  live = new Set();
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${++made}`;
    live.add(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void live.delete(url));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mode = (name: 'Encode' | 'Decode') => fireEvent.click(screen.getByRole('radio', { name }));
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const choose = (...files: File[]) => fireEvent.change(fileInput(), { target: { files } });
const typeIn = (value: string) => fireEvent.change(field('Base64 or data URI'), { target: { value } });
const fact = (name: string) => document.querySelector(`[data-fact="${name}"]`)?.textContent ?? null;
const errorLine = () => document.querySelector('[data-part="error"]')?.textContent?.trim() ?? '';
const notes = () =>
  [...document.querySelectorAll('[data-part="notes"] [data-slot="tool-message"]')].map(n => n.textContent!.trim());
const preview = () => document.querySelector('[data-preview] img') as HTMLImageElement | null;
/** Opens a Radix Select by its label and picks an option, with the keyboard. */
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

describe('the Base64 Image tool’s definition', () => {
  it('describes the tool as data: a converter of the person’s input, no default shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'base64-image',
      title: 'Base64 Image',
      summary: 'Turn an image into Base64 or a data URI, and a data URI back into an image.',
      order: 27,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toHaveLength(10);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['encode', 'decode']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect(definition.history?.maxBlobBytes).toBe(1024 * 1024);
    expect((await definition.load()).default).toBe(Base64ImageTool);
  });
  it('recognises image data from a module of its own (§7)', () => {
    expect(detect(`data:image/png;base64,${PNG_B64}`)).toBe(true);
    expect(detect(PNG_B64)).toBe(true);
    expect(detect('SGVsbG8sIFdvcmxkIQ==')).toBe(false);
  });
});

describe('the Base64 Image tool, Encode', () => {
  it('starts empty (§8): Encode, Data URI, the hint, Copy and Save off', () => {
    render(<Base64ImageTool />);
    expect(screen.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Output').textContent).toContain('Data URI');
    expect(screen.queryByLabelText('Line length')).toBeNull();
    expect(screen.getByText('Drop an image here, paste it, or')).toBeTruthy();
    expect(button('Choose image')).toBeTruthy();
    expect(screen.getByText('PNG, JPEG, GIF, WebP, AVIF, BMP, ICO or SVG, up to 10 MiB')).toBeTruthy();
    expect(fileInput().accept).toBe(
      'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon,image/svg+xml,.svg,.ico',
    );
    expect(field('Result').readOnly).toBe(true);
    expect(field('Result').getAttribute('spellcheck')).toBe('false');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('§2.1: a chosen PNG — its preview, facts and data URI; CSS url() copied whole', async () => {
    const writeText = clipboard();
    render(<Base64ImageTool />);
    choose(fileOf(bytesOf(PNG_B64), 'logo.png', 'image/png'));
    await waitFor(() => expect(field('Result').value).toBe(`data:image/png;base64,${PNG_B64}`));
    expect(fact('Type')).toBe('PNG (image/png)');
    expect(fact('Dimensions')).toBe('3 × 2');
    expect(fact('Size')).toBe('78 bytes');
    expect(fact('Base64 length')).toBe('104 characters');
    expect(fact('File')).toBe('logo.png');
    await waitFor(() => expect(preview()?.alt).toBe('Preview of logo.png'));
    expect(preview()?.getAttribute('src')).toMatch(/^blob:test\//);
    await pick('Output', 'CSS url()');
    expect(field('Result').value).toBe(`url("data:image/png;base64,${PNG_B64}")`);
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`url("data:image/png;base64,${PNG_B64}")`));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('§4: Line length only for Base64, wrapping only the bare Base64', async () => {
    render(<Base64ImageTool />);
    choose(fileOf(bytesOf(PNG_B64), 'logo.png'));
    await waitFor(() => expect(field('Result').value).not.toBe(''));
    await pick('Output', 'Base64');
    await pick('Line length', '76');
    expect(field('Result').value).toBe(`${PNG_B64.slice(0, 76)}\n${PNG_B64.slice(76)}`);
    await pick('Output', 'HTML <img>');
    expect(field('Result').value).toBe(`<img src="data:image/png;base64,${PNG_B64}" width="3" height="2" alt="">`);
    expect(screen.queryByLabelText('Line length')).toBeNull();
  });

  it('the type comes from the bytes: a JPEG named .png, a HEIC named photo.png, a text file named .png', async () => {
    render(<Base64ImageTool />);
    choose(fileOf(bytesOf(JPEG_HEAD_B64), 'logo.png', 'image/png'));
    await waitFor(() => expect(fact('Type')).toBe('JPEG (image/jpeg)'));
    expect(fact('Dimensions')).toBe('800 × 600');
    choose(fileOf(HEIC, 'photo.png', 'image/png'));
    expect(
      await screen.findByText('HEIC images cannot be shown by Chrome; this tool does not accept them.'),
    ).toBeTruthy();
    expect(field('Result').value).toBe('');
    choose(fileOf(new TextEncoder().encode('not a picture at all'), 'notes.png', 'image/png'));
    expect(
      await screen.findByText('not an image this tool recognises (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)'),
    ).toBeTruthy();
  });

  it('§2.6: a file over 10 MiB is refused by its size, before it is read', async () => {
    render(<Base64ImageTool />);
    const big = fileOf(new Uint8Array(1), 'huge.png');
    Object.defineProperty(big, 'size', { value: 54_525_952 });
    const read = vi.spyOn(big, 'arrayBuffer');
    choose(big);
    expect(
      await screen.findByText('The image is 54,525,952 bytes (52.0 MiB). This tool works with images up to 10 MiB.'),
    ).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    const edge = fileOf(new Uint8Array(1), 'edge.png');
    Object.defineProperty(edge, 'size', { value: MAX_IMAGE_BYTES + 1 });
    choose(edge);
    expect(await screen.findByText(/^The image is 10,485,761 bytes \(10\.0 MiB\)/)).toBeTruthy();
  });

  it('several files: the first is used, with a note', async () => {
    render(<Base64ImageTool />);
    choose(fileOf(bytesOf(PNG_B64), 'a.png'), fileOf(bytesOf(JPEG_HEAD_B64), 'b.jpg'));
    await waitFor(() => expect(fact('File')).toBe('a.png'));
    expect(notes()).toContain('Only the first file is used.');
  });

  it('a long output shows its first 65,536 characters; Copy and Save take it whole', async () => {
    const writeText = clipboard();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    render(<Base64ImageTool />);
    const bytes = new Uint8Array(800 * 1024);
    bytes.set(bytesOf(PNG_B64).subarray(0, 33));
    choose(fileOf(bytes, 'big.png'));
    await waitFor(() => expect(field('Result').value).toHaveLength(65_536), { timeout: 8000 });
    const full = `data:image/png;base64,`.length + Math.ceil(bytes.length / 3) * 4;
    expect(
      screen.getByText(`Showing the first 65,536 of ${full.toLocaleString('en-US')} characters. Copy copies all.`),
    ).toBeTruthy();
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText.mock.calls[0]![0]).toHaveLength(full));
    fireEvent.click(button('Save'));
    expect(clicked[0]?.download).toBe('big.png.txt');
  });

  it('an SVG with active content: the note of §2.5', async () => {
    render(<Base64ImageTool />);
    choose(fileOf(new TextEncoder().encode(SVG_ACTIVE), 'mail.svg'));
    await waitFor(() => expect(fact('Type')).toBe('SVG (image/svg+xml)'));
    expect(notes()).toContain(
      'This SVG contains scripts or external references. They do not run here, but may run if you open the saved file in a browser.',
    );
    expect(fact('Dimensions')).toBe('20 × 10');
  });
});

describe('the Base64 Image tool, Decode', () => {
  it('starts empty (§8): the field, its placeholder, buttons off', () => {
    render(<Base64ImageTool />);
    mode('Decode');
    expect(field('Base64 or data URI').placeholder).toBe('data:image/png;base64,iVBORw0KGgo…');
    expect(field('Base64 or data URI').getAttribute('spellcheck')).toBe('false');
    expect(screen.queryByLabelText('Output')).toBeNull();
    for (const name of ['Save image', 'Copy data URI', 'Copy image']) expect(button(name).disabled).toBe(true);
    typeIn('  \n ');
    expect(errorLine()).toBe('');
    typeIn('data:image/png;base64,');
    expect(errorLine()).toBe('');
    expect(preview()).toBeNull();
  });

  it('§2.2, §2.4: a JPEG, declared PNG — the warning; Save image saves image.jpg from the preview’s URL', async () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    render(<Base64ImageTool />);
    mode('Decode');
    typeIn(`data:image/png;base64,${JPEG_HEAD_B64}`);
    await waitFor(() => expect(fact('Type')).toBe('JPEG (image/jpeg)'));
    expect(fact('Dimensions')).toBe('800 × 600');
    expect(notes()).toContain('Declared image/png, but the bytes are JPEG.');
    await waitFor(() => expect(preview()?.alt).toBe('Preview of the decoded image'));
    fireEvent.click(button('Save image'));
    expect(clicked[0]?.download).toBe('image.jpg');
    expect(clicked[0]?.getAttribute('href')).toBe(preview()?.getAttribute('src'));
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('Copy data URI: the recognised type in place of the declared one', async () => {
    const writeText = clipboard();
    render(<Base64ImageTool />);
    mode('Decode');
    typeIn(`data:image/jpeg;name=x;base64,${PNG_B64}`);
    await waitFor(() => expect(button('Copy data URI').disabled).toBe(false));
    fireEvent.click(button('Copy data URI'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`data:image/png;base64,${PNG_B64}`));
  });

  it('errors next to the field, with their place, read out politely', () => {
    render(<Base64ImageTool />);
    mode('Decode');
    typeIn('iVBO!w0K');
    expect(errorLine()).toBe('Line 1, column 5: invalid character "!"');
    expect(document.querySelector('[data-part="error"]')!.getAttribute('role')).toBe('status');
    typeIn('data:image/png;base64');
    expect(errorLine()).toBe('a data URI needs a comma before the data');
    typeIn('https://example.com/a.png');
    expect(errorLine()).toMatch(/^This is an address, not image data: this tool never fetches anything\./);
    typeIn('//example.com/a.png');
    expect(errorLine()).toMatch(/^This is an address, not image data/);
    // Bare Base64 that starts with `//` is decoded, then named for what its bytes are.
    typeIn('//79');
    expect(errorLine()).toBe('not an image this tool recognises (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)');
    typeIn('aGVsbG8=');
    expect(errorLine()).toBe('not an image this tool recognises (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)');
    expect(preview()).toBeNull();
  });

  it('§6: a paste over 14 Mi characters never reaches the field', () => {
    render(<Base64ImageTool />);
    mode('Decode');
    const big = 'A'.repeat(MAX_INPUT_CHARS + 1);
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: () => big, items: [], files: [] };
    act(() => void field('Base64 or data URI').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(field('Base64 or data URI').value).toBe('');
    expect(errorLine()).toBe('Input is larger than 14 MB of Base64 (about 10 MiB of image).');
  });

  it('a truncated PNG keeps its facts and Save; the preview says it could not be shown', async () => {
    render(<Base64ImageTool />);
    mode('Decode');
    typeIn(btoa(String.fromCharCode(...bytesOf(PNG_B64).subarray(0, 40))));
    await waitFor(() => expect(preview()).not.toBeNull());
    fireEvent.error(preview()!);
    expect(await screen.findByText(DAMAGED)).toBeTruthy();
    expect(fact('Dimensions')).toBe('3 × 2');
    expect(fact('Size')).toBe('40 bytes');
    expect(button('Save image').disabled).toBe(false);
  });

  it('a header that claims 50,000 × 50,000 pixels is not decoded: no <img>, Copy image off', async () => {
    render(<Base64ImageTool />);
    mode('Decode');
    const head = bytesOf(PNG_B64).slice(0, 33);
    head.set([0, 0, 0xc3, 0x50, 0, 0, 0xc3, 0x50], 16);
    typeIn(btoa(String.fromCharCode(...head)));
    expect(
      await screen.findByText(
        'No preview: the image says it is 50,000 × 50,000 pixels, more than the 100 megapixels a preview may decode.',
      ),
    ).toBeTruthy();
    expect(preview()).toBeNull();
    expect(button('Copy image').disabled).toBe(true);
    expect(button('Save image').disabled).toBe(false);
  });

  it('opens with text handed over from the start page in Decode', async () => {
    render(<Base64ImageTool input={`data:image/png;base64,${PNG_B64}`} />);
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(fact('Dimensions')).toBe('3 × 2'));
  });
});

describe('object URLs (§5 «Адреса blob:»)', () => {
  it('one per image, revoked on a new image, Clear, a change of direction and leaving the page', async () => {
    const { unmount } = render(<Base64ImageTool />);
    mode('Decode');
    typeIn(PNG_B64);
    await waitFor(() => expect(live.size).toBe(1));
    const first = [...live][0];
    typeIn(JPEG_HEAD_B64);
    await waitFor(() => expect(live.has(first!)).toBe(false));
    expect(live.size).toBe(1);
    fireEvent.click(button('Clear'));
    await waitFor(() => expect(live.size).toBe(0));
    expect(field('Base64 or data URI').value).toBe('');
    typeIn(PNG_B64);
    await waitFor(() => expect(live.size).toBe(1));
    mode('Encode');
    await waitFor(() => expect(live.size).toBe(0));
    choose(fileOf(bytesOf(PNG_B64), 'logo.png'));
    await waitFor(() => expect(live.size).toBe(1));
    unmount();
    expect(live.size).toBe(0);
  });
});

describe('pasting on the tool’s page (§5 «Вставка из буфера обмена»)', () => {
  const paste = (target: EventTarget, data: { files?: File[]; text?: string }) => {
    const items = (data.files ?? []).map(f => ({ kind: 'file', type: f.type, getAsFile: () => f }));
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { items, files: data.files ?? [], getData: () => data.text ?? '' };
    act(() => void target.dispatchEvent(event));
    return event;
  };
  it('§2.3: a pasted image switches to Encode, from Decode’s field too', async () => {
    render(<Base64ImageTool />);
    mode('Decode');
    const event = paste(field('Base64 or data URI'), { files: [fileOf(bytesOf(PNG_B64), 'image.png', 'image/png')] });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(field('Result').value).toBe(`data:image/png;base64,${PNG_B64}`));
    expect(screen.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')).toBe('true');
  });
  it('pasted image data with nothing focused in Encode switches to Decode; other text is left alone', async () => {
    render(<Base64ImageTool />);
    expect(paste(document.body, { text: 'hello' }).defaultPrevented).toBe(false);
    paste(document.body, { text: `data:image/png;base64,${PNG_B64}` });
    await waitFor(() => expect(fact('Dimensions')).toBe('3 × 2'));
    expect(field('Base64 or data URI').value).toBe(`data:image/png;base64,${PNG_B64}`);
  });
});

describe('history (D17)', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('base64-image', definition.history!).list()).entries;

  it('commits a chosen image and Copy, with the image as a blob and no Base64; the name is not kept', async () => {
    clipboard();
    const host = memoryHost();
    render(<Base64ImageTool host={host} />);
    choose(fileOf(bytesOf(PNG_B64), 'secret-plan.png'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2));
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toContain('Encode · PNG · 3 × 2 · 78 bytes · Data URI · chosen');
    expect(labels).toContain('Encode · PNG · 3 × 2 · 78 bytes · Data URI · copied');
    const opened = await host.history
      .forOwner('base64-image', definition.history!)
      .open((await entriesOf(host))[0]!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(new Uint8Array(await opened.blobs.image!.arrayBuffer())).toEqual(bytesOf(PNG_B64));
    const kept = JSON.stringify(opened.payload);
    expect(kept).not.toContain('secret-plan');
    expect(kept).not.toContain(PNG_B64.slice(0, 20));
    expect(opened.payload).toMatchObject({ mode: 'encode', mime: 'image/png', bytes: 78, width: 3, height: 2 });
  });

  it('records a Decode edit as a snapshot when the page goes away; an image over 1 MiB not at all', async () => {
    const host = memoryHost();
    const first = render(<Base64ImageTool host={host} />);
    mode('Decode');
    typeIn(`data:image/jpg;base64,${PNG_B64}`);
    await waitFor(() => expect(fact('Type')).toBe('PNG (image/png)'));
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('Decode · PNG · 3 × 2 · 78 bytes');

    const second = render(<Base64ImageTool host={host} />);
    // Decode, chosen above, is a saved parameter now: the page opens in it.
    mode('Encode');
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(bytesOf(PNG_B64).subarray(0, 33));
    choose(fileOf(big, 'big.png'));
    await waitFor(() => expect(fact('Size')).toBe('1,048,577 bytes (1.0 MiB)'), { timeout: 8000 });
    second.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('opens an entry back: Decode with the same kind of input and the declared type; opening records nothing', async () => {
    const host = memoryHost();
    const first = render(<Base64ImageTool host={host} />);
    mode('Decode');
    typeIn(`url("data:image/jpeg;base64,${PNG_B64}")`);
    await waitFor(() => expect(fact('Type')).toBe('PNG (image/png)'));
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    render(<Base64ImageTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Decode · PNG · 3 × 2 · 78 bytes.')).toBeTruthy();
    expect(field('Base64 or data URI').value).toBe(`url("data:image/jpeg;base64,${PNG_B64}")`);
    // The page opened in Decode (saved above), so the entry's text arrives without a change of direction: its note
    // follows a moment later.
    await waitFor(() => expect(notes()).toContain('Declared image/jpeg, but the bytes are PNG.'));
    cleanup();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('opens an Encode entry back with its image and output form', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<Base64ImageTool host={host} />);
    choose(fileOf(bytesOf(PNG_B64), 'logo.png'));
    await waitFor(() => expect(field('Result').value).not.toBe(''));
    await pick('Output', 'Base64');
    fireEvent.click(button('Copy'));
    await waitFor(async () =>
      expect((await entriesOf(host)).some(e => e.label?.endsWith('Base64 · copied'))).toBe(true),
    );
    first.unmount();
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('Base64 · copied'))!;
    render(<Base64ImageTool host={host} restore={{ id: copied.id }} />);
    await waitFor(() => expect(field('Result').value).toBe(PNG_B64));
    expect(fact('File')).toBeNull();
    expect(screen.getByLabelText('Output').textContent).toContain('Base64');
  });
});

describe('the Base64 Image tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('base64-image').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('base64-image').save(base64ImageSettings.schema, values as never);
    await host.settings.forTool('base64-image').flush();
  };
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('base64-image', definition.history!).list()).entries;
  const on = (name: 'Encode' | 'Decode') => screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true';
  const output = () => screen.getByLabelText('Output').textContent;
  const lineLength = () => screen.queryByLabelText('Line length')?.textContent ?? null;
  const paste = (target: EventTarget, data: { files?: File[]; text?: string }) => {
    const items = (data.files ?? []).map(f => ({ kind: 'file', type: f.type, getAsFile: () => f }));
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { items, files: data.files ?? [], getData: () => data.text ?? '' };
    act(() => void target.dispatchEvent(event));
  };
  const png = () => fileOf(bytesOf(PNG_B64), 'logo.png', 'image/png');

  it('opens with the defaults and saves nothing until an option changes; reopened, it is as left, with no image', async () => {
    const host = memoryHost();
    const first = render(<Base64ImageTool host={host} />);
    choose(png());
    await waitFor(() => expect(field('Result').value).toBe(`data:image/png;base64,${PNG_B64}`));
    await host.settings.forTool('base64-image').flush();
    expect(savedOf(host)).toBeUndefined();
    await pick('Output', 'Base64');
    await pick('Line length', '64');
    await pick('Output', 'CSS url()');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { form: 'css', lineLength: 64 } });

    const second = render(<Base64ImageTool host={host} />);
    expect(on('Encode')).toBe(true);
    expect(output()).toContain('CSS url()');
    expect(fact('Type')).toBeNull();
    expect(field('Result').value).toBe('');
    // The line length was kept while CSS url() hid it.
    await pick('Output', 'Base64');
    expect(lineLength()).toContain('64');
    mode('Decode');
    second.unmount();

    render(<Base64ImageTool host={host} />);
    expect(on('Decode')).toBe(true);
    expect(field('Base64 or data URI').value).toBe('');
    expect(savedOf(host)).toEqual({ schema: 1, values: { mode: 'decode', form: 'base64', lineLength: 64 } });
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'view', form: 'base64', lineLength: 80, image: 'x' });
    render(<Base64ImageTool host={host} />);
    expect(on('Encode')).toBe(true);
    expect(output()).toContain('Base64');
    expect(lineLength()).toContain('No wrapping');
  });

  it('an opened entry, a text handed over, an image and pasted image data win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    const recorder = host.history.forOwner('base64-image', definition.history!).session();
    const image = new Blob([bytesOf(PNG_B64)], { type: 'image/png' });
    await recorder.commit({
      kind: 'encode',
      label: 'encoded',
      payload: { mode: 'encode', mime: 'image/png', form: 'dataUri', lineLength: 0 } as never,
      blobs: { image },
    });
    await recorder.commit({
      kind: 'decode',
      label: 'decoded',
      payload: { mode: 'decode', mime: 'image/png', shape: 'data-uri' } as never,
      blobs: { image },
    });
    await recorder.end();
    const list = await entriesOf(host);
    const values = { mode: 'decode', form: 'base64', lineLength: 76 };
    await seed(host, values);

    // An entry of Encode brings its form and line length; one of Decode only Decode.
    const encoded = render(<Base64ImageTool host={host} restore={{ id: list.find(e => e.label === 'encoded')!.id }} />);
    expect(await screen.findByText('Opened from History: encoded.')).toBeTruthy();
    expect(on('Encode')).toBe(true);
    expect(output()).toContain('Data URI');
    await waitFor(() => expect(field('Result').value).toBe(`data:image/png;base64,${PNG_B64}`));
    encoded.unmount();
    const decoded = render(<Base64ImageTool host={host} restore={{ id: list.find(e => e.label === 'decoded')!.id }} />);
    expect(await screen.findByText('Opened from History: decoded.')).toBeTruthy();
    expect(on('Decode')).toBe(true);
    decoded.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values });

    // An image pasted in Decode: Encode for the visit, with the saved form.
    const pasted = render(<Base64ImageTool host={host} />);
    expect(on('Decode')).toBe(true);
    paste(field('Base64 or data URI'), { files: [png()] });
    await waitFor(() => expect(field('Result').value).toBe(PNG_B64.match(/.{1,76}/g)!.join('\n')));
    expect(on('Encode')).toBe(true);
    // Image data pasted in Encode: Decode for the visit.
    paste(document.body, { text: `data:image/png;base64,${PNG_B64}` });
    await waitFor(() => expect(on('Decode')).toBe(true));
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values });

    // A text handed over opens Decode whatever is saved.
    const other = memoryHost();
    await seed(other, { form: 'img' });
    render(<Base64ImageTool host={other} input={`data:image/png;base64,${PNG_B64}`} />);
    expect(on('Decode')).toBe(true);
    await waitFor(() => expect(fact('Dimensions')).toBe('3 × 2'));
    await other.settings.forTool('base64-image').flush();
    expect(savedOf(other)).toEqual({ schema: 1, values: { form: 'img' } });
  });

  it('reset puts every option back to its default and keeps the image; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { form: 'base64', lineLength: 64 });
    render(<Base64ImageTool host={host} />);
    choose(png());
    await waitFor(() => expect(field('Result').value).toBe(PNG_B64.match(/.{1,64}/g)!.join('\n')));
    await act(async () => host.settings.forTool('base64-image').reset());
    expect(on('Encode')).toBe(true);
    expect(output()).toContain('Data URI');
    expect(lineLength()).toBeNull();
    expect(field('Result').value).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(savedOf(host)).toBeUndefined();
  });
});
