/**
 * The QR Code tool's page in jsdom (docs/tools/specs/qr.md §2, §6, §8): rendered with no host, the scenarios, the errors
 * next to their fields, the four actions of Generate (the clipboard, the canvas and the download link are stand-ins
 * here — the real ones are scripts/e2e-tools/qr.mjs), Read with the worker's client replaced (jsdom has no Worker and no
 * image decoding), a pasted image, and the history: what is a change and what a commit, the secret kinds through a real
 * cipher (`unlockedHost`), and entries opened back.
 */
import { definition } from './definition';
import { qrHistory } from './history';
import QrTool from './QrTool';
import { qrSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { svgFile } from '@workspace/tool-logic-qr';
import { memoryHost, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReaderModule from './reader';
import type { ReadOutcome } from './reader';
import type { ToolHost } from '@workspace/tools-host';

const reader = vi.hoisted(() => ({ readImage: vi.fn() }));
vi.mock('./reader', async importOriginal => ({
  ...(await importOriginal<typeof ReaderModule>()),
  readImage: (...args: unknown[]) => reader.readImage(...args),
}));

// --- stand-ins for what jsdom lacks ---------------------------------------------------------------------------------
const clip = { texts: [] as string[], items: [] as unknown[], fail: false };
class FakeClipboardItem {
  constructor(readonly parts: Record<string, Promise<Blob>>) {}
}
/** Every rectangle a canvas filled, and the PNGs it was asked for. */
const canvases: Array<{ width: number; height: number; rects: number[][]; fills: string[] }> = [];
class FakeOffscreenCanvas {
  rects: number[][] = [];
  fills: string[] = [];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    canvases.push(this);
  }
  getContext() {
    let style = '';
    return {
      set fillStyle(v: string) {
        style = v;
      },
      fillRect: (...r: number[]) => {
        this.rects.push(r);
        this.fills.push(style);
      },
    };
  }
  convertToBlob(options: { type: string }) {
    return Promise.resolve(new Blob(['png'], { type: options.type }));
  }
}
const downloads: Array<{ name: string; blob: Blob }> = [];
/** What the preview canvas was asked to draw. */
const drawn: unknown[][] = [];
let lastBlob: Blob | null = null;

beforeEach(() => {
  clip.texts = [];
  clip.items = [];
  clip.fail = false;
  canvases.length = 0;
  downloads.length = 0;
  reader.readImage.mockReset();
  drawn.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: () => undefined,
    drawImage: (...args: unknown[]) => drawn.push(args),
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => (clip.fail ? Promise.reject(new Error('no')) : (clip.texts.push(t), Promise.resolve())),
      write: async (items: FakeClipboardItem[]) => {
        if (clip.fail) throw new Error('refused');
        for (const item of items) clip.items.push(await item.parts['image/png']);
      },
    },
  });
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  URL.createObjectURL = (blob: Blob) => {
    lastBlob = blob;
    return 'blob:test';
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: lastBlob! });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- helpers ----------------------------------------------------------------------------------------------------------
const field = (label: string) => screen.getByLabelText(label, { selector: 'textarea, input' }) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const radio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });
const pick = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};
const info = () => document.querySelector('[data-info]')!.textContent;
const code = () => screen.findByRole('img', { name: 'QR code' });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const chooseFile = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
const png = (name = 'shot.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
const found = (text: string, count = 1, bytes: Uint8Array | null = null): ReadOutcome => ({
  ok: true,
  result: { ok: true, text, count, bytes },
  width: 400,
  height: 400,
  ms: 3,
});
const entries = async (host: ToolHost, kinds?: string[]) =>
  (await host.history.forOwner('qr', qrHistory).list(kinds ? { kinds } : {})).entries;

describe('the QR Code tool’s definition', () => {
  it('describes the tool: no detect, no shortcut, its result from the input; it loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'qr',
      title: 'QR Code',
      summary: 'Make a QR code from text or Wi-Fi details, or read one from an image.',
      order: 25,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'qr',
      'qr code',
      'barcode',
      'scan',
      'decode',
      'generate',
      'wifi',
      'svg',
      'png',
    ]);
    expect(definition).not.toHaveProperty('shortcut');
    expect(definition).not.toHaveProperty('detect');
    expect((await definition.load()).default).toBe(QrTool);
  });

  it('declares open kinds for codes made and read, and secret ones for Wi-Fi and one-time keys', () => {
    expect(qrHistory.kinds).toEqual([
      { id: 'made', title: 'Made' },
      { id: 'made-secret', title: 'Made: Wi-Fi or one-time key', secret: true },
      { id: 'read', title: 'Read' },
      { id: 'read-secret', title: 'Read: Wi-Fi or one-time key', secret: true },
    ]);
  });
});

