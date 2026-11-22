// The page (docs/tools/specs/x509.md §2, §6, §8): scenarios as a person does them, copying, the messages next to the
// field, the clock, and what the history keeps — never a private key. Certificates are the generated fixtures of the
// logic package (read from its folder as test data); private keys are made here by node:crypto and thrown away.
import { definition } from './definition';
import { detect } from './detect';
import { readPayload } from './entries';
import X509Tool from './X509Tool';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost, unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolHost } from '@workspace/tools-host';

const pem = (name: string): string =>
  readFileSync(join(__dirname, '../../../logic/x509/fixtures', `${name}.pem`), 'utf8');
const LEAF = pem('spec-leaf');
const CA = pem('spec-ca');
const CHAIN = `${pem('leaf-p256')}${pem('issuing-rsa4096')}${pem('root-rsa2048')}`;
const derOf = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64'));
/** A throwaway private key, made for this run. Its Base64 body must never show up anywhere it could be kept. */
const throwawayKey = (): { pem: string; body: string } => {
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const text = key.toString();
  return { pem: text, body: text.split('\n')[1]! };
};

const WAIT = { timeout: 15_000 };
const field = () => screen.getByLabelText('Input') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const messages = () => [...document.querySelectorAll('[data-message]')].map(m => m.textContent);
const section = (name: string) => document.querySelector(`[data-section="${name}"]`) as HTMLElement;
const stubClipboard = () => {
  const writeText = vi.fn((text: string) => Promise.resolve(void text));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};
const entriesOf = async (host: ToolHost) => (await host.history.forOwner('x509', definition.history!).list({})).entries;

