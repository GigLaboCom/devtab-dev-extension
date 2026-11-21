import { definition } from './definition';
import PasswordTool from './PasswordTool';
import { readPayload } from './payload';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_SYMBOLS, LOOK_ALIKE } from '@workspace/tool-logic-password';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PasswordPayload } from './history';
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
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

const STRENGTH_DEFAULT = '130 bits of entropy (20 characters from a set of 94, at least one of each chosen set)';
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const output = (n?: number) =>
  screen.getByLabelText(n === undefined ? 'Generated password' : `Generated password ${n}`);
const password = (n?: number) => output(n).textContent ?? '';
const strengthText = () => document.querySelector('[data-strength]')?.textContent ?? null;
const hint = () => document.querySelector('[data-hint]')?.textContent ?? '';
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const settle = () => act(async () => undefined);
const payloadOf = (draft: HistoryDraft) => draft.payload as unknown as PasswordPayload;

/** A host whose history records every call, with a status the test sets — the factory's sealing is not this tool's. */
const spyHost = (initial: Partial<RecordingStatus> = {}) => {
  const status: RecordingStatus = { gate: 'on', secrets: 'unlocked', declared: true, ...initial };
  const changes: HistoryDraft[] = [];
  const commits: HistoryDraft[] = [];
  const opened = new Map<string, OpenedEntry>();
  const history: ToolHistory = {
    owner: 'password',
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

describe('the Password Generator’s definition', () => {
  it('describes the tool, has no detect (§7), declares one secret kind and loads its component', async () => {
    expect(definition).toMatchObject({ id: 'password', title: 'Password Generator', order: 7 });
    expect(definition.summary).not.toMatch(/Nothing is stored/);
    expect(definition.detect).toBeUndefined();
    expect(definition.history?.kinds).toEqual([{ id: 'generated', title: 'Generated', secret: true }]);
    expect((await definition.load()).default).toBe(PasswordTool);
  });
});

describe('the Password Generator, rendered with no host (§2, §8)', () => {
  it('scenario 1: opens with a password of 20 characters of all four sets, its strength, and copies it', async () => {
    render(<PasswordTool />);
    const p = password();
    expect(p).toHaveLength(20);
    expect(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)).toBe(true);
    expect(output().tagName).toBe('OUTPUT');
    expect(strengthText()).toBe(STRENGTH_DEFAULT);
    expect(
      screen.getByText(
        'Entropy of these settings, not of a single password: someone who knows the settings needs up to 2^130 guesses.',
      ),
    ).toBeTruthy();
    fireEvent.click(button('Copy'));
    await settle();
    expect(writeText).toHaveBeenCalledWith(p);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('scenario 2: Symbols "-_!@" — a new password at once, 120 bits', () => {
    render(<PasswordTool />);
    const before = password();
    type('Symbols to use', '-_!@');
    const p = password();
    expect(p).not.toBe(before);
    expect(p).toMatch(/^[A-Za-z0-9\-_!@]{20}$/);
    expect(strengthText()).toBe(
      '120 bits of entropy (20 characters from a set of 66, at least one of each chosen set)',
    );
    fireEvent.click(button('Reset'));
    expect((screen.getByLabelText('Symbols to use') as HTMLInputElement).value).toBe(DEFAULT_SYMBOLS);
    expect(strengthText()).toBe(STRENGTH_DEFAULT);
  });

  it('scenario 3: Avoid look-alike characters — none of 0 O 1 I l |, 128 bits', () => {
    render(<PasswordTool />);
    fireEvent.click(screen.getByLabelText('Avoid look-alike characters (0 O 1 I l |)'));
    expect([...password()].some(c => LOOK_ALIKE.includes(c))).toBe(false);
    expect(strengthText()).toMatch(/^128 bits of entropy \(20 characters from a set of 88, /);
  });

  it('scenario 4: Words — six words through "-", then capitalized with spaces', async () => {
    render(<PasswordTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Words' }));
    await waitFor(() => expect(strengthText()).toBe('77 bits of entropy (6 words from a list of 7,776)'));
    expect(screen.getByText('Word list: EFF Large Wordlist (CC BY).')).toBeTruthy();
    expect(password()).toMatch(/^[a-z]+(-[a-z]+){5,9}$/);
    fireEvent.click(screen.getByLabelText('Capitalize words'));
    fireEvent.keyDown(screen.getByLabelText('Separator'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Space' }));
    await waitFor(() => expect(password()).toMatch(/^[A-Z][a-z-]+( [A-Z][a-z-]+){5}$/));
    expect(strengthText()).toBe('77 bits of entropy (6 words from a list of 7,776)');
    // Back to characters: the character options and a 20-character password again.
    fireEvent.click(screen.getByRole('radio', { name: 'Random characters' }));
    expect(password()).toHaveLength(20);
  });

  it('scenario 5: a PIN — Digits only, length 6, 19 bits; the last chosen set cannot be turned off', () => {
    render(<PasswordTool />);
    for (const name of ['Uppercase (A–Z)', 'Lowercase (a–z)', 'Symbols']) fireEvent.click(screen.getByLabelText(name));
    type('Length', '6');
    expect(password()).toMatch(/^\d{6}$/);
    expect(strengthText()).toBe('19 bits of entropy (6 characters from a set of 10)');
    expect((screen.getByLabelText('Digits (0–9)') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Symbols to use') as HTMLInputElement).disabled).toBe(true);
  });

  it('scenario 6: How many 5 — five passwords, each with its copy button, and Copy all', async () => {
    render(<PasswordTool />);
    type('How many', '5');
    const values = [1, 2, 3, 4, 5].map(password);
    expect(values.every(v => v.length === 20)).toBe(true);
    expect(new Set(values).size).toBe(5);
    fireEvent.click(button('Copy password 3'));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(values[2]);
    fireEvent.click(button('Copy all'));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(values.join('\n'));
    expect(screen.getByText('5 new passwords generated')).toBeTruthy();
  });

  it('scenario 7: Length 200 — the message under the field, no password, Generate and Copy off', () => {
    render(<PasswordTool />);
    type('Length', '200');
    const message = screen.getByText('Length must be a whole number from 4 to 128.');
    expect(screen.getByLabelText('Length').getAttribute('aria-describedby')).toBe(message.id);
    expect(screen.getByLabelText('Length').getAttribute('aria-invalid')).toBe('true');
    expect(password()).toBe('');
    expect(strengthText()).toBeNull();
    expect(button('Generate').disabled).toBe(true);
    expect(button('Copy').disabled).toBe(true);
    type('Length', '20');
    expect(password()).toHaveLength(20);
    expect(button('Generate').disabled).toBe(false);
  });

  it('§6: every invalid field at once, each message under its field', () => {
    render(<PasswordTool />);
    type('Length', '');
    type('How many', '21');
    type('Symbols to use', 'é!');
    expect(screen.getByText('Length must be a whole number from 4 to 128.')).toBeTruthy();
    expect(screen.getByText('How many must be a whole number from 1 to 20.')).toBeTruthy();
    expect(screen.getByText('Only ASCII punctuation can be used here. Remove "é".')).toBeTruthy();
    expect(screen.getByLabelText('Symbols to use').getAttribute('aria-describedby')).toBe('password-symbols-error');
    expect(button('Generate').disabled).toBe(true);
    expect(button('Copy all').disabled).toBe(true);
  });

  it('§6: the Symbols field — empty, a space, look-alikes only', () => {
    render(<PasswordTool />);
    type('Symbols to use', '');
    expect(screen.getByText('Add at least one symbol or turn Symbols off.')).toBeTruthy();
    type('Symbols to use', ' ');
    expect(screen.getByText('Only ASCII punctuation can be used here. Remove " ".')).toBeTruthy();
    type('Symbols to use', '|');
    fireEvent.click(screen.getByLabelText('Avoid look-alike characters (0 O 1 I l |)'));
    expect(
      screen.getByText('All symbols are excluded as look-alikes. Add others or turn Avoid look-alike characters off.'),
    ).toBeTruthy();
    type('Symbols to use', '!!!@');
    expect(password()).toMatch(/^[A-Za-z0-9!@]{20}$/);
  });

  it('§6: Words 2 and the word options', async () => {
    render(<PasswordTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Words' }));
    await waitFor(() => expect(strengthText()).not.toBeNull());
    type('Words', '2');
    expect(screen.getByText('Words must be a whole number from 3 to 20.')).toBeTruthy();
    expect(password()).toBe('');
    type('Words', '4');
    expect(strengthText()).toBe('51 bits of entropy (4 words from a list of 7,776)');
  });

  it('Generate makes a new set with the same settings and says so without the password', () => {
    render(<PasswordTool />);
    const first = password();
    fireEvent.click(button('Generate'));
    const second = password();
    expect(second).not.toBe(first);
    expect(second).toHaveLength(20);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('New password generated');
    expect(live?.textContent).not.toContain(second);
  });

  it('says the passwords are not kept without a master password (D17)', () => {
    render(<PasswordTool />);
    expect(hint()).toBe(
      "Passwords are made in this tab with the browser's cryptographic random generator. They are not sent anywhere. Generated passwords are not kept (no master password). Copied passwords stay in the clipboard until you copy something else.",
    );
  });
});

describe('the Password Generator’s history (D17)', () => {
  it('with no master password a Generate records nothing (the in-memory host)', async () => {
    const host = memoryHost();
    render(<PasswordTool host={host} />);
    fireEvent.click(button('Generate'));
    fireEvent.click(button('Copy'));
    await settle();
    const history = host.history.forOwner('password', definition.history!);
    expect(history.status().secrets).toBe('no-password');
    expect((await history.list()).entries).toEqual([]);
  });

  it('records nothing on opening; a change of settings is a change, Generate and Copy are commits', async () => {
    const { host, changes, commits } = spyHost();
    render(<PasswordTool host={host} />);
    expect(changes).toHaveLength(0);
    expect(commits).toHaveLength(0);

    type('Length', '12');
    expect(changes).toHaveLength(1);
    const changed = payloadOf(changes[0]!);
    expect(changes[0]).toMatchObject({ kind: 'generated', label: 'Password · 12 characters · 78 bits' });
    expect(changed.settings).toMatchObject({ mode: 'chars', count: 1, chars: { length: 12 } });
    expect(changed.values).toEqual([password()]);

    type('Length', '200');
    expect(changes).toHaveLength(1); // an invalid setting shows no password and records nothing

    type('Length', '16');
    fireEvent.click(button('Generate'));
    expect(commits).toHaveLength(1);
    expect(payloadOf(commits[0]!).values).toEqual([password()]);
    expect(commits[0]!.label).not.toContain(password());

    fireEvent.click(button('Copy'));
    await settle();
    expect(commits).toHaveLength(2);
    expect(commits[1]!.payload).toEqual(commits[0]!.payload);
  });

  it('says what the history does with the passwords now', () => {
    const kept = spyHost({ secrets: 'unlocked' });
    const { unmount } = render(<PasswordTool host={kept.host} />);
    expect(hint()).toContain('Generated passwords are kept encrypted in this browser.');
    unmount();
    render(<PasswordTool host={spyHost({ secrets: 'locked' }).host} />);
    expect(hint()).toContain('Generated passwords are not kept while the history is locked.');
    cleanup();
    render(<PasswordTool host={spyHost({ gate: 'off' }).host} />);
    expect(hint()).toContain('Generated passwords are not kept (history is off).');
  });

  it('opens an entry back: its settings and its passwords as they were, recording nothing', async () => {
    const { host, opened, changes, commits } = spyHost();
    const payload: PasswordPayload = {
      settings: { mode: 'words', count: 2, words: { words: 4, separator: '.', capitalize: true } },
      values: ['Abacus.Zoom.Yo-yo.Woven', 'Turtle.Retool.Spelling.Manliness'],
    };
    opened.set('e1', {
      ok: true,
      entry: {
        id: 'e1',
        owner: 'password',
        kind: 'generated',
        session: 's',
        time: 0,
        schema: 1,
        encrypted: true,
        bytes: 1,
      },
      label: '2 passphrases · 4 words · 51 bits',
      payload: payload as unknown as HistoryDraft['payload'],
      blobs: {},
    });
    render(<PasswordTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('Opened from History: 2 passphrases · 4 words · 51 bits.')).toBeTruthy();
    expect(password(1)).toBe('Abacus.Zoom.Yo-yo.Woven');
    expect(password(2)).toBe('Turtle.Retool.Spelling.Manliness');
    expect((screen.getByLabelText('Words') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('How many') as HTMLInputElement).value).toBe('2');
    expect(screen.getByLabelText('Capitalize words').getAttribute('data-state')).toBe('checked');
    expect(strengthText()).toBe('51 bits of entropy (4 words from a list of 7,776)');
    expect(changes).toHaveLength(0);
    expect(commits).toHaveLength(0);
  });

  it('an encrypted entry while the history is locked: says so', async () => {
    const { host, opened } = spyHost({ secrets: 'locked' });
    opened.set('e2', { ok: false, reason: 'locked' });
    render(<PasswordTool host={host} restore={{ id: 'e2' }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
    expect(password()).toHaveLength(20);
  });

  it('an entry that is not this tool’s payload: could not be opened', async () => {
    const { host, opened } = spyHost();
    opened.set('e3', {
      ok: true,
      entry: {
        id: 'e3',
        owner: 'password',
        kind: 'generated',
        session: 's',
        time: 0,
        schema: 1,
        encrypted: true,
        bytes: 1,
      },
      payload: { settings: { mode: 'chars' }, values: 'x' },
      blobs: {},
    });
    render(<PasswordTool host={host} restore={{ id: 'e3' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });

  it('reads back only a payload of schema 1', () => {
    expect(readPayload(null)).toBeNull();
    expect(
      readPayload({ settings: { mode: 'words', count: 1, words: { words: 6, separator: '+' } }, values: [] }),
    ).toBeNull();
    expect(
      readPayload({
        settings: {
          mode: 'chars',
          count: 1,
          chars: { length: 8, symbols: '!', sets: { upper: true, lower: true, digits: true, symbols: true } },
        },
        values: ['a'],
      }),
    ).toEqual({
      settings: {
        mode: 'chars',
        count: 1,
        chars: {
          length: 8,
          symbols: '!',
          sets: { upper: true, lower: true, digits: true, symbols: true },
          avoidLookAlike: false,
        },
      },
      values: ['a'],
    });
  });
});

describe('the Password Generator’s sources (§5.1, §5.7)', () => {
  it('use no Math.random, no console and no debug logger', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(root).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBe(4);
    for (const file of files)
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/Math\.random|console\.|createDebug/);
  });

  it('lists the passwords in the order of the rows', () => {
    render(<PasswordTool />);
    type('How many', '3');
    const rows = document.querySelectorAll('[data-slot="result-row"]');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'Copy password 2' })).toBeTruthy();
  });
});
