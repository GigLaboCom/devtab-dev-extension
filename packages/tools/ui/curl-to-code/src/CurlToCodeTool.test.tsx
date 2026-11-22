// The cURL to Code page (docs/tools/specs/curl-to-code.md §2, §6, §8): the scenarios as a person does them, the errors
// next to the command, the warnings and the credentials note under the code, Copy, the large-input steps of §12, and
// its one secret history kind (D17) through the real history factory and cipher: nothing without a master password,
// an encrypted entry with one, nothing while locked, and an entry opened back into the tool.
import CurlToCodeTool from './CurlToCodeTool';
import { definition } from './definition';
import { detect } from './detect';
import { draftOf, entryLabel, readPayload } from './entries';
import { curlToCodeSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TARGETS } from '@workspace/tool-logic-curl-to-code';
import { memoryHost, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryFactory, RestoreRequest, ToolHistory } from '@workspace/tools-host';

afterEach(cleanup);

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

const input = () => screen.getByLabelText('curl command') as HTMLTextAreaElement;
const output = () => screen.getByLabelText('Code') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const status = () => document.querySelector('[data-part="status"]')!;
const warnings = () => [...document.querySelectorAll('[data-part="warning"]')].map(w => w.textContent);
const credentials = () => document.querySelector('[data-part="credentials"]')?.textContent ?? null;
const hint = () => document.querySelector('[data-hint]')?.textContent ?? '';
const copy = () => screen.getByRole('button', { name: /^Cop(y|ied)$/ });
const settle = () => act(async () => undefined);
/** Waits until the writer of `client` is loaded and the code is the one of the command shown. */
const loaded = (client = 'javascript') => waitFor(() => expect(output().dataset.client).toBe(client));
const chooseTarget = async (name: string, client?: string) => {
  fireEvent.keyDown(screen.getByLabelText('Target'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
  if (client) await loaded(client);
};

const BASH = `curl 'https://api.example.com/api' \\\n  -H 'accept: */*' \\\n  -b 'sid=abc; theme=dark' \\\n  --data-raw $'{"text":"hi"}'`;

describe('the cURL to Code tool', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition).toMatchObject({
      id: 'curl-to-code',
      title: 'cURL to Code',
      order: 32,
      output: { origin: 'input' },
    });
    expect((await definition.load()).default).toBe(CurlToCodeTool);
  });

  it('recognises a curl command from a module of its own (§7)', () => {
    expect(detect('curl https://api.example.com/users')).toBe(true);
    expect(detect('https://api.example.com/?a=1')).toBe(false);
  });

  it('renders with no host: Target, the command, the code — empty, Copy off, nothing under them (§6)', () => {
    render(<CurlToCodeTool />);
    expect(input().placeholder).toBe("curl https://example.com/users -H 'Accept: application/json'");
    expect(input().getAttribute('spellcheck')).toBe('false');
    expect(input().getAttribute('autocomplete')).toBe('off');
    expect(output().readOnly).toBe(true);
    expect(output().getAttribute('spellcheck')).toBe('false');
    expect(screen.getByLabelText('Target').textContent).toBe('JavaScript (fetch)');
    expect(copy()).toHaveProperty('disabled', true);
    expect(status().textContent?.trim()).toBe('');
    expect(warnings()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Convert' })).toBeNull();
    type('  \n ');
    expect(output().value).toBe('');
    expect(status().textContent?.trim()).toBe('');
  });
});

