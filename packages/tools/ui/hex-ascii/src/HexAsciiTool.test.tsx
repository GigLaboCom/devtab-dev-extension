import { definition } from './definition';
import { detect } from './detect';
import HexAsciiTool from './HexAsciiTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_HEX_INPUT, MAX_TEXT_INPUT, SETTLE_MS } from '@workspace/tool-logic-hex-ascii';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const input = () => screen.getByPlaceholderText(/Text to turn into bytes|48 65 6c 6c 6f/) as HTMLTextAreaElement;
const result = () => document.querySelector('#hex-ascii-output') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const output = () => result().value;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mode = (name: 'Text to hex' | 'Hex to text') => fireEvent.click(screen.getByRole('radio', { name }));
const errorLine = () => document.querySelector('[data-part="error"]')!.textContent!.trim();
const byteLine = () => document.querySelector('[data-part="bytes"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
/** Opens a Radix Select by its label and picks an option, with the keyboard. */
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const clipboard = () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the Hex and Text tool’s definition', () => {
  it('describes the tool as data, with no default shortcut, and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'hex-ascii',
      title: 'Hex and Text',
      summary: 'Turn text into hex bytes and back: UTF-8, UTF-16 or ISO-8859-1.',
      order: 19,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'hex',
      'ascii',
      'hex to text',
      'text to hex',
      'bytes',
      'utf-8',
      'utf-16',
      'latin-1',
      'hexdump',
      '0x',
    ]);
    expect(definition).not.toHaveProperty('shortcut');
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['to-hex', 'to-text']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(HexAsciiTool);
  });

  it('recognises hex of text from a module of its own (§7)', () => {
    expect(detect('48656c6c6f')).toBe(true);
    expect(detect('deadbeef')).toBe(false);
    expect(detect('')).toBe(false);
  });
});

