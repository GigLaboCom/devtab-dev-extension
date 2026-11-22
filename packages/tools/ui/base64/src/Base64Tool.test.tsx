import Base64Tool from './Base64Tool';
import { definition } from './definition';
import { detect } from './detect';
import { base64History } from './history';
import { base64Settings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT, SETTLE_MS } from '@workspace/tool-logic-base64';
import { memoryHost } from '@workspace/tools-host';
import { MAX_SHOWN_CHARS } from '@workspace/ui/result-field';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field('Input'), { target: { value } });
const output = () => field('Result').value;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mode = (name: 'Encode' | 'Decode') => fireEvent.click(screen.getByRole('radio', { name }));
const errorLine = () => document.querySelector('[data-part="error"]')!.textContent!.trim();
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

describe('the Base64 tool’s definition', () => {
  it('describes the tool and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'base64',
      title: 'Base64',
      summary: 'Encode text to Base64 and decode it back, standard or URL-safe.',
      order: 2,
    });
    expect(definition.keywords).toEqual(['base64', 'encode', 'decode', 'base64url', 'url-safe', 'atob', 'btoa', 'pem']);
    expect(detect('SGVsbG8sIFdvcmxkIQ==')).toBe(true);
    expect(detect('password')).toBe(false);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['encode', 'decode']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(Base64Tool);
  });
});

