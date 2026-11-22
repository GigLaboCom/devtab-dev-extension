import { definition } from './definition';
import { detect } from './detect';
import HtmlEntitiesTool from './HtmlEntitiesTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT, SETTLE_MS, loadReferenceTable } from '@workspace/tool-logic-html-entities';
import { memoryHost } from '@workspace/tools-host';
import { MAX_SHOWN_CHARS } from '@workspace/ui/result-field';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// docs/tools/specs/html-entities.md §2 (scenarios), §6 (notes, word for word), §8 (the page), §12 (limits) and the
// tool's history (D17, docs/tools/history.md §10 row 17).

beforeAll(async () => {
  await loadReferenceTable(); // the table's module, once: later loads resolve at once
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field('Input'), { target: { value } });
const output = () => field('Result').value;
const limitLine = () => document.querySelector('[data-part=result-limit]')?.textContent ?? '';
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mode = (name: 'Encode' | 'Decode') => fireEvent.click(screen.getByRole('radio', { name }));
const errorLine = () => document.querySelector('[data-part="error"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
/** The table of names loads on first need; let its promise settle. */
const settle = () => act(async () => undefined);
/** Opens a Radix Select by its trigger's id and picks an option, with the keyboard. */
const choose = async (id: string, option: string) => {
  const trigger = document.getElementById(id)!;
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const stubClipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(void text));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the HTML Entities tool’s definition', () => {
  it('describes the tool, recognises its input from a module of its own and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'html-entities',
      title: 'HTML Entities',
      summary: 'Escape text for HTML and decode character references back to text.',
      order: 17,
      output: { origin: 'input' },
    });
    expect(definition).not.toHaveProperty('shortcut');
    expect(definition.keywords).toEqual([
      'html',
      'entities',
      'entity',
      'escape',
      'unescape',
      'encode',
      'decode',
      'character reference',
      '&amp;',
    ]);
    expect(detect('Tom &amp; Jerry')).toBe(true);
    expect(detect('AT&T')).toBe(false);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['encode', 'decode']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(HtmlEntitiesTool);
  });
});

