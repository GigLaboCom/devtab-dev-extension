import { definition } from './definition';
import { passwordHashHistory } from './history';
import PasswordHashTool from './PasswordHashTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseHash, verifyPassword } from '@workspace/tool-logic-password-hash';
import { memoryHost, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HistoryDraft,
  OpenedEntry,
  RecordingStatus,
  RecordOutcome,
  ToolHistory,
  ToolHost,
} from '@workspace/tools-host';

afterEach(cleanup);

// Test passwords and hashes of docs/tools/specs/password-hash.md §10 — vectors, not credentials.
const PASSWORD = 'hunter2';
const BCRYPT = '$2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK'; // gitleaks:allow — test vector (§10 row 29)
const DJANGO = 'pbkdf2_sha256$10000$seasalt$CWWFdHOWwPnki7HvkcqN9iA2T3KLW1cf2uZ5kvArtVY='; // gitleaks:allow — Django test sample

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const settle = () => act(async () => undefined);
const kept = () => document.querySelector('[data-kept]')?.textContent ?? '';
const live = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
const result = () => document.querySelector('[data-result] output')?.textContent ?? '';
const verdict = () => document.querySelector('[data-verdict]')?.textContent ?? '';
const row = (name: string) => document.querySelector(`[data-row="${name}"]`)?.textContent ?? '';
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};

/** A host whose history records every call, with a status the test sets (the factory's sealing is not this tool's). */
const spyHost = (initial: Partial<RecordingStatus> = {}) => {
  const status: RecordingStatus = { gate: 'on', secrets: 'unlocked', declared: true, ...initial };
  const changes: HistoryDraft[] = [];
  const commits: HistoryDraft[] = [];
  const opened = new Map<string, OpenedEntry>();
  const history: ToolHistory = {
    owner: 'password-hash',
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

/** The page's clipboard, stubbed: the machine's clipboard is never touched. */
const copied: string[] = [];
beforeEach(() => {
  copied.length = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) },
  });
});

describe('the Password Hash tool', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition.id).toBe('password-hash');
    expect(definition.order).toBe(36);
    expect(definition.output).toEqual({ origin: 'input' });
    expect((await definition.load()).default).toBe(PasswordHashTool);
  });

  it('recognises a pasted hash from a module of its own (§7)', async () => {
    const { detect } = await import('./detect');
    expect(detect(BCRYPT)).toBe(true);
    expect(detect('hello')).toBe(false);
  });

  it('renders with no host at all: Hash, Argon2id with the recommended parameters, a random salt (§4)', () => {
    render(<PasswordHashTool />);
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    expect(screen.getByLabelText('Algorithm').textContent).toBe('Argon2id');
    expect((screen.getByLabelText('Memory (KiB)') as HTMLInputElement).value).toBe('65536');
    expect((screen.getByLabelText('Iterations') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Parallelism') as HTMLInputElement).value).toBe('4');
    expect(screen.getByText('Uses 64 MiB of memory.')).toBeTruthy();
    // The page says which numbers are the recommendation and which the minimum it warns under.
    expect(document.querySelector('[data-recommendation]')?.textContent).toBe(
      'Recommended: m=65536 KiB, t=3, p=4 (RFC 9106, second recommended option). Warned below the minimum: m=19456 KiB with t=2 or an equal OWASP row.',
    );
    expect(document.querySelector('[data-warning]')).toBeNull();
    expect((screen.getByLabelText('Secret key (pepper)') as HTMLInputElement).value).toBe('');
    expect(button('Use recommended').disabled).toBe(true);
    expect(button('Hash').disabled).toBe(true);
    expect(screen.getByText('Type a password, choose the algorithm and press Hash.')).toBeTruthy();
    expect(kept()).toBe(
      'Everything runs in this tab; nothing is sent. The password is never kept. Hashes are not kept (no master password).',
    );
  });
});