describe('the Base64 tool, rendered with no host', () => {
  it('starts empty: Encode, both fields empty, no messages, Copy and Swap off (§8)', () => {
    render(<Base64Tool />);
    expect(screen.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')).toBe('true');
    expect(field('Input').value).toBe('');
    expect(field('Input').placeholder).toBe('Text to encode');
    expect(field('Input').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').readOnly).toBe(true);
    expect(output()).toBe('');
    expect(errorLine()).toBe('');
    expect(notes()).toEqual([]);
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
    expect(screen.getByLabelText('Alphabet')).toBeTruthy();
    expect((screen.getByLabelText('Padding') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Line length').textContent).toContain('No wrapping');
  });

  it('§2.1: Decode the Basic credentials of a header at once', () => {
    render(<Base64Tool />);
    mode('Decode');
    expect(field('Input').placeholder).toBe('Base64 to decode');
    type('YWRtaW46c2VjcmV0');
    expect(output()).toBe('admin:secret');
  });

  it('§2.2: Encode Cyrillic as UTF-8 and copy it with one press', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<Base64Tool />);
    type('Привет');
    expect(output()).toBe('0J/RgNC40LLQtdGC');
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('0J/RgNC40LLQtdGC');
    expect(button('Copied')).toBeTruthy();
    type('Привет!');
    expect(button('Copy')).toBeTruthy();
  });

  it('§2.3: URL-safe turns padding off by itself; the checkbox can turn it back on', async () => {
    render(<Base64Tool />);
    type('subjects?_d');
    expect(output()).toBe('c3ViamVjdHM/X2Q=');
    await choose('Alphabet', 'URL-safe');
    expect(screen.getByLabelText('Padding').getAttribute('aria-checked')).toBe('false');
    expect(output()).toBe('c3ViamVjdHM_X2Q');
    fireEvent.click(screen.getByLabelText('Padding'));
    expect(output()).toBe('c3ViamVjdHM_X2Q=');
    await choose('Alphabet', 'Standard');
    expect(screen.getByLabelText('Padding').getAttribute('aria-checked')).toBe('true');
  });

  it('§4: Line length wraps the result with \\n', async () => {
    render(<Base64Tool />);
    type('a'.repeat(60));
    await choose('Line length', '64');
    expect(output()).toBe(`${'YWFh'.repeat(16)}\n${'YWFh'.repeat(4)}`);
    await choose('Line length', '76');
    expect(output()).toBe(`${'YWFh'.repeat(19)}\nYWFh`);
  });

  it('§2.4: a PEM-like block over several lines decodes whole', () => {
    render(<Base64Tool />);
    mode('Decode');
    type('  SGVsbG8s\r\n\tIFdv\n cmxk IQ==\n');
    expect(output()).toBe('Hello, World!');
    expect(errorLine()).toBe('');
  });

  it('§4, §8: Decode hides the three options and says what it accepts', () => {
    render(<Base64Tool />);
    mode('Decode');
    expect(screen.queryByLabelText('Alphabet')).toBeNull();
    expect(screen.queryByLabelText('Padding')).toBeNull();
    expect(screen.queryByLabelText('Line length')).toBeNull();
    expect(screen.getByText('Accepts standard and URL-safe alphabets, with or without padding.')).toBeTruthy();
  });

  it('§2.5: bytes that are not text are shown as hex with a note; Swap is off', () => {
    render(<Base64Tool />);
    mode('Decode');
    type('//79');
    expect(output()).toBe('ff fe fd');
    expect(notes()).toEqual(['Not UTF-8 text: showing 3 bytes as hex.']);
    expect(button('Swap').disabled).toBe(true);
    expect(button('Copy').disabled).toBe(false);
    type('/w==');
    expect(notes()).toEqual(['Not UTF-8 text: showing 1 byte as hex.']);
  });

  it('§8: the byte count has a thousands separator', () => {
    render(<Base64Tool />);
    mode('Decode');
    type('/'.repeat(1600));
    expect(notes()).toEqual(['Not UTF-8 text: showing 1,200 bytes as hex.']);
  });

  it('§2.6: a typo is named with its place under the input, and the result is empty', () => {
    render(<Base64Tool />);
    mode('Decode');
    type('Zm9v!');
    expect(errorLine()).toBe('Line 1, column 5: invalid character "!"');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
  });

  it('§6: each decode error, as people read it', () => {
    render(<Base64Tool />);
    mode('Decode');
    const cases: Array<[string, string]> = [
      ['Zm=9v', 'Line 1, column 3: misplaced padding "="'],
      ['Zg=', 'Line 1, column 3: misplaced padding "="'],
      ['Zm9vY', 'Line 1, column 5: one character too many at the end'],
      ['====', 'Line 1, column 1: misplaced padding "="'],
      ['data:image/png;base64,iVBO', 'This is a data URL. Open it in Base64 Image.'],
      ['Zm9v\n😀', 'Line 2, column 1: invalid character "😀"'],
    ];
    for (const [input, message] of cases) {
      type(input);
      expect(errorLine()).toBe(message);
      expect(output()).toBe('');
    }
    type('   \n ');
    expect(errorLine()).toBe('');
    expect(output()).toBe('');
  });

  it('§6: a byte order mark is kept and noted', () => {
    render(<Base64Tool />);
    mode('Decode');
    type('77u/YQ==');
    expect(output()).toBe('\uFEFFa');
    expect(notes()).toEqual(['Starts with a byte order mark (U+FEFF).']);
  });

  it('§6: only spaces encode; Encode keeps the edges', () => {
    render(<Base64Tool />);
    type('   ');
    expect(output()).toBe('ICAg');
  });

  it('§2.7: Swap moves the result into the input and turns the direction around, options untouched', async () => {
    render(<Base64Tool />);
    await choose('Alphabet', 'URL-safe');
    type('😀 subjects?_d');
    const encoded = output();
    expect(encoded).toBe('8J-YgCBzdWJqZWN0cz9fZA');
    fireEvent.click(button('Swap'));
    expect(field('Input').value).toBe(encoded);
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('😀 subjects?_d');
    fireEvent.click(button('Swap'));
    expect(field('Input').value).toBe('😀 subjects?_d');
    expect(screen.getByLabelText('Alphabet').textContent).toContain('URL-safe');
    expect(output()).toBe(encoded);
  });

  it('starts in Decode with the text the start page hands over (recognised by detectBase64)', () => {
    render(<Base64Tool input="SGVsbG8sIFdvcmxkIQ==" />);
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('Hello, World!');
  });

  it('§8: the arrow keys move between Encode and Decode', async () => {
    render(<Base64Tool />);
    const encode = screen.getByRole('radio', { name: 'Encode' });
    act(() => encode.focus());
    fireEvent.keyDown(encode, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Decode' })));
  });
});

describe('the Base64 tool’s limits (§12)', () => {
  it('follows every edit up to 256 Ki, and 300 ms after the last edit above it', () => {
    vi.useFakeTimers();
    render(<Base64Tool />);
    const live = 'a'.repeat(LIVE_INPUT);
    type(live);
    // 341 Ki characters of Base64: the field shows 256 Ki of them (docs/tools/limits.md), the result is all there.
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(field('Result').dataset.totalLength).toBe(String(Math.ceil(LIVE_INPUT / 3) * 4));
    const large = 'b'.repeat(LIVE_INPUT + 2);
    type(large);
    expect(output().startsWith('YWFh')).toBe(true); // still the previous result
    act(() => vi.advanceTimersByTime(SETTLE_MS - 10));
    expect(output().startsWith('YWFh')).toBe(true);
    act(() => vi.advanceTimersByTime(20));
    expect(output().startsWith('YmJi')).toBe(true);
    expect(field('Result').dataset.totalLength).toBe(String(((LIVE_INPUT + 2) / 3) * 4));
  });

  it('works on exactly 5 Mi characters and refuses one more at once', () => {
    vi.useFakeTimers();
    render(<Base64Tool />);
    mode('Decode');
    type('QUFB'.repeat(MAX_INPUT / 4));
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(errorLine()).toBe('');
    // 3.75 Mi characters of text: the field shows the first 256 Ki, Copy takes all (docs/tools/limits.md).
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(document.querySelector('[data-part=result-limit]')?.textContent).toBe(
      'Showing the first 262,144 of 3,932,160 characters. Copy copies all.',
    );
    type(`${'QUFB'.repeat(MAX_INPUT / 4)}Q`);
    expect(errorLine()).toBe('Input is larger than 5 MB. This tool works with up to 5 MB.');
    expect(output()).toBe('');
  });
});

describe('the Base64 tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('base64', definition.history!).list(kinds ? { kinds } : {})).entries;

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<Base64Tool host={host} />);
    type('Привет');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['encode'])).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('Encode · Standard · 6 characters');

    render(<Base64Tool host={host} />).unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy and Swap at once, with the input, the options and the result', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    const host = memoryHost();
    render(<Base64Tool host={host} />);
    mode('Decode');
    type('YWRtaW46c2VjcmV0');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['decode'])).toHaveLength(1));
    fireEvent.click(button('Swap'));
    await waitFor(async () => expect(await entriesOf(host, ['decode'])).toHaveLength(2));
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toContain('Decode · 16 characters · copied');
    expect(labels).toContain('Decode · 16 characters · swapped');
    const history = host.history.forOwner('base64', definition.history!);
    const opened = await history.open((await entriesOf(host))[0]!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toMatchObject({ mode: 'decode', outcome: 'text' });
    expect(await opened.blobs.input!.text()).toBe('YWRtaW46c2VjcmV0');
    expect(await opened.blobs.output!.text()).toBe('admin:secret');
  });

  it('opens an entry back into the tool: input, direction and options; opening records nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    const host = memoryHost();
    const first = render(<Base64Tool host={host} />);
    await choose('Alphabet', 'URL-safe');
    await choose('Line length', '76');
    type('subjects?_d');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['encode'])).toHaveLength(1));
    first.unmount();
    await act(async () => undefined);
    const entries = await entriesOf(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('Encode · URL-safe · lines of 76 · 11 characters · copied');

    const second = render(<Base64Tool host={host} restore={{ id: copied.id }} />);
    expect(
      await screen.findByText('Opened from History: Encode · URL-safe · lines of 76 · 11 characters · copied.'),
    ).toBeTruthy();
    expect(field('Input').value).toBe('subjects?_d');
    expect(screen.getByLabelText('Alphabet').textContent).toContain('URL-safe');
    expect(screen.getByLabelText('Padding').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Line length').textContent).toContain('76');
    expect(output()).toBe('c3ViamVjdHM_X2Q');
    second.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    render(<Base64Tool host={host} input="SGVsbG8sIFdvcmxkIQ==" />).unmount();
    await waitFor(async () => expect(await entriesOf(host, ['decode'])).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('Decode · 20 characters');
  });
});

