import Base64FileTool from './Base64FileTool';
import { definition } from './definition';
import { detect } from './detect';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FIELD_MAX_CHARS, MAX_FILE_BYTES } from '@workspace/tool-logic-base64-file';
import { memoryHost, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A real certificate made by OpenSSL 4.1.0 for CN=example.test (public material), and samples built from signatures.
const CERT_B64 =
  'MIIBYjCCAQigAwIBAgIULI/FBMKhSjIE/HAWbdttARxSji4wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MB4XDTI2MTEyMjE1Mzc0M1oXDTM2MTExOTE1Mzc0M1owFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExHhGxRbzc/vXd9NpQxxuDnhyfGNj3f6Oq7qH5NKHSvps4yWCZzZN4DS5kPcphGK8gXn3jx54Vx6dSmx+cTRQgKMyMDAwHQYDVR0OBBYEFPhazzmPwIPHYkS2TjlJhfCH3WfPMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgDQSV9KY44EE+Bx9+nufzUAVbwnj6ZHCVCenks7UP6Q0CIQC4S8A1ycdgwDRy0o9ZTLb5l4Z95Mge5wVVmKLqhi8zBA==';
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const PDF = Uint8Array.from('%PDF-1.7\n%\u{E2}\u{E3}\u{CF}\u{D3}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', c =>
  c.charCodeAt(0),
);
const PDF_B64 = btoa(String.fromCharCode(...PDF));
// A PKCS #8 shape (RFC 5958 §2): version 0, AlgorithmIdentifier { id-ecPublicKey }, OCTET STRING — no real key.
const PKCS8_SHAPE = Uint8Array.from([
  0x30, 0x10, 0x02, 0x01, 0x00, 0x30, 0x09, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x04, 0x00,
]);
const UNKNOWN = Uint8Array.from([0, 0xff, 0x10, 0x9c, 0x33, 0xa1, 0x07, 0xee, 0x5d, 0x80]);
const fileOf = (bytes: Uint8Array, name: string, type = '') =>
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

// Object URLs: jsdom has none. Each one created is remembered with its Blob, so a test can say what was saved and
// whether its URL is still alive; anchors' clicks are recorded instead of navigating.
let live: Map<string, Blob>;
let saved: Array<{ name: string; blob: Blob }>;
let made = 0;
beforeEach(() => {
  live = new Map();
  saved = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${++made}`;
    live.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void live.delete(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: live.get(this.href)! });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mode = (name: 'Encode' | 'Decode') => fireEvent.click(screen.getByRole('radio', { name }));
const fileInputs = () => [...document.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
const choose = (...files: File[]) => fireEvent.change(fileInputs()[0]!, { target: { files } });
const typeIn = (value: string) => fireEvent.change(field('Base64 or data URI'), { target: { value } });
const fact = (name: string) => document.querySelector(`[data-fact="${name}"]`)?.textContent ?? null;
const errorLine = () => document.querySelector('[data-part="error"]')?.textContent?.trim() ?? '';
const notes = () =>
  [...document.querySelectorAll('[data-part="notes"] [data-slot="tool-message"]')].map(n => n.textContent!.trim());
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
const result = () => field('Result').value;
const paste = (target: EventTarget, data: { files?: File[]; text?: string }) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: (data.files ?? []).map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: () => data.text ?? '',
    },
  });
  act(() => void target.dispatchEvent(event));
  return event;
};

describe('the Base64 File tool’s definition', () => {
  it('describes the tool as data: a converter of the person’s input, no default shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'base64-file',
      title: 'Base64 File',
      summary: 'Turn any file into Base64 or a data URI, and Base64 back into a file.',
      order: 38,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds.map(k => [k.id, k.secret ?? false])).toEqual([
      ['encode', false],
      ['decode', false],
      ['encode-unknown', true],
      ['decode-unknown', true],
    ]);
    expect(definition.history?.maxBlobBytes).toBe(1024 * 1024);
    expect((await definition.load()).default).toBe(Base64FileTool);
  });

  it('recognises its input from a module of its own (§7)', () => {
    expect(detect('')).toBe(false);
    expect(detect('data:application/pdf;base64,JVBERi0xLjcK')).toBe(true);
    expect(detect(CERT_B64)).toBe(true);
    expect(detect('data:image/png;base64,iVBORw0KGgo')).toBe(false);
    expect(detect('SGVsbG8sIFdvcmxkIQ==')).toBe(false);
  });
});

describe('Encode (§2, §5.1, §8)', () => {
  it('renders with no host: Encode, an empty zone, Copy and Save off', () => {
    render(<Base64FileTool />);
    expect(screen.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Drop a file here, paste it, or')).toBeTruthy();
    expect(screen.getByText('Any file, up to 2 GiB')).toBeTruthy();
    expect(button('Copy').disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);
    expect(result()).toBe('');
  });

  it('while a file is dragged over the zone it says so (§5.8)', () => {
    render(<Base64FileTool />);
    const zone = document.querySelector('[data-slot="file-drop"]')!;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop the file here')).toBeTruthy();
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop a file here, paste it, or')).toBeTruthy();
  });

  it('scenario 1: a DER certificate → its facts and Base64; Copy takes it all', async () => {
    const writeText = clipboard();
    render(<Base64FileTool />);
    choose(fileOf(bytesOf(CERT_B64), 'server.der'));
    await waitFor(() => expect(result()).toBe(CERT_B64));
    expect(fact('File')).toBe('server.der');
    expect(fact('Type')).toBe('DER certificate (application/pkix-cert)');
    expect(fact('Size')).toBe('358 bytes');
    expect(fact('Base64 length')).toBe('480 characters');
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CERT_B64));
  });

  it('options: URL-safe drops the padding, a line length wraps, Data URI uses the recognised type', async () => {
    render(<Base64FileTool />);
    choose(fileOf(Uint8Array.from([0xfb, 0xff]), 'x.bin'));
    await waitFor(() => expect(result()).toBe('+/8='));
    await pick('Alphabet', 'URL-safe');
    await waitFor(() => expect(result()).toBe('-_8'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Padding' }));
    await waitFor(() => expect(result()).toBe('-_8='));
    await pick('Output', 'Data URI');
    await waitFor(() => expect(result()).toBe('data:application/octet-stream;base64,+/8='));
    expect(screen.queryByLabelText('Alphabet')).toBeNull();
  });

  it('wraps at 76 and 64', async () => {
    render(<Base64FileTool />);
    choose(fileOf(new TextEncoder().encode('a'.repeat(60)), 'a.txt'));
    await waitFor(() => expect(result()).not.toBe(''));
    await pick('Line length', '76');
    await waitFor(() =>
      expect(
        result()
          .split('\n')
          .map(l => l.length),
      ).toEqual([76, 4]),
    );
    await pick('Line length', '64');
    await waitFor(() =>
      expect(
        result()
          .split('\n')
          .map(l => l.length),
      ).toEqual([64, 16]),
    );
  });

  it('the Data URI type can be corrected; a malformed one empties the output and says why', async () => {
    render(<Base64FileTool />);
    choose(fileOf(new TextEncoder().encode('hello world'), 'a.txt'));
    await pick('Output', 'Data URI');
    await waitFor(() => expect(result()).toBe('data:text/plain;charset=utf-8;base64,aGVsbG8gd29ybGQ='));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'text/markdown' } });
    await waitFor(() => expect(result()).toBe('data:text/markdown;base64,aGVsbG8gd29ybGQ='));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'not a type' } });
    await waitFor(() => expect(result()).toBe(''));
    expect(screen.getByText('Type must look like type/subtype, for example application/pdf.')).toBeTruthy();
    expect(button('Copy').disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);
  });

  it('scenario 6: a name that lies — the bytes decide, a note says so', async () => {
    render(<Base64FileTool />);
    choose(fileOf(PDF, 'photo.png'));
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
    expect(notes()).toContain('The name says .png, but the bytes are a PDF document.');
  });

  it('a file over 2 GiB is refused by its size before it is read; several files — the first', async () => {
    render(<Base64FileTool />);
    const huge = fileOf(new Uint8Array(1), 'huge.img');
    Object.defineProperty(huge, 'size', { value: MAX_FILE_BYTES + 1 });
    choose(huge);
    expect(
      await screen.findByText('The file is 2,147,483,649 bytes (2.0 GiB). This tool works with files up to 2 GiB.'),
    ).toBeTruthy();
    choose(fileOf(PDF, 'a.pdf'), fileOf(UNKNOWN, 'b.bin'));
    await waitFor(() => expect(fact('File')).toBe('a.pdf'));
    expect(notes()).toContain('Only the first file is used.');
  });

  it('a long output: the start is shown, Copy refused beyond 16 Mi characters, Save saves all of it', async () => {
    render(<Base64FileTool />);
    const big = new Uint8Array(12 * 1024 * 1024 + 3);
    big[0] = 0;
    big[1] = 0xff;
    choose(fileOf(big, 'disk.img'));
    await waitFor(() => expect(result().length).toBe(65_536));
    expect(
      screen.getByText('Showing the first 65,536 of 16,777,220 characters. Too large to copy: Save saves all.'),
    ).toBeTruthy();
    expect(button('Copy').disabled).toBe(true);
    fireEvent.click(button('Save'));
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 30_000 });
    expect(saved[0]!.name).toBe('disk.img.txt');
    expect(saved[0]!.blob.size).toBe(16_777_220);
    expect(saved[0]!.blob.type).toBe('application/octet-stream');
    const head = await saved[0]!.blob.slice(0, 8).text();
    expect(head).toBe('AP8AAAAA');
    expect(live.size).toBe(0);
  }, 60_000);

  it('a pasted file is taken in Encode; pasted text with nothing focused goes to Decode', async () => {
    render(<Base64FileTool />);
    paste(document.body, { files: [fileOf(PDF, 'pasted.pdf', 'application/pdf')] });
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
    paste(document.body, { text: PDF_B64 });
    await waitFor(() => expect(field('Base64 or data URI').value).toBe(PDF_B64));
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
  });
});

describe('Decode (§2, §5.3–§5.7, §6, §8)', () => {
  it('scenario 2: Base64 of a PDF → its facts and a file name; Save file saves the bytes, its URL revoked', async () => {
    render(<Base64FileTool input={PDF_B64} />);
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
    expect(fact('Size')).toBe(`${PDF.length} bytes`);
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe('file.pdf');
    fireEvent.click(button('Save file'));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe('file.pdf');
    expect(new Uint8Array(await saved[0]!.blob.arrayBuffer())).toEqual(PDF);
    expect(saved[0]!.blob.type).toBe('application/octet-stream');
    expect(live.size).toBe(0);
  });

  it('scenario 4: a data URI’s name parameter, cleaned; the name field is cleaned again on Save', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    typeIn(`data:application/octet-stream;name=..%2F..%2Fevil%0A.txt;base64,${PDF_B64}`);
    await waitFor(() => expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe('evil.pdf'));
    expect(notes()).toEqual([]);
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: '../x/\u{202E}fdp.exe\n' } });
    fireEvent.click(button('Save file'));
    expect(saved[0]!.name).toBe('fdp.exe');
  });

  it('scenario 7: HTML is text — Show text shows it in a read-only field, nothing else', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    typeIn('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
    await waitFor(() => expect(fact('Type')).toBe('HTML document (text/html)'));
    expect(fact('Declared type')).toBe('text/html');
    expect(notes()).toContain('This is text.');
    expect(document.querySelector('script')).toBeNull();
    fireEvent.click(button('Show text'));
    await waitFor(() => expect(field('Text').value).toBe('<script>alert(1)</script>'));
    expect(field('Text').readOnly).toBe(true);
    expect(document.querySelector('script')).toBeNull();
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe('file.html');
  });

  it('scenario 8 and §6: errors next to the field, with their place', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    typeIn('JVBERi0x!jcK');
    await waitFor(() => expect(errorLine()).toBe('Line 1, column 9: invalid character "!"'));
    expect(document.querySelector('[data-part="error"]')?.getAttribute('role')).toBe('status');
    expect(button('Save file').disabled).toBe(true);
    typeIn('data:application/pdf;base64');
    await waitFor(() => expect(errorLine()).toBe('a data URI needs a comma before the data'));
    typeIn('https://example.com/a.pdf');
    await waitFor(() => expect(errorLine()).toBe('This is an address, not Base64: this tool never fetches anything.'));
    typeIn('   \n ');
    await waitFor(() => expect(errorLine()).toBe(''));
    expect(fact('Type')).toBeNull();
  });

  it('scenario 9: a PEM block → the DER certificate, named after its label', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    typeIn(`-----BEGIN CERTIFICATE-----\n${CERT_B64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`);
    await waitFor(() => expect(fact('Type')).toBe('DER certificate (application/pkix-cert)'));
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe('certificate.cer');
  });

  it('a declared type the bytes disagree with is a warning', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    typeIn(`data:image/png;base64,${PDF_B64}`);
    await waitFor(() => expect(notes()).toContain('Declared image/png, but the bytes are a PDF document.'));
  });

  it('a paste over 4 Mi characters never reaches the field: it is held and decoded', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    const text = 'AAAA'.repeat(FIELD_MAX_CHARS / 4 + 1);
    const event = paste(field('Base64 or data URI'), { text });
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByText('Pasted text: 4,194,308 characters, not shown in the field.')).toBeTruthy();
    await waitFor(() => expect(fact('Size')).toBe('3,145,731 bytes (3.0 MiB)'), { timeout: 20_000 });
    fireEvent.click(button('Clear'));
    expect(field('Base64 or data URI').value).toBe('');
  }, 30_000);

  it('a text file opened in Decode is read as Base64; a file that is not text goes to Encode', async () => {
    render(<Base64FileTool />);
    mode('Decode');
    fireEvent.change(fileInputs()[0]!, {
      target: { files: [fileOf(new TextEncoder().encode(`${PDF_B64}\n`), 'doc.b64')] },
    });
    expect(
      await screen.findByText(`Text file: doc.b64, ${PDF_B64.length + 1} bytes, not shown in the field.`),
    ).toBeTruthy();
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
    fireEvent.change(fileInputs()[0]!, { target: { files: [fileOf(PDF, 'doc.pdf')] } });
    expect(await screen.findByText('Not Base64 text: the file was opened in Encode.')).toBeTruthy();
    await waitFor(() => expect(result()).toBe(PDF_B64));
  });
});

describe('history (D17, §11)', () => {
  const entriesOf = async (host: { history: ReturnType<typeof memoryHost>['history'] }) =>
    (await host.history.forOwner('base64-file', definition.history!).list()).entries;

  it('commits a chosen file and Copy, the file as a blob; neither its name nor Base64 is kept', async () => {
    clipboard();
    const host = memoryHost();
    render(<Base64FileTool host={host} />);
    choose(fileOf(PDF, 'secret-plan.pdf'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    await waitFor(() => expect(result()).toBe(PDF_B64));
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2));
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toContain(`Encode · PDF document · ${PDF.length} bytes · Base64 · chosen`);
    expect(labels).toContain(`Encode · PDF document · ${PDF.length} bytes · Base64 · copied`);
    const opened = await host.history.forOwner('base64-file', definition.history!).open((await entriesOf(host))[0]!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(new Uint8Array(await opened.blobs.file!.arrayBuffer())).toEqual(PDF);
    expect((opened.blobs.file as File).name).toBeUndefined();
    const kept = JSON.stringify(opened.payload);
    expect(kept).not.toContain('secret-plan');
    expect(kept).not.toContain(PDF_B64.slice(0, 16));
    expect(opened.payload).toMatchObject({ mode: 'encode', type: 'pdf', mime: 'application/pdf', form: 'base64' });
  });

  it('a private key is never kept, and the page says so', async () => {
    const host = memoryHost();
    render(<Base64FileTool host={host} />);
    choose(fileOf(PKCS8_SHAPE, 'id.key'));
    await waitFor(() => expect(fact('Type')).toBe('DER private key (PKCS #8) (application/pkcs8)'));
    expect(notes()).toContain('Not kept in history: a private key is never kept.');
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(0);
  });

  it('a private key is never kept even with a master password unlocked', async () => {
    const host = await unlockedHost();
    render(<Base64FileTool host={host} />);
    mode('Decode');
    typeIn(btoa(String.fromCharCode(...PKCS8_SHAPE)));
    await waitFor(() => expect(fact('Type')).toBe('DER private key (PKCS #8) (application/pkcs8)'));
    fireEvent.click(button('Save file'));
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(0);
  });

  it('bytes of an unknown type: nothing without a master password; encrypted with one', async () => {
    const plain = memoryHost();
    const first = render(<Base64FileTool host={plain} />);
    choose(fileOf(UNKNOWN, 'blob.bin'));
    await waitFor(() => expect(fact('Type')).toBe('Unknown binary data (application/octet-stream)'));
    expect(notes()).toContain('Not kept in history: bytes of an unknown type are kept only with a master password.');
    await act(async () => undefined);
    expect(await entriesOf(plain)).toHaveLength(0);
    first.unmount();

    const host = await unlockedHost();
    render(<Base64FileTool host={host} />);
    choose(fileOf(UNKNOWN, 'blob.bin'));
    await waitFor(() => expect(notes()).toContain('Kept encrypted: bytes of an unknown type may be a key.'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.kind).toBe('encode-unknown');
    const opened = await host.history.forOwner('base64-file', definition.history!).open(entry!.id);
    expect(opened.ok && new Uint8Array(await opened.blobs.file!.arrayBuffer())).toEqual(UNKNOWN);
    await host.vault.lock();
    const locked = await host.history.forOwner('base64-file', definition.history!).open(entry!.id);
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('a file over 1 MiB is not kept; a Decode edit is a snapshot when the page goes away', async () => {
    const host = memoryHost();
    const first = render(<Base64FileTool host={host} />);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PDF);
    choose(fileOf(big, 'big.pdf'));
    await waitFor(() => expect(notes()).toContain('Not kept in history: files over 1 MiB are not kept.'));
    mode('Decode');
    typeIn(`data:application/pdf;base64,${PDF_B64}`);
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe(`Decode · PDF document · ${PDF.length} bytes`);
  });

  it('opens a Decode entry back with the same shape of input and declared type, without a name; opening records nothing', async () => {
    const host = memoryHost();
    const first = render(<Base64FileTool host={host} />);
    mode('Decode');
    typeIn(`data:image/png;name=plan.pdf;base64,${PDF_B64}`);
    await waitFor(() => expect(fact('Type')).toBe('PDF document (application/pdf)'));
    fireEvent.click(button('Save file'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    first.unmount();
    const [entry] = await entriesOf(host);
    render(<Base64FileTool host={host} restore={{ id: entry!.id }} />);
    expect(
      await screen.findByText(`Opened from History: Decode · PDF document · ${PDF.length} bytes · saved.`),
    ).toBeTruthy();
    expect(field('Base64 or data URI').value).toBe(`data:image/png;base64,${PDF_B64}`);
    await waitFor(() => expect(notes()).toContain('Declared image/png, but the bytes are a PDF document.'));
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe('file.pdf');
    cleanup();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('opens an Encode entry back with its file and options', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<Base64FileTool host={host} />);
    const emptyZip = Uint8Array.from([0x50, 0x4b, 5, 6, ...new Array<number>(18).fill(0)]);
    choose(fileOf(emptyZip, 'x.zip'));
    await waitFor(() => expect(result()).toBe('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=='));
    await pick('Alphabet', 'URL-safe');
    await waitFor(() => expect(result()).toBe('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA'));
    fireEvent.click(button('Copy'));
    await waitFor(async () =>
      expect((await entriesOf(host)).some(e => e.label?.endsWith('URL-safe · copied'))).toBe(true),
    );
    first.unmount();
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('URL-safe · copied'))!;
    expect(copied.label).toBe('Encode · ZIP archive · 22 bytes · Base64 · URL-safe · copied');
    render(<Base64FileTool host={host} restore={{ id: copied.id }} />);
    await waitFor(() => expect(result()).toBe('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA'));
    expect(fact('File')).toBeNull();
    expect(fact('Type')).toBe('ZIP archive (application/zip)');
  });

  it('opens an Encode entry back with its options (a recognised file)', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<Base64FileTool host={host} />);
    choose(fileOf(PDF, 'a.pdf'));
    await waitFor(() => expect(result()).toBe(PDF_B64));
    await pick('Output', 'Data URI');
    await waitFor(() => expect(result()).toBe(`data:application/pdf;base64,${PDF_B64}`));
    fireEvent.click(button('Copy'));
    await waitFor(async () =>
      expect((await entriesOf(host)).some(e => e.label?.endsWith('Data URI · copied'))).toBe(true),
    );
    first.unmount();
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('Data URI · copied'))!;
    render(<Base64FileTool host={host} restore={{ id: copied.id }} />);
    await waitFor(() => expect(result()).toBe(`data:application/pdf;base64,${PDF_B64}`));
    expect(fact('File')).toBeNull();
  });
});
