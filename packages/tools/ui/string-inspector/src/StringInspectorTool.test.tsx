/**
 * The String Inspector's page (docs/tools/specs/string-inspector.md §2, §6, §8, §12) and its history (D17). Every
 * invisible, control or bidirectional character is written as an escape: this file stays plain to read.
 */
import { definition } from './definition';
import StringInspectorTool from './StringInspectorTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  rows,
  summarize,
  summaryText,
  tableTsv,
} from '@workspace/tool-logic-string-inspector';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';
const text = () => screen.getByLabelText('Text') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(text(), { target: { value } });
const value = (key: string) => document.querySelector(`[data-summary="${key}"] dd`)!.textContent;
const visible = () => document.querySelector('[data-part="visible"]');
const warningTexts = () => [...document.querySelectorAll('[data-part="warnings"] li')].map(li => li.textContent);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const tableRows = () => [...document.querySelectorAll('[data-part="table"] tbody tr')];
const cellsOf = (row: Element) => [...row.querySelectorAll('td')].map(td => td.textContent);
/** The visible text with each marker as [MARKER]. */
const shown = () => {
  const box = visible();
  if (!box) return null;
  return [...box.childNodes]
    .map(n => (n.nodeType === 3 ? n.textContent : `[${(n as HTMLElement).dataset.marker}]`))
    .join('');
};
const loaded = () => screen.findByRole('region', { name: 'The text with its invisible characters marked' });

describe('the String Inspector\u{2019}s definition', () => {
  it('describes the tool as data, with no shortcut, and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'string-inspector',
      title: 'String Inspector',
      summary: 'Count characters, bytes and words, and reveal invisible and look-alike characters.',
      order: 28,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'string',
      'length',
      'count',
      'characters',
      'bytes',
      'utf-8',
      'utf-16',
      'code point',
      'grapheme',
      'unicode',
      'invisible',
      'zero width',
      'homoglyph',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect('detect' in definition).toBe(false);
    expect(definition.history?.kinds).toEqual([{ id: 'inspect', title: 'Inspected' }]);
    expect((await definition.load()).default).toBe(StringInspectorTool);
  });

  it('recognises a hidden character from a module of its own (\u{A7}7)', async () => {
    const { detect } = await import('./detect');
    expect(detect('a\u{200B}b')).toBe(true);
    expect(detect('\u{202E}evil')).toBe(true);
    expect(detect(FAMILY)).toBe(false);
    expect(detect('nbsp\u{A0}here')).toBe(false);
  });
});

