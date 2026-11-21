import {
  HEADER_KEY_NOTE,
  JWE_MESSAGE,
  NESTED_NOTE,
  PAYLOAD_NOT_OBJECT,
  PAYLOAD_NOT_TEXT,
  PRIVATE_KEY,
  algorithmName,
  claimRows,
  decodeToken,
  detectJwt,
  keyFieldOf,
  parseKey,
  timeClaims,
  timeLines,
  timeStatus,
  timeStatusText,
  verifyToken,
} from './index';
import {
  CA_CERT,
  CA_JWK,
  CA_PKCS1,
  CA_SPKI,
  ED_CERT,
  LEAF_CERT,
  LEAF_JWK,
  RFC7515_A1,
  RFC7515_A1_K,
  RFC7515_A3,
  RFC7515_A3_JWK,
  RFC7515_A3_SPKI,
  RFC8037_A4,
  RFC8037_A4_JWK,
  T1,
  T10,
  T11,
  T2,
  T3,
  T4,
  T5,
  T6,
  T7,
  T8,
  T9,
  T_ES256,
  T_ES256_DER,
  T_PS256,
  T_RS256,
} from './fixtures';
import { relativeTime } from '@workspace/tools-shared/time';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decoded, KeyInput, Verification } from './index';

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type Pair = { publicKey: Key; privateKey: Key };

const SECRET = 'tools-test-secret-0123456789abcdef!';
const at = (iso: string): number => Date.parse(iso);

const decoded = (token: string): Decoded => {
  const r = decodeToken(token);
  if (!r.ok) throw new Error(`not decoded: ${r.message}`);
  return r.token;
};
const verify = (token: string, key?: KeyInput): Promise<Verification> =>
  verifyToken(decoded(token), key && parseKey(key));
const secret = (text: string, format: 'text' | 'base64' | 'hex' | 'jwk' = 'text'): KeyInput => ({
  kind: 'secret',
  text,
  format,
});
const pub = (text: string): KeyInput => ({ kind: 'public', text });
const jwk = (json: string, extra: Record<string, unknown>): string => JSON.stringify({ ...JSON.parse(json), ...extra });
/** Replaces a token's header, keeping its payload and signature. */
const withHeader = (token: string, header: string): string =>
  [Buffer.from(header).toString('base64url'), ...token.split('.').slice(1)].join('.');
const payloadJson = (token: string) => {
  const p = decoded(token).payload!;
  if (!p.ok) throw new Error(p.message);
  return p;
};

afterEach(() => vi.restoreAllMocks());

