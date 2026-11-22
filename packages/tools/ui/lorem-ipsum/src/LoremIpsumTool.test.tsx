import { definition } from './definition';
import { draftOf, labelOf, readSettings } from './entries';
import { loremIpsumHistory } from './history';
import LoremIpsumTool from './LoremIpsumTool';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CLASSIC_SENTENCE } from '@workspace/tool-logic-lorem-ipsum';
import { AUTO_COPY, AUTO_COPY_REFUSED, memoryHost, memoryToolSettings } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HistoryDraft,
  OpenedEntry,
  RecordingStatus,
  RecordOutcome,
  ToolHistory,
  ToolHost,
} from '@workspace/tools-host';

afterEach(cleanup);

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
beforeEach(() => {
  writeText.mockClear();
  writeText.mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

const settle = () => act(async () => undefined);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const result = () => (document.getElementById('lorem-ipsum-result') as HTMLTextAreaElement).value;
const line = () => document.querySelector('[data-status]')?.textContent ?? null;
const count = () => screen.getByLabelText('Count') as HTMLInputElement;
const typeCount = (value: string) => fireEvent.change(count(), { target: { value } });
const pick = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const start = () => screen.getByRole('checkbox', { name: 'Start with "Lorem ipsum…"' });
const countError = (): string | null => {
  const describedBy = count().getAttribute('aria-describedby');
  return describedBy ? (document.getElementById(describedBy)?.textContent ?? null) : null;
};
const words = (t: string) =>
  t
    .replace(/<\/?p>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** A host whose history records every call, with a status the test sets — the factory's rules are not this tool's. */
const spyHost = (initial: Partial<RecordingStatus> = {}) => {
  const status: RecordingStatus = { gate: 'on', secrets: 'no-password', declared: true, ...initial };
  const changes: HistoryDraft[] = [];
  const commits: HistoryDraft[] = [];
  const opened = new Map<string, OpenedEntry>();
  const history: ToolHistory = {
    owner: 'lorem-ipsum',
    status: () => status,
    subscribe: () => () => undefined,
    session: () => ({
      session: undefined,
      change: draft => void changes.push(draft),
      commit: draft => {
        commits.push(draft);
        return Promise.resolve<RecordOutcome>({ recorded: true, id: String(commits.length) });
      },
      flush: () => Promise.resolve(),
      end: () => Promise.resolve(),
    }),
    list: () => Promise.resolve({ entries: [] }),
    open: id => Promise.resolve(opened.get(id) ?? { ok: false, reason: 'missing' }),
  };
  const host: ToolHost = { history: { forOwner: () => history } };
  return { host, changes, commits, opened };
};
const entry = (payload: unknown, label?: string, schema = 1): OpenedEntry => ({
  ok: true,
  entry: {
    id: 'e1',
    owner: 'lorem-ipsum',
    kind: 'generate',
    session: 's',
    time: 0,
    schema,
    encrypted: false,
    bytes: 1,
  },
  ...(label ? { label } : {}),
  payload: payload as HistoryDraft['payload'],
  blobs: {},
});
/** The spy host with "Copy automatically after generating" switched on for this tool (or not). */
const autoCopyHost = async (on: boolean) => {
  const spy = spyHost();
  const settings = memoryToolSettings();
  await settings.setForAll(['lorem-ipsum', 'password', 'uuid', 'random-string'], { [AUTO_COPY]: on });
  return { ...spy, host: { ...spy.host, settings } satisfies ToolHost, settings };
};

describe('the Lorem Ipsum tool’s definition', () => {
  it('describes the tool, has no detect (§7) and no shortcut, generates one text, declares one kind in clear', async () => {
    expect(definition).toMatchObject({
      id: 'lorem-ipsum',
      title: 'Lorem Ipsum',
      summary: 'Generate placeholder text: words, sentences or paragraphs.',
      order: 30,
      output: { origin: 'generated', copies: 'text' },
    });
    expect(definition.keywords).toEqual([
      'lorem',
      'ipsum',
      'placeholder',
      'dummy text',
      'filler',
      'generator',
      'paragraphs',
      'text',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), 'detect.ts'))).toBe(false);
    expect(definition.history).toBe(loremIpsumHistory);
    expect(loremIpsumHistory.kinds).toEqual([{ id: 'generate', title: 'Generated' }]);
    expect((await definition.load()).default).toBe(LoremIpsumTool);
  });
});

describe('the Lorem Ipsum tool, rendered with no host (§2, §6, §8)', () => {
  it('scenario 1: opens with three paragraphs starting with the classic sentence, the line under it, Copy copies it', async () => {
    render(<LoremIpsumTool />);
    const t = result();
    const paragraphs = t.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    expect(t.startsWith(`${CLASSIC_SENTENCE} `)).toBe(true);
    const sentences = t.match(/\./g)!.length;
    expect(sentences).toBeGreaterThanOrEqual(9);
    expect(sentences).toBeLessThanOrEqual(18);
    expect(t.endsWith('\n')).toBe(false);
    const n = words(t).length;
    expect(line()).toBe(`${n.toLocaleString('en-US')} words · ${t.length.toLocaleString('en-US')} characters`);
    expect(document.querySelector('[data-status]')!.getAttribute('role')).toBe('status');
    // The defaults of §4.
    expect(screen.getByRole('radio', { name: 'Paragraphs' }).getAttribute('aria-checked')).toBe('true');
    expect(count().value).toBe('3');
    expect(start().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Plain text' }).getAttribute('aria-checked')).toBe('true');
    // Opening copies nothing.
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText.mock.calls).toEqual([[t]]);
    expect(button('Copied')).toBeTruthy();
  });

  it('§8: the field is read-only, not spell-checked, in the sans font for plain text and monospace for HTML', () => {
    render(<LoremIpsumTool />);
    const field = document.getElementById('lorem-ipsum-result') as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.className).not.toContain('font-mono');
    expect(screen.getByLabelText('Result')).toBe(field);
    pick('HTML');
    expect((document.getElementById('lorem-ipsum-result') as HTMLTextAreaElement).className).toContain('font-mono');
    expect(count().getAttribute('inputmode')).toBe('numeric');
    expect(count().getAttribute('spellcheck')).toBe('false');
  });

  it('scenario 2: Words, 5 — Lorem ipsum dolor sit amet', () => {
    render(<LoremIpsumTool />);
    pick('Words');
    typeCount('5');
    expect(result()).toBe('Lorem ipsum dolor sit amet');
    expect(line()).toBe('5 words · 26 characters');
  });

  it('scenario 3: without the opening, Sentences, 2 — two random sentences', () => {
    render(<LoremIpsumTool />);
    fireEvent.click(start());
    pick('Sentences');
    typeCount('2');
    const t = result();
    const sentences = t.split(/(?<=\.) /);
    expect(sentences).toHaveLength(2);
    for (const s of sentences) expect(s).toMatch(/^[A-Z][a-z]*(,? [a-z]+)*\.$/);
    expect(t.startsWith(CLASSIC_SENTENCE)).toBe(false);
  });

  it('scenario 4: Paragraphs, 4, HTML — four <p>…</p> lines', () => {
    render(<LoremIpsumTool />);
    typeCount('4');
    pick('HTML');
    const lines = result().split('\n');
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(l).toMatch(/^<p>[A-Za-z ,.]+<\/p>$/);
    expect(lines[0]!.startsWith(`<p>${CLASSIC_SENTENCE} `)).toBe(true);
  });

  it('scenario 5: 3 → 4 paragraphs keeps the first three and adds one; Generate makes a new text', () => {
    render(<LoremIpsumTool />);
    const three = result();
    typeCount('4');
    const four = result();
    expect(four.startsWith(`${three}\n\n`)).toBe(true);
    expect(four.split('\n\n')).toHaveLength(4);
    pick('HTML');
    expect(result()).toBe(
      four
        .split('\n\n')
        .map(p => `<p>${p}</p>`)
        .join('\n'),
    );
    pick('Plain text');
    expect(result()).toBe(four);
    fireEvent.click(button('Generate'));
    const fresh = result();
    expect(fresh).not.toBe(four);
    expect(fresh.split('\n\n')).toHaveLength(4);
    expect(fresh.startsWith(`${CLASSIC_SENTENCE} `)).toBe(true);
    // And the new bytes are kept for the next change.
    typeCount('5');
    expect(result().startsWith(`${fresh}\n\n`)).toBe(true);
  });

  it('scenario 6: 500 at Paragraphs — the message under the field, the text as it was, Copy copies it, Generate off', async () => {
    render(<LoremIpsumTool />);
    const before = result();
    typeCount('500');
    expect(countError()).toBe('Enter a whole number from 1 to 100.');
    expect(count().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('lorem-ipsum-count-error')!.getAttribute('role')).toBe('status');
    expect(result()).toBe(before);
    expect(button('Generate').disabled).toBe(true);
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(before);
  });

  it('§6: empty, 0, -3, 2.5, 1e3, abc, 101 — the same message; " 5 " is 5; the message follows the unit', () => {
    render(<LoremIpsumTool />);
    for (const bad of ['', '0', '-3', '2.5', '1e3', 'abc', '101']) {
      typeCount(bad);
      expect(countError()).toBe('Enter a whole number from 1 to 100.');
    }
    typeCount('abc');
    pick('Sentences');
    expect(countError()).toBe('Enter a whole number from 1 to 1,000.');
    pick('Words');
    expect(countError()).toBe('Enter a whole number from 1 to 10,000.');
    typeCount(' 5 ');
    expect(countError()).toBeNull();
    expect(words(result())).toHaveLength(5);
    expect(count().getAttribute('aria-invalid')).toBeNull();
  });

  it('§4: a change of Unit keeps Count when it fits, else takes the new limit (500 words → 100 paragraphs)', () => {
    render(<LoremIpsumTool />);
    pick('Words');
    expect(count().value).toBe('3');
    typeCount('500');
    pick('Sentences');
    expect(count().value).toBe('500');
    pick('Paragraphs');
    expect(count().value).toBe('100');
    expect(result().split('\n\n')).toHaveLength(100);
  });

  it('§6: 1 word and 1 sentence with the opening', () => {
    render(<LoremIpsumTool />);
    pick('Words');
    typeCount('1');
    expect(result()).toBe('Lorem');
    expect(line()).toBe('1 word · 5 characters');
    pick('Sentences');
    expect(result()).toBe(CLASSIC_SENTENCE);
    expect(line()).toBe('8 words · 56 characters');
  });

  it('§6: the limits — 10,000 words, 1,000 sentences, 100 paragraphs — counted exactly, thousands with a comma', () => {
    render(<LoremIpsumTool />);
    pick('Words');
    typeCount('10000');
    expect(words(result())).toHaveLength(10_000);
    expect(line()).toMatch(/^10,000 words · \d\d,\d{3} characters$/);
    pick('Sentences');
    expect(count().value).toBe('1000');
    expect(result().match(/\./g)).toHaveLength(1000);
    pick('Paragraphs');
    expect(result().split('\n\n')).toHaveLength(100);
  });

  it('§6: the source throws — the message under the result, no text', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new DOMException('refused', 'QuotaExceededError');
    });
    render(<LoremIpsumTool />);
    expect(screen.getByText('Could not get random numbers from the browser.')).toBeTruthy();
    expect(result()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    spy.mockRestore();
    fireEvent.click(button('Generate'));
    expect(result().startsWith(CLASSIC_SENTENCE)).toBe(true);
    expect(screen.queryByText('Could not get random numbers from the browser.')).toBeNull();
  });

  it('keyboard: Tab goes through the settings, Generate, Copy and the result, in that order', () => {
    render(<LoremIpsumTool />);
    const focusable = [...document.querySelectorAll<HTMLElement>('button, input, textarea')];
    const at = (el: Element) => focusable.indexOf(el as HTMLElement);
    const sequence = [
      screen.getByRole('radio', { name: 'Words' }),
      count(),
      start(),
      screen.getByRole('radio', { name: 'HTML' }),
      button('Generate'),
      button('Copy'),
      document.getElementById('lorem-ipsum-result')!,
    ].map(at);
    expect(sequence.every(i => i >= 0)).toBe(true);
    expect([...sequence].sort((x, y) => x - y)).toEqual(sequence);
    expect(document.getElementById('lorem-ipsum-result')!.tabIndex).toBe(0);
  });
});