describe('the String Inspector, rendered with no host', () => {
  it('starts empty: the field, a summary of zeros, nothing else; Copy summary off (\u{A7}6, \u{A7}8)', () => {
    render(<StringInspectorTool />);
    expect(text().value).toBe('');
    expect(text().placeholder).toBe('Paste a string to inspect');
    expect(text().getAttribute('spellcheck')).toBe('false');
    expect(text().className).not.toContain('font-mono');
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeTruthy();
    const labels = [...document.querySelectorAll('[data-summary] dt')].map(dt => dt.textContent);
    expect(labels).toEqual([
      'Characters',
      'Code points',
      'UTF-16 code units',
      'UTF-8 bytes',
      'UTF-16 bytes',
      'Words',
      'Lines',
      'Normalization',
    ]);
    expect([...document.querySelectorAll('[data-summary] dd')].map(dd => dd.textContent)).toEqual([
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      'NFC and NFD',
    ]);
    expect(button('Copy summary').disabled).toBe(true);
    expect(document.querySelector('[data-part="warnings"]')).toBeNull();
    expect(visible()).toBeNull();
    expect(document.querySelector('[data-part="table"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy table' })).toBeNull();
  });

  it('says which Unicode data it counts with (spec \u{A7}15)', () => {
    render(<StringInspectorTool />);
    expect(document.querySelector('[data-part="unicode"]')!.textContent).toBe(
      'Counted with this browser\u{2019}s Unicode data (16.0).',
    );
  });

  it('\u{A7}2.1 \u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}: 10 characters, 19 UTF-8 bytes', () => {
    render(<StringInspectorTool />);
    type('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}');
    expect([value('graphemes'), value('utf8Bytes')]).toEqual(['10', '19']);
  });

  it('\u{A7}2.2 a family: 1 character, 7 code points, 11 units, 25 bytes; four emoji and three ZWJ, all grapheme 1', async () => {
    render(<StringInspectorTool />);
    type(FAMILY);
    expect([value('graphemes'), value('codePoints'), value('utf16Units'), value('utf8Bytes')]).toEqual([
      '1',
      '7',
      '11',
      '25',
    ]);
    await loaded();
    const r = tableRows().map(cellsOf);
    expect(r.map(c => c[2])).toEqual(['U+1F468', 'U+200D', 'U+1F469', 'U+200D', 'U+1F467', 'U+200D', 'U+1F466']);
    expect(r.filter(c => c[3] === 'ZERO WIDTH JOINER')).toHaveLength(3);
    expect(r.map(c => c[0])).toEqual(['1', '', '', '', '', '', '']);
    expect(warningTexts()).toEqual([]);
    expect(shown()).toBe(FAMILY);
  });

  it('\u{A7}2.3 api_key with a ZWSP: api[ZWSP]_key and the invisible warning; the marker is named', async () => {
    render(<StringInspectorTool />);
    type('api\u{200B}_key');
    await loaded();
    expect(shown()).toBe('api[ZWSP]_key');
    expect(warningTexts()).toEqual(['1 invisible character: ZWSP.']);
    expect(screen.getByRole('img', { name: 'ZERO WIDTH SPACE' }).textContent).toBe('ZWSP');
    expect(screen.getByRole('status', { name: 'Warnings' })).toBeTruthy();
  });

  it('\u{A7}2.4 p\u{430}ypal.com: the mixed-script warning; row 2 is U+0430, Cyrillic; the word is isolated', async () => {
    render(<StringInspectorTool />);
    type('p\u{430}ypal.com');
    await loaded();
    // Node (ICU 77.1) keeps a full stop between letters inside a word; Chrome 159 ends the word there and quotes
    // "pаypal" (spec §2.4, §15; the e2e module checks Chrome).
    expect(warningTexts()).toEqual(['Mixed scripts in 1 word: "p\u{430}ypal.com" (Cyrillic, Latin).']);
    expect(document.querySelector('bdi[data-word]')!.getAttribute('dir')).toBe('ltr');
    const second = cellsOf(tableRows()[1]!);
    expect([second[2], second[5]]).toEqual(['U+0430', 'Cyrillic']);
  });

  it('\u{A7}2.5 Trojan Source: [RLO]abc[PDF], the bidirectional warning, and no control in the page at all', async () => {
    render(<StringInspectorTool />);
    type('\u{202E}abc\u{202C}');
    await loaded();
    expect(shown()).toBe('[RLO]abc[PDF]');
    expect(warningTexts()).toEqual([
      '2 invisible characters: RLO, PDF.',
      'Bidirectional controls (RLO, PDF) can change the order in which text is displayed.',
    ]);
    const outsideField = [...document.body.querySelectorAll('*')]
      .filter(el => el.tagName !== 'TEXTAREA')
      .flatMap(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent ?? ''))
      .join('');
    expect(outsideField).not.toMatch(/[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200E}\u{200F}\u{61C}]/u);
    expect(visible()!.getAttribute('dir')).toBe('ltr');
  });

  it('a bidirectional control inside a mixed-script word is a marker in the warning too', async () => {
    render(<StringInspectorTool />);
    type('p\u{430}y\u{202E}pal');
    await loaded();
    const word = document.querySelector('bdi[data-word]')!;
    expect(word.textContent).toBe('"p\u{430}yRLOpal"');
    expect(word.querySelector('[data-marker="RLO"]')).toBeTruthy();
  });

  it('\u{A7}2.6 typographic quotes and a dash: the look-alike warning and the rows say what they look like', async () => {
    render(<StringInspectorTool />);
    type('\u{201C}quoted\u{201D} \u{2014} dash');
    await loaded();
    expect(warningTexts()).toEqual([
      '3 characters look like ASCII: \u{201C} \u{2192} ", \u{201D} \u{2192} ", \u{2014} \u{2192} -.',
    ]);
    const first = tableRows()[0]!;
    expect(first.getAttribute('data-flagged')).toBe('true');
    expect(cellsOf(first)[3]).toBe('\u{2014}looks like "');
  });

  it('\u{A7}2.7 \u{E9} decomposed against \u{E9} composed: NFD and 2 code points, NFC and 1', () => {
    render(<StringInspectorTool />);
    type('e\u{301}');
    expect([value('normalization'), value('codePoints'), value('graphemes')]).toEqual(['NFD', '2', '1']);
    type('\u{E9}');
    expect([value('normalization'), value('codePoints')]).toEqual(['NFC', '1']);
    expect(document.querySelector('[data-part="forms"]')!.textContent).toBe(
      'NFC leaves it as it is; NFD changes it: 2 code points, 3 UTF-8 bytes; NFKC leaves it as it is; NFKD changes it: 2 code points, 3 UTF-8 bytes.',
    );
  });

  it('one space is counted and not marked; a lone surrogate is', async () => {
    render(<StringInspectorTool />);
    type(' ');
    expect([value('graphemes'), value('utf8Bytes'), value('words'), value('lines')]).toEqual(['1', '1', '0', '1']);
    await loaded();
    expect(warningTexts()).toEqual([]);
    type('abc\u{D800}');
    expect([value('utf8Bytes'), value('codePoints')]).toEqual(['6', '4']);
    expect(shown()).toBe('abc[U+D800]');
    expect(warningTexts()[1]).toBe('1 lone surrogate: not valid Unicode. UTF-8 counts each as U+FFFD (3 bytes).');
  });

  it('Copy summary copies the eight lines as shown; Copied until the text changes', async () => {
    render(<StringInspectorTool />);
    type('hello');
    fireEvent.click(button('Copy summary'));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenLastCalledWith(summaryText(summarize('hello')));
    type('hello!');
    expect(button('Copy summary').textContent).toBe('Copy summary');
  });

  it('Copy table copies the shown table as TSV, with names', async () => {
    const { loadNames } = await import('@workspace/tool-logic-string-inspector');
    render(<StringInspectorTool />);
    type('a\u{200B}\u{E9}');
    await loaded();
    fireEvent.click(button('Copy table'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText).toHaveBeenLastCalledWith(tableTsv(rows('a\u{200B}\u{E9}', 1000, await loadNames())));
    expect(writeText.mock.calls.at(-1)![0].split('\n')[2]).toBe(
      '2\tZWSP\tU+200B\tZERO WIDTH SPACE\tCf Format\tCommon\tE2 80 8B\t200B\t\\u200B',
    );
  });

  it('shows the first 10,000 code points and the first 1,000 rows, and says so', async () => {
    render(<StringInspectorTool />);
    type('ab'.repeat(6_000) + 'c');
    await loaded();
    expect(document.querySelector('[data-part="visible-limit"]')!.textContent).toBe(
      'Showing the first 10,000 of 12,001 code points.',
    );
    expect(document.querySelector('[data-part="table-limit"]')!.textContent).toBe(
      'Showing the first 1,000 of 12,001 code points.',
    );
    expect(tableRows()).toHaveLength(1000);
    expect(visible()!.textContent).toHaveLength(10_000);
  });

  it('above 64 Ki the results come 300 ms after the last edit; above 1 Mi the tool refuses at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<StringInspectorTool />);
    type('x'.repeat(LIVE_INPUT));
    expect(value('graphemes')).toBe('65,536');
    type('y'.repeat(LIVE_INPUT + 1));
    expect(value('graphemes')).toBe('65,536');
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS - 1);
    });
    expect(value('graphemes')).toBe('65,536');
    // The settle, then the in-page runner's frame (jsdom has no Worker).
    for (let i = 0; i < 3; i++)
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
    expect(value('graphemes')).toBe('65,537');
    type('z'.repeat(MAX_INPUT + 1));
    const message = document.querySelector('[data-part="input-message"]')!;
    expect(message.textContent).toBe('Text is larger than 1 MB. String Inspector works with up to 1 MB.');
    expect(message.getAttribute('role')).toBe('status');
    expect(document.querySelector('[data-summary]')).toBeNull();
  }, 30_000);
});

