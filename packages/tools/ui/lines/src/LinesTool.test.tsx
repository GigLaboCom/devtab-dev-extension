import { definition } from './definition';
import LinesTool from './LinesTool';
import { DEFAULT_STEPS, readSteps, toPipeline } from './steps';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_PIPELINE, SETTLE_MS } from '@workspace/tool-logic-lines';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field('Input'), { target: { value } });
const output = () => field('Result').value;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const step = (name: string) => screen.getByRole('checkbox', { name });
const enable = (name: string) => fireEvent.click(step(name));
const checked = (name: string) => step(name).getAttribute('aria-checked') === 'true';
const group = (name: string) => screen.getByRole('group', { name });
const summary = () => document.querySelector('[data-part="summary"]')!.textContent!.trim();
const errorLine = () => document.querySelector('[data-part="error"]')!.textContent!.trim();
const counter = (name: string) =>
  within(group(name)).getByText((_, el) => el?.getAttribute('data-part') === 'delta').textContent;
const text = (label: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
/** Opens a Radix Select by its label and picks an option, with the keyboard. */
const choose = async (label: string, option: string) => {
  const trigger = screen.getByRole('combobox', { name: label });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const clipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(void text));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the Lines tool’s definition', () => {
  it('describes the tool, has no detect and no shortcut, and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'lines',
      title: 'Lines',
      summary: 'Sort, deduplicate, trim, filter, number and join lines of text.',
      order: 16,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect('detect' in definition).toBe(false);
    expect(definition.keywords).toContain('natural sort');
    expect(definition.keywords).toHaveLength(18);
    expect(definition.history?.kinds).toEqual([{ id: 'process', title: 'Processed' }]);
    expect((await definition.load()).default).toBe(LinesTool);
  });

  it('the page’s defaults are the logic’s (§4), and a stored value is read field by field', () => {
    expect(toPipeline(DEFAULT_STEPS)).toEqual(DEFAULT_PIPELINE);
    expect(readSteps(undefined)).toEqual(DEFAULT_STEPS);
    expect(readSteps({ order: { enabled: true, kind: 'oops', sort: 'natural' }, number: { start: 0 } })).toMatchObject({
      order: { enabled: true, kind: 'sort', sort: 'natural' },
      number: { start: 0, format: 'dot' },
    });
  });
});

