/**
 * docs/tools/specs/keys.md §2 (scenarios), §6 (messages next to the field), §8 (the interface), §11 (what the history
 * keeps: public keys only — a private key never, even with a master password), automatic copying (the public key,
 * never the private one) and the saved parameters (D21). Web Crypto is Node's (it has Ed25519 and X25519).
 */
import { definition } from './definition';
import { detect } from './detect';
import KeysTool, { EMPTY_GENERATE, EMPTY_INSPECT, STORAGE_FIRST, STORAGE_ON } from './KeysTool';
import { HIDDEN, PRIVATE_NOTE } from './parts';
import { keysSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUTO_COPY, AUTO_COPY_REFUSED, memoryHost, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { ToolHost } from '@workspace/tools-host';

const WAIT = { timeout: 4000 };
const pem = (label: string, lines: string[]) =>
  [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ''].join('\n');
// Published test keys, RFC 8410 §10.3 (the private key) and §4 (its public key).
const ED_PRIVATE = pem('PRIVATE KEY', ['MC4CAQAwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC']); // gitleaks:allow — published test key, RFC 8410
const ED_SPKI = pem('PUBLIC KEY', ['MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=']);
const ED_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBm/RAlphM3+hUG6wWfcO5bIUIaqMLa2ywxcOK1wMWbh';
// ssh-keygen -l of ED_LINE (OpenSSH 10.5).
const ED_SHA256 = 'SHA256:ebCT4wkJOqO5AIlHG03cHvn3Cr3ZZEEh8m81duHhR3Q';
// The private bytes in Base64, as they would appear in a record if one leaked.
const ED_SEED_B64 = '1O5y2/kTWErVttjx92n4rTr+fCjL8dT74Jeoj0R1WEI';

const output = (label: string) => (screen.getByLabelText(label) as HTMLTextAreaElement).value;
const summary = () => document.querySelector('[data-summary]')?.textContent;
const typeKey = (text: string) => fireEvent.change(screen.getByLabelText('Key'), { target: { value: text } });
const radio = (name: string) => screen.getByRole('radio', { name });
const formRadio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};
const generate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  });
  await waitFor(() => expect(summary()).toMatch(/key pair$/), WAIT);
};
const entriesOf = async (host: ToolHost) => (await host.history.forOwner('keys', definition.history!).list({})).entries;

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Key Pairs tool’s definition', () => {
  it('describes the tool, recognises keys and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'keys',
      title: 'Key Pairs',
      order: 43,
      output: { origin: 'generated', copies: 'text' },
    });
    expect(definition.summary).toBe(
      'Generate RSA, EC and Ed25519 key pairs; convert keys between PEM, JWK and OpenSSH; fingerprints.',
    );
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['generated', 'inspected']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect(detect(ED_SPKI)).toBe(true);
    expect(detect(ED_LINE)).toBe(true);
    expect(detect('hello')).toBe(false);
    expect((await definition.load()).default).toBe(KeysTool);
  });
});