describe('the String Inspector\u{2019}s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>) =>
    (await host.history.forOwner('string-inspector', definition.history!).list()).entries;

  it('records an edit as a snapshot (change), its label counts only; nothing for an empty text', async () => {
    const host = memoryHost();
    const { unmount } = render(<StringInspectorTool host={host} />);
    type('secret\u{200B}word');
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.kind).toBe('inspect');
    expect(entry!.label).toBe('11 characters \u{B7} 13 UTF-8 bytes \u{B7} 1 invisible');
    expect(entry!.label).not.toContain('secret');

    render(<StringInspectorTool host={host} />).unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('commits Copy summary at once, naming it; the text is a blob, the counts are not results kept', async () => {
    const host = memoryHost();
    render(<StringInspectorTool host={host} />);
    type('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}');
    fireEvent.click(button('Copy summary'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('10 characters \u{B7} 19 UTF-8 bytes \u{B7} copied summary');
    const opened = await host.history.forOwner('string-inspector', definition.history!).open(entry!.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({ graphemes: 10, codePoints: 10, utf8Bytes: 19, invisible: 0, copied: 'summary' });
    expect(Object.keys(opened.blobs)).toEqual(['input']);
    expect(await opened.blobs.input!.text()).toBe('\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442} \u{43C}\u{438}\u{440}');
  });

  it('commits Copy table the same way', async () => {
    const host = memoryHost();
    render(<StringInspectorTool host={host} />);
    type('x\u{A0}y');
    await loaded();
    fireEvent.click(button('Copy table'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe(
      '3 characters \u{B7} 4 UTF-8 bytes \u{B7} 1 invisible \u{B7} copied table',
    );
  });

  it('opens an entry back into the tool: the text and everything worked out from it; opening records nothing', async () => {
    const host = memoryHost();
    const first = render(<StringInspectorTool host={host} />);
    type('api\u{200B}_key');
    fireEvent.click(button('Copy summary'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    first.unmount();
    await act(async () => undefined);
    const entries = await entriesOf(host);

    const second = render(<StringInspectorTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(
      await screen.findByText(
        'Opened from History: 8 characters \u{B7} 10 UTF-8 bytes \u{B7} 1 invisible \u{B7} copied summary.',
      ),
    ).toBeTruthy();
    expect(text().value).toBe('api\u{200B}_key');
    await loaded();
    expect(shown()).toBe('api[ZWSP]_key');
    second.unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(entries.length);
  });

  it('records text handed over by the host as the visit\u{2019}s first edit', async () => {
    const host = memoryHost();
    render(<StringInspectorTool host={host} input={'a\u{200B}b'} />).unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    expect((await entriesOf(host))[0]!.label).toBe('3 characters \u{B7} 5 UTF-8 bytes \u{B7} 1 invisible');
  });

  it('does not record a text it refuses', async () => {
    const host = memoryHost();
    const { unmount } = render(<StringInspectorTool host={host} />);
    type('x'.repeat(MAX_INPUT + 1));
    unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toHaveLength(0);
  });
});