describe('the Lines tool, rendered with no host', () => {
  it('starts empty: every step off and its options disabled, no summary or counters, Copy and Use as input off (§6, §8)', () => {
    render(<LinesTool />);
    expect(screen.getByRole('heading', { name: 'Steps' })).toBeTruthy();
    expect(screen.getByText('Applied from top to bottom.')).toBeTruthy();
    const names = [
      'Split lines',
      'Trim',
      'Filter',
      'Remove blank lines',
      'Duplicates',
      'Order',
      'Prefix and suffix',
      'Number lines',
      'Join into one line',
    ];
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-labelledby'))).toHaveLength(9);
    for (const name of names) {
      expect(checked(name)).toBe(false);
      expect(group(name)).toBeTruthy();
    }
    for (const label of ['Split on', 'Trim where', 'Filter mode', 'Which blank lines', 'Duplicates mode', 'Sort by'])
      expect((screen.getByRole('combobox', { name: label }) as HTMLButtonElement).disabled).toBe(true);
    for (const label of ['Filter text', 'Prefix', 'Suffix'])
      expect((screen.getByRole('textbox', { name: label }) as HTMLInputElement).disabled).toBe(true);
    expect(field('Input').placeholder).toBe('One item per line');
    expect(field('Input').getAttribute('spellcheck')).toBe('false');
    expect(field('Input').getAttribute('wrap')).toBe('off');
    expect(field('Result').readOnly).toBe(true);
    expect(field('Result').getAttribute('wrap')).toBe('off');
    expect(summary()).toBe('');
    expect(errorLine()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Use as input').disabled).toBe(true);
    for (const input of screen.getAllByRole('textbox')) expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('with every step off the result is the input with \\n line breaks (§4)', () => {
    render(<LinesTool />);
    type('b\r\na\rc\n');
    expect(output()).toBe('b\na\nc\n');
    expect(summary()).toBe('3 lines in, 3 out');
    type('x');
    expect(summary()).toBe('1 line in, 1 out');
  });

  it('§2.1: addresses — Trim, Remove blank lines, Duplicates with Ignore case, Sort Alphabetical', () => {
    render(<LinesTool />);
    type('alice@example.com\n Bob@example.com\n\nbob@example.com\ncarol@example.com\nalice@example.com \n');
    enable('Trim');
    enable('Remove blank lines');
    enable('Duplicates');
    fireEvent.click(step('Ignore case'));
    enable('Order');
    expect(output()).toBe('alice@example.com\nBob@example.com\ncarol@example.com\n');
    expect(summary()).toBe('6 lines in, 3 out');
    expect(counter('Remove blank lines')).toBe('1 removed');
    expect(counter('Duplicates')).toBe('2 removed');
    expect(counter('Trim')).toBe('');
    expect(counter('Order')).toBe('');
  });

  it('§2.2: Natural puts file2 before file10, Alphabetical does not', async () => {
    render(<LinesTool />);
    type('file1.txt\nfile10.txt\nfile2.txt');
    enable('Order');
    expect(output()).toBe('file1.txt\nfile10.txt\nfile2.txt');
    await choose('Sort by', 'Natural (file2 before file10)');
    expect(output()).toBe('file1.txt\nfile2.txt\nfile10.txt');
  });

  it('§2.3: response codes — Count occurrences, Numeric, Descending; Uppercase first is off for Numeric', async () => {
    render(<LinesTool />);
    type('200\n404\n200\n500\n200\n404');
    enable('Duplicates');
    await choose('Duplicates mode', 'Count occurrences');
    enable('Order');
    expect((step('Uppercase first') as HTMLButtonElement).disabled).toBe(false);
    await choose('Sort by', 'Numeric');
    await choose('Direction', 'Descending');
    expect(output()).toBe('3\t200\n2\t404\n1\t500');
    expect((step('Uppercase first') as HTMLButtonElement).disabled).toBe(true);
    await choose('Sort by', 'Length');
    expect((step('Uppercase first') as HTMLButtonElement).disabled).toBe(true);
    await choose('Sort by', 'Code point');
    expect((step('Uppercase first') as HTMLButtonElement).disabled).toBe(true);
  });

  it('§2.4: ids for WHERE id IN (…) — Duplicates, Numeric, quotes, Join with comma and space', async () => {
    render(<LinesTool />);
    type('42\n17\n42\n8');
    enable('Duplicates');
    enable('Order');
    await choose('Sort by', 'Numeric');
    enable('Prefix and suffix');
    text('Prefix', "'");
    text('Suffix', "'");
    enable('Join into one line');
    expect(output()).toBe("'8', '17', '42'");
    expect(summary()).toBe('4 lines in, 1 out');
  });

  it('§2.5: a comma list into lines — Split Comma and Trim, 2 added', () => {
    render(<LinesTool />);
    type('red, green, blue');
    enable('Split lines');
    enable('Trim');
    expect(output()).toBe('red\ngreen\nblue');
    expect(counter('Split lines')).toBe('2 added');
  });

  it('§2.6: Shuffle; Number lines keeps the order; Shuffle again draws a new one', () => {
    render(<LinesTool />);
    const names = Array.from({ length: 12 }, (_, i) => `name ${i}`);
    type(names.join('\n'));
    enable('Order');
    fireEvent.click(screen.getByRole('radio', { name: 'Shuffle' }));
    const shuffled = output();
    expect(shuffled.split('\n').sort()).toEqual([...names].sort());
    enable('Number lines');
    expect(output()).toBe(
      shuffled
        .split('\n')
        .map((name, i) => `${i + 1}. ${name}`)
        .join('\n'),
    );
    // A new order: the chance it repeats is 1 in 12! per press; three presses all equal would mean no reset.
    const again = new Set<string>();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(button('Shuffle again'));
      again.add(output());
    }
    expect(again.size).toBeGreaterThan(1);
  });

  it('§2.7: Filter Keep lines containing ERROR with Match case — 2 removed', () => {
    render(<LinesTool />);
    type('10:01 ERROR db timeout\n10:03 Error retry\n10:04 ERROR disk\n10:05 ok');
    enable('Filter');
    text('Filter text', 'ERROR');
    expect(output()).toBe('10:01 ERROR db timeout\n10:03 Error retry\n10:04 ERROR disk');
    fireEvent.click(step('Match case'));
    expect(output()).toBe('10:01 ERROR db timeout\n10:04 ERROR disk');
    expect(counter('Filter')).toBe('2 removed');
    type('10:01 ERROR db timeout\n10:03 Error retry\n10:04 ERROR disk');
    expect(counter('Filter')).toBe('1 removed');
  });

  it('§5.4, §5.12: Custom separators show their field only when chosen; empty changes nothing', async () => {
    render(<LinesTool />);
    type('a::b::c');
    enable('Split lines');
    expect(screen.queryByRole('textbox', { name: 'Custom separator' })).toBeNull();
    await choose('Split on', 'Custom…');
    expect(counter('Split lines')).toBe('no change');
    const custom = screen.getByRole('textbox', { name: 'Custom separator' }) as HTMLInputElement;
    expect(custom.placeholder).toBe('Separator');
    text('Custom separator', '::');
    expect(output()).toBe('a\nb\nc');
    enable('Join into one line');
    await choose('Join with', 'Custom…');
    text('Custom join separator', ' + ');
    expect(output()).toBe('a + b + c');
  });

  it('§6: a filter that removes everything — empty result, 3 lines in, 0 out, 3 removed', () => {
    render(<LinesTool />);
    type('a\nb\nc');
    enable('Filter');
    text('Filter text', 'zzz');
    expect(output()).toBe('');
    expect(summary()).toBe('3 lines in, 0 out');
    expect(counter('Filter')).toBe('3 removed');
    expect(button('Copy').disabled).toBe(true);
  });

  it('copies the result exactly as computed, with its final line break, and says Copied until it changes', async () => {
    const writeText = clipboard();
    render(<LinesTool />);
    type('b\na\n');
    enable('Order');
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('a\nb\n');
    expect(button('Copied')).toBeTruthy();
    type('c\nb\na\n');
    expect(button('Copy')).toBeTruthy();
  });

  it('Use as input moves the result into the input and turns every step off', () => {
    render(<LinesTool />);
    type('b\na\nb');
    enable('Duplicates');
    enable('Order');
    fireEvent.click(button('Use as input'));
    expect(field('Input').value).toBe('a\nb');
    expect(checked('Duplicates')).toBe(false);
    expect(checked('Order')).toBe(false);
    expect(output()).toBe('a\nb');
  });

  it('§6: the limits are said under the input, as a status (it changes while typing), and the result is empty', () => {
    render(<LinesTool />);
    type('x\n'.repeat(200_001));
    expect(errorLine()).toBe('Text has 200,001 lines. This tool works with up to 200,000 lines.');
    expect(document.querySelector('[data-part="error"]')!.getAttribute('role')).toBe('status');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    type('a'.repeat(8_388_609));
    expect(errorLine()).toBe('Text is larger than 8 MB. This tool works with up to 8 MB.');
    type(`${'a,'.repeat(249_999)}a`);
    enable('Split lines');
    expect(errorLine()).toBe('Split gives 250,000 lines. This tool works with up to 200,000 lines.');
  });

  it('§12: above 20,000 lines the result comes 300 ms after the last edit, "Updating…" meanwhile', async () => {
    vi.useFakeTimers();
    render(<LinesTool />);
    type(Array.from({ length: 20_001 }, (_, i) => `line ${20_001 - i}`).join('\n'));
    expect(summary()).toBe('Updating…');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Use as input').disabled).toBe(true);
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS - 10));
    expect(summary()).toBe('Updating…');
    await act(async () => void vi.advanceTimersByTime(20));
    expect(summary()).toBe('20,001 lines in, 20,001 out');
    expect(output().startsWith('line 20001\n')).toBe(true);
    enable('Order');
    expect(summary()).toBe('Updating…');
    expect(output().startsWith('line 20001\n')).toBe(true); // the previous result stays in view
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS));
    expect(output().startsWith('line 1\nline 10\n')).toBe(true);
    expect(button('Copy').disabled).toBe(false);
  });

  it('§12: a large input keeps its shuffled order when another step changes', async () => {
    vi.useFakeTimers();
    render(<LinesTool />);
    type(Array.from({ length: 25_000 }, (_, i) => `n${i}`).join('\n'));
    enable('Order');
    fireEvent.click(screen.getByRole('radio', { name: 'Shuffle' }));
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS));
    const shuffled = output().split('\n');
    enable('Number lines');
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS));
    expect(output().split('\n').slice(0, 3)).toEqual(shuffled.slice(0, 3).map((n, i) => `${i + 1}. ${n}`));
  });
});