describe('§10: verification (WebCrypto in Node)', () => {
  it('1: RFC 7515 A.1 with its JWK — valid; the header as written with \\r\\n', async () => {
    expect(await verify(RFC7515_A1, secret(`{"kty":"oct","k":"${RFC7515_A1_K}"}`, 'jwk'))).toEqual({
      state: 'valid',
      warnings: [],
    });
    const header = decoded(RFC7515_A1).header;
    expect(header.ok && header.json).toEqual({ typ: 'JWT', alg: 'HS256' });
    expect(header.ok && header.display).toBe('{\n  "typ": "JWT",\n  "alg": "HS256"\n}');
  });

  it('2: RFC 7515 A.1 with the same key as Base64 (base64url without "=") — valid', async () => {
    expect((await verify(RFC7515_A1, secret(RFC7515_A1_K, 'base64'))).state).toBe('valid');
  });

  it('3: RFC 7515 A.3 (ES256) with its JWK — valid', async () => {
    expect(await verify(RFC7515_A3, pub(RFC7515_A3_JWK))).toEqual({ state: 'valid', warnings: [] });
  });

  it('4: RFC 7515 A.3 with the same key as SPKI PEM — valid', async () => {
    expect((await verify(RFC7515_A3, pub(RFC7515_A3_SPKI))).state).toBe('valid');
    expect(parseKey(pub(RFC7515_A3_SPKI))).toMatchObject({ ok: true, description: 'EC P-256 public key' });
  });

  it('5: RFC 7515 A.3 with the second-to-last character of the signature changed — invalid', async () => {
    const i = RFC7515_A3.length - 2;
    const changed = RFC7515_A3.slice(0, i) + (RFC7515_A3[i] === 'A' ? 'B' : 'A') + RFC7515_A3.slice(i + 1);
    expect(await verify(changed, pub(RFC7515_A3_JWK))).toEqual({ state: 'invalid', warnings: [] });
  });

  it('6: RFC 8037 A.4 (EdDSA) — valid; the payload is text with the "not a JSON object" note', async () => {
    expect((await verify(RFC8037_A4, pub(RFC8037_A4_JWK))).state).toBe('valid');
    expect(decoded(RFC8037_A4).payload).toEqual({
      ok: false,
      text: 'Example of Ed25519 signing',
      message: PAYLOAD_NOT_OBJECT,
    });
  });

  it('7: T1 with the test secret — valid; sub, iat, nbf, exp', async () => {
    expect(await verify(T1, secret(SECRET))).toEqual({ state: 'valid', warnings: [] });
    const p = payloadJson(T1);
    const rows = claimRows(p.json, p.raw);
    expect(rows.find(r => r.name === 'sub')).toEqual({ name: 'sub', label: 'Subject', value: 'user-42' });
    const times = Object.fromEntries(
      timeClaims(p.json).map(t => [t.name, (timeLines(t, at('2025-11-19T19:00:00Z')) as { iso: string }).iso]),
    );
    expect(times).toEqual({ iat: '2025-11-19T12:00:00Z', nbf: '2025-11-19T12:00:00Z', exp: '2025-11-19T13:00:00Z' });
  });

  it('8: T1 with the secret as Base64 — valid', async () => {
    expect((await verify(T1, secret('dG9vbHMtdGVzdC1zZWNyZXQtMDEyMzQ1Njc4OWFiY2RlZiE=', 'base64'))).state).toBe(
      'valid',
    );
  });

  it('9: T1 with one character of the secret changed — invalid', async () => {
    expect((await verify(T1, secret('tools-test-secret-0123456789abcdef?'))).state).toBe('invalid');
  });

  it('10: T1 with a space before the secret — invalid: a Text secret is not trimmed', async () => {
    expect((await verify(T1, secret(` ${SECRET}`))).state).toBe('invalid');
  });

  it('11: T2 (HS512) with the same secret — valid, shorter than 512 bits (35 bytes)', async () => {
    expect(await verify(T2, secret(SECRET))).toEqual({
      state: 'valid',
      warnings: ['The secret is shorter than 512 bits. RFC 7518 §3.2 requires at least the hash size.'],
    });
  });

  it('12: T9 with "short-secret-16b" — valid, shorter than 256 bits', async () => {
    expect(await verify(T9, secret('short-secret-16b'))).toEqual({
      state: 'valid',
      warnings: ['The secret is shorter than 256 bits. RFC 7518 §3.2 requires at least the hash size.'],
    });
  });

  it('13: T10 with the Hex secret 000102…1f (32 bytes) — valid, no warning', async () => {
    const hex = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
    expect(await verify(T10, secret(hex, 'hex'))).toEqual({ state: 'valid', warnings: [] });
  });

  it('14: T-RS256 with the SPKI PEM — valid', async () => {
    expect(await verify(T_RS256, pub(CA_SPKI))).toEqual({ state: 'valid', warnings: [] });
    expect(parseKey(pub(CA_SPKI))).toMatchObject({ description: 'RSA 2048-bit public key' });
  });

  it('15: T-RS256 with the PKCS#1 PEM (RSA PUBLIC KEY), wrapped into SPKI — valid', async () => {
    expect((await verify(T_RS256, pub(CA_PKCS1))).state).toBe('valid');
    const wrapped = parseKey(pub(CA_PKCS1));
    const spki = parseKey(pub(CA_SPKI));
    expect(wrapped.ok && spki.ok && wrapped.candidates[0]).toEqual(spki.ok && spki.candidates[0]);
  });

  it('16: T-RS256 with the certificate (expired in 2025) — valid, the key described as from a certificate', async () => {
    expect((await verify(T_RS256, pub(CA_CERT))).state).toBe('valid');
    expect(parseKey(pub(CA_CERT))).toMatchObject({
      ok: true,
      description: 'RSA 2048-bit public key from a certificate',
      warnings: ['Key taken from a certificate. The certificate itself is not checked.'],
    });
  });

  it('17: T-RS256 with the JWK of the same key — valid', async () => {
    expect((await verify(T_RS256, pub(CA_JWK))).state).toBe('valid');
  });

  it('18: T-PS256 with the certificate — valid', async () => {
    expect((await verify(T_PS256, pub(CA_CERT))).state).toBe('valid');
  });

  it('19: T-RS256 with its header replaced by PS256 — invalid', async () => {
    expect((await verify(withHeader(T_RS256, '{"alg":"PS256","typ":"JWT"}'), pub(CA_SPKI))).state).toBe('invalid');
  });

  it('20: T-ES256 with the leaf certificate — valid', async () => {
    expect((await verify(T_ES256, pub(LEAF_CERT))).state).toBe('valid');
    expect(parseKey(pub(LEAF_CERT))).toMatchObject({ description: 'EC P-256 public key from a certificate' });
  });

  it('21: T-ES256 with an RSA key — cannot verify, in words', async () => {
    expect(await verify(T_ES256, pub(CA_SPKI))).toEqual({
      state: 'cannot-verify',
      reason: 'The token uses ES256 (EC), but the key is RSA.',
    });
  });

  it('22: T-ES256-DER — invalid, the reason names DER', async () => {
    expect(decoded(T_ES256_DER).signature!.bytes).toHaveLength(70);
    expect(await verify(T_ES256_DER, pub(LEAF_CERT))).toEqual({
      state: 'invalid',
      reason: 'The signature is DER-encoded; JWS needs raw r‖s (RFC 7518 §3.4).',
      warnings: [],
    });
  });

  it('23: T-RS256 with a JWKS of an RSA and an EC key, no kid in the token — the one RSA key, valid', async () => {
    const set = `{"keys":[${jwk(CA_JWK, { kid: 'a' })},${jwk(LEAF_JWK, { kid: 'b' })}]}`;
    expect(await verify(T_RS256, pub(set))).toEqual({
      state: 'valid',
      warnings: [],
      key: 'RSA 2048-bit public key, JWK kid "a" from the set',
    });
  });

  it('24: T-RS256 with a JWKS of two RSA keys and no kid — cannot verify', async () => {
    const set = `{"keys":[${CA_JWK},${jwk(CA_JWK, { kid: 'other' })}]}`;
    expect(await verify(T_RS256, pub(set))).toEqual({
      state: 'cannot-verify',
      reason: 'The set has 2 suitable keys and the token has no kid.',
    });
  });

  it('25: a JWK meant for RS384 — cannot verify', async () => {
    expect(await verify(T_RS256, pub(jwk(CA_JWK, { alg: 'RS384' })))).toEqual({
      state: 'cannot-verify',
      reason: 'The key is meant for RS384; the token says RS256.',
    });
  });

  it('26: a JWK with "use": "enc" — cannot verify', async () => {
    expect(await verify(T_RS256, pub(jwk(CA_JWK, { use: 'enc' })))).toEqual({
      state: 'cannot-verify',
      reason: 'The key is not meant for verifying signatures.',
    });
  });

  it('27: a private key PEM — refused, never used', async () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----';
    expect(parseKey(pub(pem))).toEqual({ ok: false, message: PRIVATE_KEY, private: true });
    expect(await verify(T_RS256, pub(pem))).toEqual({ state: 'no-key' });
  });

  it('28: T1 with the text of a public key as its secret — the algorithm-confusion warning; invalid', async () => {
    expect(await verify(T1, secret(CA_SPKI))).toEqual({
      state: 'invalid',
      warnings: [
        'This looks like a public key. HS256 uses a shared secret; using a public key as an HMAC secret is a known attack (algorithm confusion).',
      ],
    });
  });

  it('29: T3 (alg none) — unsecured, no signature', async () => {
    expect(await verify(T3)).toEqual({ state: 'unsecured', hasSignature: false });
    expect(await verify(T3, secret(SECRET))).toEqual({ state: 'unsecured', hasSignature: false });
  });

  it('30: T3 with a signature "abc" — unsecured, with a signature', async () => {
    expect(await verify(`${T3}abc`)).toEqual({ state: 'unsecured', hasSignature: true });
  });

  it('31: T6 (crit: ["exp"]) with the test secret — cannot verify, naming exp', async () => {
    expect(await verify(T6, secret(SECRET))).toEqual({
      state: 'cannot-verify',
      reason: "the header lists critical parameters this tool doesn't support: exp.",
    });
  });
});

