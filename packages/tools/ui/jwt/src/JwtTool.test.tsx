import { definition } from './definition';
import { detect } from './detect';
import JwtTool from './JwtTool';
import { readPayload } from './payload';
import { jwtSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from './payload';
import type {
  HistoryDraft,
  OpenedEntry,
  RecordingStatus,
  RecordOutcome,
  ToolHistory,
  ToolHost,
} from '@workspace/tools-host';

// Sample tokens and test keys of docs/tools/specs/jwt.md §10 (the logic package's fixtures.ts holds them all; a
// package's tests do not reach into another package's files). None belongs to a real system.
// A published sample token (the specification's §10, HS256 with its test secret), not a credential.
const T1 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.EGtiSsrqY5aOYhAICf6R9A5yr17V9Qdvjqsg0nJLFX4'; // gitleaks:allow
// A published sample token (the specification's §10, alg none), not a credential.
const T3 =
  'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.'; // gitleaks:allow
// A published sample token (the specification's §10, a JWE), not a credential.
const T11 = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA'; // gitleaks:allow
// A published sample token (the specification's §10, RS256 with the x509 specification's test key), not a credential.
const T_RS256 =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIiwiaWF0IjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.bT7mYXgMn3Iz9US4R01Wsdtsh8zzTEOGYzG1fx8YgEE2Kv_ehmAFd1f1Ndt960ve3mDHaN-oJV_juh30X8_-oLWK-3_t15pZ0o1LTF5ojc2AFKmkeGheJMvBIuf2zy3npF4K5tzvzmdEwdWax4O5hQsTc_TpiWC6b191qL07Hvjw1ZJAJc_BDODculi3S6vfV1bvTOccKt8tIu_5_nbr3_NQilvFSFBJKlhQvaEnrnLzF5h9PXkoSXPUqV47ccymSE4AUZy1ewmWHc1BMHS5X3k-iu3YP3oMz8KMA_uxtDskQ-q-k8ieHC31F_WII1RZxyJxQKjYjHzJBH2C82o97g'; // gitleaks:allow
const SECRET = 'tools-test-secret-0123456789abcdef!';
// The specification's test secret in Base64 (its §2, scenario 3), not a credential.
const SECRET_BASE64 = 'dG9vbHMtdGVzdC1zZWNyZXQtMDEyMzQ1Njc4OWFiY2RlZiE='; // gitleaks:allow
const CA_SPKI = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1Laz8hEQjcfLnLj1nBot
7tJrRR1BTWCnWbfZ6RM6pZXzTfgXDjgqpZrqkVOOZSwTNujVJLW4z8OYMxa7jWm9
FmuMq8ZdYZ7QiWuqqKZB5bV03IQwcWDFfpRYzepqiDgLS1rIsxEqJEXUQUvqC8Ne
1MnBaBYmxKHe5nKaMgfQvzl64SuNi78HG8T27SmXonb0DYF8tbuAbkxw3i9M+36S
hLCk0bVqjQ+7TU5fEw+K5om7CnxFZ4y2w79daohWM7rn3MOl9nlTeclvTdvqvHWc
mNVe2YygVfiRBnnS3XYrgOYO0quzzmTWqxGS6my5GpUeNBw6pQmGpsfej/6Kj3Np
iwIDAQAB
-----END PUBLIC KEY-----`;
// A published sample key (the specification's §10, the public half of the x509 specification's test CA).
const CA_JWK =
  '{"kty":"RSA","n":"1Laz8hEQjcfLnLj1nBot7tJrRR1BTWCnWbfZ6RM6pZXzTfgXDjgqpZrqkVOOZSwTNujVJLW4z8OYMxa7jWm9FmuMq8ZdYZ7QiWuqqKZB5bV03IQwcWDFfpRYzepqiDgLS1rIsxEqJEXUQUvqC8Ne1MnBaBYmxKHe5nKaMgfQvzl64SuNi78HG8T27SmXonb0DYF8tbuAbkxw3i9M-36ShLCk0bVqjQ-7TU5fEw-K5om7CnxFZ4y2w79daohWM7rn3MOl9nlTeclvTdvqvHWcmNVe2YygVfiRBnnS3XYrgOYO0quzzmTWqxGS6my5GpUeNBw6pQmGpsfej_6Kj3Npiw","e":"AQAB"}'; // gitleaks:allow
// A published sample key (the specification's §10, the public half of the x509 specification's test leaf).
const LEAF_JWK =
  '{"kty":"EC","x":"vo8P50TYF6J14lH8qHIQkvXm84dtPO5rrOzCihYjYIw","y":"pssgKCu6eF8IwRg0l92sb8AtRUWe06YUfkQIaFWmhiw","crv":"P-256"}'; // gitleaks:allow

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const signature = () => document.querySelector('[data-signature]');
const signatureTitle = () => document.querySelector('[data-signature-title]')?.textContent ?? null;
const captions = () => [...document.querySelectorAll('[data-caption]')].map(c => c.textContent);
const hint = () => document.querySelector('[data-hint]')?.textContent ?? '';
const pane = (name: string) => screen.getByText(name, { selector: '.kit-tool-pane-head *' }).closest('.kit-tool-pane')!;
const settle = () => act(async () => undefined);
/** Waits for the signature status to leave "Checking signature…". */
const verdict = async (title: string) => waitFor(() => expect(signatureTitle()).toBe(title));
const chooseFormat = async (name: string) => {
  fireEvent.keyDown(screen.getByLabelText('Secret format'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
};

/** A host whose history records every call, with a status the test sets — the factory's sealing is not this tool's. */
const spyHost = (initial: Partial<RecordingStatus> = {}) => {
  const status: RecordingStatus = { gate: 'on', secrets: 'unlocked', declared: true, ...initial };
  const changes: HistoryDraft[] = [];
  const commits: HistoryDraft[] = [];
  const opened = new Map<string, OpenedEntry>();
  const history: ToolHistory = {
    owner: 'jwt',
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
const payloadOf = (draft: HistoryDraft) => draft.payload as unknown as JwtPayload;

describe('the JWT tool’s definition', () => {
  it('describes the tool, detects tokens, declares three secret kinds, derives its output and has no shortcut', async () => {
    expect(definition).toMatchObject({ id: 'jwt', title: 'JWT', order: 4, output: { origin: 'input' } });
    expect(definition.summary).toBe('Decode a JSON Web Token and check its signature with your key.');
    expect(definition.shortcut).toBeUndefined();
    expect(detect(T1)).toBe(true);
    expect(detect(`Bearer ${T1}`)).toBe(true);
    expect(detect('a.b.c')).toBe(false);
    expect(definition.history?.kinds).toEqual([
      { id: 'decoded', title: 'Decoded', secret: true },
      { id: 'checked', title: 'Checked with a key', secret: true },
      { id: 'signed', title: 'Signed', secret: true },
    ]);
    expect((await definition.load()).default).toBe(JwtTool);
  });
});

describe('the JWT tool, rendered with no host (§2, §8)', () => {
  it('empty: only the token field with its placeholder and the line of §8', () => {
    render(<JwtTool />);
    expect(screen.getByLabelText('Token').getAttribute('placeholder')).toBe('Paste a JWT: eyJ…');
    expect(screen.getByText('Paste a token to decode it. Add a key to verify its signature.')).toBeTruthy();
    expect(signature()).toBeNull();
    expect(screen.queryByLabelText('Secret')).toBeNull();
  });

  it('scenario 1: T1 — header, payload, "Signature not verified", exp as ISO, local time and "expired 6 hours ago"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-11-19T19:00:00Z'));
    render(<JwtTool input={T1} />);
    expect(signatureTitle()).toBe('Signature not verified');
    expect(signature()?.getAttribute('role')).toBe('status');
    expect(screen.getByText("Decoding doesn't prove who made the token. Add the key to verify it.")).toBeTruthy();
    expect(screen.getByLabelText('Header').textContent).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect(screen.getByLabelText('Payload').textContent).toContain('"sub": "user-42"');
    expect(captions()).toEqual(['Decoded, not verified', 'Decoded, not verified']);
    expect(screen.getByText('Algorithm: HS256 — HMAC with SHA-256')).toBeTruthy();
    const exp = document.querySelector('[data-claim="exp"]')!.parentElement!;
    expect(within(exp).getByText('2025-11-19T13:00:00Z')).toBeTruthy();
    expect(within(exp).getByText('expired 6 hours ago')).toBeTruthy();
    expect(within(exp).getByText('Expires')).toBeTruthy();
    expect(document.querySelector('[data-times]')?.textContent).toBe('Expired 6 hours ago');
    expect(document.querySelector('[data-signature-bytes]')?.textContent).toBe('32 bytes');
    expect(screen.getByLabelText('Secret').getAttribute('type')).toBe('password');
  });

  it('scenario 2: the secret verifies; one letter changed does not match', async () => {
    render(<JwtTool input={T1} />);
    type('Secret', SECRET);
    await verdict('Signature verified');
    expect(screen.getByText('with the key below')).toBeTruthy();
    expect(captions()).toEqual(['Signature verified', 'Signature verified']);
    expect(screen.getByText('35-byte secret (280 bits)')).toBeTruthy();
    type('Secret', SECRET.replace('!', '?'));
    await verdict('Signature does not match');
    expect(captions()).toEqual(['Decoded, not verified', 'Decoded, not verified']);
  });

  it('scenario 3: Secret format Base64', async () => {
    render(<JwtTool input={T1} />);
    await chooseFormat('Base64');
    type('Secret', SECRET_BASE64);
    await verdict('Signature verified');
  });

  it('a Hex secret that is not hex: the message next to the field, not verified', async () => {
    render(<JwtTool input={T1} />);
    await chooseFormat('Hex');
    type('Secret', 'zz');
    const message = screen.getByText('Position 1: "z" is not a hex digit.');
    expect(message.getAttribute('role')).toBe('status');
    expect(screen.getByLabelText('Secret').getAttribute('aria-describedby')).toBe(message.id);
    expect(signatureTitle()).toBe('Signature not verified');
  });

  it('scenario 4: an RS256 token with the PEM public key, and with a JWK', async () => {
    render(<JwtTool input={T_RS256} />);
    expect(screen.queryByLabelText('Secret')).toBeNull();
    expect(screen.getByLabelText('Public key').getAttribute('placeholder')).toBe(
      '-----BEGIN PUBLIC KEY----- …, a certificate, a JWK or a JWKS',
    );
    type('Public key', CA_SPKI);
    await verdict('Signature verified');
    expect(screen.getByText('RSA 2048-bit public key')).toBeTruthy();
    type('Public key', CA_JWK);
    await verdict('Signature verified');
  });

  it('scenario 5: a JWKS — the key that suits the token is chosen and named', async () => {
    render(<JwtTool input={T_RS256} />);
    type('Public key', `{"keys":[${LEAF_JWK.replace('{', '{"kid":"b",')},${CA_JWK.replace('{', '{"kid":"a",')}]}`);
    await verdict('Signature verified');
    expect(screen.getByText('JWKS with 2 keys')).toBeTruthy();
    expect(screen.getByText('Key used: RSA 2048-bit public key, JWK kid "a" from the set')).toBeTruthy();
  });

  it('scenario 6: alg none — the unsecured line, no key field', () => {
    render(<JwtTool input={T3} />);
    expect(signatureTitle()).toBe('Unsecured token: alg is "none". Anyone could have written it.');
    expect(signature()?.querySelector('.text-destructive svg')).toBeTruthy();
    expect(screen.queryByLabelText('Secret')).toBeNull();
    expect(screen.queryByLabelText('Public key')).toBeNull();
  });

  it('scenario 7: a private key is refused and not used', () => {
    render(<JwtTool input={T_RS256} />);
    type('Public key', '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----');
    expect(
      screen.getByText("This is a private key. Verification needs only the public key; don't paste private keys here."),
    ).toBeTruthy();
    expect(signatureTitle()).toBe('Signature not verified');
  });

  it('scenario 8: "Bearer " and a line break are taken away, with a note', () => {
    render(<JwtTool />);
    type('Token', `Bearer ${T1.slice(0, 40)}\n${T1.slice(40)}`);
    expect(screen.getByText('Removed "Bearer " and line breaks.')).toBeTruthy();
    expect(signatureTitle()).toBe('Signature not verified');
  });

  it('scenario 9: a JWE — the message, its header, no key field, nothing more', () => {
    render(<JwtTool input={T11} />);
    expect(
      screen.getByText('This is an encrypted token (JWE). Only its header can be read without the decryption key.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Header').textContent).toBe('{\n  "alg": "dir",\n  "enc": "A256GCM"\n}');
    expect(screen.queryByLabelText('Payload')).toBeNull();
    expect(screen.queryByLabelText('Secret')).toBeNull();
    expect(screen.queryByText('Signature', { selector: '.kit-tool-pane-head *' })).toBeNull();
  });

  it('§6: an error next to the token field, read out politely; Clear empties token and key', async () => {
    render(<JwtTool input={T1} />);
    type('Secret', SECRET);
    type('Token', 'a.b');
    const message = screen.getByText('A JWT has 3 parts separated by dots (5 for an encrypted token). This has 2.');
    expect(message.getAttribute('role')).toBe('status');
    expect(screen.getByLabelText('Token').getAttribute('aria-describedby')).toBe(message.id);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText('Token') as HTMLTextAreaElement).value).toBe('');
    type('Token', T1);
    expect((screen.getByLabelText('Secret') as HTMLInputElement).value).toBe('');
    await settle();
  });

  it('§5.5: "Checking signature…" until WebCrypto answers; an answer for an older key is dropped', async () => {
    let releaseFirst: (ok: boolean) => void = () => undefined;
    const verify = vi
      .spyOn(crypto.subtle, 'verify')
      .mockImplementationOnce(() => new Promise<boolean>(resolve => (releaseFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve(false));
    render(<JwtTool input={T1} />);
    type('Secret', 'first');
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(signatureTitle()).toBe('Checking signature…');
    type('Secret', 'second');
    await verdict('Signature does not match');
    await act(async () => releaseFirst(true));
    expect(signatureTitle()).toBe('Signature does not match');
    verify.mockRestore();
  });

  it('§6: a token larger than 1 MB is refused before decoding', () => {
    render(<JwtTool />);
    type('Token', `${T1}${'A'.repeat(1024 * 1024)}`);
    expect(screen.getByText('The token is larger than 1 MB. This tool decodes tokens up to 1 MB.')).toBeTruthy();
    expect(signature()).toBeNull();
  });

  it('Show secret shows and hides it, saying so with aria-pressed', () => {
    render(<JwtTool input={T1} />);
    const toggle = screen.getByRole('button', { name: 'Show secret' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Hide secret');
    expect(screen.getByLabelText('Secret').getAttribute('type')).toBe('text');
  });

  it('copies the header, the payload and the signature, each with one press', async () => {
    render(<JwtTool input={T1} />);
    fireEvent.click(within(pane('Header') as HTMLElement).getByRole('button', { name: 'Copy' }));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect(within(pane('Header') as HTMLElement).getByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(within(pane('Payload') as HTMLElement).getByRole('button', { name: 'Copy' }));
    await settle();
    expect(writeText.mock.lastCall?.[0]).toContain('"exp": 1763557200');
    fireEvent.click(within(pane('Signature') as HTMLElement).getByRole('button', { name: 'Copy' }));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(T1.split('.')[2]);
  });

  it('says what happens to tokens and keys now: not kept without a master password (D17)', () => {
    render(<JwtTool input={T1} />);
    expect(hint()).toBe(
      'Nothing is sent: tokens and keys are decoded and checked in this tab. They are not kept (no master password).',
    );
  });
});

describe('the JWT tool’s history (D17)', () => {
  it('with no master password nothing is recorded (the in-memory host)', async () => {
    const host = memoryHost();
    render(<JwtTool host={host} input={T1} />);
    type('Secret', SECRET);
    await verdict('Signature verified');
    fireEvent.click(within(pane('Header') as HTMLElement).getByRole('button', { name: 'Copy' }));
    await settle();
    const history = host.history.forOwner('jwt', definition.history!);
    expect(history.status().secrets).toBe('no-password');
    expect((await history.list()).entries).toEqual([]);
  });

  it('an edit is a change once its verdict is known; with a key it is "checked"; Copy is a commit', async () => {
    const { host, changes, commits } = spyHost();
    render(<JwtTool host={host} />);
    expect(changes).toHaveLength(0);
    type('Token', T1);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'decoded', label: 'HS256 · signature not verified' });
    expect(payloadOf(changes[0]!)).toEqual({ token: T1, kind: 'jws', alg: 'HS256', signature: 'no-key' });

    type('Secret', SECRET);
    await verdict('Signature verified');
    // The change is recorded in an effect after the verdict is drawn: wait for it rather than read it at once.
    await waitFor(() => expect(changes.at(-1)).toMatchObject({ kind: 'checked', label: 'HS256 · signature verified' }));
    const last = changes.at(-1)!;
    expect(payloadOf(last).key).toEqual({ field: 'secret', format: 'text', text: SECRET });
    expect(changes.every(c => payloadOf(c).signature !== ('checking' as never))).toBe(true);

    fireEvent.click(within(pane('Payload') as HTMLElement).getByRole('button', { name: 'Copy' }));
    await settle();
    expect(commits).toHaveLength(1);
    expect(payloadOf(commits[0]!)).toMatchObject({ signature: 'valid', key: { text: SECRET } });
  });

  it('says what the history does with tokens and keys now', () => {
    const { unmount } = render(<JwtTool host={spyHost({ secrets: 'unlocked' }).host} input={T1} />);
    expect(hint()).toContain('They are kept encrypted in this browser.');
    unmount();
    render(<JwtTool host={spyHost({ secrets: 'locked' }).host} input={T1} />);
    expect(hint()).toContain('They are not kept while the history is locked.');
    cleanup();
    render(<JwtTool host={spyHost({ gate: 'off' }).host} input={T1} />);
    expect(hint()).toContain('They are not kept (history is off).');
  });

  it('opens an entry back — token, key and format — recording nothing', async () => {
    const { host, opened, changes, commits } = spyHost();
    const payload: JwtPayload = {
      token: T1,
      kind: 'jws',
      alg: 'HS256',
      signature: 'valid',
      key: { field: 'secret', format: 'base64', text: SECRET_BASE64 },
    };
    opened.set('e1', {
      ok: true,
      entry: { id: 'e1', owner: 'jwt', kind: 'checked', session: 's', time: 0, schema: 1, encrypted: true, bytes: 1 },
      label: 'HS256 · signature verified',
      payload: payload as unknown as HistoryDraft['payload'],
      blobs: {},
    });
    render(<JwtTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('Opened from History: HS256 · signature verified.')).toBeTruthy();
    expect((screen.getByLabelText('Token') as HTMLTextAreaElement).value).toBe(T1);
    expect((screen.getByLabelText('Secret') as HTMLInputElement).value).toBe(payload.key!.text);
    expect(screen.getByLabelText('Secret format').textContent).toBe('Base64');
    await verdict('Signature verified');
    expect(changes).toHaveLength(0);
    expect(commits).toHaveLength(0);
  });

  it('an encrypted entry while the history is locked: says so; a foreign payload: could not be opened', async () => {
    const locked = spyHost({ secrets: 'locked' });
    locked.opened.set('e2', { ok: false, reason: 'locked' });
    const { unmount } = render(<JwtTool host={locked.host} restore={{ id: 'e2' }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
    unmount();
    const other = spyHost();
    other.opened.set('e3', {
      ok: true,
      entry: { id: 'e3', owner: 'jwt', kind: 'decoded', session: 's', time: 0, schema: 1, encrypted: true, bytes: 1 },
      payload: { values: ['x'] },
      blobs: {},
    });
    render(<JwtTool host={other.host} restore={{ id: 'e3' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });

  it('reads back only a payload of schema 1', () => {
    expect(readPayload({ token: 'x', kind: 'jws', signature: 'valid' })).toEqual({
      token: 'x',
      kind: 'jws',
      signature: 'valid',
    });
    expect(readPayload({ token: 'x', kind: 'jws', signature: 'checking' })).toBeUndefined();
    expect(
      readPayload({ token: 'x', kind: 'jws', signature: 'valid', key: { field: 'secret', format: 'pem', text: '' } }),
    ).toBeUndefined();
    expect(readPayload(null)).toBeUndefined();
  });
});

describe('the JWT tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('jwt').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('jwt').save(jwtSettings.schema, values as never);
    await host.settings!.forTool('jwt').flush();
  };
  const toMode = (name: 'Decode' | 'Sign') => fireEvent.click(screen.getByRole('radio', { name }));
  const inSign = () => screen.getByRole('radio', { name: 'Sign' }).getAttribute('data-state') === 'on';
  const format = () => screen.getByLabelText('Secret format').textContent;
  const compact = () => screen.getByLabelText('Compact JSON').getAttribute('aria-checked');
  /** The tool's history is all secret: a host whose history opens what the test puts in, with real saved parameters. */
  const hostWithEntries = () => {
    const spy = spyHost();
    const host: ToolHost = { history: spy.host.history, settings: memoryHost().settings };
    return { host, opened: spy.opened };
  };
  const entry = (id: string, kind: string) => ({
    id,
    owner: 'jwt',
    kind,
    session: 's',
    time: 0,
    schema: 1,
    encrypted: true,
    bytes: 1,
  });

  it('saves the secret formats and Compact JSON — never a token or a key; reopened, it is as left; the mode is not saved', async () => {
    const host = memoryHost();
    const first = render(<JwtTool host={host} />);
    type('Token', T1);
    await chooseFormat('Hex');
    type('Secret', SECRET);
    toMode('Sign');
    fireEvent.click(screen.getByLabelText('Compact JSON'));
    await chooseFormat('Base64');
    type('Signing secret', SECRET);
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { secretFormat: 'hex', compact: false, signSecretFormat: 'base64' },
    });
    expect(JSON.stringify(savedOf(host))).not.toContain(SECRET);
    expect(JSON.stringify(savedOf(host))).not.toContain('eyJ');

    render(<JwtTool host={host} />);
    expect(inSign()).toBe(false);
    type('Token', T1);
    expect(format()).toBe('Hex');
    expect((screen.getByLabelText('Secret') as HTMLInputElement).value).toBe('');
    toMode('Sign');
    expect(compact()).toBe('false');
    expect(format()).toBe('Base64');
    expect((screen.getByLabelText('Signing secret') as HTMLInputElement).value).toBe('');
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { secretFormat: 'pem', compact: 'yes', signSecretFormat: 'jwk' });
    render(<JwtTool host={host} input={T1} />);
    expect(format()).toBe('Text (UTF-8)');
    toMode('Sign');
    expect(compact()).toBe('true');
    expect(format()).toBe('JWK');
  });

  it('a paste keeps what is saved; an entry and a key carried between the modes win for the visit; what is saved stays', async () => {
    const { host, opened } = hostWithEntries();
    await seed(host, { secretFormat: 'hex', compact: false });
    const stored = { schema: 1, values: { secretFormat: 'hex', compact: false } };
    const pasted = render(<JwtTool host={host} input={T1} />);
    expect(inSign()).toBe(false);
    expect(format()).toBe('Hex');
    pasted.unmount();
    expect(savedOf(host)).toEqual(stored);

    const key: JwtPayload = {
      token: T1,
      kind: 'jws',
      alg: 'HS256',
      signature: 'valid',
      key: { field: 'secret', format: 'base64', text: SECRET_BASE64 },
    };
    opened.set('e1', {
      ok: true,
      entry: entry('e1', 'checked'),
      label: 'HS256 · signature verified',
      payload: key as unknown as HistoryDraft['payload'],
      blobs: {},
    });
    const checked = render(<JwtTool host={host} restore={{ id: 'e1' }} />);
    expect(await screen.findByText('Opened from History: HS256 · signature verified.')).toBeTruthy();
    expect(format()).toBe('Base64');
    await verdict('Signature verified');
    // Edit and sign: the decoded parts are only compacted, and the secret goes with its format — for this visit.
    fireEvent.click(screen.getByRole('button', { name: 'Edit and sign' }));
    expect(compact()).toBe('true');
    expect(format()).toBe('Base64');
    await waitFor(() => expect((screen.getByLabelText('Signed token') as HTMLTextAreaElement).value).toBe(T1));
    checked.unmount();
    expect(savedOf(host)).toEqual(stored);

    opened.set('e2', {
      ok: true,
      entry: entry('e2', 'signed'),
      label: 'HS256 · signed',
      payload: {
        mode: 'sign',
        header: '{"alg":"HS256"}',
        payload: '{"sub":"x"}',
        compact: true,
        alg: 'HS256',
        token: 'x',
      } as unknown as HistoryDraft['payload'],
      blobs: {},
    });
    const signed = render(<JwtTool host={host} restore={{ id: 'e2' }} />);
    expect(await screen.findByText(/^Opened from History: HS256 · signed\./)).toBeTruthy();
    expect(compact()).toBe('true');
    signed.unmount();
    expect(savedOf(host)).toEqual(stored);
    render(<JwtTool host={host} />);
    toMode('Sign');
    expect(compact()).toBe('false');
  });

  it('reset puts the formats and Compact JSON back to the defaults and keeps the token and the secret', async () => {
    const host = memoryHost();
    await seed(host, { secretFormat: 'base64', compact: false, signSecretFormat: 'hex' });
    render(<JwtTool host={host} input={T1} />);
    type('Secret', SECRET_BASE64);
    await verdict('Signature verified');
    await act(async () => host.settings!.forTool('jwt').reset());
    expect(format()).toBe('Text (UTF-8)');
    expect((screen.getByLabelText('Token') as HTMLTextAreaElement).value).toBe(T1);
    expect((screen.getByLabelText('Secret') as HTMLInputElement).value).toBe(SECRET_BASE64);
    await verdict('Signature does not match');
    toMode('Sign');
    expect(compact()).toBe('true');
    expect(format()).toBe('Text (UTF-8)');
    expect(savedOf(host)).toBeUndefined();
  });
});