describe('the Lines tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('lines', definition.history!).list({})).entries;

  it('records an edit as a snapshot when the page goes away, and nothing for an empty input', async () => {
    const host = memoryHost();
    const { unmount } = render(<LinesTool host={host} />);
    type('b\na');
    enable('Order');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('Sort: Alphabetical · 2 lines in, 2 out');

    render(<LinesTool host={host} />).unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy and Use as input at once, with the input, the steps and the result', async () => {
    clipboard();
    const host = memoryHost();
    render(<LinesTool host={host} />);
    type(' b\na\n b\n');
    enable('Trim');
    enable('Duplicates');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    fireEvent.click(button('Use as input'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2));
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toContain('Trim · Duplicates · 3 lines in, 2 out · copied');
    expect(labels).toContain('Trim · Duplicates · 3 lines in, 2 out · used as input');
    const history = host.history.forOwner('lines', definition.history!);
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    const opened = await history.open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entry.kind).toBe('process');
    expect(opened.payload).toMatchObject({
      steps: { trim: { enabled: true }, duplicates: { enabled: true } },
      linesIn: 3,
      linesOut: 2,
      action: 'copy',
    });
    expect(await opened.blobs.input!.text()).toBe(' b\na\n b\n');
    expect(await opened.blobs.output!.text()).toBe('b\na\n');
    expect(opened.blobs.tape).toBeUndefined();
  });

  it('opens an entry back into the tool — input, steps and the same shuffled order; opening records nothing', async () => {
    clipboard();
    const host = memoryHost();
    const first = render(<LinesTool host={host} />);
    type(Array.from({ length: 30 }, (_, i) => `item ${i}`).join('\n'));
    enable('Order');
    fireEvent.click(screen.getByRole('radio', { name: 'Shuffle' }));
    enable('Number lines');
    await choose('Number format', '1) item');
    const shuffled = output();
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    first.unmount();
    await act(async () => undefined);
    const entries = await entriesOf(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('Shuffle · Number lines · 30 lines in, 30 out · copied');

    const second = render(<LinesTool host={host} restore={{ id: copied.id }} />);
    expect(await screen.findByText(`Opened from History: ${copied.label}.`)).toBeTruthy();
    expect(field('Input').value.split('\n')).toHaveLength(30);
    expect(checked('Order')).toBe(true);
    expect(screen.getByRole('radio', { name: 'Shuffle' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Number format' }).textContent).toContain('1) item');
    expect(output()).toBe(shuffled);
    second.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('records text handed over by the host as the visit’s first edit', async () => {
    const host = memoryHost();
    render(<LinesTool host={host} input={'b\na\nb'} />).unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('3 lines in, 3 out');
  });
});