describe('Generate', () => {
  it('§2.1: opens in Generate with Ed25519 and nothing made; a pair with a comment, the private key hidden', async () => {
    render(<KeysTool />);
    expect(radio('Generate').getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('Algorithm').textContent).toBe('Ed25519');
    expect(screen.getByText(EMPTY_GENERATE)).toBeTruthy();
    expect(document.querySelector('[data-key]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'alice@laptop' } });
    await generate();
    expect(summary()).toBe('Ed25519 key pair');
    expect(screen.getByText(/^Generated in (\d+ ms|\d+\.\d s)$/)).toBeTruthy();
    expect(output('Public key')).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+ alice@laptop\n$/);
    expect(screen.getByLabelText('SHA256 (OpenSSH)').textContent).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    // The private key: hidden, with the sentence about memory; Show shows PKCS#8; the forms switch.
    expect(screen.queryByLabelText('Private key')).toBeNull();
    expect(screen.getByText(HIDDEN)).toBeTruthy();
    expect(screen.getByText(PRIVATE_NOTE)).toBeTruthy();
    const show = screen.getByRole('button', { name: /Show private key/ });
    expect(show.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(show);
    expect(output('Private key')).toMatch(/^-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI/); // gitleaks:allow — a prefix pattern, no key
    fireEvent.click(formRadio('Private key form', 'OpenSSH'));
    expect(output('Private key')).toMatch(
      /^-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ/,
    );
    // Copy of the private key works hidden too; Clear forgets the pair.
    fireEvent.click(show);
    expect(screen.queryByLabelText('Private key')).toBeNull();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-copy-private]')!);
    });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('BEGIN OPENSSH PRIVATE KEY'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(document.querySelector('[data-key]')).toBeNull();
    expect(screen.getByText(EMPTY_GENERATE)).toBeTruthy();
  });

  it('§2.2: RSA 2048 with RS256 — the JWK has alg, use and the RFC 7638 kid', async () => {
    render(<KeysTool />);
    await choose('Algorithm', 'RSA');
    fireEvent.click(radio('2048'));
    expect(screen.getByLabelText('JWK algorithm').textContent).toBe('RS256');
    await generate();
    expect(summary()).toBe('RSA 2048-bit key pair');
    fireEvent.click(formRadio('Public key form', 'JWK'));
    const jwk = JSON.parse(output('Public key')) as Record<string, string>;
    expect(Object.keys(jwk)).toEqual(['kty', 'n', 'e', 'alg', 'use', 'kid']);
    expect(jwk).toMatchObject({ kty: 'RSA', e: 'AQAB', alg: 'RS256', use: 'sig' });
    expect(jwk.kid).toBe(screen.getByLabelText('JWK thumbprint (RFC 7638)').textContent);
    fireEvent.click(screen.getByLabelText('Add kid (RFC 7638 thumbprint)'));
    expect(JSON.parse(output('Public key')).kid).toBeUndefined();
  });

  it('X25519: no OpenSSH forms, no comment field; the public key opens as PEM', async () => {
    render(<KeysTool />);
    await choose('Algorithm', 'X25519');
    expect(screen.queryByLabelText('Comment')).toBeNull();
    await generate();
    expect(summary()).toBe('X25519 key pair');
    expect(output('Public key')).toMatch(/^-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VuAyEA/);
    const forms = within(screen.getByRole('radiogroup', { name: 'Public key form' }))
      .getAllByRole('radio')
      .map(r => r.textContent);
    expect(forms).toEqual(['PEM', 'JWK']);
    expect(screen.queryByLabelText('SHA256 (OpenSSH)')).toBeNull();
  });

  it('§5.1: a browser without Ed25519 and X25519 — the options are off with a line, ECDSA P-256 is chosen', async () => {
    const real = crypto.subtle.generateKey.bind(crypto.subtle) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(crypto.subtle, 'generateKey').mockImplementation(((algorithm: { name: string }, ...rest: unknown[]) =>
      algorithm.name === 'Ed25519' || algorithm.name === 'X25519'
        ? Promise.reject(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError'))
        : real(algorithm, ...rest)) as never);
    render(<KeysTool />);
    await waitFor(() => expect(screen.getByLabelText('Algorithm').textContent).toBe('ECDSA P-256'));
    expect(
      screen.getByText('Ed25519 needs Chrome 137 or later; this browser has no Ed25519 in Web Crypto.'),
    ).toBeTruthy();
    expect(
      screen.getByText('X25519 needs Chrome 133 or later; this browser has no X25519 in Web Crypto.'),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Algorithm'));
    });
    const option = await screen.findByRole('option', { name: 'Ed25519 — not in this browser' });
    expect(option.getAttribute('data-disabled')).not.toBeNull();
  });

  it('Generating… with Cancel throws the result away; a refusal of the browser is an alert', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const real = crypto.subtle.generateKey.bind(crypto.subtle) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi
      .spyOn(crypto.subtle, 'generateKey')
      .mockImplementation(((algorithm: { name: string }, ...rest: unknown[]) =>
        algorithm.name === 'ECDSA'
          ? new Promise(resolve => (finish = resolve)).then(() => real(algorithm, ...rest))
          : real(algorithm, ...rest)) as never);
    render(<KeysTool />);
    await choose('Algorithm', 'ECDSA P-256');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(document.querySelector('[data-busy]')!.textContent).toBe('Generating…');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.getAttribute('title')).toBe('The browser finishes the key; it is thrown away.');
    fireEvent.click(cancel);
    expect(document.querySelector('[data-announcement]')!.textContent).toBe('Cancelled.');
    await act(async () => finish(undefined));
    await act(async () => new Promise(r => setTimeout(r, 50)));
    expect(document.querySelector('[data-key]')).toBeNull();

    spy.mockImplementation((() => Promise.reject(new DOMException('no', 'OperationError'))) as never);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    });
    expect(await screen.findByText('The browser could not generate the key: OperationError.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('The browser could not generate the key: OperationError.');
  });
});

