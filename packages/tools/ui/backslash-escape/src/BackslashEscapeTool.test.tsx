// The String Escape tool's component (docs/tools/specs/backslash-escape.md §2, §4, §6, §8, §12; D17; D21): rendered with
// no host, then with an in-memory host for the history and the saved parameters. Control characters and lone surrogates are written as escapes.
import BackslashEscapeTool from './BackslashEscapeTool';
import { definition } from './definition';
import { detect } from './detect';
import { backslashEscapeSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT, SETTLE_MS } from '@workspace/tool-logic-backslash-escape';
import { memoryHost } from '@workspace/tools-host';
import { MAX_SHOWN_CHARS, MAX_SHOWN_LINES } from '@workspace/ui/result-field';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field('Input'), { target: { value } });
const output = () => field('Result').value;
const limitLine = () => document.querySelector('[data-part=result-limit]')?.textContent ?? '';
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mode = (name: 'Escape' | 'Unescape') => fireEvent.click(screen.getByRole('radio', { name }));
const checkbox = (name: string) => fireEvent.click(screen.getByLabelText(name));
const errorLine = () => document.querySelector('[data-part="error"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
/** Opens a Radix Select by its label and picks an option by its accessible name, with the keyboard. */
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const stubClipboard = () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the String Escape tool’s definition', () => {
  it('describes the tool, recognises escaped text from its own module and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'backslash-escape',
      title: 'String Escape',
      summary: 'Escape text for a string literal and unescape it back: JSON, JavaScript, Python, C.',
      order: 18,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toEqual([
      'escape',
      'unescape',
      'backslash',
      'string literal',
      'json string',
      'quotes',
      '\\n',
      '\\u',
    ]);
    expect(detect('He said \\"hi\\"\\n')).toBe(true);
    expect(detect('C:\\new\\table')).toBe(false);
    expect(definition.history?.kinds.map(k => [k.id, k.title])).toEqual([
      ['escape', 'Escaped'],
      ['unescape', 'Unescaped'],
    ]);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(BackslashEscapeTool);
  });
});

