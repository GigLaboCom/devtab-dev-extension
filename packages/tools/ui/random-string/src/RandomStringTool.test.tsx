import { definition } from './definition';
import { readEntry, readSettings } from './entries';
import { randomStringHistory } from './history';
import RandomStringTool from './RandomStringTool';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUTO_COPY, AUTO_COPY_REFUSED, memoryHost, memoryToolSettings, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RandomStringPayload } from './history';
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

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const settle = () => act(async () => undefined);
const entropy = () => document.querySelector('[data-entropy]')?.textContent ?? null;
const hint = () => document.querySelector('[data-hint]')?.textContent ?? '';
const live = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
/** The strings shown, whatever their form: one output, rows, or the field. */
const strings = (): string[] => {
  const field = screen.queryByLabelText('Generated strings');
  if (field instanceof HTMLTextAreaElement) return field.value === '' ? [] : field.value.split('\n');
  if (field) return [...field.querySelectorAll('output')].map(o => o.textContent ?? '');
  const one = screen.queryByLabelText('Generated string');
  return one ? [one.textContent ?? ''] : [];
};
const errorUnder = (id: string): string | null => {
  const input = document.getElementById(id)!;
  const describedBy = input.getAttribute('aria-describedby');
  return describedBy ? (document.getElementById(describedBy)?.textContent ?? null) : null;
};
/** Picks an option of a Select by its trigger's label (Radix renders the list in a portal). */
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};
const payloadOf = (draft: HistoryDraft) => draft.payload as unknown as RandomStringPayload;

/** A host whose history records every call, with a status the test sets — the factory's sealing is not this tool's. */
const spyHost = (initial: Partial<RecordingStatus> = {}) => {
  const status: RecordingStatus = { gate: 'on', secrets: 'unlocked', declared: true, ...initial };
  const changes: HistoryDraft[] = [];
  const commits: HistoryDraft[] = [];
  const opened = new Map<string, OpenedEntry>();
  const history: ToolHistory = {
    owner: 'random-string',
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
const entry = (payload: unknown, blobs: Record<string, Blob>, label?: string): OpenedEntry => ({
  ok: true,
  entry: {
    id: 'e1',
    owner: 'random-string',
    kind: 'generated',
    session: 's',
    time: 0,
    schema: 1,
    encrypted: true,
    bytes: 1,
  },
  ...(label ? { label } : {}),
  payload: payload as HistoryDraft['payload'],
  blobs,
});

describe('the Random String tool’s definition', () => {
  it('describes the tool, has no detect (§7) and no shortcut, declares one secret kind and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'random-string',
      title: 'Random String',
      summary: 'Random strings and bytes for tokens, keys and test data.',
      order: 29,
      output: { origin: 'generated', copies: 'lines' },
    });
    expect(definition.keywords).toEqual([
      'random',
      'string',
      'token',
      'secret',
      'key',
      'hex',
      'bytes',
      'nonce',
      'salt',
      'alphanumeric',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), 'detect.ts'))).toBe(false);
    expect(definition.history?.kinds).toEqual([{ id: 'generated', title: 'Generated', secret: true }]);
    expect(definition.history?.maxBlobBytes).toBe(1_048_576);
    expect((await definition.load()).default).toBe(RandomStringTool);
  });
});