describe('Inspect', () => {
  it('§2.3: a pasted public key opens Inspect; kind, forms and fingerprints', async () => {
    render(<KeysTool input={ED_SPKI} />);
    expect(radio('Inspect').getAttribute('data-state')).toBe('on');
    await waitFor(() => expect(summary()).toBe('Ed25519 public key (SPKI)'));
    expect(output('Public key')).toBe(`${ED_LINE}\n`);
    await waitFor(() => expect(screen.getByLabelText('SHA256 (OpenSSH)').textContent).toBe(ED_SHA256));
    expect(screen.getByLabelText('MD5 (OpenSSH, legacy)').textContent).toBe(
      'MD5:a4:93:e0:e6:59:bd:5e:0e:be:ad:f9:d7:f9:bd:c2:85',
    );
    expect(screen.getByLabelText('SPKI SHA-256 (Base64)').textContent).toBe(
      'oekVYFTgT6yJmunydRMs3Ael28TqLCrTof/G4NJTaB8=',
    );
    expect(document.querySelector('[data-private]')).toBeNull();
  });

  it('§2.4: a JWK Set — a switch, the kid in the summary, a bad key in its place', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
    const set = JSON.stringify({
      keys: [
        { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo', kid: 'a' },
        { ...ec, kid: '2024-01' },
        { kty: 'RSA', e: 'AQAB' },
      ],
    });
    render(<KeysTool input={set} />);
    await waitFor(() => expect(screen.getByText('3 keys')).toBeTruthy());
    expect(document.querySelector('[data-message="error"]')!.textContent).toBe('Key 3: The JWK has no "n".');
    fireEvent.click(screen.getByRole('radio', { name: 'Key 2' }));
    await waitFor(() => expect(summary()).toBe('EC P-256 public key (JWK Set), kid "2024-01"'));
    fireEvent.click(formRadio('Public key form', 'PEM'));
    expect(output('Public key')).toMatch(/^-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/);
  });

  it('§2.5: a private key — its public key and private forms, hidden; §6 messages next to the field', async () => {
    render(<KeysTool input={ED_PRIVATE} />);
    await waitFor(() => expect(summary()).toBe('Ed25519 private key (PKCS#8)'));
    expect(output('Public key')).toBe(`${ED_LINE}\n`);
    expect(screen.getByText(HIDDEN)).toBeTruthy();
    typeKey('hello');
    await waitFor(() => expect(document.querySelector('[data-message="error"]')).not.toBeNull());
    expect(document.querySelector('[data-message="error"]')!.textContent).toBe(
      'No key found. Paste a PEM block (-----BEGIN PUBLIC KEY-----), a JWK, a JWK Set or an OpenSSH public key line.',
    );
    typeKey(pem('CERTIFICATE', ['MIIB']));
    await waitFor(() =>
      expect(document.querySelector('[data-message="error"]')!.textContent).toBe(
        'This is a certificate, not a key. The X.509 Certificate tool reads certificates and shows their public key.',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText(EMPTY_INSPECT)).toBeTruthy();
  });

  it('§2.7: a weak RSA key and an odd exponent are notes', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent: 3 });
    render(<KeysTool input={publicKey.export({ type: 'spki', format: 'pem' }).toString()} />);
    await waitFor(() => expect(summary()).toBe('RSA 1024-bit public key (SPKI), exponent 3'));
    expect(screen.getByText('RSA keys shorter than 2048 bits are considered weak.')).toBeTruthy();
    expect(screen.getByText('The public exponent is 3, not the usual 65537.')).toBeTruthy();
  });
});