describe('§2 scenarios', () => {
  it('1. "Copy as cURL (bash)": fetch at once, the Cookie warning, the credentials note last', async () => {
    render(<CurlToCodeTool input={BASH} />);
    await loaded();
    expect(output().value.startsWith("const response = await fetch('https://api.example.com/api', {")).toBe(true);
    expect(output().value).toContain("  method: 'POST',");
    expect(warnings()).toEqual(['A browser does not let fetch set the Cookie header (Node does).']);
    expect(credentials()).toBe('The code contains credentials from the command. Do not share it as is.');
    const list = document.querySelector('[data-part="warnings"]')!;
    expect(list.getAttribute('role')).toBe('status');
    expect(list.lastElementChild?.getAttribute('data-part')).toBe('credentials');
  });

  it('2. Python (requests)', async () => {
    render(<CurlToCodeTool input={BASH} />);
    await chooseTarget('Python (requests)', 'python');
    expect(output().value).toContain('import requests\n\nheaders = {');
    expect(output().value).toContain('data = \'{"text":"hi"}\'');
    expect(output().value).toContain('response = requests.post(');
  });

  it('3. -u in Go: SetBasicAuth with the password as curl splits it', async () => {
    render(<CurlToCodeTool />);
    type("curl -u 'ann:pa:ss' https://api.example.com/me");
    await chooseTarget('Go (net/http)', 'go');
    expect(output().value).toContain('req.SetBasicAuth("ann", "pa:ss")');
  });

  it('4. "Copy as cURL (cmd)": the same code as its bash form', async () => {
    render(<CurlToCodeTool />);
    await loaded();
    type("curl 'https://api.example.com/api?q=1&x=2' -H 'accept: application/json'");
    const bash = output().value;
    type('curl ^"https://api.example.com/api?q=1^&x=2^" ^\n  -H ^"accept: application/json^"');
    expect(output().value).toBe(bash);
  });

  it('5. shell variables stay as written, with a warning', async () => {
    render(<CurlToCodeTool />);
    await loaded();
    type('curl https://api.example.com/x -H "Authorization: Bearer $TOKEN"');
    expect(output().value).toContain("'Authorization': 'Bearer $TOKEN'");
    expect(warnings()).toEqual(['Shell variables and $(…) are not expanded; they stay in the code as written.']);
  });

  it('6. a pipe: only the curl command, a warning', async () => {
    render(<CurlToCodeTool />);
    await loaded();
    type('curl -s https://api.example.com/users | jq .');
    expect(output().value).toBe("const response = await fetch('https://api.example.com/users');\n");
    expect(warnings()).toEqual(['Only the curl command is translated; "| jq ." after it is ignored.']);
  });

  it('7. wget: the error under the command, no code, Copy off; the error puts the caret on its place', async () => {
    render(<CurlToCodeTool />);
    await loaded();
    type('wget https://api.example.com/');
    const error = screen.getByRole('button', { name: 'Line 1, column 1: the command must start with curl' });
    expect(status().getAttribute('role')).toBe('status');
    expect(error.querySelector('svg')).toBeTruthy();
    expect(output().value).toBe('');
    expect(copy()).toHaveProperty('disabled', true);
    expect(warnings()).toEqual([]);
    type("curl -H 'X: 1' 'https://api");
    fireEvent.click(screen.getByRole('button', { name: 'Line 1, column 16: unterminated single quote' }));
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(15);
  });
});

describe('the clients (§4)', () => {
  it('the picker: seventeen clients in four labelled groups, JavaScript (fetch) chosen', async () => {
    render(<CurlToCodeTool input="curl https://api.example.com/users" />);
    await loaded();
    fireEvent.keyDown(screen.getByLabelText('Target'), { key: 'Enter' });
    const options = await screen.findAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(TARGETS.map(t => t.label));
    expect(options).toHaveLength(17);
    expect([...document.querySelectorAll('[data-slot="select-label"]')].map(l => l.textContent)).toEqual([
      'JavaScript',
      'Python',
      'Command line',
      'Other languages',
    ]);
    expect(document.querySelectorAll('[data-slot="select-separator"]')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'JavaScript (fetch)' }).getAttribute('aria-selected')).toBe('true');
  });

  it('every client: choosing it loads its writer and shows its code for the same command', async () => {
    render(<CurlToCodeTool input="curl -X POST https://api.example.com/items -d 'a=1'" />);
    await loaded();
    const seen = new Set<string>();
    for (const t of TARGETS) {
      if (t.value !== 'javascript') await chooseTarget(t.label, t.value);
      expect(screen.getByLabelText('Target').textContent).toBe(t.label);
      expect(output().value).toMatch(/api\.example\.com/);
      seen.add(output().value);
    }
    expect(seen.size).toBe(17);
  });
});

describe('Copy and the result', () => {
  it('copies the code as shown, with its final line break; "Copied" until the code changes', async () => {
    render(<CurlToCodeTool input="curl https://api.example.com/users" />);
    await loaded();
    fireEvent.click(copy());
    await settle();
    expect(writeText).toHaveBeenCalledWith("const response = await fetch('https://api.example.com/users');\n");
    expect(copy().textContent).toBe('Copied');
    type('curl https://api.example.com/other');
    expect(copy().textContent).toBe('Copy');
  });
});

