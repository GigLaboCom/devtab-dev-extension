import { definition } from './definition';
import HashTool from './HashTool';
import { hashSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoryDraft, OpenedEntry, RecordingStatus, ToolHistory, ToolHost } from '@workspace/tools-host';

beforeAll(() => {
  // jsdom's `crypto` has no `subtle`; the page's has (the logic's tests run on Node's own).
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
});
afterEach(cleanup);

const ABC = {
  MD5: '900150983cd24fb0d6963f7d28e17f72',
  'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
  'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};
const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

const field = (label: string) => screen.getByLabelText(label, { selector: 'textarea, input' }) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
/** The value of a result row (its `<output>`, named after the row). */
const row = (name: string) => screen.getByRole('status', { name }).textContent ?? '';
const rowValue = async (name: string, value: string) => waitFor(() => expect(row(name)).toBe(value));
const press = (name: string, group: 'Input' | 'Output' = 'Input') =>
  fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));
const message = (where: 'input' | 'key' | 'compare') =>
  document.querySelector(`[data-field="${where}"]`)?.textContent?.trim() ?? '';
const chooseFile = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
const pickKeyFormat = async (name: string) => {
  fireEvent.keyDown(screen.getByLabelText('Key format'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
};

describe('the Hash tool’s definition', () => {
  it('describes the tool, has no detect (§7) and loads its component', async () => {
    expect(definition).toMatchObject({ id: 'hash', title: 'Hash', order: 8 });
    expect(definition.summary).toBe('MD5, SHA-1 and SHA-2 hashes and HMAC of text or a file.');
    // No `./detect` module (§7): the package exports the definition only, nothing recognises pasted text as its input.
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), 'detect.ts'))).toBe(false);
    expect(definition.history?.kinds.every(k => k.secret)).toBe(true);
    expect((await definition.load()).default).toBe(HashTool);
  });
});