describe('Generate', () => {
  it('renders with no host: Generate, Text, the empty frame, actions off (§8 empty state)', () => {
    render(<QrTool />);
    expect(radio('Mode', 'Generate').getAttribute('aria-checked')).toBe('true');
    expect(radio('Content', 'Text').getAttribute('aria-checked')).toBe('true');
    expect(field('Text').placeholder).toBe('https://example.com/ or any text');
    expect(field('Text').getAttribute('spellcheck')).toBe('false');
    expect(screen.getByText('Enter text to make a QR code.')).toBeTruthy();
    for (const name of ['Download SVG', 'Download PNG', 'Copy image', 'Copy text'])
      expect(button(name).disabled).toBe(true);
    expect(screen.queryByRole('img', { name: 'QR code' })).toBeNull();
  });

  it('§2.1: https://example.com/ — the code at once, its line, the SVG path of §5.4', async () => {
    render(<QrTool />);
    type('Text', 'https://example.com/');
    const svg = await code();
    expect(info()).toBe('Version 2 · 25 × 25 modules · level M · 20 bytes (byte mode)');
    expect(svg.getAttribute('viewBox')).toBe('0 0 33 33');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff');
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('#000000');
    expect(svg.querySelector('path')!.getAttribute('d')).toMatch(/^M4 4h7v1h-7zM12 4h1v1h-1z/);
    expect(document.querySelector('[data-info]')!.getAttribute('role')).toBe('status');
  });

  it('Download SVG saves qr-code.svg — the file of §5.5; Download PNG draws 264 px and saves qr-code.png', async () => {
    render(<QrTool />);
    type('Text', 'https://example.com/');
    await code();
    fireEvent.click(button('Download SVG'));
    expect(downloads[0]!.name).toBe('qr-code.svg');
    expect(downloads[0]!.blob.type).toBe('image/svg+xml');
    const text = await downloads[0]!.blob.text();
    expect(text.length).toBe(2396);
    expect(text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="264" height="264" viewBox="0 0 33 33"/);
    fireEvent.click(button('Download PNG'));
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(downloads[1]!.name).toBe('qr-code.png');
    expect(downloads[1]!.blob.type).toBe('image/png');
    const canvas = canvases.at(-1)!;
    expect([canvas.width, canvas.height]).toEqual([264, 264]);
    // White first, over the whole image; then the dark runs in whole pixels: 8 px a module, inside the quiet zone.
    expect(canvas.rects[0]).toEqual([0, 0, 264, 264]);
    expect(canvas.fills[0]).toBe('#ffffff');
    expect(canvas.rects[1]).toEqual([32, 32, 56, 8]);
    expect(canvas.fills.slice(1).every(f => f === '#000000')).toBe(true);
    expect(canvas.rects.slice(1).every(r => r.every(v => Number.isInteger(v) && v % 8 === 0))).toBe(true);
  });

  it('Copy image puts a PNG on the clipboard from the click and says Copied until the code changes; a refusal is said', async () => {
    render(<QrTool />);
    type('Text', 'hello');
    await code();
    fireEvent.click(button('Copy image'));
    await screen.findByRole('button', { name: 'Copied' });
    expect((clip.items[0] as Blob).type).toBe('image/png');
    type('Text', 'hello!');
    await screen.findByRole('button', { name: 'Copy image' });
    clip.fail = true;
    fireEvent.click(button('Copy image'));
    expect((await screen.findByText('Could not copy the image.')).getAttribute('role')).toBe('alert');
  });

  it('Copy text copies exactly the encoded string', async () => {
    render(<QrTool />);
    type('Text', ' spaced text \n');
    await code();
    fireEvent.click(button('Copy text'));
    await screen.findByRole('button', { name: 'Copied' });
    expect(clip.texts).toEqual([' spaced text \n']);
  });

  it('§3: a space or a line break at the end is encoded, with the note', async () => {
    render(<QrTool />);
    type('Text', 'text\n');
    await code();
    expect(screen.getByText('The text ends with a space or line break; it is encoded too.')).toBeTruthy();
    type('Text', '   ');
    await waitFor(() => expect(info()).toMatch(/3 characters \(alphanumeric mode\)$/));
  });

  it('§6: Привет, мир 🙂 — byte mode, 25 bytes, version 2', async () => {
    render(<QrTool />);
    type('Text', 'Привет, мир 🙂');
    await code();
    expect(info()).toBe('Version 2 · 25 × 25 modules · level M · 25 bytes (byte mode)');
  });

  it('§2.6 (corrected): 2,900 Latin letters at M are too long — the message, no code; level L gives version 40', async () => {
    render(<QrTool />);
    type('Text', 'a'.repeat(2900));
    const message = await screen.findByText(
      'Too long for a QR code: 2,900 bytes; level M holds up to 2,331 bytes in byte mode.',
    );
    // An error that changes while typing is a status, not an alert (the recipe).
    expect(message.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('img', { name: 'QR code' })).toBeNull();
    for (const name of ['Download SVG', 'Download PNG', 'Copy image', 'Copy text'])
      expect(button(name).disabled).toBe(true);
    await pick('Error correction', 'L — 7%');
    await code();
    expect(info()).toBe('Version 40 · 177 × 177 modules · level L · 2,900 bytes (byte mode)');
    // 3,000 bytes (the specification's first number) do not fit even at L: 2,953 is its limit.
    type('Text', 'a'.repeat(3000));
    expect(
      await screen.findByText('Too long for a QR code: 3,000 bytes; level L holds up to 2,953 bytes in byte mode.'),
    ).toBeTruthy();
  });

  it('§6: я × 1,166 at M — the message in bytes', async () => {
    render(<QrTool />);
    type('Text', 'я'.repeat(1166));
    expect(
      await screen.findByText('Too long for a QR code: 2,332 bytes; level M holds up to 2,331 bytes in byte mode.'),
    ).toBeTruthy();
  });

  it('a quiet zone below 4 draws the code with the note; the SVG file follows the zone and the PNG size', async () => {
    render(<QrTool />);
    type('Text', 'https://example.com/');
    await code();
    expect(document.querySelector('[data-quiet-note]')).toBeNull();
    await pick('Quiet zone', '1 module');
    expect(
      await screen.findByText('ISO/IEC 18004 asks for a quiet zone of 4 modules; some scanners fail with less.'),
    ).toBeTruthy();
    expect((await code()).getAttribute('viewBox')).toBe('0 0 27 27');
    await pick('PNG size', '16 px per module');
    fireEvent.click(button('Download SVG'));
    expect(await downloads[0]!.blob.text()).toMatch(/^<svg [^>]*width="432" height="432" viewBox="0 0 27 27"/);
  });

  it('§2.2: Wi-Fi — the string under the form (password shown only on Show), the code holds it', async () => {
    render(<QrTool />);
    fireEvent.click(radio('Content', 'Wi-Fi'));
    expect(screen.getByText('Enter the network name.')).toBeTruthy();
    type('Network name', 'my;net');
    type('Password', 'p@ss:word\\1');
    expect(field('Password').type).toBe('password');
    expect(field('Password').getAttribute('autocomplete')).toBe('off');
    fireEvent.click(screen.getByLabelText('Hidden network'));
    await code();
    const shown = () => screen.getByRole('status', { name: 'Wi-Fi string' }).textContent;
    expect(shown()).toBe('WIFI:T:WPA;S:my\\;net;P:••••••••;H:true;;');
    fireEvent.click(button('Show'));
    expect(field('Password').type).toBe('text');
    expect(shown()).toBe('WIFI:T:WPA;S:my\\;net;P:p@ss\\:word\\\\1;H:true;;');
    fireEvent.click(button('Copy text'));
    await waitFor(() => expect(clip.texts).toEqual(['WIFI:T:WPA;S:my\\;net;P:p@ss\\:word\\\\1;H:true;;']));
  });

  it('§6: Wi-Fi None — the password is off and there is no P; an empty name builds nothing', async () => {
    render(<QrTool />);
    fireEvent.click(radio('Content', 'Wi-Fi'));
    type('Network name', 'Cafe');
    await pick('Security', 'None');
    expect(field('Password').disabled).toBe(true);
    await code();
    fireEvent.click(button('Copy text'));
    await waitFor(() => expect(clip.texts).toEqual(['WIFI:T:nopass;S:Cafe;;']));
    type('Network name', '');
    expect(screen.queryByRole('img', { name: 'QR code' })).toBeNull();
    expect(screen.getByText('Enter the network name.')).toBeTruthy();
    expect(screen.getByText('Enter Wi-Fi details to make a QR code.')).toBeTruthy();
  });

  it('Wi-Fi notes: no password; 64 hexadecimal digits', async () => {
    render(<QrTool />);
    fireEvent.click(radio('Content', 'Wi-Fi'));
    type('Network name', 'Lab');
    expect(screen.getByText('No password: choose None if the network is open.')).toBeTruthy();
    type('Password', 'ab'.repeat(32));
    expect(
      screen.getByText('64 hexadecimal digits: phones use them as the network’s raw key, not as a passphrase.'),
    ).toBeTruthy();
  });
});