describe('Hash (§2, scenarios 1, 2, 7, 8)', () => {
  it('scenario 1: a password and Hash — an Argon2id PHC string that verifies, with Copy', async () => {
    render(<PasswordHashTool />);
    type('Password', PASSWORD);
    expect(button('Hash').disabled).toBe(false);
    fireEvent.click(button('Hash'));
    await waitFor(() =>
      expect(result()).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/),
    );
    expect(live()).toBe('Hash ready.');
    expect(document.querySelector('[data-summary]')?.textContent).toMatch(
      /^Argon2id · m=65536 KiB, t=3, p=4 · random 16-byte salt · \d+\.\d\d s$/,
    );
    const parsed = parseHash(result());
    expect(parsed.ok && (await verifyPassword(PASSWORD, parsed.hash))).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy hash' })).toBeTruthy();
  });

  it('Enter in the password field hashes; two presses give two salts', async () => {
    render(<PasswordHashTool />);
    type('Password', PASSWORD);
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' });
    await waitFor(() => expect(result()).not.toBe(''));
    const first = result();
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).not.toBe(first));
    expect(result().split('$')[4]).not.toBe(first.split('$')[4]);
  });

  it('scenario 2: bcrypt, htpasswd line, user alice — "alice:$2y$10$…"', async () => {
    render(<PasswordHashTool />);
    await choose('Algorithm', 'bcrypt');
    expect((screen.getByLabelText('Cost') as HTMLInputElement).value).toBe('12');
    expect(document.querySelector('[data-recommendation]')?.textContent).toBe(
      'Recommended: cost 12 (the default of PHP, Laravel, Python bcrypt and Ruby bcrypt). Warned below the minimum: cost 10 (OWASP).',
    );
    expect(screen.queryByLabelText('Secret key (pepper)')).toBeNull();
    await choose('Format', 'htpasswd line');
    type('Password', PASSWORD);
    expect(button('Hash').disabled).toBe(true);
    type('User', 'a:b');
    expect(screen.getByText('The user name cannot contain ":" or a line break.')).toBeTruthy();
    type('User', 'alice');
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).toMatch(/^alice:\$2y\$12\$[./A-Za-z0-9]{53}$/));
    expect(screen.getByRole('button', { name: 'Copy line' })).toBeTruthy();
  });

  it('a custom salt makes the same string as §10 (bcrypt, salt 00…0f)', async () => {
    render(<PasswordHashTool />);
    await choose('Algorithm', 'bcrypt');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    type('Salt', '0001020304');
    expect(screen.getByText('bcrypt needs a salt of exactly 16 bytes; this one is 5 bytes.')).toBeTruthy();
    type('Salt', '000102030405060708090a0b0c0d0e0f');
    type('Cost', '10');
    type('Password', PASSWORD);
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).toBe(BCRYPT));
    expect(document.querySelector('[data-summary]')?.textContent).toMatch(/^bcrypt · cost 10 · your 16-byte salt · /);
  });

  it('scenario 7: a parameter beyond the limits blocks Hash with the reason under its field', async () => {
    render(<PasswordHashTool />);
    type('Password', PASSWORD);
    type('Memory (KiB)', '4194304');
    expect(screen.getByText('Memory must be a whole number from 8 to 1,048,576 KiB.')).toBeTruthy();
    expect(screen.getByLabelText('Memory (KiB)').getAttribute('aria-invalid')).toBe('true');
    expect(button('Hash').disabled).toBe(true);
    type('Memory (KiB)', '8192');
    expect(
      screen.getByText(
        'Below the OWASP minimum for Argon2id: use at least 19 MiB with 2 iterations (or 46 MiB with 1, 12 MiB with 3, 9 MiB with 4, 7 MiB with 5).',
      ),
    ).toBeTruthy();
    expect(button('Hash').disabled).toBe(false);
    fireEvent.click(button('Use recommended'));
    expect((screen.getByLabelText('Memory (KiB)') as HTMLInputElement).value).toBe('65536');
  });

  it('scenario 8: 80 bytes with bcrypt — the note about 72 bytes; switching algorithm resets the parameters', async () => {
    render(<PasswordHashTool />);
    type('Password', 'x'.repeat(80));
    expect(screen.queryByText(/first 72 bytes/)).toBeNull();
    await choose('Algorithm', 'bcrypt');
    expect(
      screen.getByText(
        'bcrypt uses only the first 72 bytes of a password; this one is 80 bytes in UTF-8, so the rest is ignored.',
      ),
    ).toBeTruthy();
    await choose('Algorithm', 'scrypt');
    expect((screen.getByLabelText('Cost (log2 N)') as HTMLInputElement).value).toBe('17');
    expect(screen.getByText('N = 131,072 · uses 128 MiB of memory.')).toBeTruthy();
    expect(screen.getByLabelText('Format').textContent).toBe('$scrypt$ (passlib)');
  });

  it('an edit removes the result: what is shown always matches the fields', async () => {
    render(<PasswordHashTool />);
    type('Password', PASSWORD);
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).not.toBe(''));
    type('Password', 'hunter3');
    expect(result()).toBe('');
  });
});