describe('large commands (§12)', () => {
  const big = (n: number) => `curl --data-raw '${'x'.repeat(n)}' https://api.example.com/big`;

  it('above 1 MiB: Convert (or Ctrl+Enter), the line under the command, then the code', async () => {
    render(<CurlToCodeTool />);
    type(big(1024 * 1024));
    expect(status().textContent).toBe('Large command: press Convert (Ctrl+Enter).');
    expect(output().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(output().value).toContain("  body: 'xxx"));
    expect(status().textContent?.trim()).toBe('');
    await chooseTarget('Go (net/http)', 'go');
    expect(output().value).toBe('');
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(output().value).toContain('package main'));
  });

  it('above 16 MiB: refused', () => {
    render(<CurlToCodeTool />);
    type(big(16 * 1024 * 1024));
    expect(status().textContent).toBe('Command is larger than 16 MB.');
    expect(screen.queryByRole('button', { name: 'Convert' })).toBeNull();
  });
});

describe('the history (D17): one secret kind', () => {
  const owner = (history: HistoryFactory): ToolHistory => history.forOwner('curl-to-code', definition.history!);

  it('without a master password nothing is recorded, and the page says so', async () => {
    const host = memoryHost();
    render(<CurlToCodeTool host={host} input={BASH} />);
    await loaded();
    fireEvent.click(copy());
    await settle();
    expect(owner(host.history).status().secrets).toBe('no-password');
    expect((await owner(host.history).list()).entries).toEqual([]);
    expect(hint()).toBe(
      'Nothing is sent: the command is read in this tab and the code is never run. Commands are not kept (no master password).',
    );
  });

  it('unlocked: Copy records one encrypted entry, which opens back into the tool with its language', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<CurlToCodeTool host={host} />);
    expect(hint()).toContain('Commands and code are kept encrypted in this browser.');
    type("curl -X POST https://api.example.com/items -u 'ann:s3cret'");
    await chooseTarget('Rust (reqwest)', 'rust');
    fireEvent.click(copy());
    await waitFor(async () => expect((await owner(host.history).list()).entries).toHaveLength(1));
    const [entry] = (await owner(host.history).list()).entries;
    expect(entry).toMatchObject({ kind: 'converted', encrypted: true });
    // Nothing of the command in clear in the store: not in the record's line, not in its blobs.
    let raw = '';
    for await (const row of host.store.scan({})) {
      raw += row.line;
      for (const hash of row.line.match(/(?:sha256|hmac256)-[A-Za-z0-9_-]+/g) ?? [])
        raw += (await (await host.store.blob(hash))?.data.text()) ?? '';
    }
    expect(raw).toContain('"sealed"');
    expect(raw).not.toContain('s3cret');
    expect(raw).not.toContain('api.example.com');
    expect(raw).not.toContain('basic_auth');
    unmount();

    const restore: RestoreRequest = { id: entry!.id };
    render(<CurlToCodeTool host={host} restore={restore} />);
    await waitFor(() => expect(input().value).toBe("curl -X POST https://api.example.com/items -u 'ann:s3cret'"));
    expect(screen.getByLabelText('Target').textContent).toBe('Rust (reqwest)');
    await loaded('rust');
    expect(output().value).toContain('.basic_auth("ann", Some("s3cret"))');
    expect(document.querySelector('[data-restored]')?.textContent).toBe(
      'Opened from History: POST api.example.com → Rust (reqwest).',
    );
    await settle();
    expect((await owner(host.history).list()).entries).toHaveLength(1);
  });

  it('an edit with code is recorded by the checkpoint rule; text from the start page counts as an edit', async () => {
    const host = await unlockedHost();
    render(<CurlToCodeTool host={host} input="curl https://api.example.com/users" />);
    await loaded();
    await act(async () => {
      dispatchEvent(new Event('pagehide'));
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    await waitFor(async () => expect((await owner(host.history).list()).entries).toHaveLength(1));
  });

  it('locked: nothing is recorded, the page says so, and an entry stays shut', async () => {
    const host = await unlockedHost();
    const id = await (async () => {
      const recorder = owner(host.history).session();
      await recorder.commit(draftOf('curl https://a.example/', 'go', 'package main\n'));
      return (await owner(host.history).list()).entries[0]!.id;
    })();
    await host.vault.lock();
    render(<CurlToCodeTool host={host} restore={{ id }} />);
    await waitFor(() =>
      expect(document.querySelector('[data-restored]')?.textContent).toBe(
        'This entry is encrypted: unlock the history to open it.',
      ),
    );
    expect(input().value).toBe('');
    expect(hint()).toContain('Commands are not kept while the history is locked.');
    type('curl https://api.example.com/x');
    fireEvent.click(copy());
    await settle();
    expect((await owner(host.history).list()).entries).toHaveLength(1);
  });

  it('a new client is kept with its name and opens back into it', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<CurlToCodeTool host={host} input="curl -X PUT https://api.example.com/k -d x=1" />);
    await loaded();
    await chooseTarget('Kotlin (OkHttp)', 'kotlin');
    fireEvent.click(copy());
    await waitFor(async () => expect((await owner(host.history).list()).entries).toHaveLength(1));
    const [entry] = (await owner(host.history).list()).entries;
    unmount();
    render(<CurlToCodeTool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() =>
      expect(document.querySelector('[data-restored]')?.textContent).toBe(
        'Opened from History: PUT api.example.com → Kotlin (OkHttp).',
      ),
    );
    await loaded('kotlin');
    expect(output().value).toContain('.put("x=1".toRequestBody())');
  });

  it('entries: the label names the method, the host and the language; the payload is read back', () => {
    expect(entryLabel("curl -X PUT 'https://api.example.com/a'", 'python')).toBe(
      'PUT api.example.com → Python (requests)',
    );
    expect(entryLabel('curl x', 'javascript')).toBe('curl → JavaScript (fetch)');
    expect(readPayload({ target: 'go' })).toEqual({ target: 'go' });
    expect(readPayload({ target: 'php' })).toEqual({ target: 'php' });
    expect(readPayload({ target: 'cobol' })).toBeUndefined();
    expect(readPayload(null)).toBeUndefined();
  });
});