describe('Read', () => {
  it('the empty state: only the drop zone with Choose image', () => {
    render(<QrTool />);
    fireEvent.click(radio('Mode', 'Read'));
    expect(screen.getByText('Drop an image here, paste it, or choose a file.')).toBeTruthy();
    expect(button('Choose image')).toBeTruthy();
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).accept).toBe('image/*');
    expect(screen.queryByRole('textbox', { name: 'Content' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Image preview' })).toBeNull();
  });

  it('§2.3: a screenshot with a link — the text, its line, the note; never a link; Copy copies the text', async () => {
    reader.readImage.mockResolvedValue(found('https://example.com/qr-clean'));
    render(<QrTool />);
    fireEvent.click(radio('Mode', 'Read'));
    chooseFile(png());
    expect(await screen.findByText('Found a QR code: 28 characters.')).toBeTruthy();
    expect(screen.getByText('Links are shown as text and are never opened.')).toBeTruthy();
    expect(field('Content').value).toBe('https://example.com/qr-clean');
    expect(field('Content').readOnly).toBe(true);
    expect(document.querySelector('a[href]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Image preview' }).tagName).toBe('CANVAS');
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(clip.texts).toEqual(['https://example.com/qr-clean']));
  });

  it('§2.4: a Wi-Fi code — the table, the password hidden until Show, also in the text', async () => {
    reader.readImage.mockResolvedValue(found('WIFI:T:WPA;S:my\\;net;P:p@ss\\:word;;'));
    render(<QrTool />);
    fireEvent.click(radio('Mode', 'Read'));
    chooseFile(png('photo.png'));
    const table = await screen.findByRole('table', { name: 'Wi-Fi details' });
    const rows = within(table)
      .getAllByRole('row')
      .map(r => r.textContent);
    expect(rows).toEqual(['Networkmy;net', 'SecurityWPA', 'Password••••••••Show', 'Hiddenno']);
    expect(field('Content').value).toBe('WIFI:T:WPA;S:my\\;net;P:••••••••;;');
    fireEvent.click(button('Show'));
    expect(within(table).getByText('p@ss:word')).toBeTruthy();
    expect(field('Content').value).toBe('WIFI:T:WPA;S:my\\;net;P:p@ss\\:word;;');
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(clip.texts).toEqual(['WIFI:T:WPA;S:my\\;net;P:p@ss\\:word;;']));
  });

  it('§2.5 and §6: no code; not an image; too large; could not open; unreadable — each said as an alert', async () => {
    render(<QrTool />);
    fireEvent.click(radio('Mode', 'Read'));
    const error = () => document.querySelector('[data-read-error]');
    reader.readImage.mockResolvedValue({ ok: true, result: { ok: false, located: false }, width: 1, height: 1, ms: 1 });
    chooseFile(png());
    await waitFor(() =>
      expect(error()?.textContent).toBe('No QR code found. Try a sharper or larger image, or crop it to the code.'),
    );
    expect(error()?.getAttribute('role')).toBe('alert');
    chooseFile(new File(['plain'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(error()?.textContent).toBe('This file is not an image.'));
    const big = png('big.png');
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 + 1 });
    chooseFile(big);
    await waitFor(() => expect(error()?.textContent).toBe('The image is larger than 50 MB.'));
    reader.readImage.mockResolvedValue({ ok: false, message: 'This image could not be opened.' });
    chooseFile(png('broken.png'));
    await waitFor(() => expect(error()?.textContent).toBe('This image could not be opened.'));
    reader.readImage.mockResolvedValue({ ok: true, result: { ok: false, located: true }, width: 1, height: 1, ms: 1 });
    chooseFile(png('kanji.png'));
    await waitFor(() =>
      expect(error()?.textContent).toMatch(/^A QR code was found, but its contents could not be read/),
    );
    // The reader is never asked for a file that is not an image or is too large.
    expect(reader.readImage).toHaveBeenCalledTimes(3);
  });

  it('the preview: the worker’s fitted bitmap is centred on the 240 × 240 canvas as soon as it comes', async () => {
    const bitmap = { width: 240, height: 120, close: vi.fn() };
    reader.readImage.mockImplementation((_file: File, options: { onPreview: (b: unknown) => void }) => {
      options.onPreview(bitmap);
      return Promise.resolve(found('x'));
    });
    render(<QrTool />);
    fireEvent.click(radio('Mode', 'Read'));
    chooseFile(png());
    await screen.findByText('Found a QR code: 1 character.');
    const canvas = screen.getByRole('img', { name: 'Image preview' }) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([240, 240]);
    expect(drawn).toEqual([[bitmap, 0, 60]]);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('several codes: the first is shown and the count said; bytes that are not text also as hex', async () => {
    reader.readImage.mockResolvedValue(found('first', 2));
    render(<QrTool />);
    fireEvent.click(radio('Mode', 'Read'));
    chooseFile(png());
    expect(await screen.findByText('This image holds 2 QR codes; the first one found is shown.')).toBeTruthy();
    reader.readImage.mockResolvedValue(found('\u0000�A', 1, new Uint8Array([0, 0xff, 0x41])));
    chooseFile(png());
    await waitFor(() => expect(field('Bytes (hex)').value).toBe('00 ff 41'));
    expect(
      screen.getByText(
        'Some bytes of this code are not text in its encoding: they are shown one character a byte (ISO-8859-1) above, and exactly as hex below.',
      ),
    ).toBeTruthy();
  });

  it('a pasted image is read from anywhere on the page, also from Generate; a pasted text is an ordinary paste', async () => {
    reader.readImage.mockResolvedValue(found('pasted'));
    render(<QrTool />);
    const paste = (target: Element, files: File[]) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { files } });
      target.dispatchEvent(event);
      return event;
    };
    const text = paste(field('Text'), []);
    expect(text.defaultPrevented).toBe(false);
    expect(reader.readImage).not.toHaveBeenCalled();
    let image!: Event;
    act(() => {
      image = paste(field('Text'), [png('clipboard.png')]);
    });
    expect(image.defaultPrevented).toBe(true);
    expect(await screen.findByText('Found a QR code: 6 characters.')).toBeTruthy();
    expect(radio('Mode', 'Read').getAttribute('aria-checked')).toBe('true');
    act(() => void paste(document.body, [png('again.png')]));
    await waitFor(() => expect(reader.readImage).toHaveBeenCalledTimes(2));
  });
});