beforeEach(() => at('2026-11-19T00:00:00Z'));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the X.509 Certificate tool', () => {
  it('is described by its definition, which loads it; states its output and no shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'x509',
      title: 'X.509 Certificate',
      order: 26,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toHaveLength(11);
    expect((await definition.load()).default).toBe(X509Tool);
  });

  it('recognises a certificate PEM from a module of its own (§7)', () => {
    expect(detect(LEAF)).toBe(true);
    expect(detect('-----BEGIN PUBLIC KEY-----')).toBe(false);
    expect(detect('')).toBe(false);
  });

  it('renders with no host at all: the empty state and the hint (§8)', () => {
    render(<X509Tool />);
    expect(field().placeholder).toBe('-----BEGIN CERTIFICATE-----');
    expect(field().getAttribute('spellcheck')).toBe('false');
    expect(screen.getByText('Paste a certificate or open a .pem, .crt, .cer or .der file.')).toBeTruthy();
    expect(
      screen.getByText('This tool reads certificates. It does not check signatures, trust or revocation.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });
});

describe('§2 scenarios', () => {
  it('1: the LEAF certificate — name, status, self-issued, key, names, fingerprint with Copy', async () => {
    const writeText = stubClipboard();
    render(<X509Tool />);
    type(LEAF);
    expect(document.querySelector('[data-subject-display]')!.textContent).toBe('test.example.com');
    expect(document.querySelector('[data-validity]')!.textContent).toBe('Valid: expires in 23 years');
    expect(screen.getByText('Self-issued')).toBeTruthy();
    expect(within(section('Public key')).getByText('EC P-256')).toBeTruthy();
    expect(within(section('Subject')).getByLabelText('Subject (RFC 4514)').textContent).toBe(
      'CN=test.example.com,OU=Certificates,O=Example Tools Test,C=DE',
    );
    const san = document.querySelector('[data-extension="2.5.29.17"]') as HTMLElement;
    expect([...san.querySelectorAll('li')].map(li => li.textContent)).toEqual([
      'DNS test.example.com',
      'DNS *.test.example.com',
      'IP 192.0.2.10',
      'IP 2001:db8::1',
      'Email admin@example.com',
      'URI https://example.com/',
    ]);
    const sha256 = '9A:0F:75:02:BB:18:B0:85:BB:8F:7C:81:F8:9A:05:CB:44:22:5A:D9:B7:48:50:01:7F:E2:C4:80:07:35:D9:BD';
    await waitFor(
      () => expect(within(section('Fingerprints')).getByLabelText('SHA-256').textContent).toBe(sha256),
      WAIT,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy SHA-256' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sha256));
    await waitFor(() =>
      expect(within(section('Public key')).getByLabelText('SPKI SHA-256').textContent).toBe(
        'ekG9wAgKm6o/dtNzloLwQN6mo9ZPoSq0OaYuAsXBpaM=',
      ),
    );
    expect(document.querySelectorAll('[data-chain-switch]')).toHaveLength(0);
  });

  it('2: openssl s_client -showcerts output — 3 certificates, a switch, the chain line', () => {
    render(<X509Tool />);
    type(
      `CONNECTED(00000003)\ndepth=2 C = DE\n---\nCertificate chain\n 0 s:CN = www.example.com\n${CHAIN}---\nServer certificate\n`,
    );
    expect(screen.getByText('3 certificates')).toBeTruthy();
    const group = document.querySelector('[data-chain-switch]') as HTMLElement;
    expect(group.querySelector('[aria-label="Certificate"]')).toBeTruthy();
    expect(
      within(group)
        .getAllByRole('radio')
        .map(r => r.textContent),
    ).toEqual(['1', '2', '3']);
    expect(document.querySelector('[data-chain]')!.textContent).toBe(
      'Issued by certificate 2 (names match; signature not checked)',
    );
    expect(screen.getByText('End-entity certificate')).toBeTruthy();
    fireEvent.click(within(group).getByRole('radio', { name: 'Certificate 2' }));
    expect(document.querySelector('[data-subject-display]')!.textContent).toBe('Example Test Issuing CA 1');
    expect(screen.getByText('CA certificate')).toBeTruthy();
    fireEvent.click(within(group).getByRole('radio', { name: 'Certificate 3' }));
    expect(screen.getByText('CA certificate · Self-issued')).toBeTruthy();
    expect(document.querySelector('[data-chain]')).toBeNull();
  });

  it('3: Open file with DER — the same reading, the file line under the field', async () => {
    render(<X509Tool />);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File([derOf(LEAF)], 'server.der')] } });
    await waitFor(() => expect(document.querySelector('[data-subject-display]')?.textContent).toBe('test.example.com'));
    expect(document.querySelector('[data-file]')!.textContent).toBe('server.der — 703 bytes');
    expect(field().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(document.querySelector('[data-file]')).toBeNull();
    expect(screen.getByText('Paste a certificate or open a .pem, .crt, .cer or .der file.')).toBeTruthy();
  });

  it('3: a file dropped on the field is opened, not inserted', async () => {
    render(<X509Tool />);
    const file = new File([LEAF], 'chain.pem');
    fireEvent.drop(field(), { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() => expect(document.querySelector('[data-file]')?.textContent).toBe('chain.pem — 1009 bytes'));
    expect(document.querySelector('[data-subject-display]')!.textContent).toBe('test.example.com');
  });

  it('4: the CA certificate in November 2025 — expired, basic constraints, key usage', () => {
    at('2025-11-19T00:00:00Z');
    render(<X509Tool />);
    type(CA);
    expect(document.querySelector('[data-validity]')!.textContent).toBe('Expired 10 months ago');
    expect(document.querySelector('[data-validity="expired"] svg')).toBeTruthy();
    const ext = (oid: string) => document.querySelector(`[data-extension="${oid}"]`)!.textContent;
    expect(ext('2.5.29.19')).toBe('Basic constraints2.5.29.19CriticalCA: yes, path length 0');
    expect(ext('2.5.29.15')).toBe('Key usage2.5.29.15CriticalCertificate signing, CRL signing');
    expect(document.querySelector('[data-subject-display]')!.textContent).toBe('Test Root CA, "Quoted"');
  });

  it('5: a private key with the certificate — the certificate read, the warning above', () => {
    render(<X509Tool />);
    type(`${throwawayKey().pem}\n${LEAF}`);
    expect(messages()).toEqual([
      'Line 1: A private key block was ignored. This tool never reads private keys; remove it from the field.',
    ]);
    expect(document.querySelector('[data-subject-display]')!.textContent).toBe('test.example.com');
  });

  it('6: a certificate request', () => {
    render(<X509Tool />);
    type('-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----');
    expect(messages()).toEqual(['Certificate requests (CSR) are not supported.']);
  });

  it('7: broken Base64; truncated DER', () => {
    render(<X509Tool />);
    type(LEAF.replace('REUxGzAZ', 'REUx!zAZ'));
    expect(messages()).toEqual(['The CERTIFICATE block is not valid Base64. Line 3, column 5: invalid character "!".']);
    const cut = Buffer.from(derOf(LEAF).slice(0, 400)).toString('base64');
    type(`-----BEGIN CERTIFICATE-----\n${cut}\n-----END CERTIFICATE-----`);
    expect(messages()).toEqual(['Byte 0: the element is longer than the data left (truncated certificate?).']);
    expect(document.querySelector('[data-message]')!.getAttribute('role')).toBe('status');
  });
});

describe('§6 and §8 details', () => {
  it('hello: no certificate found; a public key is skipped with its label', () => {
    render(<X509Tool />);
    type('hello');
    expect(messages()).toEqual([
      'No certificate found. Paste a PEM block (-----BEGIN CERTIFICATE-----) or Base64 DER, or open a .crt / .der file.',
    ]);
    type('-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----');
    expect(messages()).toEqual(['A "PUBLIC KEY" block is not a certificate; it was skipped.']);
  });

  it('text over 1 MB and a file over 1 MB are refused in words', () => {
    render(<X509Tool />);
    type('A'.repeat(1_048_577));
    expect(messages()).toEqual(['The text is larger than 1 MB; certificates are much smaller.']);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File([new Uint8Array(1_048_577)], 'big.bin')] } });
    expect(messages()).toEqual(['This file is larger than 1 MB; certificates are much smaller.']);
    expect(document.querySelector('[data-file]')!.textContent).toBe('big.bin — 1 MB');
  });

  it('v1 without extensions and with no expiration date; weak key and signature are warned about', () => {
    render(<X509Tool />);
    type(pem('weak-v1'));
    expect(within(section('Extensions')).getByText('No extensions')).toBeTruthy();
    expect(within(section('Details')).getByText('v1')).toBeTruthy();
    expect(
      within(section('Validity')).getByText('No expiration date (99991231235959Z, RFC 5280 §4.1.2.5).'),
    ).toBeTruthy();
    expect(document.querySelector('[data-validity]')!.textContent).toBe('Valid: no expiration date');
    expect([...document.querySelectorAll('[data-warning]')].map(w => w.textContent)).toEqual([
      'RSA keys shorter than 2048 bits are considered weak.',
      'This signature algorithm is no longer considered secure.',
    ]);
  });

  it('the not-yet-valid ED certificate; the times in three lines', () => {
    render(<X509Tool />);
    type(pem('spec-ed'));
    expect(document.querySelector('[data-validity]')!.textContent).toBe('Not valid yet: starts in 3 years');
    expect(within(section('Validity')).getByText('2030-01-01T00:00:00Z')).toBeTruthy();
    expect(within(section('Validity')).getByText('365 days')).toBeTruthy();
  });

  it('the status moves with the clock (useNow)', async () => {
    at('2026-11-22T12:00:00Z');
    render(<X509Tool />);
    type(pem('leaf-p256'));
    expect(document.querySelector('[data-validity]')!.textContent).toBe('Valid: expires in 9 days');
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    await waitFor(
      () => expect(document.querySelector('[data-validity]')!.textContent).toBe('Valid: expires in 6 days'),
      WAIT,
    );
    vi.setSystemTime(new Date('2026-12-02T12:00:00Z'));
    await waitFor(() => expect(document.querySelector('[data-validity]')!.textContent).toBe('Expired 1 day ago'), WAIT);
  });

  it('copies the subject, the serial number and the PEM; an unknown extension’s whole value', async () => {
    const writeText = stubClipboard();
    render(<X509Tool />);
    type(pem('leaf-p256'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy subject' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('CN=www.example.com,O=Example Tools,L=Berlin,ST=Berlin,C=DE'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy serial number' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('7F0102030405060708090A0B0C0D0E0F10111213'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy PEM' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(pem('leaf-p256')));
    fireEvent.click(screen.getByRole('button', { name: 'Copy 1.2.3.4.5.6 value' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^0C:17:45/)));
    // Addresses are text, never links.
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('long extension values fold (keyboard-reachable <details>)', () => {
    render(<X509Tool />);
    type(pem('leaf-p256'));
    const san = document.querySelector('[data-extension="2.5.29.17"]')!;
    expect(san.querySelector('details > summary')!.textContent).toBe('11 entries');
  });
});

describe('history (D17)', () => {
  it('a person’s edit is recorded as the certificates, written again as PEM; opening a file is a commit', async () => {
    const host = memoryHost();
    const { unmount } = render(<X509Tool host={host} />);
    type(`noise before\n${LEAF}\nnoise after`);
    unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('test.example.com');
    const opened = await host.history.forOwner('x509', definition.history!).open(entry!.id);
    expect(opened.ok && (await opened.blobs.certificates!.text())).toBe(LEAF);
    expect(opened.ok && readPayload(opened.payload)).toEqual({ count: 1 });

    render(<X509Tool host={host} />);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File([CHAIN], 'chain.pem')] } });
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2), WAIT);
    const newest = (await entriesOf(host))[0]!;
    expect(newest.label).toBe('www.example.com and 2 more');
  });

  it('an entry opened from History brings the certificates back and records nothing', async () => {
    const host = memoryHost();
    const first = render(<X509Tool host={host} />);
    type(CHAIN);
    first.unmount();
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    const [entry] = await entriesOf(host);
    const { unmount } = render(<X509Tool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() => expect(field().value).toBe(CHAIN));
    expect(screen.getByText('Opened from History: www.example.com and 2 more.')).toBeTruthy();
    expect(screen.getByText('3 certificates')).toBeTruthy();
    unmount();
    await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
    expect(await entriesOf(host)).toHaveLength(1);
  });

  it('a private key leaves nothing behind, even with a master password set and unlocked', async () => {
    const host = await unlockedHost();
    const key = throwawayKey();
    // The key alone: no entry, no blob, no label.
    const alone = render(<X509Tool host={host} />);
    type(key.pem);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File([key.pem], 'key.pem')] },
    });
    await act(async () => new Promise(resolve => setTimeout(resolve, 100)));
    alone.unmount();
    await act(async () => new Promise(resolve => setTimeout(resolve, 100)));
    expect(await host.store.stats()).toMatchObject({ records: 0, blobs: 0 });
    expect(await entriesOf(host)).toEqual([]);

    // The key with a certificate, typed and copied: the certificate is kept, the key is not, in any form.
    stubClipboard();
    const both = render(<X509Tool host={host} />);
    type(`${key.pem}\n${LEAF}`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy serial number' }));
    await waitFor(async () => expect((await entriesOf(host)).length).toBeGreaterThan(0), WAIT);
    both.unmount();
    await act(async () => new Promise(resolve => setTimeout(resolve, 100)));
    const lines: string[] = [];
    for await (const row of host.store.scan({})) {
      lines.push(row.line);
      for (const hash of row.blobs) {
        const blob = await host.store.blob(hash);
        lines.push(JSON.stringify({ ...blob, data: undefined }));
        if (blob) lines.push(await blob.data.text());
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(key.body);
      expect(line).not.toContain('PRIVATE KEY');
    }
    for (const entry of await entriesOf(host)) {
      const opened = await host.history.forOwner('x509', definition.history!).open(entry.id);
      if (!opened.ok) continue;
      const text = await opened.blobs.certificates!.text();
      expect(text).toBe(LEAF);
      expect(JSON.stringify(opened.payload)).not.toContain(key.body);
      expect(entry.label).toBe('test.example.com');
    }
  });
});
