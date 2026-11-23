import { definition } from './definition';
import { draft } from './entries';
import RegexpTool, { TEXTS } from './RegexpTool';
import { RegexpRunner } from './runner';
import { regexpSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { runRegexp } from '@workspace/tool-logic-regexp';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobMessage } from './runner';
import type { ToolHost } from '@workspace/tools-host';

// jsdom has no Worker: a fake one runs the logic's runRegexp off the test's stack (as the real worker does off the
// page's thread), or never answers (a pattern that backtracks for ever), or fails.
type Mode = 'answer' | 'hang' | 'crash' | 'slow';
let mode: Mode = 'answer';
let workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null = null;
  terminated = false;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    workers.push(this);
  }
  postMessage(message: unknown): void {
    const { id, request } = message as JobMessage;
    if (mode === 'hang') return;
    if (mode === 'crash') {
      setTimeout(() => this.onerror?.({ message: 'boom', preventDefault: () => undefined }), 0);
      return;
    }
    setTimeout(
      () => {
        if (!this.terminated) this.onmessage?.({ data: { id, result: runRegexp(request) } });
      },
      mode === 'slow' ? 600 : 0,
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

beforeEach(() => {
  mode = 'answer';
  workers = [];
  writeText.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const flag = (name: string) => screen.getByRole('button', { name });
const region = () => screen.getByRole('region', { name: 'Matches in text' });
const marks = () => [...region().querySelectorAll('mark')];
const status = () => document.querySelector('[data-status]')?.textContent ?? '';
const message = (where: string) => document.querySelector(`[data-field="${where}"]`)?.textContent?.trim() ?? '';
const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map(row =>
      within(row)
        .getAllByRole('cell')
        .map(cell => cell.textContent),
    );
const until = (text: string) => waitFor(() => expect(status()).toContain(text));

describe('the RegExp tool’s definition', () => {
  it('describes the tool, has no detect and no shortcut, and loads its component', async () => {
    expect(definition).toMatchObject({ id: 'regexp', title: 'RegExp', order: 9, output: { origin: 'input' } });
    expect(definition.summary).toBe('Test a JavaScript regular expression: matches, groups and replacement.');
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds.map(k => [k.id, k.secret ?? false])).toEqual([
      ['match', false],
      ['replace', false],
    ]);
    expect((await definition.load()).default).toBe(RegexpTool);
  });
});

describe('the RegExp tool, rendered with no host', () => {
  it('starts empty: g on, no status, copy buttons off, no worker started', () => {
    render(<RegexpTool />);
    expect(field('Pattern').value).toBe('');
    expect(field('Test text').value).toBe('');
    expect(flag('global').getAttribute('aria-pressed')).toBe('true');
    expect(flag('ignore case').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-flags]')?.textContent).toBe('global');
    expect(status()).toBe('');
    for (const name of ['Copy regex', 'Copy matches'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(TEXTS.hint)).toBeTruthy();
    expect(field('Pattern').getAttribute('placeholder')).toBe('\\d{4}-\\d{2}-\\d{2}');
    expect(field('Test text').getAttribute('placeholder')).toBe('Paste the text to search');
    expect(field('Pattern').getAttribute('spellcheck')).toBe('false');
    expect(workers).toHaveLength(0);
  });

  it('§2.1: dates highlighted, 2 matches; the second one’s groups with positions', async () => {
    render(<RegexpTool />);
    type('Pattern', '(\\d{4})-(\\d{2})-(\\d{2})');
    type('Test text', 'from 2026-11-19 to 2026-12-01');
    await until('2 matches');
    expect(marks().map(m => m.textContent)).toEqual(['2026-11-19', '2026-12-01']);
    expect(marks()[0]!.getAttribute('title')).toBe('Match 1: line 1, column 6');
    expect(marks()[0]!.className).toContain('bg-primary/15');
    expect(marks()[1]!.className).toContain('bg-primary/30');
    expect(marks()[0]!.className).toContain('ring-ring');
    expect(region().textContent).toBe('from 2026-11-19 to 2026-12-01');
    expect(rows('Matches')).toEqual([
      ['1', '1:6', '5–15', '"2026-11-19"'],
      ['2', '1:20', '19–29', '"2026-12-01"'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Match 2' }));
    expect(rows('Groups')).toEqual([
      ['1', '—', '19–23', '"2026"'],
      ['2', '—', '24–26', '"12"'],
      ['3', '—', '27–29', '"01"'],
    ]);
    expect(marks()[1]!.className).toContain('ring-ring');
    expect(marks()[0]!.className).not.toContain('ring-ring');
    expect(screen.getByRole('button', { name: 'Match 2' }).getAttribute('aria-pressed')).toBe('true');
    // A click on a mark selects it too.
    fireEvent.click(marks()[0]!);
    expect(rows('Groups')[0]).toEqual(['1', '—', '5–9', '"2026"']);
  });

  it('§2.2: Replace with $3.$2.$1 gives the result, Copy result copies it', async () => {
    render(<RegexpTool />);
    type('Pattern', '(\\d{4})-(\\d{2})-(\\d{2})');
    type('Test text', 'from 2026-11-19 to 2026-12-01');
    expect(screen.queryByLabelText('Replace with')).toBeNull();
    fireEvent.click(screen.getByLabelText('Replace'));
    expect(field('Replace with').getAttribute('placeholder')).toBe('$1, $<name>, $&');
    expect(screen.getByText(TEXTS.replaceHint)).toBeTruthy();
    type('Replace with', '$3.$2.$1');
    await waitFor(() => expect(field('Result').value).toBe('from 19.11.2026 to 01.12.2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('from 19.11.2026 to 01.12.2026');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('§2.3: named groups in the table and in the replacement', async () => {
    render(<RegexpTool />);
    type('Pattern', '(?<user>\\w+)@(?<host>[\\w.]+)');
    type('Test text', 'mail ann@example.com, bob@test.org');
    fireEvent.click(screen.getByLabelText('Replace'));
    type('Replace with', '$<host>: $<user>');
    await until('2 matches');
    expect(rows('Groups')).toEqual([
      ['1', 'user', '5–8', '"ann"'],
      ['2', 'host', '9–20', '"example.com"'],
    ]);
    await waitFor(() => expect(field('Result').value).toBe('mail example.com: ann, test.org: bob'));
  });

  it('§2.4: a pasted literal is split; Keep as pasted puts it back as pasted', async () => {
    render(<RegexpTool />);
    fireEvent.click(flag('ignore case'));
    fireEvent.paste(field('Pattern'), { clipboardData: { getData: () => '/^\\s*#.*$/gm' } });
    expect(field('Pattern').value).toBe('^\\s*#.*$');
    expect(['global', 'multiline', 'ignore case'].map(n => flag(n).getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'false',
    ]);
    expect(message('pattern')).toBe(TEXTS.pasted);
    fireEvent.click(screen.getByRole('button', { name: 'Keep as pasted' }));
    expect(field('Pattern').value).toBe('/^\\s*#.*$/gm');
    expect(document.querySelector('[data-flags]')?.textContent).toBe('global, ignore case');
    expect(message('pattern')).toBe('');
    expect(screen.queryByRole('button', { name: 'Keep as pasted' })).toBeNull();

    // The note goes with the next change of the pattern; a paste into part of the field is a plain paste.
    type('Pattern', '');
    fireEvent.paste(field('Pattern'), { clipboardData: { getData: () => '/a+/g' } });
    expect(message('pattern')).toBe(TEXTS.pasted);
    type('Pattern', 'a+x');
    expect(message('pattern')).toBe('');
    const input = field('Pattern') as HTMLInputElement;
    input.setSelectionRange(1, 1);
    const paste = fireEvent.paste(input, { clipboardData: { getData: () => '/b/i' } });
    expect(paste).toBe(true);
    expect(input.value).toBe('a+x');
    // Not a literal: pasted as it is.
    type('Pattern', '');
    expect(fireEvent.paste(field('Pattern'), { clipboardData: { getData: () => '/usr/local/bin/' } })).toBe(true);
  });

  it('§2.5: a pattern that never ends is stopped at 1 s, says so, offers 10 s; an edit returns to 1 s', async () => {
    mode = 'hang';
    const run = vi.spyOn(RegexpRunner.prototype, 'run');
    render(<RegexpTool />);
    type('Pattern', '^(a+)+$');
    type('Test text', `${'a'.repeat(40)}b`);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![1]).toBe(1_000);
    await waitFor(() => expect(screen.getByText(TEXTS.stopped(1_000))).toBeTruthy(), { timeout: 2_500 });
    expect(TEXTS.stopped(1_000)).toBe(
      'Stopped after 1 second: the pattern takes too long on this text. Nested quantifiers such as (a+)+ often cause this (catastrophic backtracking).',
    );
    expect(screen.getByText(TEXTS.stopped(1_000)).getAttribute('role')).toBe('alert');
    expect(workers[0]!.terminated).toBe(true);
    expect(marks()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Allow 10 seconds' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]![1]).toBe(10_000);
    expect(screen.queryByRole('button', { name: 'Allow 10 seconds' })).toBeNull();
    // A following edit works: the long run is cancelled, the limit is 1 s again, and an answer shows.
    mode = 'answer';
    type('Test text', 'aaa');
    await until('1 match');
    expect(run.mock.calls[2]![1]).toBe(1_000);
    expect(workers[1]!.terminated).toBe(true);
    expect(screen.queryByText(TEXTS.stopped(1_000))).toBeNull();
  });

  it('a new edit cancels the run in flight at once', async () => {
    mode = 'hang';
    render(<RegexpTool />);
    type('Pattern', '^(a+)+$');
    type('Test text', `${'a'.repeat(40)}b`);
    await waitFor(() => expect(workers).toHaveLength(1));
    type('Test text', 'aaab');
    expect(workers[0]!.terminated).toBe(true);
  });

  it('says Running… when the answer takes over 300 ms, keeping the old results meanwhile', async () => {
    render(<RegexpTool />);
    type('Pattern', 'a');
    type('Test text', 'a a');
    await until('2 matches');
    mode = 'slow';
    type('Test text', 'a a a');
    await waitFor(() => expect(status()).toBe(`2 matches${TEXTS.running}`), { timeout: 1_000 });
    expect(marks()).toHaveLength(2);
    await until('3 matches');
    expect(status()).toBe('3 matches');
  });

  it('a worker that fails says so', async () => {
    mode = 'crash';
    render(<RegexpTool />);
    type('Pattern', 'a');
    type('Test text', 'a');
    expect(await screen.findByText('The regular expression could not be run: boom.')).toBeTruthy();
  });

  it('§2.6: half an emoji without u, with a note; the whole one with u', async () => {
    render(<RegexpTool />);
    type('Pattern', '.');
    type('Test text', '😀');
    await until('2 matches');
    expect(message('matches')).toBe(TEXTS.splitsPair);
    expect(rows('Matches').map(r => r[3])).toEqual(['"\\ud83d"', '"\\ude00"']);
    fireEvent.click(flag('unicode'));
    await until('1 match');
    expect(marks().map(m => m.textContent)).toEqual(['😀']);
    expect(message('matches')).toBe('');
  });

  it('§2.7: a typo shows the engine’s words under the field, politely, and no results', async () => {
    render(<RegexpTool />);
    type('Pattern', '\\d+');
    type('Test text', 'a1');
    await until('1 match');
    type('Pattern', '(\\d+');
    const shown = document.querySelector('[data-field="pattern"]')!;
    expect(shown.textContent).toBe('Unterminated group');
    expect(shown.getAttribute('role')).toBe('status');
    expect(shown.getAttribute('data-tone')).toBe('error');
    expect(status()).toBe('');
    expect(marks()).toHaveLength(0);
    expect(screen.queryByRole('table', { name: 'Matches' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy regex' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('copies the regex as a literal and the matches one per line', async () => {
    render(<RegexpTool />);
    type('Pattern', 'a/b|c');
    fireEvent.click(flag('ignore case'));
    type('Test text', 'A/B c a/b');
    await until('3 matches');
    fireEvent.click(screen.getByRole('button', { name: 'Copy regex' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenLastCalledWith('/a\\/b|c/gi');
    fireEvent.click(screen.getByRole('button', { name: 'Copy matches' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenLastCalledWith('A/B\nc\na/b');
  });

  it('u and v exclude each other; the flags are said in words', () => {
    render(<RegexpTool />);
    fireEvent.click(flag('unicode'));
    fireEvent.click(flag('unicodeSets'));
    expect(flag('unicode').getAttribute('aria-pressed')).toBe('false');
    expect(flag('unicodeSets').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(flag('multiline'));
    expect(document.querySelector('[data-flags]')?.textContent).toBe('global, multiline, unicodeSets');
    fireEvent.click(flag('global'));
    fireEvent.click(flag('multiline'));
    fireEvent.click(flag('unicodeSets'));
    expect(document.querySelector('[data-flags]')?.textContent).toBe('');
  });

  it('\\p{L} without u or v: it runs, with the note', async () => {
    render(<RegexpTool />);
    type('Pattern', '\\p{L}');
    type('Test text', 'p{L} x');
    await until('1 match');
    expect(message('pattern')).toBe(TEXTS.property);
    fireEvent.click(flag('unicode'));
    expect(message('pattern')).toBe('');
    // Now a Unicode property: the letters p, L and x.
    await until('3 matches');
  });

  it('a text over 1,000,000 characters is refused next to its field; nothing runs', async () => {
    render(<RegexpTool />);
    type('Pattern', 'a');
    type('Test text', 'a'.repeat(1_000_001));
    expect(message('text')).toBe(TEXTS.textTooLong);
    await new Promise(r => setTimeout(r, 250));
    expect(workers).toHaveLength(0);
    expect(status()).toBe('');
  });

  it('over 1,000 matches: the table shows 1,000 and says so; over 10,000: the status says the first are shown', async () => {
    render(<RegexpTool />);
    type('Pattern', 'a');
    type('Test text', 'a'.repeat(1_500));
    await until('1,500 matches');
    // Built 200 rows a frame, 1,000 in the end. The wait counts rows cheaply: asking for 1,000 buttons by role and name
    // on every poll costs jsdom seconds on a loaded machine, and the wait ended before the last batches came. By role
    // once at the end.
    await waitFor(() => expect(document.querySelectorAll('button[aria-label^="Match "]')).toHaveLength(1_000), {
      timeout: 20_000,
    });
    expect(screen.getAllByRole('button', { name: /^Match \d+$/ })).toHaveLength(1_000);
    expect(message('rows')).toBe('Showing 1,000 of 1,500 matches.');
    type('Test text', 'a'.repeat(10_001));
    await waitFor(() => expect(status()).toContain('10,000+ matches (the first 10,000 are shown)'), {
      timeout: 10_000,
    });
    expect(message('rows')).toBe('Showing 1,000 of 10,000+ matches.');
  }, 60_000);

  it('builds the highlights a chunk at a time, all of them in the end', async () => {
    render(<RegexpTool />);
    type('Pattern', 'a');
    type('Test text', 'ab'.repeat(5_000));
    await until('5,000 matches');
    expect(region().textContent).toBe('ab'.repeat(5_000));
    await waitFor(() => expect(region().getAttribute('data-built')).toBe('all'), { timeout: 10_000 });
    expect(marks()).toHaveLength(5_000);
    expect(region().textContent).toBe('ab'.repeat(5_000));
  }, 30_000);

  it('an empty match is a bar with its place said; a group that did not take part is no match', async () => {
    render(<RegexpTool />);
    type('Pattern', '(a)|(b)|x*');
    type('Test text', 'ab');
    await until('3 matches');
    const empty = marks()[2]!;
    expect(empty.textContent).toBe('');
    expect(empty.getAttribute('aria-label')).toBe('Empty match at line 1, column 3');
    expect(rows('Groups')).toEqual([
      ['1', '—', '0–1', '"a"'],
      ['2', '—', '—', 'no match'],
    ]);
  });
});

describe('the RegExp tool’s history', () => {
  it('records edits as snapshots with the count, commits a copy, and opens an entry back', async () => {
    const host = memoryHost();
    const history = host.history.forOwner('regexp', definition.history!);
    const { unmount } = render(<RegexpTool host={host} />);
    type('Pattern', '\\d+');
    type('Test text', 'a1 b22');
    await until('2 matches');
    // Leaving the page writes the pending snapshot.
    unmount();
    let entries: Awaited<ReturnType<typeof history.list>>['entries'] = [];
    await waitFor(async () => {
      entries = (await history.list({})).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]).toMatchObject({ kind: 'match', label: '/\\d+/g · 2 matches' });

    const second = render(<RegexpTool host={host} />);
    type('Pattern', '(\\w)(\\d)');
    type('Test text', 'x1 y2');
    fireEvent.click(screen.getByLabelText('Replace'));
    type('Replace with', '$2$1');
    await waitFor(() => expect(field('Result').value).toBe('1x 2y'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    await waitFor(async () => {
      entries = (await history.list({ kinds: ['replace'] })).entries;
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
    expect(entries[0]!.label).toBe('/(\\w)(\\d)/g · replace · 2 matches');
    second.unmount();

    render(<RegexpTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: /(\\w)(\\d)/g · replace · 2 matches.')).toBeTruthy();
    expect(field('Pattern').value).toBe('(\\w)(\\d)');
    expect(field('Test text').value).toBe('x1 y2');
    expect(field('Replace with').value).toBe('$2$1');
    await waitFor(() => expect(field('Result').value).toBe('1x 2y'));
  });
});

describe('the RegExp tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('regexp').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('regexp').save(regexpSettings.schema, values as never);
    await host.settings!.forTool('regexp').flush();
  };
  const shownFlags = () => document.querySelector('[data-flags]')?.textContent;
  const replaceOn = () => screen.getByLabelText('Replace').getAttribute('aria-checked');

  it('saves the flags and Replace the person chose; reopened, it is as left, with no pattern or text', async () => {
    const host = memoryHost();
    const first = render(<RegexpTool host={host} />);
    type('Pattern', 'a');
    type('Test text', 'aA');
    fireEvent.click(flag('ignore case'));
    fireEvent.click(flag('multiline'));
    fireEvent.click(flag('global'));
    fireEvent.click(screen.getByLabelText('Replace'));
    type('Replace with', 'b');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { flags: 'im', replace: true } });

    render(<RegexpTool host={host} />);
    expect(shownFlags()).toBe('ignore case, multiline');
    expect(replaceOn()).toBe('true');
    expect(field('Pattern').value).toBe('');
    expect(field('Test text').value).toBe('');
    expect(field('Replace with').value).toBe('');
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { flags: 'uv', replace: true });
    render(<RegexpTool host={host} />);
    expect(shownFlags()).toBe('global');
    expect(replaceOn()).toBe('true');
    cleanup();
    await seed(host, { flags: 'mi', replace: 'yes' });
    render(<RegexpTool host={host} />);
    expect(shownFlags()).toBe('global');
    expect(replaceOn()).toBe('false');
  });

  it('a pasted literal and an opened entry show their own flags — for the visit; what is saved stays', async () => {
    const host = memoryHost();
    await seed(host, { flags: 'gi', replace: true });
    const pasted = render(<RegexpTool host={host} input="text from the start page" />);
    expect(field('Test text').value).toBe('text from the start page');
    expect(shownFlags()).toBe('global, ignore case');
    fireEvent.paste(field('Pattern'), { clipboardData: { getData: () => '/^#/my' } });
    expect(shownFlags()).toBe('multiline, sticky');
    // Keep as pasted puts back the flags shown before the paste.
    fireEvent.click(screen.getByRole('button', { name: 'Keep as pasted' }));
    expect(shownFlags()).toBe('global, ignore case');
    fireEvent.paste(field('Pattern'), { clipboardData: { getData: () => '/^#/my' } });
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { flags: 'gi', replace: true } });

    const recorder = host.history.forOwner('regexp', definition.history!).session();
    await recorder.commit(
      draft({ pattern: 'b+', flags: 'sy', text: 'abbc', replace: false, replacement: '' }, undefined, 'copy-regex'),
    );
    const [entry] = (await host.history.forOwner('regexp', definition.history!).list({})).entries;
    const opened = render(<RegexpTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(/^Opened from History/)).toBeTruthy();
    expect(shownFlags()).toBe('dotAll, sticky');
    expect(replaceOn()).toBe('false');
    expect(field('Test text').value).toBe('abbc');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { flags: 'gi', replace: true } });

    render(<RegexpTool host={host} />);
    expect(shownFlags()).toBe('global, ignore case');
    expect(replaceOn()).toBe('true');
  });

  it('reset puts the flags and Replace back to the defaults and keeps the input; the matches follow', async () => {
    const host = memoryHost();
    await seed(host, { flags: 'gi', replace: true });
    render(<RegexpTool host={host} />);
    type('Pattern', 'a');
    type('Test text', 'aA');
    await until('2 matches');
    await act(async () => host.settings!.forTool('regexp').reset());
    expect(shownFlags()).toBe('global');
    expect(replaceOn()).toBe('false');
    expect(field('Pattern').value).toBe('a');
    expect(field('Test text').value).toBe('aA');
    await until('1 match');
    expect(savedOf(host)).toBeUndefined();
  });
});