describe('Verify (§2, scenarios 3–6)', () => {
  it('scenario 3: a Django string — what was read, then Does not match / Matches', async () => {
    render(<PasswordHashTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Verify' }));
    expect(screen.getByText('Paste a hash and type the password to check it.')).toBeTruthy();
    type('Hash', DJANGO);
    expect(row('Algorithm')).toBe('PBKDF2-HMAC-SHA256');
    expect(row('Format')).toBe('Django');
    expect(row('Parameters')).toBe('10,000 iterations');
    expect(row('Salt')).toBe('7 characters (text)');
    expect(
      screen.getByText('Below the OWASP minimum for PBKDF2-HMAC-SHA256: use 600,000 iterations or more.'),
    ).toBeTruthy();
    expect(screen.getByText('Salts shorter than 16 bytes are below the usual recommendation (128 bits).')).toBeTruthy();
    type('Password', 'letmein');
    fireEvent.click(button('Verify'));
    await waitFor(() => expect(verdict()).toBe('Does not match: this password gives a different hash.'));
    expect(live()).toBe('Does not match.');
    type('Password', 'lètmein');
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' });
    await waitFor(() => expect(verdict()).toBe('Matches: this password gives this hash.'));
    expect(document.querySelector('[data-verdict] svg')).toBeTruthy();
  });

  it('scenario 5: a pasted hash opens Verify with it filled in, the password empty', () => {
    render(<PasswordHashTool input={`${BCRYPT}\n`} />);
    expect((screen.getByLabelText('Hash') as HTMLInputElement).value).toBe(BCRYPT);
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(row('Algorithm')).toBe('bcrypt ($2b$)');
    expect(row('Parameters')).toBe('cost 10 (1,024 rounds)');
  });

  it('scenario 6 and §6: hashes it does not compute, in words; beyond the limits refused', () => {
    render(<PasswordHashTool input="x" />);
    type('Hash', '$6$rounds=5000$saltsalt$abc');
    expect(
      screen.getByText(
        'SHA-512-crypt ($6$) hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.',
      ),
    ).toBeTruthy();
    type('Hash', '5f4dcc3b5aa765d61d8327deb882cf99');
    expect(
      screen.getByText(
        'This looks like a plain MD5 digest, not a password hash. Plain digests are compared in the Hash tool.',
      ),
    ).toBeTruthy();
    type('Hash', BCRYPT.replace('$10$', '$20$'));
    type('Password', PASSWORD);
    expect(
      screen.getByText("This hash is beyond the tool's limits: Cost must be a whole number from 4 to 18."),
    ).toBeTruthy();
    expect(button('Verify').disabled).toBe(true);
  });

  it('scenario 4: an old $2a$05$ — the warning, and the check still runs', async () => {
    render(<PasswordHashTool input="$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW" />); // gitleaks:allow — published vector
    expect(screen.getByText('Below the OWASP minimum for bcrypt: use cost 10 or more.')).toBeTruthy();
    type('Password', 'U*U');
    fireEvent.click(button('Verify'));
    await waitFor(() => expect(verdict()).toBe('Matches: this password gives this hash.'));
  });
});

describe('the secret key (pepper), Argon2 only (§5.10)', () => {
  const PEPPER = 'pepper-for-tests';
  it('Hash with a key: the note, the summary; the key is not in the string; Verify needs it again', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m));
    const { host, commits } = spyHost();
    render(<PasswordHashTool host={host} />);
    const key = screen.getByLabelText('Secret key (pepper)') as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.getAttribute('autocomplete')).toBe('off');
    expect(key.getAttribute('spellcheck')).toBe('false');
    const toggle = button('Show secret key');
    fireEvent.click(toggle);
    expect(key.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    type('Secret key (pepper)', PEPPER);
    expect(
      screen.getByText('The secret key is not part of the hash string: verifying needs the same key again.'),
    ).toBeTruthy();
    type('Password', PASSWORD);
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/));
    expect(document.querySelector('[data-summary]')?.textContent).toMatch(/ · with a secret key · /);
    const made = result();
    expect(made).not.toContain(PEPPER);
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]!.payload).toMatchObject({ keyed: true });
    expect(JSON.stringify(commits)).not.toContain(PEPPER);

    // Verify: with the key — matches; without it — does not, and the page says what it cannot know.
    fireEvent.click(screen.getByRole('radio', { name: 'Verify' }));
    type('Hash', made);
    type('Password', PASSWORD);
    type('Secret key (pepper)', PEPPER);
    fireEvent.click(button('Verify'));
    await waitFor(() => expect(verdict()).toBe('Matches: this password gives this hash.'));
    type('Secret key (pepper)', '');
    fireEvent.click(button('Verify'));
    await waitFor(() => expect(verdict()).toBe('Does not match: this password gives a different hash.'));
    expect(document.querySelector('[data-secret-unknown]')?.textContent).toBe(
      'The hash string does not say whether a secret key (pepper) was used: with a missing or wrong key, even the right password does not match.',
    );
    expect(JSON.stringify(commits)).not.toContain(PEPPER);
    expect(commits.at(-1)).toMatchObject({ kind: 'verified', payload: { match: false, keyed: false } });
    // A bcrypt string has no key: the field goes.
    type('Hash', BCRYPT);
    expect(screen.queryByLabelText('Secret key (pepper)')).toBeNull();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('leaving Argon2 lets the key go; a key over 1,024 bytes is refused', async () => {
    render(<PasswordHashTool />);
    type('Password', PASSWORD);
    type('Secret key (pepper)', 'k'.repeat(1025));
    expect(screen.getByText('The secret key is longer than 1,024 bytes.')).toBeTruthy();
    expect(button('Hash').disabled).toBe(true);
    await choose('Algorithm', 'bcrypt');
    await choose('Algorithm', 'Argon2i');
    expect((screen.getByLabelText('Secret key (pepper)') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/^Argon2i is a supplementary variant \(RFC 9106\)/)).toBeTruthy();
  });

  it('an entry made with a key opens back without it, and says so', async () => {
    const { host, opened } = spyHost();
    opened.set('k1', {
      ok: true,
      entry: {
        id: 'k1',
        owner: 'password-hash',
        kind: 'verified',
        session: 's',
        time: 0,
        schema: 1,
        encrypted: true,
        bytes: 1,
      },
      label: 'Argon2id · m=65536, t=3, p=4 · matches',
      payload: { hash: BCRYPT, match: true, keyed: true },
      blobs: {},
    } as unknown as OpenedEntry);
    render(<PasswordHashTool host={host} restore={{ id: 'k1' }} />);
    expect(
      await screen.findByText(
        'Opened from History: Argon2id · m=65536, t=3, p=4 · matches. The password is never kept: type it again. It was made with a secret key, which is never kept either.',
      ),
    ).toBeTruthy();
  });
});