describe('history (D17): public keys only', () => {
  it('Generate commits the public key and fingerprint; the entry opens in Inspect with the public key', async () => {
    const host = memoryHost();
    const { unmount } = render(<KeysTool host={host} />);
    expect(screen.getByText(`${STORAGE_FIRST} ${STORAGE_ON}`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'ci@stand' } });
    await generate();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    const [entry] = await entriesOf(host);
    expect(entry!.kind).toBe('generated');
    expect(entry!.label).toMatch(/^Ed25519 key pair · SHA256:[A-Za-z0-9+/]{43}$/);
    const line = output('Public key').trim();
    unmount();

    render(<KeysTool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() => expect((screen.getByLabelText('Key') as HTMLTextAreaElement).value).toBe(`${line}\n`));
    expect(screen.getByText(`Opened from History: ${entry!.label}. Only the public key was kept.`)).toBeTruthy();
    await waitFor(() => expect(summary()).toBe('Ed25519 public key (OpenSSH), comment "ci@stand"'));
    expect(document.querySelector('[data-private]')).toBeNull();
  });

  it('a private key leaves nothing of itself behind, even with a master password set and unlocked', async () => {
    const host = await unlockedHost();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-384' });
    const sec1 = ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    const d = ec.privateKey.export({ format: 'jwk' }).d!;
    const body = sec1.split('\n')[1]!;
    const first = render(<KeysTool host={host} input={ED_PRIVATE} />);
    await waitFor(() => expect(summary()).toBe('Ed25519 private key (PKCS#8)'));
    await waitFor(() => expect(screen.getByLabelText('SHA256 (OpenSSH)').textContent).toBe(ED_SHA256));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-copy-public]')!);
    });
    typeKey(sec1);
    await waitFor(() => expect(summary()).toBe('EC P-384 private key (SEC1)'));
    await act(async () => new Promise(r => setTimeout(r, 50)));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-copy-public]')!);
    });
    await waitFor(async () => expect((await entriesOf(host)).length).toBeGreaterThanOrEqual(2), WAIT);
    // Generate too, with the private key shown and copied.
    fireEvent.click(radio('Generate'));
    await generate();
    fireEvent.click(screen.getByRole('button', { name: /Show private key/ }));
    const generatedBody = output('Private key').split('\n')[1]!;
    await act(async () => {
      fireEvent.click(document.querySelector('[data-copy-private]')!);
    });
    first.unmount();
    await act(async () => new Promise(r => setTimeout(r, 100)));
    const lines: string[] = [];
    for await (const row of host.store.scan({})) {
      lines.push(row.line);
      for (const hash of row.blobs) {
        const blob = await host.store.blob(hash);
        if (blob) lines.push(await blob.data.text());
      }
    }
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line).not.toContain('PRIVATE KEY');
      expect(line).not.toContain(ED_SEED_B64);
      expect(line).not.toContain(body);
      expect(line).not.toContain(d);
      expect(line).not.toContain(generatedBody);
    }
    for (const entry of await entriesOf(host)) {
      const opened = await host.history.forOwner('keys', definition.history!).open(entry.id);
      expect(opened.ok).toBe(true);
      if (!opened.ok) continue;
      const text = JSON.stringify(opened.payload);
      expect(text).not.toContain('PRIVATE');
      expect(text).not.toContain(d);
    }
    expect(JSON.stringify(host.settings.forTool('keys').saved() ?? {})).not.toMatch(/PRIVATE|AAAA/);
  });
});