describe('the Lorem Ipsum tool’s history (D17): the settings, in clear, never the text', () => {
  it('records nothing on opening; a change is a change, Generate and Copy are commits — settings only', async () => {
    const { host, changes, commits } = spyHost();
    render(<LoremIpsumTool host={host} />);
    await settle();
    expect(changes).toHaveLength(0);
    expect(commits).toHaveLength(0);

    typeCount('4');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      kind: 'generate',
      payload: { unit: 'paragraphs', count: 4, startWithLorem: true, format: 'plain' },
      label: '4 paragraphs · Plain text · classic opening',
    });
    typeCount('400');
    expect(changes).toHaveLength(1); // an invalid Count makes nothing and records nothing

    pick('Words');
    expect(count().value).toBe('400');
    fireEvent.click(start());
    pick('HTML');
    expect(changes.at(-1)!.payload).toEqual({ unit: 'words', count: 400, startWithLorem: false, format: 'html' });
    expect(changes.at(-1)!.label).toBe('400 words · HTML · random opening');

    fireEvent.click(button('Generate'));
    expect(commits).toHaveLength(1);
    fireEvent.click(button('Copy'));
    await settle();
    expect(commits).toHaveLength(2);
    expect(commits[1]!.payload).toEqual(commits[0]!.payload);
    // No text anywhere in what is recorded.
    const shown = result();
    for (const d of [...changes, ...commits]) {
      expect(d.text).toBeUndefined();
      expect(d.blobs).toBeUndefined();
      expect(JSON.stringify(d)).not.toContain(shown.slice(3, 40));
      expect(d.label).toMatch(
        /^[\d,]+ (words?|sentences?|paragraphs?) · (Plain text|HTML) · (classic|random) opening$/,
      );
    }
  });

  it('the in-memory host: Generate keeps one entry in clear; opening it brings the settings back with a new text, says so, records and copies nothing', async () => {
    const host = memoryHost();
    await host.settings.setForAll(['lorem-ipsum'], { [AUTO_COPY]: true });
    const first = render(<LoremIpsumTool host={host} />);
    pick('Sentences');
    typeCount('7');
    fireEvent.click(start());
    fireEvent.click(button('Generate'));
    await settle();
    const before = result();
    first.unmount();
    writeText.mockClear();

    const history = host.history.forOwner('lorem-ipsum', loremIpsumHistory);
    const list = (await history.list()).entries;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'generate', encrypted: false });
    expect(list[0]!.label).toBe('7 sentences · Plain text · random opening');

    render(<LoremIpsumTool host={host} restore={{ id: list[0]!.id }} />);
    expect(
      await screen.findByText(
        'Opened from History: 7 sentences · Plain text · random opening. The text is new: only the settings were kept.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Sentences' }).getAttribute('aria-checked')).toBe('true');
    expect(count().value).toBe('7');
    expect(start().getAttribute('aria-checked')).toBe('false');
    const after = result();
    expect(after.split(/(?<=\.) /)).toHaveLength(7);
    expect(after).not.toBe(before);
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect((await history.list()).entries).toHaveLength(1);
  });

  it('an entry that is not this tool’s payload, or out of the limits, could not be opened; a newer schema says so', async () => {
    const { host, opened, changes } = spyHost();
    opened.set('e1', entry({ unit: 'paragraphs', count: 101, startWithLorem: true, format: 'plain' }));
    const { unmount } = render(<LoremIpsumTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
    unmount();
    opened.set('e1', { ok: false, reason: 'newer-schema' });
    render(<LoremIpsumTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('This entry was kept by a newer version of the tool.')).toBeTruthy();
    expect(changes).toHaveLength(0);
  });

  it('reads back only a payload of schema 1 within the limits', () => {
    expect(readSettings({ unit: 'words', count: 10_000, startWithLorem: false, format: 'html' })).toEqual({
      unit: 'words',
      count: 10_000,
      startWithLorem: false,
      format: 'html',
    });
    for (const bad of [
      null,
      [],
      'x',
      { unit: 'chars', count: 3, startWithLorem: true, format: 'plain' },
      { unit: 'words', count: 0, startWithLorem: true, format: 'plain' },
      { unit: 'words', count: 2.5, startWithLorem: true, format: 'plain' },
      { unit: 'sentences', count: 1001, startWithLorem: true, format: 'plain' },
      { unit: 'words', count: 3, startWithLorem: 'yes', format: 'plain' },
      { unit: 'words', count: 3, startWithLorem: true, format: 'markdown' },
    ])
      expect(readSettings(bad)).toBeNull();
    const s = { unit: 'paragraphs', count: 1, startWithLorem: true, format: 'plain' } as const;
    expect(readSettings(draftOf(s).payload)).toEqual(s);
    expect(labelOf(s)).toBe('1 paragraph · Plain text · classic opening');
  });

  it('says what the history keeps, by its state', () => {
    const { host } = spyHost({ gate: 'off' });
    const { unmount } = render(<LoremIpsumTool host={host} />);
    expect(document.querySelector('[data-hint]')!.textContent).toBe('Nothing is kept: the history is off.');
    unmount();
    render(<LoremIpsumTool host={spyHost().host} />);
    expect(document.querySelector('[data-hint]')!.textContent).toBe(
      'History keeps the settings, not the text: an entry opens with a new text.',
    );
  });
});