describe('the Random String tool, rendered with no host (§2, §6, §8)', () => {
  it('opens with 10 strings of 32 Letters and digits, each a row with its copy button, and 190 bits', () => {
    render(<RandomStringTool />);
    const shown = strings();
    expect(shown).toHaveLength(10);
    for (const s of shown) expect(s).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(new Set(shown).size).toBe(10);
    expect(entropy()).toBe('190 bits of entropy per string');
    const rows = document.querySelectorAll('[data-slot="result-row"]');
    expect(rows).toHaveLength(10);
    expect(within(rows[2] as HTMLElement).getByRole('button', { name: 'Copy string 3' })).toBeTruthy();
    expect(button('Copy all')).toBeTruthy();
    expect(button('Generate').disabled).toBe(false);
    expect((screen.getByRole('radio', { name: 'Characters' }) as HTMLElement).getAttribute('aria-checked')).toBe(
      'true',
    );
    // Opening announces nothing: only a new batch the person asked for or set up.
    expect(live()).toBe('');
    expect(hint()).toBe(
      "Made in this tab with the browser's cryptographic random generator. Generated strings are not kept (no master password).",
    );
  });

  it('Copy all copies the batch as shown — one per line, no line break at the end; a row copies its string', async () => {
    render(<RandomStringTool />);
    const shown = strings();
    fireEvent.click(button('Copy all'));
    await settle();
    expect(writeText.mock.calls).toEqual([[shown.join('\n')]]);
    expect(button('Copied').textContent).toBe('Copied');
    fireEvent.click(button('Copy string 4'));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(shown[3]);
  });

  it('scenario 1: Bytes, 32, Hex (lowercase), one string — 64 hex digits, 256 bits, Copy', async () => {
    render(<RandomStringTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    type('How many', '1');
    const [hex] = strings();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(entropy()).toBe('256 bits of entropy per string');
    expect(screen.getByLabelText('Generated string')).toBeTruthy();
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText.mock.calls).toEqual([[hex]]);
  });

  it('scenario 2: the same 32 bytes in Base64 — 44 characters ending in "="; Base64url — 43, no "="', async () => {
    render(<RandomStringTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    type('How many', '1');
    await choose('Encoding', 'Base64');
    expect(strings()[0]).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    await choose('Encoding', 'Base64url');
    expect(strings()[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await choose('Encoding', 'Hex (uppercase)');
    expect(strings()[0]).toMatch(/^[0-9A-F]{64}$/);
  });

  it('scenario 3: 1,000 identifiers of 12 a–z0–9 — one field, Copy all copies it whole', async () => {
    render(<RandomStringTool />);
    await choose('Alphabet', 'Lowercase letters and digits');
    type('Length', '12');
    type('How many', '1000');
    const field = screen.getByLabelText('Generated strings') as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.getAttribute('spellcheck')).toBe('false');
    const lines = field.value.split('\n');
    expect(lines).toHaveLength(1000);
    for (const line of lines) expect(line).toMatch(/^[a-z0-9]{12}$/);
    expect(field.value.endsWith('\n')).toBe(false);
    fireEvent.click(button('Copy all'));
    await settle();
    expect(writeText.mock.calls).toEqual([[field.value]]);
  });

  it('scenario 4: Crockford Base32, length 8 — no I, L, O, U', async () => {
    render(<RandomStringTool />);
    await choose('Alphabet', 'Crockford Base32');
    type('Length', '8');
    for (const s of strings()) expect(s).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(entropy()).toBe('40 bits of entropy per string');
  });

  it('scenario 5: Custom "ACGT", length 16 — DNA strings, 32 bits', async () => {
    render(<RandomStringTool />);
    await choose('Alphabet', 'Custom');
    const custom = screen.getByLabelText('Custom alphabet') as HTMLInputElement;
    expect(custom.placeholder).toBe('e.g. ACGT');
    expect(custom.getAttribute('spellcheck')).toBe('false');
    expect(custom.getAttribute('autocomplete')).toBe('off');
    // Custom and an empty field: the message, nothing shown.
    expect(errorUnder('random-string-custom')).toBe('Type the characters to use.');
    expect(strings()).toEqual([]);
    type('Custom alphabet', 'ACGT');
    type('Length', '16');
    for (const s of strings()) expect(s).toMatch(/^[ACGT]{16}$/);
    expect(entropy()).toBe('32 bits of entropy per string');
  });

  it('scenario 6: Custom "aa" — the message under the field, no result, the buttons off', async () => {
    render(<RandomStringTool />);
    await choose('Alphabet', 'Custom');
    type('Custom alphabet', 'aa');
    expect(errorUnder('random-string-custom')).toBe('The alphabet needs at least 2 different characters.');
    // It changes while typing: read out politely, not as an alert.
    expect(screen.getByText('The alphabet needs at least 2 different characters.').getAttribute('role')).toBe('status');
    expect(strings()).toEqual([]);
    expect(entropy()).toBeNull();
    expect(button('Generate').disabled).toBe(true);
    expect(button('Copy all').disabled).toBe(true);
    type('Custom alphabet', 'a b');
    expect(errorUnder('random-string-custom')).toBe('Remove spaces and line breaks from the alphabet.');
    type('Custom alphabet', '🙂x');
    type('Length', '4');
    for (const s of strings()) expect(s).toMatch(/^(?:🙂|x){4}$/u);
  });

  it('scenario 7: Length 1,000 × How many 10,000 — too much at once, under How many', () => {
    render(<RandomStringTool />);
    type('Length', '1000');
    type('How many', '10000');
    expect(errorUnder('random-string-count')).toBe('Too much at once: length × how many must be at most 1,000,000.');
    expect(strings()).toEqual([]);
    expect(button('Generate').disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    type('Bytes', '1000');
    expect(errorUnder('random-string-count')).toBe('Too much at once: bytes × how many must be at most 1,000,000.');
  });

  it('§6: Length, Bytes and How many out of range — each message under its field', () => {
    render(<RandomStringTool />);
    for (const value of ['', '0', '1025', '2.5']) {
      type('Length', value);
      expect(errorUnder('random-string-length')).toBe('Length must be a whole number from 1 to 1,024.');
      expect(strings()).toEqual([]);
    }
    type('Length', '32');
    for (const value of ['', '0', '10001']) {
      type('How many', value);
      expect(errorUnder('random-string-count')).toBe('How many must be a whole number from 1 to 10,000.');
    }
    type('How many', '10');
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    for (const value of ['', '0', '1025']) {
      type('Bytes', value);
      expect(errorUnder('random-string-bytes')).toBe('Bytes must be a whole number from 1 to 1,024.');
    }
    const input = screen.getByLabelText('Bytes') as HTMLInputElement;
    expect([input.type, input.min, input.max, input.step]).toEqual(['number', '1', '1024', '1']);
  });

  it('every change of a setting makes a new batch at once, and says so; Generate makes a new one with the same settings', () => {
    render(<RandomStringTool />);
    const first = strings();
    type('Length', '16');
    const second = strings();
    expect(second.every(s => s.length === 16)).toBe(true);
    expect(live()).toBe('10 strings generated');
    fireEvent.click(button('Generate'));
    const third = strings();
    expect(third).toHaveLength(10);
    expect(third.every(s => s.length === 16)).toBe(true);
    expect(third).not.toEqual(second);
    expect(first).not.toEqual(second);
    type('How many', '1');
    expect(live()).toBe('1 string generated');
  });

  it('up to 20 strings are rows, 21 and more one field; one string is Copy, more Copy all', () => {
    render(<RandomStringTool />);
    type('How many', '20');
    expect(document.querySelectorAll('[data-slot="result-row"]')).toHaveLength(20);
    expect(screen.getByLabelText('Generated strings').tagName).toBe('DIV');
    type('How many', '21');
    expect(document.querySelectorAll('[data-slot="result-row"]')).toHaveLength(0);
    expect(screen.getByLabelText('Generated strings').tagName).toBe('TEXTAREA');
    expect(strings()).toHaveLength(21);
    type('How many', '1');
    expect(button('Copy')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy all' })).toBeNull();
  });

  // The waits below are for the batch, not a bound on its time: on a loaded machine making 101,000 characters alone can
  // take more than a second (`scripts/bench-tools.mjs --only=random-string`).
  it(
    '§12: a batch over 100,000 characters is made 300 ms after the last change, Generate saying Generating…',
    { timeout: 30_000 },
    async () => {
      render(<RandomStringTool />);
      type('How many', '1000');
      type('Length', '101');
      expect(button('Generating…').disabled).toBe(true);
      expect(button('Copy all').disabled).toBe(true);
      // Until then the batch shown is the last one made (32 characters), and it cannot be copied.
      expect(strings()[0]).toHaveLength(32);
      await waitFor(() => expect(strings()[0]).toHaveLength(101), { timeout: 10_000 });
      expect(strings()).toHaveLength(1000);
      expect(strings().every(s => s.length === 101)).toBe(true);
      expect(button('Generate').disabled).toBe(false);
      // Generate of a large batch: the label first, then the batch.
      const before = strings();
      fireEvent.click(button('Generate'));
      expect(screen.getByRole('button', { name: 'Generating…' })).toBeTruthy();
      await waitFor(() => expect(strings()).not.toEqual(before), { timeout: 10_000 });
      expect(live()).toBe('1,000 strings generated');
    },
  );

  it('the source failing — the message of §6, nothing shown', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new DOMException('no', 'OperationError');
    });
    render(<RandomStringTool />);
    expect(screen.getByText('Could not get random numbers from the browser.')).toBeTruthy();
    expect(strings()).toEqual([]);
    spy.mockRestore();
  });
});

describe('the Random String tool’s history (D17)', () => {
  it('with no master password nothing is recorded (the in-memory host)', async () => {
    const host = memoryHost();
    render(<RandomStringTool host={host} />);
    type('Length', '20');
    fireEvent.click(button('Generate'));
    fireEvent.click(button('Copy all'));
    await settle();
    const history = host.history.forOwner('random-string', randomStringHistory);
    expect(history.status().secrets).toBe('no-password');
    expect((await history.list()).entries).toEqual([]);
  });

  it('records nothing on opening; a change of settings is a change, Generate and every copy are commits', async () => {
    const { host, changes, commits } = spyHost();
    render(<RandomStringTool host={host} />);
    expect(changes).toHaveLength(0);
    expect(commits).toHaveLength(0);

    type('Length', '12');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'generated',
      label: '10 strings · 12 characters · Letters and digits · 71 bits',
    });
    expect(payloadOf(changes[0]!).settings).toEqual({
      mode: 'chars',
      preset: 'alnum',
      custom: '',
      length: 12,
      count: 10,
    });
    expect(await changes[0]!.blobs!.strings!.text()).toBe(strings().join('\n'));

    type('Length', '2000');
    expect(changes).toHaveLength(1); // an invalid setting shows nothing and records nothing

    type('Length', '16');
    fireEvent.click(button('Generate'));
    expect(commits).toHaveLength(1);
    const shown = strings();
    expect(await commits[0]!.blobs!.strings!.text()).toBe(shown.join('\n'));
    for (const s of shown) expect(commits[0]!.label).not.toContain(s);

    fireEvent.click(button('Copy all'));
    await settle();
    fireEvent.click(button('Copy string 2'));
    await settle();
    expect(commits).toHaveLength(3);
    expect(commits[2]!.payload).toEqual(commits[0]!.payload);
  });

  it('Bytes: the raw bytes are recorded, not their writing', async () => {
    const { host, commits } = spyHost();
    render(<RandomStringTool host={host} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    type('How many', '2');
    fireEvent.click(button('Generate'));
    expect(commits[0]!.label).toBe('2 strings · 32 bytes · Hex (lowercase) · 256 bits');
    const raw = new Uint8Array(await commits[0]!.blobs!.bytes!.arrayBuffer());
    expect(raw).toHaveLength(64);
    const hex = [...raw].map(b => b.toString(16).padStart(2, '0')).join('');
    expect(strings()).toEqual([hex.slice(0, 64), hex.slice(64)]);
  });

  it('says what the history does with the strings now', () => {
    const kept = spyHost({ secrets: 'unlocked' });
    const { unmount } = render(<RandomStringTool host={kept.host} />);
    expect(hint()).toContain('Generated strings are kept encrypted in this browser.');
    unmount();
    render(<RandomStringTool host={spyHost({ secrets: 'locked' }).host} />);
    expect(hint()).toContain('Generated strings are not kept while the history is locked.');
    cleanup();
    render(<RandomStringTool host={spyHost({ gate: 'off' }).host} />);
    expect(hint()).toContain('Generated strings are not kept (history is off).');
  });

  it('with a master password, unlocked: Generate keeps one encrypted entry, nothing in clear; it opens back; locked: not opened', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<RandomStringTool host={host} />);
    expect(hint()).toContain('Generated strings are kept encrypted in this browser.');
    await choose('Alphabet', 'Custom');
    type('Custom alphabet', 'ACGT🙂');
    type('Length', '24');
    fireEvent.click(button('Generate'));
    const shown = strings();
    const history = host.history.forOwner('random-string', randomStringHistory);
    await waitFor(async () => expect((await history.list()).entries).toHaveLength(1));
    // Copy is the same batch again: not recorded twice.
    fireEvent.click(button('Copy all'));
    await settle();
    unmount();
    await settle();
    const [kept] = (await history.list()).entries;
    expect(kept!.encrypted).toBe(true);
    expect(kept!.label).toBeUndefined();
    // Nothing of the strings, the label or the settings in clear in the store — rows or blobs.
    const rows: string[] = [];
    const blobs: string[] = [];
    for await (const row of host.store.scan({})) {
      rows.push(JSON.stringify(row));
      for (const ref of JSON.parse(row.line).blobs ?? []) {
        const data = await host.store.blob(ref.hash);
        blobs.push(new TextDecoder('latin1').decode(await data!.data.arrayBuffer()));
      }
    }
    expect(rows).toHaveLength(1);
    expect(blobs).toHaveLength(1);
    const raw = rows.join('') + blobs.join('');
    for (const s of shown) expect(raw).not.toContain(s.slice(0, 12));
    expect(raw).not.toContain('ACGT');
    expect(raw).not.toContain('Custom alphabet');

    const view = render(<RandomStringTool host={host} restore={{ id: kept!.id }} />);
    expect(
      await screen.findByText('Opened from History: 10 strings · 24 characters · Custom alphabet · 55 bits.'),
    ).toBeTruthy();
    expect(strings()).toEqual(shown);
    expect((screen.getByLabelText('Custom alphabet') as HTMLInputElement).value).toBe('ACGT🙂');
    expect((screen.getByLabelText('Length') as HTMLInputElement).value).toBe('24');
    expect(entropy()).toBe('55 bits of entropy per string');
    view.unmount();

    await host.vault.lock();
    render(<RandomStringTool host={host} restore={{ id: kept!.id }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
    expect(strings()).not.toEqual(shown);
    expect(hint()).toContain('Generated strings are not kept while the history is locked.');
  });

  it('an entry of Bytes opens back as the same bytes in its encoding', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<RandomStringTool host={host} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    await choose('Encoding', 'Base64');
    type('How many', '3');
    fireEvent.click(button('Generate'));
    const shown = strings();
    const history = host.history.forOwner('random-string', randomStringHistory);
    await waitFor(async () => expect((await history.list()).entries).toHaveLength(1));
    unmount();
    await settle();
    const [kept] = (await history.list()).entries;
    render(<RandomStringTool host={host} restore={{ id: kept!.id }} />);
    expect(await screen.findByText('Opened from History: 3 strings · 32 bytes · Base64 · 256 bits.')).toBeTruthy();
    expect(strings()).toEqual(shown);
    expect((screen.getByRole('radio', { name: 'Bytes' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
  });

  it('opening an entry records nothing; one that is not this tool’s payload could not be opened', async () => {
    const { host, opened, changes, commits } = spyHost();
    opened.set(
      'e1',
      entry(
        { settings: { mode: 'chars', preset: 'hex', custom: '', length: 4, count: 2 } },
        { strings: new Blob(['00af\nbeef']) },
        '2 strings · 4 characters · Hex, lowercase · 16 bits',
      ),
    );
    opened.set(
      'e2',
      entry(
        { settings: { mode: 'chars', preset: 'hex', custom: '', length: 4, count: 2 } },
        {
          strings: new Blob(['00af\nBEEF']),
        },
      ),
    );
    opened.set('e3', entry({ settings: { mode: 'words' } }, {}));
    const { unmount } = render(<RandomStringTool host={host} restore={{ id: 'e1' }} />);
    expect(
      await screen.findByText('Opened from History: 2 strings · 4 characters · Hex, lowercase · 16 bits.'),
    ).toBeTruthy();
    expect(strings()).toEqual(['00af', 'beef']);
    expect(changes).toHaveLength(0);
    expect(commits).toHaveLength(0);
    unmount();
    for (const id of ['e2', 'e3']) {
      const view = render(<RandomStringTool host={host} restore={{ id }} />);
      expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
      view.unmount();
    }
  });

  it('reads back only a payload of schema 1', async () => {
    expect(readSettings(null)).toBeNull();
    expect(readSettings({ settings: { mode: 'chars', preset: 'nope', custom: '', length: 1, count: 1 } })).toBeNull();
    expect(readSettings({ settings: { mode: 'bytes', bytes: 2, encoding: 'base32', count: 1 } })).toBeNull();
    expect(readSettings({ settings: { mode: 'bytes', bytes: 2, encoding: 'HEX', count: 1 } })).toEqual({
      mode: 'bytes',
      bytes: 2,
      encoding: 'HEX',
      count: 1,
    });
    const opened = entry(
      { settings: { mode: 'bytes', bytes: 2, encoding: 'HEX', count: 1 } },
      {
        bytes: new Blob([new Uint8Array([1, 2, 3])]),
      },
    );
    expect(opened.ok && (await readEntry(opened))).toBeNull();
  });
});

/** The spy host with "Copy automatically after generating" switched on for this tool (or not). */
const autoCopyHost = async (on: boolean) => {
  const spy = spyHost();
  const settings = memoryToolSettings();
  await settings.setForAll(['random-string', 'password', 'uuid'], { [AUTO_COPY]: on });
  return { ...spy, host: { ...spy.host, settings } satisfies ToolHost, settings };
};

describe('Copy automatically after generating (docs/tools/copying.md)', () => {
  it('off (the default): Generate copies nothing', async () => {
    render(<RandomStringTool host={(await autoCopyHost(false)).host} />);
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(live()).toBe('10 strings generated');
    expect(button('Copy all').textContent).toBe('Copy all');
  });

  it('on: opening and a change of the settings copy nothing; Generate copies the batch once, recorded once', async () => {
    const { host, commits } = await autoCopyHost(true);
    render(<RandomStringTool host={host} />);
    await settle();
    type('Length', '24');
    fireEvent.click(screen.getByRole('radio', { name: 'Bytes' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Characters' }));
    await settle();
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.click(button('Generate'));
    await settle();
    const shown = strings();
    expect(writeText.mock.calls).toEqual([[shown.join('\n')]]);
    expect(shown.join('\n').endsWith('\n')).toBe(false);
    expect(shown.every(s => s.length === 24)).toBe(true);
    // The button's own "Copied", and one sentence for the screen reader (never a string).
    expect(button('Copied').textContent).toBe('Copied');
    expect(live()).toBe('10 strings generated and copied');
    for (const s of shown) expect(live()).not.toContain(s);
    expect(screen.queryByText(AUTO_COPY_REFUSED)).toBeNull();
    // Generate is the commit; the automatic copy is not a second one.
    expect(commits).toHaveLength(1);
  });

  it('on, one string: Generate copies it, the button is Copy → Copied', async () => {
    render(<RandomStringTool host={(await autoCopyHost(true)).host} />);
    type('How many', '1');
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText.mock.calls).toEqual([[strings()[0]]]);
    expect(button('Copied')).toBeTruthy();
    expect(live()).toBe('1 string generated and copied');
  });

  it('on, a large batch in the field: Generate copies what Copy all copies — the field whole', async () => {
    render(<RandomStringTool host={(await autoCopyHost(true)).host} />);
    type('How many', '500');
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(button('Generate'));
    await settle();
    const field = screen.getByLabelText('Generated strings') as HTMLTextAreaElement;
    expect(writeText.mock.calls).toEqual([[field.value]]);
    expect(field.value.split('\n')).toHaveLength(500);
    expect(live()).toBe('500 strings generated and copied');
  });

  it('on, the browser refuses: one line says so, the copy button still works', async () => {
    render(<RandomStringTool host={(await autoCopyHost(true)).host} />);
    writeText.mockImplementationOnce(() =>
      Promise.reject(
        new DOMException("Failed to execute 'writeText' on 'Clipboard': Document is not focused.", 'NotAllowedError'),
      ),
    );
    fireEvent.click(button('Generate'));
    await settle();
    const line = screen.getByText(AUTO_COPY_REFUSED);
    expect(line.getAttribute('role')).toBeNull();
    expect(live()).toBe('10 strings generated, not copied automatically');
    expect(button('Copy all').textContent).toBe('Copy all');
    fireEvent.click(button('Copy all'));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(strings().join('\n'));
    expect(button('Copied')).toBeTruthy();
    // A new batch: the refusal was about the old one.
    type('Length', '30');
    expect(screen.queryByText(AUTO_COPY_REFUSED)).toBeNull();
  });

  it('on: opening an entry from History copies nothing', async () => {
    const { host, opened } = await autoCopyHost(true);
    opened.set(
      'e1',
      entry(
        { settings: { mode: 'bytes', bytes: 2, encoding: 'hex', count: 1 } },
        { bytes: new Blob([new Uint8Array([0xbe, 0xef])]) },
        'String · 2 bytes · Hex (lowercase) · 16 bits',
      ),
    );
    render(<RandomStringTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('Opened from History: String · 2 bytes · Hex (lowercase) · 16 bits.')).toBeTruthy();
    await settle();
    expect(strings()).toEqual(['beef']);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('follows the switch live: turned on while the tool is open, the next Generate copies', async () => {
    const { host, settings } = await autoCopyHost(false);
    render(<RandomStringTool host={host} />);
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    await act(() => settings.setForAll(['random-string'], { [AUTO_COPY]: true }));
    fireEvent.click(button('Generate'));
    await settle();
    expect(writeText.mock.calls).toEqual([[strings().join('\n')]]);
  });
});

describe('the Random String tool’s sources (§5.1, §5.6)', () => {
  it('use no Math.random, no console and no debug logger', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(root).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBe(4);
    for (const file of files)
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/Math\.random|console\.|createDebug/);
  });
});