describe('cURL to Code’s saved parameter: the client (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: { settings: { forTool(id: string): { saved(): unknown } } }) =>
    host.settings.forTool('curl-to-code').saved();
  const shown = () => screen.getByLabelText('Target').textContent;

  it('any of the seventeen clients the person picks is saved — never the command or the code; reopened, it is the client', async () => {
    const host = memoryHost();
    const first = render(<CurlToCodeTool host={host} />);
    type("curl -u 'ann:s3cret' https://api.example.com/x");
    await chooseTarget('Swift (URLSession)', 'swift');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { target: 'swift' } });
    expect(JSON.stringify(savedOf(host))).not.toMatch(/s3cret|example|URLSession\(/);
    render(<CurlToCodeTool host={host} input="curl https://api.example.com/y" />);
    expect(shown()).toBe('Swift (URLSession)');
    await loaded('swift');
    expect(output().value).toContain('api.example.com/y');
    expect(curlToCodeSettings.fields.target.default).toBe('javascript');
    for (const t of TARGETS) expect(curlToCodeSettings.fields.target.accepts(t.value)).toBe(true);
    expect(TARGETS).toHaveLength(17);
  });

  it('a saved client that is not one of them (a later release’s, a damaged record) opens JavaScript (fetch)', async () => {
    const host = memoryHost();
    host.settings.forTool('curl-to-code').save(1, { target: 'cobol' });
    render(<CurlToCodeTool host={host} />);
    expect(shown()).toBe('JavaScript (fetch)');
    await loaded();
  });

  it('an entry opened from History shows its client for the visit; what is saved stays', async () => {
    const host = await unlockedHost();
    const { unmount } = render(<CurlToCodeTool host={host} />);
    type('curl https://api.example.com/items');
    await chooseTarget('Rust (reqwest)', 'rust');
    fireEvent.click(copy());
    await waitFor(async () =>
      expect((await host.history.forOwner('curl-to-code', definition.history!).list()).entries).toHaveLength(1),
    );
    await chooseTarget('Go (net/http)', 'go');
    unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { target: 'go' } });
    const [entry] = (await host.history.forOwner('curl-to-code', definition.history!).list()).entries;
    const opened = render(<CurlToCodeTool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() => expect(shown()).toBe('Rust (reqwest)'));
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { target: 'go' } });
  });

  it('reset opens JavaScript (fetch) again and keeps the command; the code follows', async () => {
    const host = memoryHost();
    host.settings.forTool('curl-to-code').save(1, { target: 'python' });
    render(<CurlToCodeTool host={host} />);
    await loaded('python');
    type('curl https://api.example.com/z');
    await act(async () => host.settings.forTool('curl-to-code').reset());
    expect(shown()).toBe('JavaScript (fetch)');
    await loaded();
    expect(input().value).toBe('curl https://api.example.com/z');
    expect(output().value).toContain('fetch(');
    expect(savedOf(host)).toBeUndefined();
  });
});