describe('§10: decoding and times', () => {
  it('32: T5 — exp in milliseconds: out of range, read as milliseconds 2025-11-19T13:00:00Z', () => {
    const [exp] = timeClaims(payloadJson(T5).json);
    expect(exp).toMatchObject({ name: 'exp', value: 1763557200000 });
    expect(exp!.date).toBeUndefined();
    expect(exp!.millisecondsHint?.toISOString()).toBe('2025-11-19T13:00:00.000Z');
    expect(timeLines(exp!, 0)).toEqual({
      message: 'Out of range',
      hint: 'Looks like milliseconds: 2025-11-19T13:00:00Z',
    });
  });

  it('33: T7 — a big integer is shown as written', () => {
    const p = payloadJson(T7);
    expect(p.display).toContain('"id": 12345678901234567890');
    expect(claimRows(p.json, p.raw).find(r => r.name === 'id')?.value).toBe('12345678901234567890');
  });

  it('34: T4 — non-ASCII and an emoji; aud joined with ", "', () => {
    const p = payloadJson(T4);
    expect(p.json).toEqual({ name: 'Žofie 🙂', aud: ['api', 'web'] });
    expect(p.display).toContain('"name": "Žofie 🙂"');
    expect(claimRows(p.json, p.raw)).toEqual([
      { name: 'name', value: '"Žofie 🙂"' },
      { name: 'aud', label: 'Audience', value: 'api, web' },
    ]);
  });

  it('35: T8 — a key in the header: the note, and the key is not used', async () => {
    expect(decoded(T8).headerNotes).toEqual([HEADER_KEY_NOTE]);
    expect(await verify(T8)).toEqual({ state: 'no-key' });
    // The header's own key ("k": "AAAA") does not make it valid; the trusted secret does.
    expect((await verify(T8, secret('AAAA', 'base64'))).state).toBe('invalid');
    expect((await verify(T8, secret(SECRET))).state).toBe('valid');
  });

  it('36: T11 — a JWE: its header, no payload', () => {
    const t = decoded(T11);
    expect(t.kind).toBe('jwe');
    expect(t.header.ok && t.header.json).toEqual({ alg: 'dir', enc: 'A256GCM' });
    expect(t.payload).toBeUndefined();
    expect(t.signature).toBeUndefined();
    expect(t.notes).toEqual([JWE_MESSAGE]);
    expect(keyFieldOf(t)).toBeUndefined();
  });

  it('37: "Bearer " + T1 with a line break after the 40th character — decoded as T1, with the note', () => {
    const t = decoded(`Bearer ${T1.slice(0, 40)}\n${T1.slice(40)}`);
    expect(t.notes).toEqual(['Removed "Bearer " and line breaks.']);
    expect(t.signingInput).toBe(T1.split('.').slice(0, 2).join('.'));
    expect(t.alg).toBe('HS256');
  });

  it('38: the inputs of §6 give the messages of §6', () => {
    expect(decodeToken('abc')).toEqual({
      ok: false,
      message: 'A JWT has 3 parts separated by dots (5 for an encrypted token). This has 1.',
    });
    expect(decodeToken('a.b')).toMatchObject({ ok: false, message: expect.stringMatching(/ This has 2\.$/) });
    expect(decodeToken('eyJh+bGciOiJIUzI1NiJ9.e30.')).toEqual({
      ok: false,
      message: 'Segment 1, position 5: "+" is not used in Base64url. This looks like standard Base64.',
      segment: 1,
      position: 5,
    });
    expect(decodeToken('eyJhb.e30.')).toEqual({
      ok: false,
      message: 'Segment 1 has an impossible length for Base64url.',
      segment: 1,
    });
    expect(decoded('bm90IGpzb24.e30.').header).toEqual({
      ok: false,
      text: 'not json',
      message: 'The header is not JSON.',
    });
    expect(decoded('WzFd.e30.').header).toEqual({
      ok: false,
      text: '[1]',
      message: 'The header must be a JSON object.',
    });
    expect(decoded('_w.e30.').header).toEqual({ ok: false, hex: 'ff', message: 'The header is not UTF-8 text.' });
  });

  it('39: T1 at 12:30 — valid until 13:00, exp "in 30 minutes"', () => {
    const now = at('2025-11-19T12:30:00Z');
    const claims = timeClaims(payloadJson(T1).json);
    const status = timeStatus(claims, now);
    expect(status).toEqual({ status: { kind: 'valid', until: at('2025-11-19T13:00:00Z') }, issuedInFuture: false });
    expect(relativeTime(at('2025-11-19T13:00:00Z'), now)).toBe('in 30 minutes');
    expect(timeStatusText(status, now)).toBe('Valid for 30 minutes more');
  });

  it('40: T1 at exactly 13:00 — expired (now ≥ exp)', () => {
    const now = at('2025-11-19T13:00:00Z');
    const status = timeStatus(timeClaims(payloadJson(T1).json), now);
    expect(status.status).toEqual({ kind: 'expired', at: now });
    expect(timeStatusText(status, now)).toBe('Expired just now');
    expect(timeStatusText(status, at('2025-11-19T19:00:00Z'))).toBe('Expired 6 hours ago');
  });

  it('41: T1 at 11:59:59 — not valid yet, issued in the future', () => {
    const now = at('2025-11-19T11:59:59Z');
    const status = timeStatus(timeClaims(payloadJson(T1).json), now);
    expect(status).toEqual({ status: { kind: 'not-yet', at: at('2025-11-19T12:00:00Z') }, issuedInFuture: true });
    expect(timeStatusText(status, now)).toBe('Not valid yet: starts in 1 second');
  });

  it('42: relativeTime — now, 59 seconds ago, in 59 minutes, in 1 month, 1 year ago', () => {
    const now = at('2025-11-19T12:00:00Z');
    const day = 86_400_000;
    expect(relativeTime(now + 500, now)).toBe('now');
    expect(relativeTime(now - 59_999, now)).toBe('59 seconds ago');
    expect(relativeTime(now + 3_599_999, now)).toBe('in 59 minutes');
    expect(relativeTime(now + 45 * day, now)).toBe('in 1 month');
    expect(relativeTime(now - 400 * day, now)).toBe('1 year ago');
  });

  it('43: detectJwt — the examples of §7', () => {
    for (const yes of [T1, T3, `Bearer ${T1}`, T11, `  ${T1}\n`]) expect(detectJwt(yes)).toBe(true);
    for (const no of [
      'eyJhbGciOiJIUzI1NiJ9',
      '{"alg":"HS256"}',
      'dGVzdA==',
      '550e8400-e29b-41d4-a716-446655440000',
      RFC7515_A3_SPKI,
      'https://example.com/a.b.c?x=1.2',
      'a.b.c',
      '',
    ])
      expect(detectJwt(no)).toBe(false);
  });

  it('44: Ed25519 where the browser has none (importKey throws NotSupportedError) — cannot verify, Chrome 137', async () => {
    const error = Object.assign(new Error('Unrecognized algorithm name'), { name: 'NotSupportedError' });
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(error);
    expect(await verify(RFC8037_A4, pub(RFC8037_A4_JWK))).toEqual({
      state: 'cannot-verify',
      reason: 'this browser has no Ed25519 support (Chrome 137 or later is needed).',
    });
  });
});