describe('the HTML Entities tool, rendered with no host', () => {
  it('starts empty: Encode, Only & < > " \', Numbers as off, Copy and Swap off, no notes (§8)', () => {
    render(<HtmlEntitiesTool />);
    expect(screen.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')).toBe('true');
    expect(field('Input').value).toBe('');
    expect(field('Input').placeholder).toBe('Text to escape');
    expect(field('Input').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').getAttribute('spellcheck')).toBe('false');
    expect(field('Result').readOnly).toBe(true);
    expect(document.getElementById('html-entities-scope')!.textContent).toContain(`Only & < > " '`);
    expect((document.getElementById('html-entities-format') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('html-entities-format')!.textContent).toContain('Decimal');
    expect(screen.getByText('Numbers as')).toBeTruthy();
    expect(output()).toBe('');
    expect(errorLine()).toBe('');
    expect(notes()).toEqual([]);
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
  });

  it('§2.1: Decode what an API sent', async () => {
    render(<HtmlEntitiesTool />);
    mode('Decode');
    expect(field('Input').placeholder).toBe('Text with &amp; and other references');
    expect(document.getElementById('html-entities-scope')).toBeNull();
    expect(document.getElementById('html-entities-format')).toBeNull();
    type('&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;');
    await settle();
    expect(output()).toBe('<p>Tom & Jerry</p>');
    expect(notes()).toEqual([]);
  });

  it('§2.2: Encode a code sample for an article, and Copy it', async () => {
    const writeText = stubClipboard();
    render(<HtmlEntitiesTool />);
    type(`<a href="x">Tom & 'Jerry'</a>`);
    expect(output()).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText).toHaveBeenCalledWith('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
    expect(button('Copied')).toBeTruthy();
    type('changed');
    expect(button('Copy')).toBeTruthy();
  });

  it('§2.3: ASCII only — Also non-ASCII, Hex', async () => {
    render(<HtmlEntitiesTool />);
    type('café 😀');
    expect(output()).toBe('café 😀');
    await choose('html-entities-scope', 'Also non-ASCII');
    expect((document.getElementById('html-entities-format') as HTMLButtonElement).disabled).toBe(false);
    expect(output()).toBe('caf&#233; &#128512;');
    await choose('html-entities-format', 'Hex');
    expect(output()).toBe('caf&#xE9; &#x1F600;');
  });

  it('§2.4: Decode a name without its semicolon, as the browser does', async () => {
    render(<HtmlEntitiesTool />);
    mode('Decode');
    type('&copy 2024 ACME');
    await settle();
    expect(output()).toBe('© 2024 ACME');
  });

  it('§2.5: Encode text that already has &amp; — encoded again, with the note', async () => {
    render(<HtmlEntitiesTool />);
    type('&amp;');
    await settle();
    expect(output()).toBe('&amp;amp;');
    expect(notes()).toEqual([
      'The input already contains HTML references. They are encoded again: &amp; becomes &amp;amp;.',
    ]);
    type('AT&T');
    await settle();
    expect(output()).toBe('AT&amp;T');
    expect(notes()).toEqual([]);
    type('price 5&#8364');
    expect(notes()).toHaveLength(1); // a number needs no table
  });

  it('§2.6: a typo in a name is left as it is and named', async () => {
    render(<HtmlEntitiesTool />);
    mode('Decode');
    type('a&nbps;b');
    await settle();
    expect(output()).toBe('a&nbps;b');
    expect(notes()).toEqual(['Not recognised, left as is: &nbps;']);
  });

  it('§6: the unknown names — two in order, more than five counted', async () => {
    render(<HtmlEntitiesTool />);
    mode('Decode');
    type('&unknown; &foo;');
    await settle();
    expect(output()).toBe('&unknown; &foo;');
    expect(notes()).toEqual(['Not recognised, left as is: &unknown;, &foo;']);
    type('&a1;&a2;&a3;&a4;&a5;&a6;&a7;&a8;&a1;');
    expect(notes()).toEqual(['Not recognised, left as is: &a1;, &a2;, &a3;, &a4;, &a5; and 3 more.']);
  });

  it('§6: C1 controls are left as they are and counted, one and two', async () => {
    render(<HtmlEntitiesTool />);
    await choose('html-entities-scope', 'Also non-ASCII');
    type('\u0080 and \u009F');
    expect(output()).toBe('\u0080 and \u009F');
    expect(notes()).toEqual(['2 C1 control characters (U+0080–U+009F) left as is: HTML has no reference for them.']);
    type('\u0085…');
    expect(output()).toBe('\u0085&#8230;');
    expect(notes()).toEqual(['1 C1 control character (U+0080–U+009F) left as is: HTML has no reference for them.']);
  });

  it('§6: both notes at once under Encode', async () => {
    render(<HtmlEntitiesTool />);
    await choose('html-entities-scope', 'Also non-ASCII');
    type('&eacute;\u0080');
    await settle();
    expect(notes()).toEqual([
      'The input already contains HTML references. They are encoded again: &amp; becomes &amp;amp;.',
      '1 C1 control character (U+0080–U+009F) left as is: HTML has no reference for them.',
    ]);
  });

  it('§6: a lone surrogate, the forbidden numbers, only spaces, the empty input', async () => {
    render(<HtmlEntitiesTool />);
    await choose('html-entities-scope', 'Also non-ASCII');
    type('\uD800');
    expect(output()).toBe('&#65533;');
    type('   ');
    expect(output()).toBe('   ');
    mode('Decode');
    expect(output()).toBe('   ');
    type('&#0;&#x110000;&#xD800;');
    expect(output()).toBe('���');
    expect(notes()).toEqual([]);
    type('');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
  });

  it('§6: markup in Decode input stays text: nothing is made of it', async () => {
    render(<HtmlEntitiesTool />);
    mode('Decode');
    const before = document.querySelectorAll('img, script, iframe').length;
    type('</textarea><img src=x onerror=alert(1)>&amp;');
    await settle();
    expect(output()).toBe('</textarea><img src=x onerror=alert(1)>&');
    expect(document.querySelectorAll('img, script, iframe').length).toBe(before);
  });

  it('§4: Swap moves the result into the input and turns the direction, options untouched', async () => {
    render(<HtmlEntitiesTool />);
    await choose('html-entities-scope', 'Also non-ASCII');
    await choose('html-entities-format', 'Hex');
    type('<b>café</b>');
    const encoded = output();
    expect(encoded).toBe('&lt;b&gt;caf&#xE9;&lt;/b&gt;');
    fireEvent.click(button('Swap'));
    await settle();
    expect(field('Input').value).toBe(encoded);
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('<b>café</b>');
    fireEvent.click(button('Swap'));
    expect(field('Input').value).toBe('<b>café</b>');
    expect(document.getElementById('html-entities-scope')!.textContent).toContain('Also non-ASCII');
    expect(document.getElementById('html-entities-format')!.textContent).toContain('Hex');
    expect(output()).toBe(encoded);
  });

  it('§3: the field gives line breaks as LF; a reference to CR decodes to CR (what Copy takes, not the field’s view)', async () => {
    const writeText = stubClipboard();
    render(<HtmlEntitiesTool />);
    type('a\r\nb\rc&#13;');
    fireEvent.click(button('Copy'));
    await settle();
    mode('Decode');
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText.mock.calls.map(c => c[0])).toEqual(['a\nb\nc&amp;#13;', 'a\nb\nc\r']);
  });

  it('starts in Decode with the text the start page hands over (recognised by detect)', async () => {
    render(<HtmlEntitiesTool input={'Tom &amp; Jerry &lt;3'} />);
    await settle();
    expect(screen.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('Tom & Jerry <3');
  });

  it('§8: the arrow keys move between Encode and Decode', async () => {
    render(<HtmlEntitiesTool />);
    const encode = screen.getByRole('radio', { name: 'Encode' });
    act(() => encode.focus());
    fireEvent.keyDown(encode, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Decode' })));
  });
});

describe('the HTML Entities tool’s limits (§12)', () => {
  it('follows every edit up to 1 Mi, and 300 ms after the last edit above it', async () => {
    vi.useFakeTimers();
    render(<HtmlEntitiesTool />);
    type('<'.repeat(LIVE_INPUT));
    // 4 Mi characters of result: the field shows the first 256 Ki, Copy takes all (docs/tools/limits.md).
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(limitLine()).toBe('Showing the first 262,144 of 4,194,304 characters. Copy copies all.');
    type('>'.repeat(LIVE_INPUT + 1));
    expect(output().startsWith('&lt;')).toBe(true); // still the previous result
    act(() => vi.advanceTimersByTime(SETTLE_MS - 10));
    expect(output().startsWith('&lt;')).toBe(true);
    act(() => vi.advanceTimersByTime(20));
    expect(output().startsWith('&gt;')).toBe(true);
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(limitLine()).toBe('Showing the first 262,144 of 4,194,308 characters. Copy copies all.');
  });

  it('works on exactly 5 Mi characters and refuses one more at once', async () => {
    vi.useFakeTimers();
    render(<HtmlEntitiesTool />);
    mode('Decode');
    type('&lt;'.repeat(MAX_INPUT / 4));
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    await settle();
    expect(errorLine()).toBe('');
    expect(output()).toHaveLength(MAX_SHOWN_CHARS);
    expect(limitLine()).toBe('Showing the first 262,144 of 1,310,720 characters. Copy copies all.');
    type(`${'&lt;'.repeat(MAX_INPUT / 4)}x`);
    expect(errorLine()).toBe('Input is larger than 5 MB. This tool works with up to 5 MB.');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
  });
});

describe('the HTML Entities tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('html-entities', definition.history!).list(kinds ? { kinds } : {})).entries;

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<HtmlEntitiesTool host={host} />);
    type('<b>');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['encode'])).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('Encode · 3 characters');

    render(<HtmlEntitiesTool host={host} />).unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy and Swap at once, with the input, the options and the result', async () => {
    stubClipboard();
    const host = memoryHost();
    render(<HtmlEntitiesTool host={host} />);
    mode('Decode');
    type('&lt;p&gt;');
    await settle();
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['decode'])).toHaveLength(1));
    fireEvent.click(button('Swap'));
    await waitFor(async () => expect(await entriesOf(host, ['decode'])).toHaveLength(2));
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toContain('Decode · 9 characters · copied');
    expect(labels).toContain('Decode · 9 characters · swapped');
    const history = host.history.forOwner('html-entities', definition.history!);
    const opened = await history.open((await entriesOf(host))[0]!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toMatchObject({ mode: 'decode', scope: 'special', format: 'decimal' });
    expect(await opened.blobs.input!.text()).toBe('&lt;p&gt;');
    expect(await opened.blobs.output!.text()).toBe('<p>');
  });

  it('opens an entry back into the tool: input, direction and options; opening records nothing', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<HtmlEntitiesTool host={host} />);
    await choose('html-entities-scope', 'Also non-ASCII');
    await choose('html-entities-format', 'Hex');
    type('café 😀');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['encode'])).toHaveLength(1));
    first.unmount();
    await settle();
    const entries = await entriesOf(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('Encode · Also non-ASCII · Hex · 7 characters · copied');

    const second = render(<HtmlEntitiesTool host={host} restore={{ id: copied.id }} />);
    expect(
      await screen.findByText('Opened from History: Encode · Also non-ASCII · Hex · 7 characters · copied.'),
    ).toBeTruthy();
    expect(field('Input').value).toBe('café 😀');
    expect(document.getElementById('html-entities-scope')!.textContent).toContain('Also non-ASCII');
    expect(document.getElementById('html-entities-format')!.textContent).toContain('Hex');
    expect(output()).toBe('caf&#xE9; &#x1F600;');
    second.unmount();
    await settle();
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    const { unmount } = render(<HtmlEntitiesTool host={host} input={'Tom &amp; Jerry'} />);
    await settle();
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['decode'])).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('Decode · 15 characters');
  });
});