describe('the Hex and Text tool, rendered with no host', () => {
  it('starts empty: Text to hex, UTF-8, Plain, both fields empty, 0 bytes, Copy and Swap off (§4, §8)', () => {
    render(<HexAsciiTool />);
    expect(screen.getByRole('radio', { name: 'Text to hex' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Text')).toBe(input());
    expect(screen.getByLabelText('Hex')).toBe(result());
    expect(input().value).toBe('');
    expect(input().placeholder).toBe('Text to turn into bytes');
    expect(input().getAttribute('spellcheck')).toBe('false');
    expect(result().getAttribute('spellcheck')).toBe('false');
    expect(result().readOnly).toBe(true);
    expect(output()).toBe('');
    expect(byteLine()).toBe('0 bytes');
    expect(document.querySelector('[data-part="bytes"]')!.getAttribute('role')).toBe('status');
    expect(errorLine()).toBe('');
    expect(notes()).toEqual([]);
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
    expect(screen.getByLabelText('Encoding').textContent).toContain('UTF-8');
    expect(screen.getByLabelText('Format').textContent).toContain('Plain — 48656c');
    expect(screen.getByLabelText('Uppercase').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Bytes per line').textContent).toContain('No wrapping');
  });

  it('§8: the select items word for word', async () => {
    render(<HexAsciiTool />);
    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'Enter' });
    const formats = (await screen.findAllByRole('option')).map(o => o.textContent);
    expect(formats).toEqual([
      'Plain — 48656c',
      'Spaced — 48 65 6c',
      'Colons — 48:65:6c',
      'Commas — 48, 65, 6c',
      'C array — 0x48, 0x65',
      'Escaped — \\x48\\x65',
      'Dump — offsets and text',
    ]);
    fireEvent.keyDown(screen.getAllByRole('option')[0]!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.keyDown(screen.getByLabelText('Encoding'), { key: 'Enter' });
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual([
      'UTF-8',
      'UTF-16 LE',
      'UTF-16 BE',
      'ISO-8859-1',
    ]);
  });

  it('§2.1: hex from a log reads as text, the byte count under the hex', () => {
    render(<HexAsciiTool />);
    mode('Hex to text');
    expect(screen.getByLabelText('Hex')).toBe(input());
    expect(screen.getByLabelText('Text')).toBe(result());
    expect(input().placeholder).toBe('48 65 6c 6c 6f, 0x48 or \\x48');
    expect(screen.queryByLabelText('Format')).toBeNull();
    expect(screen.queryByLabelText('Uppercase')).toBeNull();
    expect(screen.queryByLabelText('Bytes per line')).toBeNull();
    type('48656c6c6f2c20776f726c64');
    expect(output()).toBe('Hello, world');
    expect(byteLine()).toBe('12 bytes');
    // Under the input in this direction.
    expect(input().parentElement!.querySelector('[data-part="bytes"]')).not.toBeNull();
  });

  it('§2.2: a C array from a debugger — brackets, commas and 0x are skipped', () => {
    render(<HexAsciiTool />);
    mode('Hex to text');
    type('{0x48, 0x65, 0x6c, 0x6c, 0x6f}');
    expect(output()).toBe('Hello');
    expect(byteLine()).toBe('5 bytes');
  });

  it('§2.3: é€😀 as UTF-8 Spaced, then UTF-16 LE', async () => {
    render(<HexAsciiTool />);
    type('é€😀');
    expect(output()).toBe('c3a9e282acf09f9880');
    await choose('Format', 'Spaced — 48 65 6c');
    expect(output()).toBe('c3 a9 e2 82 ac f0 9f 98 80');
    expect(byteLine()).toBe('9 bytes');
    expect(result().parentElement!.querySelector('[data-part="bytes"]')).not.toBeNull();
    await choose('Encoding', 'UTF-16 LE');
    expect(output()).toBe('e9 00 ac 20 3d d8 00 de');
    expect(byteLine()).toBe('8 bytes');
  });

  it('§2.4: Latin-1 bytes read as UTF-8 give U+FFFD and a note; ISO-8859-1 reads é', async () => {
    render(<HexAsciiTool />);
    mode('Hex to text');
    type('e9');
    expect(output()).toBe('�');
    expect(notes()).toEqual([
      'Not valid UTF-8 from byte 1: invalid bytes are shown as U+FFFD. ISO-8859-1 shows every byte as one character.',
    ]);
    await choose('Encoding', 'ISO-8859-1');
    expect(output()).toBe('é');
    expect(notes()).toEqual([]);
  });

  it('§2.5: the dump view — Swap and Bytes per line are off; Uppercase changes offsets and bytes', async () => {
    render(<HexAsciiTool />);
    type('Hello, World!\nHi');
    await choose('Format', 'Dump — offsets and text');
    expect(output()).toBe(
      ['00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 0a 48 69  |Hello, World!.Hi|'].join('\n'),
    );
    expect(button('Swap').disabled).toBe(true);
    expect((screen.getByLabelText('Bytes per line') as HTMLButtonElement).disabled).toBe(true);
    expect(result().getAttribute('wrap')).toBe('off');
    type('0123456789abcdefg');
    fireEvent.click(screen.getByLabelText('Uppercase'));
    expect(output().split('\n')[1]).toBe(`00000010  67${' '.repeat(48)}|g|`);
    expect(output().split('\n')[0]).toContain('61 62 63 64 65 66');
  });

  it('§2.6: a typo is named with its place under the input, read out politely; the result is empty', () => {
    render(<HexAsciiTool />);
    mode('Hex to text');
    type('48 6g');
    expect(errorLine()).toBe('Line 1, column 5: "g" is not a hex digit');
    expect(document.querySelector('[data-part="error"]')!.getAttribute('role')).toBe('status');
    expect(output()).toBe('');
    expect(byteLine()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
  });

  it('§2.7: control characters show as symbols, Copy copies the real ones', async () => {
    const writeText = clipboard();
    render(<HexAsciiTool />);
    mode('Hex to text');
    type('00 07 0d 0a 41');
    expect(output()).toBe('␀␇␍\nA');
    expect(notes()).toEqual(['Contains 3 control characters, shown as symbols. Copy copies the real characters.']);
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('\u0000\u0007\r\nA');
    expect(button('Copied')).toBeTruthy();
    type('00 07 0d 0a 42');
    expect(button('Copy')).toBeTruthy();
  });

  it('§6: each error and note, as people read it', async () => {
    render(<HexAsciiTool />);
    await choose('Encoding', 'ISO-8859-1');
    type('a😀');
    expect(errorLine()).toBe('Line 1, column 2: "😀" is not in ISO-8859-1');
    type('€');
    expect(errorLine()).toBe('Line 1, column 1: "€" is not in ISO-8859-1');
    await choose('Encoding', 'UTF-8');
    type('\uD800');
    expect(output()).toBe('efbfbd');
    expect(notes()).toEqual(['Unpaired surrogates were replaced with U+FFFD (ef bf bd).']);
    type('  ');
    expect(output()).toBe('2020');

    mode('Hex to text');
    const errors: Array<[string, string]> = [
      ['48 6', 'Line 1, column 4: odd number of hex digits in "6"'],
      ['486', 'Line 1, column 1: odd number of hex digits in "486"'],
      ['48 zz', 'Line 1, column 4: "z" is not a hex digit'],
      ['0x', 'Line 1, column 1: 0x without hex digits'],
      ['\\x', 'Line 1, column 1: \\x without hex digits'],
      ['%48', 'Line 1, column 1: "%" is not a hex digit'],
      [
        '00000000  48 65 6c 6c 6f 0a                                 |Hello.|',
        'Line 1, column 1: looks like a hex dump: offsets and the text column are not accepted. Paste only the hex bytes (xxd -p prints them)',
      ],
    ];
    for (const [text, message] of errors) {
      type(text);
      expect(errorLine(), text).toBe(message);
      expect(output()).toBe('');
    }
    type('efbbbf61');
    expect(output()).toBe('﻿a');
    expect(notes()).toEqual(['Starts with a byte order mark (U+FEFF).']);
    type(' \n ');
    expect(output()).toBe('');
    expect(byteLine()).toBe('0 bytes');
    expect(errorLine()).toBe('');
    await choose('Encoding', 'UTF-16 LE');
    type('410042');
    expect(output()).toBe('A�');
    expect(notes()).toEqual([
      'Not valid UTF-16 from byte 3 (an unpaired surrogate or an odd last byte): shown as U+FFFD.',
    ]);
    await choose('Encoding', 'ISO-8859-1');
    type('80 9f');
    expect(notes()).toEqual([
      'Contains 2 control characters (C1, U+0080–U+009F): they have no symbols and stay invisible. Copy copies the real characters.',
    ]);
  });

  it('§4: Uppercase keeps the prefix lowercase; Bytes per line wraps', async () => {
    render(<HexAsciiTool />);
    type('Ok, all of it.');
    await choose('Format', 'C array — 0x48, 0x65');
    fireEvent.click(screen.getByLabelText('Uppercase'));
    expect(output().startsWith('0x4F, 0x6B')).toBe(true);
    await choose('Bytes per line', '8');
    expect(output()).toBe('0x4F, 0x6B, 0x2C, 0x20, 0x61, 0x6C, 0x6C, 0x20,\n0x6F, 0x66, 0x20, 0x69, 0x74, 0x2E');
  });

  it('§4: Swap moves the result into the input and turns the direction around, both ways', async () => {
    render(<HexAsciiTool />);
    await choose('Format', 'Spaced — 48 65 6c');
    type('Привет');
    const there = output();
    expect(there).toBe('d0 9f d1 80 d0 b8 d0 b2 d0 b5 d1 82');
    fireEvent.click(button('Swap'));
    expect(input().value).toBe(there);
    expect(screen.getByRole('radio', { name: 'Hex to text' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('Привет');
    fireEvent.click(button('Swap'));
    expect(input().value).toBe('Привет');
    expect(screen.getByLabelText('Format').textContent).toContain('Spaced');
    expect(output()).toBe(there);
  });

  it('§4: Swap takes the real text, not the symbols', () => {
    render(<HexAsciiTool />);
    mode('Hex to text');
    type('41 00 42');
    expect(output()).toBe('A␀B');
    fireEvent.click(button('Swap'));
    expect(input().value).toBe('A\u0000B');
    expect(output()).toBe('410042');
  });

  it('starts in Hex to text with the text the start page hands over (recognised by detectHex)', () => {
    render(<HexAsciiTool input="48656c6c6f" />);
    expect(screen.getByRole('radio', { name: 'Hex to text' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('Hello');
  });
});

describe('the Hex and Text tool’s limits (§12)', () => {
  it('follows every edit up to 256 Ki, and 300 ms after the last edit above it', () => {
    vi.useFakeTimers();
    render(<HexAsciiTool />);
    type('a'.repeat(LIVE_INPUT));
    expect(output()).toHaveLength(LIVE_INPUT * 2);
    type('b'.repeat(LIVE_INPUT + 1));
    expect(output().startsWith('6161')).toBe(true); // still the previous result
    act(() => vi.advanceTimersByTime(SETTLE_MS - 10));
    expect(output().startsWith('6161')).toBe(true);
    act(() => vi.advanceTimersByTime(20));
    expect(output().startsWith('6262')).toBe(true);
    expect(output()).toHaveLength((LIVE_INPUT + 1) * 2);
  });

  it('Text to hex works on exactly 1 Mi characters and refuses one more at once', () => {
    vi.useFakeTimers();
    render(<HexAsciiTool />);
    type('a'.repeat(MAX_TEXT_INPUT));
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(errorLine()).toBe('');
    expect(byteLine()).toBe('1,048,576 bytes');
    type('a'.repeat(MAX_TEXT_INPUT + 1));
    expect(errorLine()).toBe('Text is larger than 1 MB. Text to hex works with up to 1 MB.');
    expect(output()).toBe('');
    expect(button('Swap').disabled).toBe(true);
  });

  it('Hex to text works on exactly 5 Mi characters and refuses one more at once', () => {
    vi.useFakeTimers();
    render(<HexAsciiTool />);
    mode('Hex to text');
    type('41'.repeat(MAX_HEX_INPUT / 2));
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(errorLine()).toBe('');
    expect(output()).toHaveLength(MAX_HEX_INPUT / 2);
    type(`${'41'.repeat(MAX_HEX_INPUT / 2)} `);
    expect(errorLine()).toBe('Input is larger than 5 MB. Hex to text works with up to 5 MB.');
    expect(output()).toBe('');
  });
});

describe('the Hex and Text tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('hex-ascii', definition.history!).list(kinds ? { kinds } : {})).entries;
  /** Waits until the history stops changing, then answers its entries. */
  const settledEntries = async (host: ReturnType<typeof memoryHost>) => {
    let last = -1;
    for (;;) {
      await act(async () => new Promise(r => setTimeout(r, 30)));
      const now = (await entriesOf(host)).length;
      if (now === last) return entriesOf(host);
      last = now;
    }
  };

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<HexAsciiTool host={host} />);
    type('Hello');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['to-hex'])).toHaveLength(1));
    const [entry] = await settledEntries(host);
    expect(entry!.label).toBe('Text to hex · UTF-8 · Plain · 5 bytes');

    render(<HexAsciiTool host={host} />).unmount();
    expect(await settledEntries(host)).toHaveLength(1);
  });

  it('commits Copy and Swap at once, with the input, the options and the result; invalid bytes keep their hex', async () => {
    clipboard();
    const host = memoryHost();
    render(<HexAsciiTool host={host} />);
    mode('Hex to text');
    type('48 e9 41');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['to-text'])).toHaveLength(1));
    fireEvent.click(button('Swap'));
    await waitFor(async () => expect(await entriesOf(host, ['to-text'])).toHaveLength(2));
    const entries = await settledEntries(host);
    const labels = entries.map(e => e.label);
    expect(labels).toContain('Hex to text · UTF-8 · 3 bytes · not valid UTF-8 from byte 2 · copied');
    expect(labels).toContain('Hex to text · UTF-8 · 3 bytes · not valid UTF-8 from byte 2 · swapped');
    const history = host.history.forOwner('hex-ascii', definition.history!);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    const opened = await history.open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toMatchObject({ mode: 'to-text', encoding: 'utf-8', outcome: 'ok', firstInvalidByte: 2 });
    expect(await opened.blobs.input!.text()).toBe('48 e9 41');
    expect(await opened.blobs.output!.text()).toBe('H�A');
  });

  it('opens an entry back into the tool: input, direction and options; opening records nothing', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<HexAsciiTool host={host} />);
    await choose('Encoding', 'UTF-16 BE');
    await choose('Format', 'Colons — 48:65:6c');
    await choose('Bytes per line', '16');
    fireEvent.click(screen.getByLabelText('Uppercase'));
    type('é€😀');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['to-hex'])).toHaveLength(1));
    first.unmount();
    const entries = await settledEntries(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('Text to hex · UTF-16 BE · Colons · uppercase · 16 per line · 8 bytes · copied');

    const second = render(<HexAsciiTool host={host} restore={{ id: copied.id }} />);
    expect(await screen.findByText(`Opened from History: ${copied.label}.`)).toBeTruthy();
    expect(input().value).toBe('é€😀');
    expect(screen.getByLabelText('Encoding').textContent).toContain('UTF-16 BE');
    expect(screen.getByLabelText('Format').textContent).toContain('Colons');
    expect(screen.getByLabelText('Uppercase').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Bytes per line').textContent).toContain('16');
    expect(output()).toBe('00:E9:20:AC:D8:3D:DE:00');
    second.unmount();
    expect(await settledEntries(host)).toHaveLength(entries.length);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    render(<HexAsciiTool host={host} input="48656c6c6f" />).unmount();
    await waitFor(async () => expect(await entriesOf(host, ['to-text'])).toHaveLength(1));
    expect((await settledEntries(host))[0]!.label).toBe('Hex to text · UTF-8 · 5 bytes');
  });

  it('records an error with its place, and nothing for a refused input', async () => {
    const host = memoryHost();
    const view = render(<HexAsciiTool host={host} />);
    mode('Hex to text');
    type('48 zz');
    view.unmount();
    await waitFor(async () => expect(await entriesOf(host, ['to-text'])).toHaveLength(1));
    expect((await settledEntries(host))[0]!.label).toBe(
      'Hex to text · UTF-8 · error at line 1, column 4 · 5 characters',
    );

    const other = memoryHost();
    const refused = render(<HexAsciiTool host={other} />);
    type('a'.repeat(MAX_TEXT_INPUT + 1));
    refused.unmount();
    expect(await settledEntries(other)).toHaveLength(0);
  });
});
