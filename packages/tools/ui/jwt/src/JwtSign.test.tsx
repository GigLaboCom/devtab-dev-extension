/**
 * Signing in the JWT tool (docs/tools/specs/jwt.md §16): the Sign mode — header and payload as JSON, the algorithm
 * written into the header, a secret or a private key —, the token it makes, decoded and verified back by the tool,
 * "Edit and sign" from a decoded token, and the history: the `signed` kind keeps the header, the payload and the token
 * (encrypted, with a master password) and never the key.
 */
import JwtTool from './JwtTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { decodeToken, parseKey, verifyToken } from '@workspace/tool-logic-jwt';
import { unlockedHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

// The tool's own fixture token T1 (jwt.md §10) and its secret.
const T1 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.EGtiSsrqY5aOYhAICf6R9A5yr17V9Qdvjqsg0nJLFX4'; // gitleaks:allow — the specification's sample token
const SECRET = 'tools-test-secret-0123456789abcdef!';

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const signed = () => (screen.getByLabelText('Signed token') as HTMLTextAreaElement).value;
const toSign = () => fireEvent.click(screen.getByRole('radio', { name: 'Sign' }));
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Sign (§16)', () => {
  it('opens with an HS256 header and a sample payload; a secret signs; Decode it verifies with the same secret', async () => {
    render(<JwtTool />);
    toSign();
    expect((screen.getByLabelText('Header') as HTMLTextAreaElement).value).toBe(
      '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
    );
    expect(screen.getByLabelText('Algorithm').textContent).toBe('HS256');
    await waitFor(() =>
      expect(document.querySelector('[data-sign-error="key"]')?.textContent).toBe('Enter the secret to sign with.'),
    );
    type('Signing secret', SECRET);
    await waitFor(() => expect(signed()).toMatch(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[\w-]+\.[\w-]{43}$/));
    fireEvent.click(screen.getByRole('button', { name: 'Decode it' }));
    await waitFor(() =>
      expect(document.querySelector('[data-signature-title]')?.textContent).toBe('Signature verified'),
    );
    expect(screen.getByText(/Nothing is sent: tokens and keys are decoded/)).toBeTruthy();
  });

  it('the algorithm list writes alg; ES256 signs with a SEC1 private key, verified by the public key', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    render(<JwtTool />);
    toSign();
    await choose('Algorithm', 'ES256');
    expect((screen.getByLabelText('Header') as HTMLTextAreaElement).value).toBe(
      '{\n  "alg": "ES256",\n  "typ": "JWT"\n}',
    );
    type('Private key', ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString());
    await waitFor(() => expect(signed()).toMatch(/^eyJ/));
    const decoded = decodeToken(signed());
    if (!decoded.ok) throw new Error('decode');
    const v = await verifyToken(
      decoded.token,
      parseKey({ kind: 'public', text: ec.publicKey.export({ type: 'spki', format: 'pem' }).toString() }),
    );
    expect(v.state).toBe('valid');
    // A public key in the field: words, no token.
    type('Private key', ec.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    await waitFor(() =>
      expect(document.querySelector('[data-sign-error="key"]')?.textContent).toBe(
        'Signing needs the private key; this is a public key.',
      ),
    );
    expect(signed()).toBe('');
  });

  it('alg "none" is refused; a header that is not JSON says where', async () => {
    render(<JwtTool />);
    toSign();
    type('Signing secret', SECRET);
    type('Header', '{"alg":"none"}');
    await waitFor(() =>
      expect(document.querySelector('[data-sign-error="header"]')?.textContent).toBe(
        'alg "none" makes an unsecured token; this tool signs only with a key.',
      ),
    );
    type('Header', '{"alg":');
    await waitFor(() =>
      expect(document.querySelector('[data-sign-error="header"]')?.textContent).toMatch(
        /^The header is not JSON\. Line 1, column 8: /,
      ),
    );
  });

  it('Edit and sign: a decoded token, its secret carried over — re-signed, the same token', async () => {
    render(<JwtTool input={T1} />);
    type('Secret', SECRET);
    await waitFor(() =>
      expect(document.querySelector('[data-signature-title]')?.textContent).toBe('Signature verified'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit and sign' }));
    expect(screen.getByRole('radio', { name: 'Sign' }).getAttribute('data-state')).toBe('on');
    await waitFor(() => expect(signed()).toBe(T1));
  });
});

describe('Sign and the history (D17): the token encrypted, the key never', () => {
  it('Copy commits a signed entry without the secret or the private key; it opens back into Sign with an empty key', async () => {
    const host = await unlockedHost();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pkcs8 = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const d = rsa.privateKey.export({ format: 'jwk' }).d!;
    const first = render(<JwtTool host={host} />);
    toSign();
    type('Signing secret', SECRET);
    await waitFor(() => expect(signed()).toMatch(/^eyJ/));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-copy-signed]')!);
    });
    await choose('Algorithm', 'RS256');
    type('Private key', pkcs8);
    await waitFor(() => expect(signed()).toMatch(/^eyJhbGciOiJSUzI1NiIs/));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-copy-signed]')!);
    });
    const list = async () =>
      (await host.history.forOwner('jwt', (await import('./history')).jwtHistory).list({})).entries;
    await waitFor(async () => expect((await list()).filter(e => e.kind === 'signed')).toHaveLength(2), {
      timeout: 4000,
    });
    first.unmount();
    await act(async () => new Promise(r => setTimeout(r, 100)));
    const texts: string[] = [];
    const history = host.history.forOwner('jwt', (await import('./history')).jwtHistory);
    for (const entry of await list()) {
      const opened = await history.open(entry.id);
      if (opened.ok) texts.push(JSON.stringify(opened.payload));
    }
    for await (const row of host.store.scan({})) texts.push(row.line);
    expect(texts.length).toBeGreaterThan(2);
    for (const t of texts) {
      expect(t).not.toContain(SECRET);
      expect(t).not.toContain(d);
      expect(t).not.toContain('PRIVATE KEY');
      expect(t).not.toContain(pkcs8.split('\n')[1]);
    }
    let rs: { id: string } | undefined;
    for (const entry of await list()) {
      const opened = await history.open(entry.id);
      if (opened.ok && (opened.payload as { alg?: string }).alg === 'RS256') rs = entry;
    }
    if (!rs) throw new Error('no RS256 entry');
    render(<JwtTool host={host} restore={{ id: rs.id }} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Sign' }).getAttribute('data-state')).toBe('on'));
    expect(
      screen.getByText('Opened from History: RS256 · signed. The signing key is never kept: enter it again.'),
    ).toBeTruthy();
    expect((screen.getByLabelText('Private key') as HTMLTextAreaElement).value).toBe('');
  });
});