describe('§5.1 preparation and splitting', () => {
  it('reports what it removed: Bearer alone, line breaks alone, spaces alone', () => {
    expect(decoded(`bearer   ${T1}`).notes).toEqual(['Removed "Bearer ".']);
    expect(decoded(`${T1.slice(0, 20)}\r\n${T1.slice(20)}`).notes).toEqual(['Removed line breaks.']);
    expect(decoded(`${T1.slice(0, 20)} ${T1.slice(20)}`).notes).toEqual(['Removed spaces.']);
    expect(decoded(`\n  ${T1}  \n`).notes).toEqual([]);
  });

  it('accepts "=" padding with a warning naming the segment', () => {
    const [h, p, s] = T1.split('.');
    const t = decoded(`${h}.${p}=.${s}`);
    expect(t.notes).toEqual(['Segment 2 has "=" padding, which JWT doesn\'t use (RFC 7515 §2).']);
    expect(t.payload?.ok).toBe(true);
  });

  it('names "/" too, and other characters by themselves', () => {
    expect(decodeToken('eyJhbGci.e3/0.')).toMatchObject({
      message: expect.stringMatching(/^Segment 2, position 3: "\/"/),
    });
    expect(decodeToken('eyJhbGci.e30.ab!c')).toMatchObject({
      message: 'Segment 3, position 3: "!" is not a Base64url character.',
    });
  });

  it('nothing to decode in an empty or blank text', () => {
    expect(decodeToken('   \n')).toEqual({ ok: false, message: '' });
  });

  it('decodes a long token quickly, and refuses long junk without hanging (no backtracking)', () => {
    const big = `${T1.split('.')[0]}.${'A'.repeat(300_000)}.${T1.split('.')[2]}`;
    const t0 = performance.now();
    expect(decodeToken(big).ok).toBe(true);
    expect(detectJwt(big)).toBe(true);
    expect(detectJwt(`eyJ${'a.'.repeat(150_000)}`)).toBe(false);
    expect(detectJwt(`eyJ${'-'.repeat(300_000)}!`)).toBe(false);
    expect(decodeToken(`${' '.repeat(150_000)}x${' '.repeat(150_000)}`).ok).toBe(false);
    expect(detectJwt(`Bearer${' '.repeat(300_000)}x`)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('§5.2 header and payload', () => {
  it('a payload that is not text is shown as hex with "Payload is not text."', () => {
    expect(decoded('eyJhbGciOiJIUzI1NiJ9.__4.').payload).toEqual({
      ok: false,
      hex: 'ff fe',
      message: PAYLOAD_NOT_TEXT,
    });
  });

  it('a JSON array payload is text, not claims', () => {
    expect(decoded('eyJhbGciOiJIUzI1NiJ9.WzFd.').payload).toEqual({
      ok: false,
      text: '[1]',
      message: PAYLOAD_NOT_OBJECT,
    });
  });

  it('a duplicate name: the last wins; alg is case-sensitive', async () => {
    const t = decoded(withHeader(T1, '{"alg":"none","alg":"HS256"}'));
    expect(t.alg).toBe('HS256');
    expect(await verify(withHeader(T1, '{"alg":"hs256"}'), secret(SECRET))).toEqual({
      state: 'cannot-verify',
      reason: 'algorithm "hs256" is not supported.',
    });
  });

  it('cty: JWT (any case) — the nested-token note', () => {
    expect(decoded(withHeader(T1, '{"alg":"HS256","cty":"jwt"}')).headerNotes).toEqual([NESTED_NOTE]);
  });

  it('jku, x5u and x5c are noted like jwk', () => {
    for (const member of ['"jku":"https://example.com/jwks"', '"x5u":"https://example.com/c"', '"x5c":[]'])
      expect(decoded(withHeader(T1, `{"alg":"RS256",${member}}`)).headerNotes).toEqual([HEADER_KEY_NOTE]);
  });
});

describe('§5.3 and §6: what cannot be verified', () => {
  it('an unknown alg, ES256K, Ed448, no alg, an empty crit', async () => {
    const reason = async (header: string) => {
      const v = await verify(withHeader(T1, header), secret(SECRET));
      return v.state === 'cannot-verify' ? v.reason : v.state;
    };
    expect(await reason('{"alg":"HS999"}')).toBe('algorithm "HS999" is not supported.');
    expect(await reason('{"alg":"ES256K"}')).toBe("ES256K (secp256k1) is not available in the browser's Web Crypto.");
    expect(await reason('{"alg":"Ed448"}')).toBe("Ed448 is not available in the browser's Web Crypto.");
    expect(await reason('{"typ":"JWT"}')).toBe('the header has no "alg".');
    expect(await reason('{"alg":"HS256","crit":[]}')).toBe('"crit" must not be empty.');
    expect(await verify('bm90IGpzb24.e30.', secret(SECRET))).toEqual({
      state: 'cannot-verify',
      reason: 'the header is not a JSON object.',
    });
  });

  it('a JWE has nothing to verify', async () => {
    expect((await verify(T11, secret(SECRET))).state).toBe('cannot-verify');
  });

  it('an ES256 signature of the wrong length that is not DER', async () => {
    const [h, p] = T_ES256.split('.');
    expect(await verify(`${h}.${p}.AAAA`, pub(LEAF_CERT))).toEqual({
      state: 'invalid',
      reason: 'The signature is 3 bytes; ES256 needs 64.',
      warnings: [],
    });
  });

  it('a key of the wrong curve, and a key of the wrong family', async () => {
    const p384 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']);
    const spki = Buffer.from(await crypto.subtle.exportKey('spki', p384.publicKey)).toString('base64');
    const pem = `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----`;
    expect(await verify(T_ES256, pub(pem))).toEqual({
      state: 'cannot-verify',
      reason: 'ES256 needs a P-256 key; this key is P-384.',
    });
    expect(await verify(T_RS256, pub(LEAF_JWK))).toEqual({
      state: 'cannot-verify',
      reason: 'The token uses RS256 (RSA), but the key is EC P-256.',
    });
    expect(await verify(RFC8037_A4, pub(CA_SPKI))).toEqual({
      state: 'cannot-verify',
      reason: 'The token uses EdDSA (Ed25519), but the key is RSA.',
    });
  });

  it('an Ed448 key for EdDSA, and a set with no key for the algorithm', async () => {
    expect(await verify(RFC8037_A4, pub('{"kty":"OKP","crv":"Ed448","x":"AA"}'))).toEqual({
      state: 'cannot-verify',
      reason: 'The token uses EdDSA (Ed25519), but the key is Ed448.',
    });
    expect(await verify(T_RS256, pub(`{"keys":[${LEAF_JWK}]}`))).toEqual({
      state: 'cannot-verify',
      reason: 'The set has no key for RS256.',
    });
  });

  it('a public key for an HS token and a secret for an RS token are refused in words', async () => {
    expect(await verify(T1, pub(CA_SPKI))).toEqual({
      state: 'cannot-verify',
      reason: 'HS256 needs a shared secret, not a public key.',
    });
    expect(await verify(T_RS256, secret(SECRET))).toEqual({
      state: 'cannot-verify',
      reason: 'RS256 needs a public key, not a shared secret.',
    });
  });

  it('an SPKI WebCrypto does not take — cannot verify (DataError)', async () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nMAMCAQA=\n-----END PUBLIC KEY-----';
    expect(parseKey(pub(pem))).toMatchObject({ ok: true, description: 'Public key' });
    expect(await verify(T_RS256, pub(pem))).toEqual({
      state: 'cannot-verify',
      reason: 'the browser could not read this key (DataError).',
    });
  });
});

describe('§5.4 keys', () => {
  it('secrets: empty is no key; Hex errors name the position; formats skip outer spaces except Text', () => {
    expect(parseKey(secret(''))).toEqual({ ok: false, message: '' });
    expect(parseKey(secret('  ', 'base64'))).toEqual({ ok: false, message: '' });
    expect(parseKey(secret('zz', 'hex'))).toEqual({ ok: false, message: 'Position 1: "z" is not a hex digit.' });
    expect(parseKey(secret('0a 0b c', 'hex'))).toEqual({
      ok: false,
      message: 'The hex secret has an odd number of digits.',
    });
    expect(parseKey(secret(' 00 01 ', 'hex'))).toMatchObject({ ok: true, description: '2-byte secret (16 bits)' });
    expect(parseKey(secret('ab!c', 'base64'))).toEqual({ ok: false, message: 'Position 3: invalid character "!".' });
    expect(parseKey(secret('{"kty":"RSA"}', 'jwk'))).toEqual({
      ok: false,
      message: 'A secret JWK needs "kty": "oct" and "k".',
    });
    expect(parseKey(secret(' ', 'text'))).toMatchObject({ ok: true, description: '1-byte secret (8 bits)' });
  });

  it('long key input is read in linear time, whatever its shape', () => {
    const t0 = performance.now();
    const long = ' '.repeat(150_000);
    for (const format of ['text', 'base64', 'hex', 'jwk'] as const) {
      parseKey(secret(`${long}x${long}`, format));
      parseKey(secret(`{${long}"kty"`, format));
    }
    parseKey(secret(`{"kty":"oct","k":"${'='.repeat(300_000)}x"}`, 'jwk'));
    parseKey(pub(`-----BEGIN ${'A'.repeat(300_000)}`));
    parseKey(pub(`{"keys":[${'{},'.repeat(100_000)}{}]}`));
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('a hex secret error leaves the signature not verified', async () => {
    expect(await verify(T1, secret('zz', 'hex'))).toEqual({ state: 'no-key' });
  });

  it('PEM: no END line, bad Base64, an unsupported label, every private label', () => {
    expect(parseKey(pub('-----BEGIN PUBLIC KEY-----\nMFkw'))).toEqual({
      ok: false,
      message: 'The PEM block has no END line.',
    });
    expect(parseKey(pub('-----BEGIN PUBLIC KEY-----\nM!!w\n-----END PUBLIC KEY-----'))).toEqual({
      ok: false,
      message: 'The PEM block is not valid Base64.',
    });
    expect(parseKey(pub('-----BEGIN CERTIFICATE REQUEST-----\nMA==\n-----END CERTIFICATE REQUEST-----'))).toEqual({
      ok: false,
      message: 'Unsupported PEM block "CERTIFICATE REQUEST". Paste a PUBLIC KEY, RSA PUBLIC KEY or CERTIFICATE.',
    });
    for (const label of ['RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'OPENSSH PRIVATE KEY'])
      expect(parseKey(pub(`-----BEGIN ${label}-----\nAAAA`))).toMatchObject({ private: true, message: PRIVATE_KEY });
    expect(parseKey(pub('hello'))).toEqual({ ok: false, message: 'Paste a PEM key, a certificate, a JWK or a JWKS.' });
  });

  it('a JWK with any private member is refused, alone or in a set', () => {
    for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'])
      expect(parseKey(pub(jwk(CA_JWK, { [member]: 'AA' })))).toMatchObject({ private: true });
    expect(parseKey(pub(`{"keys":[${CA_JWK},${jwk(LEAF_JWK, { d: 'AA' })}]}`))).toMatchObject({ private: true });
  });

  it('a JWKS: by kid exactly; no such kid; key_ops without verify', async () => {
    const set = `{"keys":[${jwk(LEAF_JWK, { kid: 'b' })},${jwk(CA_JWK, { kid: 'a' })}]}`;
    expect(parseKey(pub(set))).toMatchObject({ ok: true, description: 'JWKS with 2 keys', set: true });
    expect((await verify(withHeader(T_RS256, '{"alg":"RS256","kid":"a"}'), pub(set))).state).toBe('invalid');
    expect(await verify(withHeader(T_RS256, '{"alg":"RS256","kid":"A"}'), pub(set))).toEqual({
      state: 'cannot-verify',
      reason: 'No key with kid "A" in the set.',
    });
    expect(await verify(T_RS256, pub(jwk(CA_JWK, { key_ops: ['encrypt'] })))).toEqual({
      state: 'cannot-verify',
      reason: 'The key is not meant for verifying signatures.',
    });
    expect((await verify(T_RS256, pub(jwk(CA_JWK, { key_ops: ['verify'], use: 'sig', alg: 'RS256' })))).state).toBe(
      'valid',
    );
  });

  it('describes keys: a JWK with kid, an Ed25519 certificate', () => {
    expect(parseKey(pub(jwk(CA_JWK, { kid: '2024-01' })))).toMatchObject({
      description: 'RSA 2048-bit public key, JWK kid "2024-01"',
    });
    expect(parseKey(pub(ED_CERT))).toMatchObject({ description: 'Ed25519 public key from a certificate' });
  });

  it('RSA shorter than 2048 bits: verified, with the warning', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
    const input = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
    const token = `${input}.${Buffer.from(sig).toString('base64url')}`;
    const jwkText = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey));
    expect(await verify(token, pub(jwkText))).toEqual({
      state: 'valid',
      warnings: ['The RSA key is shorter than 2048 bits (RFC 7518 §3.3).'],
    });
  });

  it('PS384, PS512, ES384, ES512 and Ed25519 (RFC 9864) with keys made here', async () => {
    const sign = async (alg: string, key: Pair, signParams: object) => {
      const input = `${Buffer.from(JSON.stringify({ alg })).toString('base64url')}.e30`;
      const sig = await crypto.subtle.sign(signParams as never, key.privateKey, new TextEncoder().encode(input));
      const spki = Buffer.from(await crypto.subtle.exportKey('spki', key.publicKey)).toString('base64');
      return verify(
        `${input}.${Buffer.from(sig).toString('base64url')}`,
        pub(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----`),
      );
    };
    const rsa = (hash: string) =>
      crypto.subtle.generateKey(
        { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash },
        true,
        ['sign', 'verify'],
      ) as Promise<Pair>;
    const ec = (namedCurve: string) =>
      crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, ['sign', 'verify']) as Promise<Pair>;
    expect((await sign('PS384', await rsa('SHA-384'), { name: 'RSA-PSS', saltLength: 48 })).state).toBe('valid');
    expect((await sign('PS512', await rsa('SHA-512'), { name: 'RSA-PSS', saltLength: 64 })).state).toBe('valid');
    expect((await sign('ES384', await ec('P-384'), { name: 'ECDSA', hash: 'SHA-384' })).state).toBe('valid');
    expect((await sign('ES512', await ec('P-521'), { name: 'ECDSA', hash: 'SHA-512' })).state).toBe('valid');
    const ed = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as Pair;
    expect((await sign('Ed25519', ed, { name: 'Ed25519' })).state).toBe('valid');
  });
});

describe('§5.6, §5.8 claims', () => {
  it('a NumericDate as a string or null: not a NumericDate, and no time status', () => {
    const claims = timeClaims({ exp: '1763557200', nbf: null });
    expect(claims.map(c => timeLines(c, 0))).toEqual([
      { message: 'Not a NumericDate (RFC 7519 §2)' },
      { message: 'Not a NumericDate (RFC 7519 §2)' },
    ]);
    const status = timeStatus(claims, 0);
    expect(status.status).toEqual({ kind: 'unknown' });
    expect(timeStatusText(status, 0)).toBeUndefined();
  });

  it('a fractional NumericDate keeps its milliseconds; no exp and no nbf — no expiry', () => {
    const [iat] = timeClaims({ iat: 1763553600.25 });
    expect((timeLines(iat!, at('2025-11-19T12:00:00Z')) as { iso: string }).iso).toBe('2025-11-19T12:00:00.250Z');
    const status = timeStatus([iat!], at('2025-11-19T13:00:00Z'));
    expect(timeStatusText(status, 0)).toBe('No expiry (no "exp" claim)');
  });

  it('the three lines of a time claim: ISO, local, relative words', () => {
    const [exp] = timeClaims({ exp: 1763557200 });
    expect(timeLines(exp!, at('2025-11-19T19:00:00Z'), 'UTC')).toEqual({
      iso: '2025-11-19T13:00:00Z',
      local: expect.stringMatching(/^Nov 19, 2025, 1:00:00\sPM UTC$/),
      relative: 'expired 6 hours ago',
    });
  });

  it('registered names get their meaning; long values are cut at 200 characters', () => {
    const long = 'x'.repeat(300);
    const json = { iss: 'https://example.com', jti: 'id-1', extra: { long } };
    const rows = claimRows(json, json);
    expect(rows.slice(0, 2)).toEqual([
      { name: 'iss', label: 'Issuer', value: 'https://example.com' },
      { name: 'jti', label: 'Token ID', value: 'id-1' },
    ]);
    expect(rows[2]!.value).toHaveLength(201);
    expect(rows[2]!.value.endsWith('…')).toBe(true);
  });
});

describe('§8 algorithm names', () => {
  it('names each algorithm family', () => {
    expect(algorithmName('HS256')).toBe('HMAC with SHA-256');
    expect(algorithmName('RS384')).toBe('RSASSA-PKCS1-v1_5 with SHA-384');
    expect(algorithmName('PS512')).toBe('RSASSA-PSS with SHA-512');
    expect(algorithmName('ES256')).toBe('ECDSA P-256 with SHA-256');
    expect(algorithmName('ES512')).toBe('ECDSA P-521 with SHA-512');
    expect(algorithmName('EdDSA')).toBe('Ed25519');
    expect(algorithmName('HS999')).toBeUndefined();
  });

  it('chooses the key field by the algorithm', () => {
    expect(keyFieldOf(decoded(T1))).toBe('secret');
    expect(keyFieldOf(decoded(T_RS256))).toBe('public');
    expect(keyFieldOf(decoded(T3))).toBeUndefined();
  });
});

describe('detection against the other tools’ inputs (their specifications’ §7 and §10)', () => {
  it.each([
    ['json', '{"alg": "HS256", "typ": "JWT"}'],
    ['base64', 'SGVsbG8gd29ybGQ='],
    ['base64', 'eyJhbGciOiJIUzI1NiJ9'],
    ['url', 'https://example.com/path.with.dots?a=b.c'],
    ['url', 'a%2Fb.c%2Fd.e'],
    ['unix-time', '1700000000'],
    ['unix-time', '2023-11-14T22:13:20Z'],
    ['uuid', '550e8400-e29b-41d4-a716-446655440000'],
    ['hash', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['regexp', '/^eyJ[\\w-]+\\.[\\w-]+\\.[\\w-]*$/'],
    ['yaml-json', 'alg: HS256\ntyp: JWT'],
    ['text', 'version 1.2.3'],
    ['text', 'eyJ.eyJ.eyJ'],
    ['domain', 'www.example.com'],
  ])('%s: %s is not a token', (_, text) => expect(detectJwt(text)).toBe(false));

  it('a JWS whose header has no alg, or whose alg is not a string, is not detected', () => {
    expect(detectJwt(withHeader(T1, '{"typ":"JWT"}'))).toBe(false);
    expect(detectJwt(withHeader(T1, '{"alg":1}'))).toBe(false);
  });
});