describe('the Hash tool, rendered with no host', () => {
  it('empty: the hashes of the empty input, and says so (§6, §8)', async () => {
    render(<HashTool />);
    await rowValue('MD5', EMPTY_MD5);
    expect(message('input')).toBe('Hash of empty input.');
    expect(field('Text').placeholder).toBe('Text to hash');
    expect(screen.getByText(/^MD5 and SHA-1 are not collision-resistant\./).textContent).toBe(
      'MD5 and SHA-1 are not collision-resistant. Use them only to compare with existing checksums.',
    );
  });

  it('§2.1: abc gives five rows; Copy copies the value of one, nothing else', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<HashTool />);
    type('Text', 'abc');
    await rowValue('MD5', ABC.MD5);
    expect(row('SHA-1')).toBe(ABC['SHA-1']);
    expect(row('SHA-256')).toBe(ABC['SHA-256']);
    expect(row('SHA-384')).toMatch(/^cb00753f/);
    expect(row('SHA-512')).toMatch(/^ddaf35a1/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy SHA-256' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith(ABC['SHA-256']);
    expect(message('input')).toBe('');
  });

  it('§2.2, §5.6: a line break at the end, a space at an edge — hints, still hashed', async () => {
    render(<HashTool />);
    type('Text', 'abc\n');
    await rowValue('SHA-256', 'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb');
    expect(message('input')).toBe('The text ends with a line break. It is part of the hashed bytes.');
    type('Text', '   ');
    await rowValue('MD5', md5('   '));
    expect(message('input')).toBe('The text starts or ends with a space. It is part of the hashed bytes.');
  });

  it('§2.6: Output Base64 and HEX rewrite the hashes without computing them again', async () => {
    render(<HashTool />);
    type('Text', 'abc');
    await rowValue('MD5', ABC.MD5);
    press('Base64', 'Output');
    // Synchronous: the same digests, written anew.
    expect(row('SHA-256')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    expect(row('MD5')).toBe('kAFQmDzST7DWlj99KOF/cg==');
    press('HEX', 'Output');
    expect(row('MD5')).toBe(ABC.MD5.toUpperCase());
  });

  it('§2.7: Hex input — two bytes, or the error next to the field; Base64 input and its errors (§6)', async () => {
    render(<HashTool />);
    press('Hex');
    expect(field('Hex').placeholder).toBe('00 ff 10 …');
    type('Hex', '00 ff');
    await rowValue('SHA-256', '06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8');
    type('Hex', '0g');
    await rowValue('SHA-256', '');
    expect(message('input')).toBe('Position 2: "g" is not a hex digit.');
    type('Hex', 'abc');
    expect(message('input')).toBe('Hex needs an even number of digits (3 found).');
    press('Base64');
    expect(field('Base64').placeholder).toBe('SGVsbG8=');
    type('Base64', 'YW=Jj');
    expect(message('input')).toBe('Position 3: "=" can only appear at the end.');
    type('Base64', 'YWJjZ');
    expect(message('input')).toBe('Base64 length is not valid: one character too many or missing.');
    type('Base64', 'a+b_');
    expect(message('input')).toBe('Position 4: "_" belongs to the URL-safe alphabet, but "+" was used before.');
    type('Base64', 'YWJj');
    await rowValue('MD5', ABC.MD5);
  });

  it('§2.4: HMAC with the key Jefe (RFC 4231 case 2); an empty key fills the rows with "Enter a key."', async () => {
    render(<HashTool />);
    type('Text', 'what do ya want for nothing?');
    fireEvent.click(screen.getByLabelText('HMAC'));
    for (const name of ['HMAC-MD5', 'HMAC-SHA-1', 'HMAC-SHA-256', 'HMAC-SHA-384', 'HMAC-SHA-512'])
      expect(row(name)).toBe('Enter a key.');
    expect(screen.queryByRole('button', { name: 'Copy HMAC-SHA-256' })).toBeNull();
    const key = field('Key');
    expect(key.type).toBe('password');
    expect(key.autocomplete).toBe('off');
    expect(key.getAttribute('spellcheck')).toBe('false');
    type('Key', 'Jefe');
    await rowValue('HMAC-SHA-256', '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(row('HMAC-MD5')).toBe('750c783e6ab0b503eaa86e310a5db738');
    expect(screen.getByRole('button', { name: 'Copy HMAC-SHA-256' })).toBeTruthy();
  });

  it('§8.2: Show key reveals the key (aria-pressed) and hides it again', () => {
    render(<HashTool />);
    fireEvent.click(screen.getByLabelText('HMAC'));
    const show = screen.getByRole('button', { name: 'Show key' });
    expect(show.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(show);
    expect(field('Key').type).toBe('text');
    expect(show.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(show);
    expect(field('Key').type).toBe('password');
  });

  it('§2.5: a key in hex (RFC 4231 case 1); a wrong hex key is said at the key, rows empty (§6)', async () => {
    render(<HashTool />);
    type('Text', 'Hi There');
    fireEvent.click(screen.getByLabelText('HMAC'));
    await pickKeyFormat('Hex');
    type('Key', '0b'.repeat(20));
    await rowValue('HMAC-SHA-256', 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    type('Key', 'zz');
    await rowValue('HMAC-SHA-256', '');
    expect(message('key')).toBe('Position 1: "z" is not a hex digit.');
    expect(row('HMAC-MD5')).toBe('');
  });

  it('§5.5: Compare with — a match marks its row, other answers under the field', async () => {
    render(<HashTool />);
    type('Text', 'abc');
    await rowValue('MD5', ABC.MD5);
    type('Compare with', `${ABC['SHA-256']}  file.txt`);
    expect(message('compare')).toBe('Matches SHA-256.');
    const matched = document.querySelector('[data-match]')!;
    expect(matched.textContent).toContain('Matches');
    expect(matched.querySelector('output')?.getAttribute('aria-label')).toBe('SHA-256');
    type('Compare with', 'kAFQmDzST7DWlj99KOF/cg==');
    expect(message('compare')).toBe('Matches MD5.');
    type('Compare with', EMPTY_MD5);
    expect(message('compare')).toBe('No hash above matches.');
    expect(document.querySelector('[data-match]')).toBeNull();
    type('Compare with', 'abc');
    expect(message('compare')).toBe('Not a hex or Base64 hash.');
    type('Compare with', '');
    expect(message('compare')).toBe('');
    expect(field('Compare with').placeholder).toBe('Paste an expected hash');
  });

  it('§12: 1–16 MiB is hashed 300 ms after the last edit, with "Hashing…"; over 16 MiB is refused (§6)', async () => {
    render(<HashTool />);
    type('Text', 'a'.repeat(2 * 1024 * 1024));
    expect(message('input')).toBe('Hashing…');
    expect(row('MD5')).toBe('');
    await waitFor(() => expect(row('MD5')).toBe(md5('a'.repeat(2 * 1024 * 1024))), { timeout: 4000 });
    type('Text', 'a'.repeat(16 * 1024 * 1024 + 1));
    expect(message('input')).toBe('Text is larger than 16 MB. Use File for large inputs.');
    expect(row('MD5')).toBe('');
  });
});

describe('the Hash tool’s File mode', () => {
  it('§2.3: a file — its name and size, then the hashes, the same as of its bytes as text (§5.3)', async () => {
    render(<HashTool />);
    press('File');
    expect(screen.getByText('Drop a file here or')).toBeTruthy();
    chooseFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }));
    expect(screen.getByText('abc.txt — 3 bytes')).toBeTruthy();
    await rowValue('MD5', ABC.MD5);
    expect(row('SHA-256')).toBe(ABC['SHA-256']);
    type('Compare with', `SHA256 (abc.txt) = ${ABC['SHA-256'].toUpperCase()}`);
    expect(message('compare')).toBe('Matches SHA-256.');
  });

  it('§6: an empty file is the empty input; an unreadable file is refused (there is no size limit, §12)', async () => {
    render(<HashTool />);
    press('File');
    chooseFile(new File([], 'empty.bin'));
    expect(screen.getByText('empty.bin — 0 bytes')).toBeTruthy();
    await rowValue('MD5', EMPTY_MD5);

    const gone = new File(['abc'], 'gone.txt');
    Object.defineProperty(gone, 'slice', {
      value: () => ({ arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')) }),
    });
    chooseFile(gone);
    await waitFor(() => expect(message('input')).toBe('Could not read the file.'));
    expect(row('MD5')).toBe('');
  });

  it('§6: Cancel during hashing — "Cancelled.", no hashes', async () => {
    render(<HashTool />);
    press('File');
    // Never-ending reads: the hashing waits on the first chunk until it is cancelled.
    const slow = new File([new Uint8Array(3 * 1024 * 1024)], 'slow.bin');
    Object.defineProperty(slow, 'slice', { value: () => ({ arrayBuffer: () => new Promise(() => undefined) }) });
    chooseFile(slow);
    expect(await screen.findByText(/^Hashing… 0%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(message('input')).toBe('Cancelled.');
    expect(row('MD5')).toBe('');
    expect(screen.queryByText(/^Hashing…/)).toBeNull();
  });

  it('lets the file go when the mode changes (§11)', async () => {
    render(<HashTool />);
    press('File');
    chooseFile(new File(['abc'], 'abc.txt'));
    await rowValue('MD5', ABC.MD5);
    press('Text');
    await rowValue('MD5', EMPTY_MD5);
    press('File');
    expect(screen.queryByText(/abc\.txt/)).toBeNull();
    expect(row('MD5')).toBe('');
  });
});

/** A host whose history reports `secrets` and keeps what the tool sends, to see what it records and what it opens. */
const recordingHost = (secrets: RecordingStatus['secrets']) => {
  const kept: Array<{ id: string; how: 'change' | 'commit'; draft: HistoryDraft }> = [];
  const keep = (how: 'change' | 'commit', draft: HistoryDraft) => {
    const id = `e${kept.length + 1}`;
    kept.push({ id, how, draft });
    return id;
  };
  const history: ToolHistory = {
    owner: 'hash',
    status: () => ({ gate: 'on', secrets, declared: true }),
    subscribe: () => () => undefined,
    session: () => ({
      session: 's1',
      change: draft => void keep('change', draft),
      commit: async draft => ({ recorded: true, id: keep('commit', draft) }),
      flush: async () => undefined,
      end: async () => undefined,
    }),
    list: async () => ({ entries: [] }),
    open: async (id): Promise<OpenedEntry> => {
      const entry = kept.find(e => e.id === id)!;
      return {
        ok: true,
        entry: {
          id,
          owner: 'hash',
          kind: entry.draft.kind,
          session: 's1',
          time: 0,
          schema: 1,
          encrypted: true,
          bytes: 1,
        },
        ...(entry.draft.label ? { label: entry.draft.label } : {}),
        payload: entry.draft.payload,
        blobs: { ...entry.draft.blobs },
      };
    },
  };
  const host: ToolHost = { history: { forOwner: () => history } };
  return { host, kept };
};

describe('the Hash tool’s history (D17: secret kinds only)', () => {
  it('without a master password: says that nothing is kept, and the in-memory history keeps nothing', async () => {
    const host = memoryHost();
    render(<HashTool host={host} />);
    expect(document.querySelector('[data-kept]')?.textContent).toBe(
      'Nothing you hash here is kept: this tool’s history needs a master password (Settings → History).',
    );
    type('Text', 'secret');
    await rowValue('MD5', md5('secret'));
    cleanup();
    const history = host.history.forOwner('hash', definition.history!);
    await waitFor(async () => expect((await history.list()).entries).toEqual([]));
  });

  it('locked, unlocked: says what is true now', () => {
    render(<HashTool host={recordingHost('locked').host} />);
    expect(document.querySelector('[data-kept]')?.textContent).toBe(
      'Nothing you hash here is kept while the history is locked.',
    );
    cleanup();
    render(<HashTool host={recordingHost('unlocked').host} />);
    expect(document.querySelector('[data-kept]')?.textContent).toBe(
      'Kept in this browser’s history, encrypted: the text (or a file’s name and size), the key and the hashes — never a file’s contents.',
    );
  });

  it('a text edit is a change with the text, the key and the hashes; it opens back into the fields', async () => {
    const { host, kept } = recordingHost('unlocked');
    render(<HashTool host={host} />);
    await rowValue('MD5', EMPTY_MD5);
    expect(kept).toEqual([]); // opening the page records nothing
    type('Text', 'what do ya want for nothing?');
    fireEvent.click(screen.getByLabelText('HMAC'));
    type('Key', 'Jefe');
    await rowValue('HMAC-SHA-256', '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    await waitFor(() => expect(kept.at(-1)?.draft.payload).toMatchObject({ key: 'Jefe' }));
    const last = kept.at(-1)!;
    expect(last.how).toBe('change');
    expect(last.draft).toMatchObject({ kind: 'text', label: 'HMAC · Text · 28 characters' });
    expect(last.draft.payload).toMatchObject({
      input: 'text',
      hmac: true,
      keyFormat: 'text',
      output: 'hex',
      digests: { 'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843' },
    });
    expect(await last.draft.blobs!.input!.text()).toBe('what do ya want for nothing?');
    const count = kept.length;
    cleanup();

    render(<HashTool host={host} restore={{ id: last.id }} />);
    expect(await screen.findByText('Opened from History: HMAC · Text · 28 characters.')).toBeTruthy();
    expect(field('Text').value).toBe('what do ya want for nothing?');
    expect(field('Key').value).toBe('Jefe');
    await rowValue('HMAC-SHA-256', '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(kept.length).toBe(count); // opening an entry records nothing
  });

  it('a hashed file is a commit with its name, size and hashes — never its contents; it opens without the file', async () => {
    const { host, kept } = recordingHost('unlocked');
    render(<HashTool host={host} />);
    press('File');
    chooseFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }));
    await rowValue('MD5', ABC.MD5);
    await waitFor(() => expect(kept.some(e => e.how === 'commit')).toBe(true));
    const commit = kept.find(e => e.how === 'commit')!;
    expect(commit.draft).toMatchObject({ kind: 'file', label: 'File · abc.txt · 3 bytes' });
    expect(commit.draft.blobs).toBeUndefined();
    expect(commit.draft.payload).toMatchObject({
      input: 'file',
      file: { name: 'abc.txt', size: 3, type: 'text/plain' },
      digests: { MD5: ABC.MD5, 'SHA-256': ABC['SHA-256'] },
    });
    expect(JSON.stringify(commit.draft)).not.toContain('"abc"');
    // Hashing the same file under a key is an edit of that result: a change, not a second commit.
    fireEvent.click(screen.getByLabelText('HMAC'));
    type('Key', 'k');
    await waitFor(() => expect(kept.at(-1)?.draft.payload).toMatchObject({ input: 'file', hmac: true, key: 'k' }), {
      timeout: 4000,
    });
    expect(kept.at(-1)!.how).toBe('change');
    expect(kept.filter(e => e.how === 'commit')).toHaveLength(1);
    cleanup();

    render(<HashTool host={host} restore={{ id: commit.id }} />);
    expect(
      await screen.findByText(
        'Opened from History: File · abc.txt · 3 bytes. The file itself is not kept: choose it again to hash it.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('abc.txt — 3 bytes')).toBeTruthy();
    expect(row('SHA-256')).toBe(ABC['SHA-256']);
  });

  it('an entry that cannot be opened says why', async () => {
    const { host } = recordingHost('locked');
    const history = host.history.forOwner('hash', definition.history!);
    history.open = async () => ({ ok: false, reason: 'locked' });
    render(<HashTool host={host} restore={{ id: 'x' }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
  });
});

describe('the Hash tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('hash').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('hash').save(hashSettings.schema, values as never);
    await host.settings!.forTool('hash').flush();
  };
  const on = (group: 'Input' | 'Output') =>
    within(screen.getByRole('radiogroup', { name: group }))
      .getAllByRole('radio')
      .find(r => r.getAttribute('aria-checked') === 'true')?.textContent;
  const hmac = () => screen.getByLabelText('HMAC').getAttribute('aria-checked');
  const keyFormat = () => screen.getByLabelText('Key format').textContent;
  const EXPECTED = ABC['SHA-256'];

  it('saves Input, Output, HMAC and Key format — never the key or the expected hash; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<HashTool host={host} />);
    press('Hex');
    press('Base64', 'Output');
    fireEvent.click(screen.getByLabelText('HMAC'));
    type('Key', 'Jefe');
    await pickKeyFormat('Base64');
    type('Compare with', EXPECTED);
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { inputFormat: 'hex', output: 'base64', hmac: true, keyFormat: 'base64' },
    });
    expect(JSON.stringify(savedOf(host))).not.toContain('Jefe');
    expect(JSON.stringify(savedOf(host))).not.toContain(EXPECTED);

    render(<HashTool host={host} />);
    expect(on('Input')).toBe('Hex');
    expect(on('Output')).toBe('Base64');
    expect(hmac()).toBe('true');
    expect(keyFormat()).toBe('Base64');
    expect(field('Key').value).toBe('');
    expect(field('Compare with').value).toBe('');
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { inputFormat: 'binary', output: 'HEX', hmac: 1, keyFormat: 'hex' });
    render(<HashTool host={host} />);
    expect(on('Input')).toBe('Text');
    expect(on('Output')).toBe('HEX');
    expect(hmac()).toBe('false');
    await rowValue('MD5', EMPTY_MD5.toUpperCase());
    fireEvent.click(screen.getByLabelText('HMAC'));
    expect(keyFormat()).toBe('Hex');
  });

  it('handed text opens in Text and an opened entry shows its own options — for the visit; what is saved stays', async () => {
    const memory = memoryHost();
    const { host: recording, kept } = recordingHost('unlocked');
    const host: ToolHost = { history: recording.history, settings: memory.settings };
    await seed(host, { inputFormat: 'hex', output: 'HEX' });
    const stored = { schema: 1, values: { inputFormat: 'hex', output: 'HEX' } };
    const handed = render(<HashTool host={host} input="abc" />);
    expect(on('Input')).toBe('Text');
    await rowValue('MD5', ABC.MD5.toUpperCase());
    handed.unmount();
    expect(savedOf(host)).toEqual(stored);

    kept.push({
      id: 'e1',
      how: 'commit',
      draft: {
        kind: 'text',
        label: 'Base64 · 4 characters',
        payload: { input: 'base64', output: 'hex', hmac: false, compare: '', digests: {} },
        blobs: { input: new Blob(['YWJj'], { type: 'text/plain' }) },
      },
    });
    const opened = render(<HashTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('Opened from History: Base64 · 4 characters.')).toBeTruthy();
    expect(on('Input')).toBe('Base64');
    expect(on('Output')).toBe('hex');
    await rowValue('MD5', ABC.MD5);
    opened.unmount();
    expect(savedOf(host)).toEqual(stored);
    render(<HashTool host={host} />);
    expect(on('Input')).toBe('Hex');
    expect(on('Output')).toBe('HEX');
  });

  it('reset puts the options back to the defaults and keeps the key; a file is let go, as on any change of Input', async () => {
    const host = memoryHost();
    await seed(host, { inputFormat: 'file', output: 'base64', hmac: true, keyFormat: 'hex' });
    render(<HashTool host={host} />);
    chooseFile(new File(['abc'], 'abc.txt'));
    type('Key', '6b');
    await waitFor(() => expect(row('HMAC-MD5')).not.toBe(''));
    await act(async () => host.settings!.forTool('hash').reset());
    expect(on('Input')).toBe('Text');
    expect(on('Output')).toBe('hex');
    expect(hmac()).toBe('false');
    await rowValue('MD5', EMPTY_MD5);
    expect(savedOf(host)).toBeUndefined();
    fireEvent.click(screen.getByLabelText('HMAC'));
    expect(field('Key').value).toBe('6b');
    expect(keyFormat()).toBe('Text (UTF-8)');
    press('File');
    expect(screen.queryByText(/abc\.txt/)).toBeNull();
  });
});