describe('the Base64 tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('base64').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('base64').save(base64Settings.schema, values as never);
    await host.settings.forTool('base64').flush();
  };
  const direction = () =>
    screen.getByRole('radio', { name: 'Decode' }).getAttribute('data-state') === 'on' ? 'decode' : 'encode';
  const options = () => ({
    alphabet: screen.getByLabelText('Alphabet').textContent,
    padding: screen.getByLabelText('Padding').getAttribute('aria-checked'),
    lineLength: screen.getByLabelText('Line length').textContent,
  });

  it('saves the direction and options the person chose; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<Base64Tool host={host} />);
    await choose('Alphabet', 'URL-safe');
    await choose('Line length', '64');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { alphabet: 'url', padding: false, lineLength: 64 } });
    render(<Base64Tool host={host} />);
    expect(direction()).toBe('encode');
    expect(options()).toEqual({ alphabet: 'URL-safe', padding: 'false', lineLength: '64' });
    type('subjects?_d');
    expect(output()).toBe('c3ViamVjdHM_X2Q');
  });

  it('Swap is the person’s change of direction: saved', async () => {
    const host = memoryHost();
    render(<Base64Tool host={host} />);
    type('hi');
    fireEvent.click(button('Swap'));
    expect(direction()).toBe('decode');
    await host.settings.forTool('base64').flush();
    expect(savedOf(host)).toEqual({ schema: 1, values: { mode: 'decode' } });
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { alphabet: 'url', padding: 'no', lineLength: 80, mode: 'sideways' });
    render(<Base64Tool host={host} />);
    expect(direction()).toBe('encode');
    expect(options()).toEqual({ alphabet: 'URL-safe', padding: 'true', lineLength: 'No wrapping' });
  });

  it('a paste opens Decode and an opened entry shows its options — for the visit; what is saved stays', async () => {
    const host = memoryHost();
    await seed(host, { lineLength: 76 });
    const pasted = render(<Base64Tool host={host} input="SGVsbG8sIFdvcmxkIQ==" />);
    expect(direction()).toBe('decode');
    expect(output()).toBe('Hello, World!');
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { lineLength: 76 } });

    const recorder = host.history.forOwner('base64', base64History).session();
    await recorder.commit({
      kind: 'encode',
      label: 'Encode · URL-safe',
      payload: { mode: 'encode', alphabet: 'url', padding: false, lineLength: 0, outcome: 'text', action: 'copy' },
      blobs: { input: new Blob(['subjects?_d']), output: new Blob(['c3ViamVjdHM_X2Q']) },
    });
    const [entry] = await entriesOfHost(host);
    const opened = render(<Base64Tool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Encode · URL-safe.')).toBeTruthy();
    expect(options()).toEqual({ alphabet: 'URL-safe', padding: 'false', lineLength: 'No wrapping' });
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { lineLength: 76 } });
    render(<Base64Tool host={host} />);
    expect(direction()).toBe('encode');
    expect(options()).toEqual({ alphabet: 'Standard', padding: 'true', lineLength: '76' });
  });

  it('reset puts the direction and options back to the defaults and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'decode' });
    render(<Base64Tool host={host} />);
    type('aGk=');
    expect(output()).toBe('hi');
    await act(async () => host.settings.forTool('base64').reset());
    expect(direction()).toBe('encode');
    expect(field('Input').value).toBe('aGk=');
    expect(output()).toBe('YUdrPQ==');
    expect(savedOf(host)).toBeUndefined();
  });
});

const entriesOfHost = async (host: ReturnType<typeof memoryHost>) =>
  (await host.history.forOwner('base64', base64History).list({})).entries;