describe('Copy automatically after generating (docs/tools/copying.md)', () => {
  it('applies to this tool: a generator whose one generation is one text', () => {
    expect(definition.output).toEqual({ origin: 'generated', copies: 'text' });
  });

  it('off: Generate copies nothing; the line has no tail', async () => {
    render(<LoremIpsumTool host={(await autoCopyHost(false)).host} />);
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(line()).toMatch(/^\d+ words · [\d,]+ characters$/);
    expect(button('Copy')).toBeTruthy();
  });

  it('on: opening (with its text) and every change copy nothing; Generate copies the text once, recorded once', async () => {
    const { host, commits } = await autoCopyHost(true);
    render(<LoremIpsumTool host={host} />);
    await settle();
    expect(result()).not.toBe('');
    typeCount('4');
    pick('Words');
    fireEvent.click(start());
    pick('HTML');
    pick('Paragraphs');
    await settle();
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.click(button('Generate'));
    await settle();
    const t = result();
    expect(writeText.mock.calls).toEqual([[t]]);
    expect(t.split('\n')).toHaveLength(4);
    expect(t.endsWith('\n')).toBe(false);
    expect(button('Copied')).toBeTruthy();
    expect(line()).toBe(
      `${words(t).length.toLocaleString('en-US')} words · ${t.length.toLocaleString('en-US')} characters · copied`,
    );
    expect(screen.queryByText(AUTO_COPY_REFUSED)).toBeNull();
    expect(commits).toHaveLength(1);

    // A change afterwards: a new text, the tail and "Copied" go, nothing is copied.
    typeCount('5');
    expect(line()).not.toContain('copied');
    expect(button('Copy')).toBeTruthy();
    await settle();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('on, plain text: the copy is the text as shown — paragraphs joined by a blank line', async () => {
    render(<LoremIpsumTool host={(await autoCopyHost(true)).host} />);
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText.mock.calls).toEqual([[result()]]);
    expect(result().split('\n\n')).toHaveLength(3);
  });

  it('on, the browser refuses: the tail says so, one line says why, the Copy button still works', async () => {
    render(<LoremIpsumTool host={(await autoCopyHost(true)).host} />);
    writeText.mockImplementationOnce(() =>
      Promise.reject(
        new DOMException("Failed to execute 'writeText' on 'Clipboard': Document is not focused.", 'NotAllowedError'),
      ),
    );
    fireEvent.click(button('Generate'));
    await settle();
    expect(line()).toMatch(/ · not copied automatically$/);
    const refusal = screen.getByText(AUTO_COPY_REFUSED);
    expect(refusal.getAttribute('role')).toBeNull();
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(result());
    expect(button('Copied')).toBeTruthy();
    typeCount('2');
    expect(screen.queryByText(AUTO_COPY_REFUSED)).toBeNull();
  });

  it('on: opening an entry from History copies nothing', async () => {
    const { host, opened } = await autoCopyHost(true);
    opened.set('e1', entry({ unit: 'words', count: 12, startWithLorem: true, format: 'plain' }, '12 words'));
    render(<LoremIpsumTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText(/^Opened from History: 12 words\./)).toBeTruthy();
    await settle();
    expect(words(result())).toHaveLength(12);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('follows the switch live: turned on while the tool is open, the next Generate copies', async () => {
    const { host, settings } = await autoCopyHost(false);
    render(<LoremIpsumTool host={host} />);
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    await act(() => settings.setForAll(['lorem-ipsum'], { [AUTO_COPY]: true }));
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText.mock.calls).toEqual([[result()]]);
  });
});

describe('the Lorem Ipsum tool’s sources (§5.2)', () => {
  it('use no Math.random, no console and no debug logger', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(root).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.sort()).toEqual(['LoremIpsumTool.tsx', 'definition.ts', 'entries.ts', 'history.ts']);
    for (const file of files)
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/Math\.random|console\.|createDebug|getRandomValues/);
  });
});