describe('the password is a secret (§11)', () => {
  it('a password field with a show/hide button of constant name; nothing reaches the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m));
    render(<PasswordHashTool />);
    const field = screen.getByLabelText('Password') as HTMLInputElement;
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
    const toggle = button('Show password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(field.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.title).toBe('Hide password');
    expect(document.querySelector('form')).toBeNull();
    type('Password', PASSWORD);
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).not.toBe(''));
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('history (D17, §11)', () => {
  it('without a master password nothing is recorded (the in-memory host)', async () => {
    const host = memoryHost();
    render(<PasswordHashTool host={host} />);
    type('Password', PASSWORD);
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(result()).not.toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Copy hash' }));
    await settle();
    const history = host.history.forOwner('password-hash', passwordHashHistory);
    expect(history.status().secrets).toBe('no-password');
    expect((await history.list()).entries).toEqual([]);
  });

  it('Hash and Verify are commits with the hash and parameters, never the password; edits record nothing', async () => {
    const { host, commits, changes } = spyHost();
    render(<PasswordHashTool host={host} />);
    type('Password', PASSWORD);
    expect(changes).toHaveLength(0);
    fireEvent.click(button('Hash'));
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]).toMatchObject({ kind: 'hashed', label: 'Argon2id · m=65536, t=3, p=4' });
    expect(commits[0]!.payload).toMatchObject({
      algorithm: 'argon2id',
      format: 'phc',
      salt: { mode: 'random' },
      encoded: result(),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy hash' }));
    await settle();
    expect(copied).toEqual([result()]);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toEqual(commits[0]);

    fireEvent.click(screen.getByRole('radio', { name: 'Verify' }));
    type('Hash', BCRYPT);
    type('Password', PASSWORD);
    fireEvent.click(button('Verify'));
    await waitFor(() => expect(commits).toHaveLength(3));
    expect(commits[2]).toMatchObject({
      kind: 'verified',
      label: 'bcrypt · cost 10 · matches',
      payload: { hash: BCRYPT, match: true },
    });
    expect(changes).toHaveLength(0);
    expect(JSON.stringify(commits)).not.toContain(PASSWORD);
  });

  it('says what the history does with hashes now', () => {
    const { unmount } = render(<PasswordHashTool host={spyHost().host} />);
    expect(kept()).toContain('The hashes you make or check are kept encrypted in this browser.');
    unmount();
    render(<PasswordHashTool host={spyHost({ secrets: 'locked' }).host} />);
    expect(kept()).toContain('Hashes are not kept while the history is locked.');
    cleanup();
    render(<PasswordHashTool host={spyHost({ gate: 'off' }).host} />);
    expect(kept()).toContain('Hashes are not kept (history is off).');
  });

  it('encrypted with a master password: nothing in clear in the store, opens back without the password', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<PasswordHashTool host={host} />);
    await choose('Algorithm', 'bcrypt');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    type('Salt', '000102030405060708090a0b0c0d0e0f');
    type('Cost', '10');
    type('Password', PASSWORD);
    fireEvent.click(button('Hash'));
    const history = host.history.forOwner('password-hash', passwordHashHistory);
    await waitFor(async () => expect((await history.list()).entries).toHaveLength(1));
    unmount();
    await settle();
    const [entry] = (await history.list()).entries;
    expect(entry!.encrypted).toBe(true);
    const raw: string[] = [];
    for await (const r of host.store.scan({})) raw.push(JSON.stringify(r));
    expect(raw.join('')).not.toContain(PASSWORD);
    expect(raw.join('')).not.toContain(BCRYPT.slice(7, 29));
    const opened = await history.open(entry!.id);
    expect(opened.ok && JSON.stringify(opened.payload)).not.toContain(PASSWORD);

    render(<PasswordHashTool host={host} restore={{ id: entry!.id }} />);
    expect(
      await screen.findByText('Opened from History: bcrypt · cost 10. The password is never kept: type it again.'),
    ).toBeTruthy();
    expect(result()).toBe(BCRYPT);
    expect(screen.getByLabelText('Algorithm').textContent).toBe('bcrypt');
    expect((screen.getByLabelText('Salt') as HTMLInputElement).value).toBe('000102030405060708090a0b0c0d0e0f');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    cleanup();
    await host.vault.lock();
    render(<PasswordHashTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
  });

  it('a verified entry opens in Verify with the hash; a foreign payload could not be opened', async () => {
    const { host, opened, commits } = spyHost();
    opened.set('v1', {
      ok: true,
      entry: {
        id: 'v1',
        owner: 'password-hash',
        kind: 'verified',
        session: 's',
        time: 0,
        schema: 1,
        encrypted: true,
        bytes: 1,
      },
      label: 'bcrypt · cost 10 · matches',
      payload: { hash: BCRYPT, match: true },
      blobs: {},
    } as unknown as OpenedEntry);
    opened.set('x', {
      ok: true,
      entry: {
        id: 'x',
        owner: 'password-hash',
        kind: 'hashed',
        session: 's',
        time: 0,
        schema: 1,
        encrypted: true,
        bytes: 1,
      },
      payload: { nope: 1 },
      blobs: {},
    } as unknown as OpenedEntry);
    const { unmount } = render(<PasswordHashTool host={host} restore={{ id: 'v1' }} />);
    expect(
      await screen.findByText(
        'Opened from History: bcrypt · cost 10 · matches. The password is never kept: type it again.',
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText('Hash') as HTMLInputElement).value).toBe(BCRYPT);
    expect(verdict()).toBe('');
    unmount();
    render(<PasswordHashTool host={host} restore={{ id: 'x' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
    expect(commits).toHaveLength(0);
  });
});