describe('history', () => {
  it('a code made of text: an edit is a change, Copy text a commit; the entry opens back with its options', async () => {
    const host = memoryHost();
    const { unmount } = render(<QrTool host={host} />);
    type('Text', 'https://example.com/');
    await code();
    await pick('Error correction', 'Q — 25%');
    await code();
    fireEvent.click(button('Copy text'));
    await waitFor(async () => expect(await entries(host, ['made'])).toHaveLength(1));
    unmount();
    await act(async () => undefined);
    const [entry] = await entries(host, ['made']);
    expect(entry!.label).toBe('https://example.com/ · level Q');
    const opened = await host.history.forOwner('qr', qrHistory).open(entry!.id);
    expect(opened.ok && opened.payload).toEqual({
      content: 'text',
      text: 'https://example.com/',
      level: 'Q',
      quiet: 4,
      px: 8,
    });
    render(<QrTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: https://example.com/ · level Q.')).toBeTruthy();
    expect(field('Text').value).toBe('https://example.com/');
    await code();
    expect(info()).toBe('Version 2 · 25 × 25 modules · level Q · 20 bytes (byte mode)');
  });

  it('Wi-Fi details without a master password are not kept at all, and the page says so', async () => {
    const host = memoryHost();
    const { unmount } = render(<QrTool host={host} />);
    fireEvent.click(radio('Content', 'Wi-Fi'));
    type('Network name', 'Home');
    type('Password', 'secret123');
    await code();
    expect(document.querySelector('[data-kept]')!.textContent).toBe(
      'Not kept: Wi-Fi details and one-time password keys need a master password (Settings → History).',
    );
    fireEvent.click(button('Copy text'));
    fireEvent.click(button('Download SVG'));
    unmount();
    await act(async () => undefined);
    expect(await entries(host)).toEqual([]);
  });

  it('a text that is Wi-Fi details or a one-time key goes to the secret kind too', async () => {
    const host = memoryHost();
    const { unmount } = render(<QrTool host={host} />);
    type('Text', 'otpauth://totp/Example:me?secret=JBSWY3DPEHPK3PXP');
    await code();
    expect(document.querySelector('[data-kept]')!.textContent).toMatch(
      /^Not kept: Wi-Fi details and one-time password keys/,
    );
    fireEvent.click(button('Copy text'));
    type('Text', 'WIFI:T:WPA;S:x;P:y;;');
    await code();
    fireEvent.click(button('Copy text'));
    unmount();
    await act(async () => undefined);
    expect(await entries(host)).toEqual([]);
  });

  it('with a master password, unlocked: Wi-Fi is kept encrypted and opens back into the form; locked: not opened', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<QrTool host={host} />);
    fireEvent.click(radio('Content', 'Wi-Fi'));
    type('Network name', 'my;net');
    type('Password', 'p@ss:word\\1');
    fireEvent.click(screen.getByLabelText('Hidden network'));
    await code();
    expect(document.querySelector('[data-kept]')!.textContent).toBe('Kept in this browser’s history, encrypted.');
    fireEvent.click(button('Copy image'));
    await screen.findByRole('button', { name: 'Copied' });
    await waitFor(async () => expect(await entries(host, ['made-secret'])).toHaveLength(1));
    unmount();
    await act(async () => undefined);
    const [entry] = await entries(host, ['made-secret']);
    expect(entry!.encrypted).toBe(true);
    expect(entry!.label).toBeUndefined();
    // Nothing of the details in clear in the store.
    const rows: string[] = [];
    for await (const row of host.store.scan({})) rows.push(JSON.stringify(row));
    const raw = rows.join('');
    expect(rows).toHaveLength(1);
    expect(raw).not.toContain('p@ss');
    expect(raw).not.toContain('my;net');

    const view = render(<QrTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Wi-Fi · my;net · level M.')).toBeTruthy();
    expect(field('Network name').value).toBe('my;net');
    expect(field('Password').value).toBe('p@ss:word\\1');
    expect((screen.getByLabelText('Hidden network') as HTMLElement).getAttribute('aria-checked')).toBe('true');
    view.unmount();

    await host.vault.lock();
    render(<QrTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
    // Wi-Fi was the person's choice above, a saved parameter now: the form opens with nothing of the entry in it.
    expect(field('Network name').value).toBe('');
    expect(field('Password').value).toBe('');
  });

  it('a code read: its text is kept (never the image) and opens back in Read; a Wi-Fi code read only encrypted', async () => {
    const host = memoryHost();
    reader.readImage.mockResolvedValue(found('https://example.com/qr-clean'));
    const { unmount } = render(<QrTool host={host} />);
    fireEvent.click(radio('Mode', 'Read'));
    chooseFile(png());
    await screen.findByText('Found a QR code: 28 characters.');
    await waitFor(async () => expect(await entries(host, ['read'])).toHaveLength(1));
    reader.readImage.mockResolvedValue(found('WIFI:T:WPA;S:Home;P:secret123;;'));
    chooseFile(png());
    await screen.findByRole('table', { name: 'Wi-Fi details' });
    unmount();
    await act(async () => undefined);
    const all = await entries(host);
    expect(all.map(e => e.kind)).toEqual(['read']);
    const opened = await host.history.forOwner('qr', qrHistory).open(all[0]!.id);
    expect(opened.ok && opened.payload).toEqual({ text: 'https://example.com/qr-clean', count: 1 });
    expect(opened.ok && Object.keys(opened.blobs)).toEqual([]);
    render(<QrTool host={host} restore={{ id: all[0]!.id }} />);
    expect(
      await screen.findByText(
        'Opened from History: Read · https://example.com/qr-clean. The image itself is not kept.',
      ),
    ).toBeTruthy();
    expect(radio('Mode', 'Read').getAttribute('aria-checked')).toBe('true');
    expect(field('Content').value).toBe('https://example.com/qr-clean');
  });

  it('a Wi-Fi code read with the history unlocked is kept encrypted', async () => {
    const host = await unlockedHost();
    reader.readImage.mockResolvedValue(found('WIFI:T:WPA;S:Home;P:secret123;;'));
    render(<QrTool host={host} />);
    fireEvent.click(radio('Mode', 'Read'));
    chooseFile(png());
    await screen.findByRole('table', { name: 'Wi-Fi details' });
    await waitFor(async () => expect(await entries(host, ['read-secret'])).toHaveLength(1));
    expect((await entries(host))[0]!.encrypted).toBe(true);
  });

  it('opening an entry and re-rendering records nothing new', async () => {
    const host = memoryHost();
    const { unmount } = render(<QrTool host={host} />);
    type('Text', 'once');
    await code();
    fireEvent.click(button('Copy text'));
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    unmount();
    await act(async () => undefined);
    const [entry] = await entries(host);
    const view = render(<QrTool host={host} restore={{ id: entry!.id }} />);
    await screen.findByText(/^Opened from History/);
    await code();
    view.unmount();
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(1);
  });

  it('the downloaded SVG equals the logic’s file for the code shown', async () => {
    render(<QrTool />);
    type('Text', 'HELLO WORLD');
    await code();
    fireEvent.click(button('Download SVG'));
    const { buildQr } = await import('./maker');
    const built = buildQr('HELLO WORLD', 'M');
    expect(built.ok && (await downloads[0]!.blob.text())).toBe(built.ok && svgFile(built.modules, 4, 8));
  });
});

describe('the QR Code tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('qr').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('qr').save(qrSettings.schema, values as never);
    await host.settings.forTool('qr').flush();
  };
  const on = (group: string, name: string) => radio(group, name).getAttribute('aria-checked') === 'true';
  const shows = () => ({
    level: screen.getByLabelText('Error correction').textContent,
    quiet: screen.getByLabelText('Quiet zone').textContent,
    px: screen.getByLabelText('PNG size').textContent,
  });
  const pasteImage = () =>
    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { files: [png('clipboard.png')] } });
      document.body.dispatchEvent(event);
    });

  it('opens with the defaults and saves nothing until an option changes; reopened, it is as left — never the network', async () => {
    const host = memoryHost();
    const first = render(<QrTool host={host} />);
    expect(shows()).toEqual({ level: 'M — 15%', quiet: '4 modules', px: '8 px per module' });
    type('Text', 'https://example.com/');
    await code();
    await host.settings.forTool('qr').flush();
    expect(savedOf(host)).toBeUndefined();
    await pick('Error correction', 'Q — 25%');
    await pick('Quiet zone', '2 modules');
    await pick('PNG size', '16 px per module');
    fireEvent.click(radio('Content', 'Wi-Fi'));
    type('Network name', 'Home');
    await pick('Security', 'WEP');
    type('Password', 'secret123');
    fireEvent.click(screen.getByLabelText('Hidden network'));
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { content: 'wifi', level: 'Q', quiet: 2, px: 16 } });

    const second = render(<QrTool host={host} />);
    expect(on('Mode', 'Generate')).toBe(true);
    expect(on('Content', 'Wi-Fi')).toBe(true);
    expect(shows()).toEqual({ level: 'Q — 25%', quiet: '2 modules', px: '16 px per module' });
    expect(field('Network name').value).toBe('');
    expect(field('Password').value).toBe('');
    expect(screen.getByLabelText('Security').textContent).toBe('WPA/WPA2/WPA3');
    expect(screen.getByLabelText('Hidden network').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(radio('Mode', 'Read'));
    second.unmount();

    render(<QrTool host={host} />);
    expect(on('Mode', 'Read')).toBe(true);
    expect(savedOf(host)!.values).toEqual({ mode: 'read', content: 'wifi', level: 'Q', quiet: 2, px: 16 });
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'scan', content: 'wifi', level: 'X', quiet: 5, px: 16, password: 'x' });
    render(<QrTool host={host} />);
    expect(on('Mode', 'Generate')).toBe(true);
    expect(on('Content', 'Wi-Fi')).toBe(true);
    expect(shows()).toEqual({ level: 'M — 15%', quiet: '4 modules', px: '16 px per module' });
  });

  it('an opened entry, a text handed over and an image win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    const session = host.history.forOwner('qr', qrHistory).session();
    await session.commit({
      kind: 'made',
      label: 'made',
      payload: { content: 'text', text: 'from history', level: 'Q', quiet: 4, px: 8 } as never,
      blobs: {},
    });
    await session.commit({ kind: 'read', label: 'read', payload: { text: 'seen', count: 1 } as never, blobs: {} });
    await session.end();
    const list = await entries(host);
    const values = { content: 'wifi', level: 'H', px: 32 };
    await seed(host, values);

    const made = render(<QrTool host={host} restore={{ id: list.find(e => e.label === 'made')!.id }} />);
    expect(await screen.findByText('Opened from History: made.')).toBeTruthy();
    expect(on('Content', 'Text')).toBe(true);
    expect(field('Text').value).toBe('from history');
    expect(shows()).toEqual({ level: 'Q — 25%', quiet: '4 modules', px: '8 px per module' });
    made.unmount();
    const read = render(<QrTool host={host} restore={{ id: list.find(e => e.label === 'read')!.id }} />);
    expect(await screen.findByText(/^Opened from History: read\./)).toBeTruthy();
    expect(on('Mode', 'Read')).toBe(true);
    read.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values });

    // A text handed over: Generate · Text with the saved options; an image pasted then: Read for the visit.
    reader.readImage.mockResolvedValue(found('pasted'));
    const handed = render(<QrTool host={host} input="handed over" />);
    expect(on('Content', 'Text')).toBe(true);
    expect(field('Text').value).toBe('handed over');
    expect(shows()).toEqual({ level: 'H — 30%', quiet: '4 modules', px: '32 px per module' });
    pasteImage();
    expect(await screen.findByText('Found a QR code: 6 characters.')).toBeTruthy();
    expect(on('Mode', 'Read')).toBe(true);
    handed.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values });

    // Opened with what is saved, an image pasted from Generate reads in Read, and nothing is written.
    render(<QrTool host={host} />);
    expect(on('Content', 'Wi-Fi')).toBe(true);
    pasteImage();
    await screen.findByText('Found a QR code: 6 characters.');
    await host.settings.forTool('qr').flush();
    expect(savedOf(host)).toEqual({ schema: 1, values });
  });

  it('reset puts every option back to its default and keeps the text; the code follows', async () => {
    const host = memoryHost();
    await seed(host, { level: 'H', quiet: 0, px: 32 });
    render(<QrTool host={host} />);
    type('Text', 'https://example.com/');
    await code();
    expect(info()).toMatch(/level H/);
    await act(async () => host.settings.forTool('qr').reset());
    expect(shows()).toEqual({ level: 'M — 15%', quiet: '4 modules', px: '8 px per module' });
    expect(field('Text').value).toBe('https://example.com/');
    await waitFor(() => expect(info()).toMatch(/level M/));
    expect(savedOf(host)).toBeUndefined();
  });
});