describe('the String Escape tool, rendered with no host', () => {
  it('starts empty (§8): Escape, JSON, no Quote, both checkboxes off, Copy and Swap off, no messages', () => {
    render(<BackslashEscapeTool />);
    expect(screen.getByRole('radio', { name: 'Escape' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Dialect').textContent).toBe('JSON');
    expect(screen.queryByLabelText('Quote')).toBeNull();
    expect(screen.getByLabelText('Escape non-ASCII').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('With quotes').getAttribute('aria-checked')).toBe('false');
    expect(field('Input').value).toBe('');
    expect(field('Input').placeholder).toBe('Text to escape');
    expect(field('Input').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').readOnly).toBe(true);
    expect(output()).toBe('');
    expect(errorLine()).toBe('');
    expect(notes()).toEqual([]);
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
  });

  it('§2.1: a JSON log line unescapes into two lines; Swap and Unescape again reads the \\u00e9', () => {
    render(<BackslashEscapeTool />);
    mode('Unescape');
    expect(field('Input').placeholder).toBe('Text with \\n, \\" and other escapes');
    type('Request failed:\\n\\t{\\"code\\": 42, \\"msg\\": \\"caf\\\\u00e9\\"}');
    expect(output()).toBe('Request failed:\n\t{"code": 42, "msg": "caf\\u00e9"}');
    fireEvent.click(button('Swap'));
    expect(screen.getByRole('radio', { name: 'Escape' }).getAttribute('aria-checked')).toBe('true');
    mode('Unescape');
    expect(output().split('\n')[1]).toBe('\t{"code": 42, "msg": "café"}');
  });

  it("§2.2: SQL into a JavaScript string in ' quotes, with quotes", async () => {
    render(<BackslashEscapeTool />);
    await choose('Dialect', 'JavaScript');
    await choose('Quote', 'Single quote');
    checkbox('With quotes');
    type("SELECT *\nFROM t\nWHERE name = 'x'");
    expect(output()).toBe("'SELECT *\\nFROM t\\nWHERE name = \\'x\\''");
    expect(screen.getByLabelText('Quote').textContent).toBe("'Single quote");
  });

  it('§2.3: a Windows path for Python', async () => {
    render(<BackslashEscapeTool />);
    await choose('Dialect', 'Python');
    type('C:\\temp\\new');
    expect(output()).toBe('C:\\\\temp\\\\new');
  });

  it('§2.4: \\x41 in JSON is an error with its place and the dialects that know it; JavaScript reads A', async () => {
    render(<BackslashEscapeTool />);
    mode('Unescape');
    type('\\x41');
    expect(errorLine()).toBe(
      'Line 1, column 1: unknown escape "\\x" in JSON. It is an escape in JavaScript, Python, C / C++.',
    );
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
    await choose('Dialect', 'JavaScript');
    expect(errorLine()).toBe('');
    expect(output()).toBe('A');
  });

  it('§2.5: a C string with its quotes, bytes of UTF-8', async () => {
    render(<BackslashEscapeTool />);
    mode('Unescape');
    await choose('Dialect', 'C / C++');
    checkbox('With quotes');
    type('"caf\\303\\251"');
    expect(output()).toBe('café');
  });

  it('§2.6: ASCII-only JSON with Escape non-ASCII', () => {
    render(<BackslashEscapeTool />);
    type('café \u{1F600}');
    expect(output()).toBe('café \u{1F600}');
    checkbox('Escape non-ASCII');
    expect(output()).toBe('caf\\u00e9 \\ud83d\\ude00');
  });

  it('§4, §8: Quote is offered for JavaScript (three) and Python (two), in Escape only; a new dialect resets it to "', async () => {
    render(<BackslashEscapeTool />);
    await choose('Dialect', 'JavaScript');
    fireEvent.keyDown(screen.getByLabelText('Quote'), { key: 'Enter' });
    const names = (await screen.findAllByRole('option')).map(o => o.querySelector('.sr-only')?.textContent);
    expect(names).toEqual(['Double quote', 'Single quote', 'Backtick']);
    fireEvent.keyDown(screen.getByRole('option', { name: 'Backtick' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    type('a`${b}`');
    expect(output()).toBe('a\\`\\${b}\\`');
    await choose('Dialect', 'Python');
    expect(screen.getByLabelText('Quote').textContent).toBe('"Double quote');
    fireEvent.keyDown(screen.getByLabelText('Quote'), { key: 'Enter' });
    expect((await screen.findAllByRole('option')).map(o => o.querySelector('.sr-only')?.textContent)).toEqual([
      'Double quote',
      'Single quote',
    ]);
    fireEvent.keyDown(screen.getByRole('option', { name: 'Double quote' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await choose('Dialect', 'C / C++');
    expect(screen.queryByLabelText('Quote')).toBeNull();
    await choose('Dialect', 'JavaScript');
    mode('Unescape');
    expect(screen.queryByLabelText('Quote')).toBeNull();
    expect(screen.queryByLabelText('Escape non-ASCII')).toBeNull();
    expect(screen.getByLabelText('With quotes')).toBeTruthy();
  });

  it('§8: the notes under the result — Python’s kept escapes (five, then "and N more"), surrogates, bytes', async () => {
    render(<BackslashEscapeTool />);
    mode('Unescape');
    await choose('Dialect', 'Python');
    type('\\q\\d');
    expect(output()).toBe('\\q\\d');
    expect(notes()).toEqual(['Kept with the backslash, as Python does: \\q, \\d']);
    type('\\q\\d\\w\\s\\e\\g\\h\\q');
    expect(notes()).toEqual(['Kept with the backslash, as Python does: \\q, \\d, \\w, \\s, \\e and 2 more']);
    type('\\ud800');
    expect(output()).toBe('\uD800');
    expect(notes()).toEqual(['Contains an unpaired surrogate (U+D800). Most programs turn it into U+FFFD.']);
    // Python does not pair surrogate escapes: two code points.
    type('\\ud83d\\ude00');
    expect(notes()).toEqual(['Contains 2 unpaired surrogates, the first U+D83D. Most programs turn them into U+FFFD.']);
    await choose('Dialect', 'JSON');
    expect(output()).toBe('\u{1F600}');
    expect(notes()).toEqual([]);
    await choose('Dialect', 'C / C++');
    type('\\xe9');
    expect(output()).toBe('\uFFFD');
    expect(notes()).toEqual(['Bytes from \\x and octal escapes are not valid UTF-8: shown as U+FFFD.']);
  });

  it('§6: the errors, as people read them, under the input', async () => {
    render(<BackslashEscapeTool />);
    mode('Unescape');
    const cases: Array<[string, string]> = [
      ['abc\\', 'Line 1, column 4: lone backslash at the end'],
      ['\\u12', 'Line 1, column 1: \\u needs exactly 4 hex digits'],
      ['\\q', 'Line 1, column 1: unknown escape "\\q" in JSON.'],
      ['ok\n  \\q', 'Line 2, column 3: unknown escape "\\q" in JSON.'],
      ['a\\\nb', 'Line 1, column 2: a backslash before a line break is not allowed in JSON'],
    ];
    for (const [input, message] of cases) {
      type(input);
      expect(errorLine()).toBe(message);
      expect(output()).toBe('');
    }
    await choose('Dialect', 'C / C++');
    type('\\q');
    expect(errorLine()).toBe('Line 1, column 1: unknown escape "\\q" in C / C++.');
    await choose('Dialect', 'JavaScript');
    expect(output()).toBe('q');
    expect(errorLine()).toBe('');
  });

  it('§6: spaces only stay spaces both ways; with quotes they are an error; an empty input says nothing', () => {
    render(<BackslashEscapeTool />);
    type('   ');
    expect(output()).toBe('   ');
    mode('Unescape');
    expect(output()).toBe('   ');
    checkbox('With quotes');
    expect(errorLine()).toBe('Line 1, column 4: Expected text in " quotes');
    type('');
    expect(errorLine()).toBe('');
    expect(output()).toBe('');
    type("'a'");
    expect(errorLine()).toBe('Line 1, column 1: Expected text in " quotes');
  });

  it('§4: Swap moves the result into the input and turns the direction around, the choices untouched', async () => {
    render(<BackslashEscapeTool />);
    await choose('Dialect', 'Python');
    await choose('Quote', 'Single quote');
    checkbox('With quotes');
    type("it's \u0007");
    const escaped = output();
    expect(escaped).toBe("'it\\'s \\x07'");
    fireEvent.click(button('Swap'));
    expect(field('Input').value).toBe(escaped);
    expect(screen.getByRole('radio', { name: 'Unescape' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Dialect').textContent).toBe('Python');
    expect(screen.getByLabelText('With quotes').getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe("it's \u0007");
    fireEvent.click(button('Swap'));
    expect(screen.getByLabelText('Quote').textContent).toBe("'Single quote");
    expect(output()).toBe(escaped);
  });

  it('Copy copies the whole result, says Copied until it changes', async () => {
    const writeText = stubClipboard();
    render(<BackslashEscapeTool />);
    type('He said "hi"\n');
    expect(output()).toBe('He said \\"hi\\"\\n');
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('He said \\"hi\\"\\n');
    expect(button('Copied')).toBeTruthy();
    type('He said "hi"!');
    expect(button('Copy')).toBeTruthy();
  });

  it('starts in Unescape with the text the start page hands over (recognised by detect)', () => {
    render(<BackslashEscapeTool input={'He said \\"hi\\"\\n'} />);
    expect(screen.getByRole('radio', { name: 'Unescape' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('He said "hi"\n');
  });

  it('§8: the arrow keys move between Escape and Unescape', async () => {
    render(<BackslashEscapeTool />);
    const escape = screen.getByRole('radio', { name: 'Escape' });
    act(() => escape.focus());
    fireEvent.keyDown(escape, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Unescape' })));
  });
});

describe('the String Escape tool’s limits (§12)', () => {
  it('follows every edit up to 1 Mi; above it the result comes 300 ms after the last edit, Copy and Swap wait', async () => {
    vi.useFakeTimers();
    render(<BackslashEscapeTool />);
    type('\n'.repeat(LIVE_INPUT));
    // 2 Mi characters of result: the field shows the first 256 Ki, Copy takes all (docs/tools/limits.md).
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(limitLine()).toBe('Showing the first 262,144 of 2,097,152 characters. Copy copies all.');
    type('\t'.repeat(LIVE_INPUT + 1));
    expect(output().startsWith('\\n')).toBe(true); // still the previous result
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS - 10);
    });
    expect(output().startsWith('\\n')).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(output().startsWith('\\t')).toBe(true);
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(limitLine()).toBe('Showing the first 262,144 of 2,097,154 characters. Copy copies all.');
    expect(button('Copy').disabled).toBe(false);
    expect(button('Swap').disabled).toBe(false);
  });

  it('works on exactly 5 Mi characters and refuses one more at once', async () => {
    vi.useFakeTimers();
    render(<BackslashEscapeTool />);
    mode('Unescape');
    type('\\n'.repeat(MAX_INPUT / 2));
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(errorLine()).toBe('');
    // 2.5 Mi line breaks: the field shows the first 10,000 lines.
    expect(output()).toBe('\n'.repeat(MAX_SHOWN_LINES - 1));
    expect(limitLine()).toBe('Showing the first 10,000 of 2,621,441 lines. Copy copies all.');
    type(`${'\\n'.repeat(MAX_INPUT / 2)}x`);
    expect(errorLine()).toBe('Input is larger than 5 MB. This tool works with up to 5 MB.');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
  });

  it('an error in a large input is shown once its result is there', async () => {
    vi.useFakeTimers();
    render(<BackslashEscapeTool />);
    mode('Unescape');
    type(`${'a'.repeat(LIVE_INPUT)}\\q`);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(errorLine()).toBe(`Line 1, column ${LIVE_INPUT + 1}: unknown escape "\\q" in JSON.`);
  });
});

describe('the String Escape tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('backslash-escape', definition.history!).list(kinds ? { kinds } : {})).entries;

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<BackslashEscapeTool host={host} />);
    type('He said "hi"');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['escape'])).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('Escape · JSON · 12 characters');

    render(<BackslashEscapeTool host={host} />).unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy and Swap at once, with the input, the choices and the result', async () => {
    stubClipboard();
    const host = memoryHost();
    render(<BackslashEscapeTool host={host} />);
    mode('Unescape');
    await choose('Dialect', 'JavaScript');
    type('\\x41\\u{1F600}');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['unescape'])).toHaveLength(1));
    fireEvent.click(button('Swap'));
    await waitFor(async () => expect(await entriesOf(host, ['unescape'])).toHaveLength(2));
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toContain('Unescape · JavaScript · 13 characters · copied');
    expect(labels).toContain('Unescape · JavaScript · 13 characters · swapped');
    const history = host.history.forOwner('backslash-escape', definition.history!);
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    const opened = await history.open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toMatchObject({ mode: 'unescape', dialect: 'js', outcome: 'text', action: 'copy' });
    expect(await opened.blobs.input!.text()).toBe('\\x41\\u{1F600}');
    expect(await opened.blobs.output!.text()).toBe('A\u{1F600}');
  });

  it('records an error with its place; the label says it', async () => {
    const host = memoryHost();
    const { unmount } = render(<BackslashEscapeTool host={host} />);
    mode('Unescape');
    type('ab\\');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['unescape'])).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('Unescape · JSON · error at line 1, column 3 · 3 characters');
  });

  it('opens an entry back into the tool: input, direction, dialect, quote and options; opening records nothing', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<BackslashEscapeTool host={host} />);
    await choose('Dialect', 'JavaScript');
    await choose('Quote', 'Backtick');
    checkbox('Escape non-ASCII');
    checkbox('With quotes');
    type('${é}');
    expect(output()).toBe('`\\${\\u00e9}`');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['escape'])).toHaveLength(1));
    first.unmount();
    await act(async () => undefined);
    const entries = await entriesOf(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('Escape · JavaScript · backticks · non-ASCII · with quotes · 4 characters · copied');

    const second = render(<BackslashEscapeTool host={host} restore={{ id: copied.id }} />);
    expect(await screen.findByText(`Opened from History: ${copied.label}.`)).toBeTruthy();
    expect(field('Input').value).toBe('${é}');
    expect(screen.getByRole('radio', { name: 'Escape' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Dialect').textContent).toBe('JavaScript');
    expect(screen.getByLabelText('Quote').textContent).toBe('`Backtick');
    expect(screen.getByLabelText('Escape non-ASCII').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('With quotes').getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('`\\${\\u00e9}`');
    second.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    render(<BackslashEscapeTool host={host} input={'line1\\nline2\\ttab'} />).unmount();
    await waitFor(async () => expect(await entriesOf(host, ['unescape'])).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('Unescape · JSON · 17 characters');
  });
});

describe('the String Escape tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('backslash-escape', definition.history!).list({})).entries;
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('backslash-escape').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('backslash-escape').save(backslashEscapeSettings.schema, values as never);
    await host.settings.forTool('backslash-escape').flush();
  };
  const current = () =>
    screen.getByRole('radio', { name: 'Unescape' }).getAttribute('aria-checked') === 'true' ? 'unescape' : 'escape';
  const dialect = () => screen.getByLabelText('Dialect').textContent;
  const quote = () => screen.queryByLabelText('Quote')?.textContent ?? null;
  const ticked = (name: string) => screen.queryByLabelText(name)?.getAttribute('aria-checked') ?? null;

  it('saves the direction, dialect, quote and options the person chose; reopened, it is as left; Swap is saved too', async () => {
    const host = memoryHost();
    const first = render(<BackslashEscapeTool host={host} />);
    await choose('Dialect', 'JavaScript');
    await choose('Quote', 'Single quote');
    checkbox('Escape non-ASCII');
    checkbox('With quotes');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { dialect: 'js', quote: "'", nonAscii: true, withQuotes: true },
    });
    const second = render(<BackslashEscapeTool host={host} />);
    expect(current()).toBe('escape');
    expect(dialect()).toBe('JavaScript');
    expect(quote()).toBe("'Single quote");
    expect(ticked('Escape non-ASCII')).toBe('true');
    expect(ticked('With quotes')).toBe('true');
    type("it's é");
    expect(output()).toBe("'it\\'s \\u00e9'");
    fireEvent.click(button('Swap'));
    expect(current()).toBe('unescape');
    expect(output()).toBe("it's é");
    second.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { mode: 'unescape', dialect: 'js', quote: "'", nonAscii: true, withQuotes: true },
    });
  });

  it('a new dialect starts from the double quote, and both are saved', async () => {
    const host = memoryHost();
    await seed(host, { dialect: 'js', quote: '`' });
    const { unmount } = render(<BackslashEscapeTool host={host} />);
    expect(quote()).toBe('`Backtick');
    await choose('Dialect', 'Python');
    expect(quote()).toBe('"Double quote');
    unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { dialect: 'python' } });
  });

  it('a saved record it cannot show falls back field by field; a quote its dialect lacks is the double quote', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'sideways', dialect: 'python', quote: '`', nonAscii: 'yes', withQuotes: true });
    render(<BackslashEscapeTool host={host} />);
    expect(current()).toBe('escape');
    expect(dialect()).toBe('Python');
    expect(quote()).toBe('"Double quote');
    expect(ticked('Escape non-ASCII')).toBe('false');
    expect(ticked('With quotes')).toBe('true');
    type('a"b');
    expect(output()).toBe('"a\\"b"');
  });

  it('a paste opens Unescape without With quotes in the saved dialect, an entry shows its own — for the visit; what is saved stays', async () => {
    const host = memoryHost();
    await seed(host, { dialect: 'js', quote: "'", withQuotes: true });
    const pasted = render(<BackslashEscapeTool host={host} input={'\\x41\\u{1F600}\\n'} />);
    expect(current()).toBe('unescape');
    expect(dialect()).toBe('JavaScript');
    expect(ticked('With quotes')).toBe('false');
    expect(output()).toBe('A\u{1F600}\n');
    pasted.unmount();
    await act(async () => undefined);
    expect(savedOf(host)).toEqual({ schema: 1, values: { dialect: 'js', quote: "'", withQuotes: true } });

    const recorder = host.history.forOwner('backslash-escape', definition.history!).session();
    await recorder.commit({
      kind: 'escape',
      label: 'Escape · C / C++ · 3 characters',
      payload: { mode: 'escape', dialect: 'c', quote: '"', nonAscii: false, withQuotes: false, outcome: 'text' },
      blobs: { input: new Blob(['a"b']), output: new Blob(['a\\"b']) },
    });
    const entry = (await entriesOf(host)).find(e => e.label === 'Escape · C / C++ · 3 characters')!;
    const opened = render(<BackslashEscapeTool host={host} restore={{ id: entry.id }} />);
    expect(await screen.findByText('Opened from History: Escape · C / C++ · 3 characters.')).toBeTruthy();
    expect(dialect()).toBe('C / C++');
    expect(quote()).toBeNull();
    expect(ticked('With quotes')).toBe('false');
    expect(output()).toBe('a\\"b');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { dialect: 'js', quote: "'", withQuotes: true } });
    render(<BackslashEscapeTool host={host} />);
    expect(current()).toBe('escape');
    expect(dialect()).toBe('JavaScript');
    expect(quote()).toBe("'Single quote");
    expect(ticked('With quotes')).toBe('true');
  });

  it('reset puts every choice back to the defaults and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { dialect: 'python', quote: "'", withQuotes: true, nonAscii: true });
    render(<BackslashEscapeTool host={host} />);
    type("é'");
    expect(output()).toBe("'\\xe9\\''");
    await act(async () => host.settings.forTool('backslash-escape').reset());
    expect(current()).toBe('escape');
    expect(dialect()).toBe('JSON');
    expect(quote()).toBeNull();
    expect(ticked('Escape non-ASCII')).toBe('false');
    expect(ticked('With quotes')).toBe('false');
    expect(field('Input').value).toBe("é'");
    expect(output()).toBe("é'");
    expect(savedOf(host)).toBeUndefined();
  });
});