describe('automatic copying after generating (copying.md §6): the public key, never the private one', () => {
  const autoCopyHost = async (on: boolean) => {
    const host = memoryHost();
    await host.settings.setForAll(['keys'], { [AUTO_COPY]: on });
    return host;
  };

  it('off: Generate copies nothing', async () => {
    render(<KeysTool host={await autoCopyHost(false)} />);
    await generate();
    expect(writeText).not.toHaveBeenCalled();
    expect(document.querySelector('[data-announcement]')!.textContent).toBe('New Ed25519 key pair generated');
  });

  it('on: Generate copies the public key as its Copy would, says so once, the Copy button shows Copied', async () => {
    const host = await autoCopyHost(true);
    render(<KeysTool host={host} />);
    await generate();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toBe(output('Public key'));
    expect(copied).not.toContain('PRIVATE');
    await waitFor(() =>
      expect(document.querySelector('[data-announcement]')!.textContent).toBe(
        'New Ed25519 key pair generated and copied',
      ),
    );
    expect((document.querySelector('[data-copy-public]') as HTMLElement).textContent).toBe('Copied');
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
  });

  it('on: opening an entry, editing, changing a form copy nothing; a refusal is one line', async () => {
    const host = await autoCopyHost(true);
    writeText.mockImplementation(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    const first = render(<KeysTool host={host} />);
    await generate();
    expect(await screen.findByText(AUTO_COPY_REFUSED)).toBeTruthy();
    expect(screen.getByText(AUTO_COPY_REFUSED).getAttribute('role')).toBeNull();
    first.unmount();
    writeText.mockClear();
    writeText.mockImplementation(() => Promise.resolve());
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1));
    const [entry] = await entriesOf(host);
    render(<KeysTool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() => expect(summary()).toMatch(/public key/));
    typeKey(ED_SPKI);
    await waitFor(() => expect(summary()).toBe('Ed25519 public key (SPKI)'));
    fireEvent.click(formRadio('Public key form', 'PEM'));
    await act(async () => new Promise(r => setTimeout(r, 50)));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('the Key Pairs tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('keys').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('keys').save(keysSettings.schema, values as never);
    await host.settings.forTool('keys').flush();
  };

  it('saves nothing until a choice changes; reopened, it is as left (never a key or the comment)', async () => {
    const host = memoryHost();
    const first = render(<KeysTool host={host} />);
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'me@host' } });
    await host.settings.forTool('keys').flush();
    expect(savedOf(host)).toBeUndefined();
    await choose('Algorithm', 'RSA');
    fireEvent.click(radio('4096'));
    await choose('JWK algorithm', 'PS256');
    fireEvent.click(screen.getByLabelText('Add kid (RFC 7638 thumbprint)'));
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { algorithm: 'RSA', size: 4096, rsaAlg: 'PS256', addKid: false },
    });
    render(<KeysTool host={host} />);
    expect(screen.getByLabelText('Algorithm').textContent).toBe('RSA');
    expect(radio('4096').getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('JWK algorithm').textContent).toBe('PS256');
    expect((screen.getByLabelText('Comment') as HTMLInputElement).value).toBe('');
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'inspect', algorithm: 'Ed448', size: 1024, publicForm: 'jwk', addKid: 'yes' });
    render(<KeysTool host={host} input={ED_SPKI} />);
    await waitFor(() => expect(summary()).toBe('Ed25519 public key (SPKI)'));
    expect(output('Public key')).toMatch(/^\{\n {2}"kty": "OKP"/);
    fireEvent.click(radio('Generate'));
    expect(screen.getByLabelText('Algorithm').textContent).toBe('Ed25519');
    expect(screen.getByLabelText('Add kid (RFC 7638 thumbprint)').getAttribute('data-state')).toBe('checked');
  });

  it('an entry and a paste win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    await seed(host, { algorithm: 'P-384' });
    const first = render(<KeysTool host={host} input={ED_SPKI} />);
    expect(radio('Inspect').getAttribute('data-state')).toBe('on');
    await waitFor(() => expect(summary()).toBeTruthy());
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { algorithm: 'P-384' } });
    const recorder = host.history.forOwner('keys', definition.history!).session();
    await recorder.commit({
      kind: 'generated',
      label: 'RSA 2048-bit key pair · SHA256:x',
      payload: {
        algorithm: 'RSA',
        size: 2048,
        rsaAlg: 'RSA-OAEP-256',
        addKid: true,
        comment: '',
        publicText: ED_LINE,
        fingerprint: 'x',
      } as never,
    });
    const [entry] = await entriesOf(host);
    render(<KeysTool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() => expect(summary()).toBe('Ed25519 public key (OpenSSH)'));
    fireEvent.click(radio('Generate'));
    expect(screen.getByLabelText('Algorithm').textContent).toBe('RSA');
    expect(screen.getByLabelText('JWK algorithm').textContent).toBe('RSA-OAEP-256');
    expect(savedOf(host)).toEqual({ schema: 1, values: { algorithm: 'P-384' } });
  });

  it('the host’s reset puts the defaults back', async () => {
    const host = memoryHost();
    await seed(host, { algorithm: 'P-521', mode: 'inspect' });
    render(<KeysTool host={host} />);
    expect(radio('Inspect').getAttribute('data-state')).toBe('on');
    await act(async () => host.settings.forTool('keys').reset());
    expect(radio('Generate').getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('Algorithm').textContent).toBe('Ed25519');
  });
});
