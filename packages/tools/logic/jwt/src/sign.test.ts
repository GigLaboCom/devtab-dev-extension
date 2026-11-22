/**
 * Signing (docs/tools/specs/jwt.md §16): RFC 7515 Appendix A.1 (HS256) and A.2 (RS256) as known answers — both are
 * deterministic —, every algorithm the tool verifies signed and then accepted by the tool's own verification, the key
 * forms (PKCS#8, PKCS#1, SEC1, JWK), and the refusals word for word. Keys other than the RFC's are made here by
 * node:crypto and thrown away.
 */
import {
  decodeToken,
  NONE_REFUSED,
  NOT_THIS_FORM,
  PUBLIC_NOT_PRIVATE,
  parseKey,
  signToken,
  verifyToken,
  withAlg,
  headerAlg,
} from './index';
import { RFC7515_A1, RFC7515_A1_K } from './fixtures';
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { SignRequest } from './index';
import type { KeyObject } from 'node:crypto';

/** RFC 7515 A.2's RSA key (JWK). */
const A2_JWK = {
  kty: 'RSA', // gitleaks:allow — published RFC 7515 A.2 example key
  n: 'ofgWCuLjybRlzo0tZWJjNiuSfb4p4fAkd_wWJcyQoTbji9k0l8W26mPddxHmfHQp-Vaw-4qPCJrcS2mJPMEzP1Pt0Bm4d4QlL-yRT-SFd2lZS-pCgNMsD1W_YpRPEwOWvG6b32690r2jZ47soMZo9wGzjb_7OMg0LOL-bSf63kpaSHSXndS5z5rexMdbBYUsLA9e-KXBdQOS-UTo7WTBEMa2R2CapHg665xsmtdVMTBQY4uDZlxvb3qCo5ZwKh9kG4LT6_I5IhlJH7aGhyxXFvUK-DWNmoudF8NAco9_h9iaGNj8q2ethFkMLs91kzk2PAcDTW9gb54h4FRWyuXpoQ', // gitleaks:allow — published RFC 7515 A.2 example key
  e: 'AQAB', // gitleaks:allow — published RFC 7515 A.2 example key
  d: 'Eq5xpGnNCivDflJsRQBXHx1hdR1k6Ulwe2JZD50LpXyWPEAeP88vLNO97IjlA7_GQ5sLKMgvfTeXZx9SE-7YwVol2NXOoAJe46sui395IW_GO-pWJ1O0BkTGoVEn2bKVRUCgu-GjBVaYLU6f3l9kJfFNS3E0QbVdxzubSu3Mkqzjkn439X0M_V51gfpRLI9JYanrC4D4qAdGcopV_0ZHHzQlBjudU2QvXt4ehNYTCBr6XCLQUShb1juUO1ZdiYoFaFQT5Tw8bGUl_x_jTj3ccPDVZFD9pIuhLhBOneufuBiB4cS98l2SR_RQyGWSeWjnczT0QU91p1DhOVRuOopznQ', // gitleaks:allow — published RFC 7515 A.2 example key
  p: '4BzEEOtIpmVdVEZNCqS7baC4crd0pqnRH_5IB3jw3bcxGn6QLvnEtfdUdiYrqBdss1l58BQ3KhooKeQTa9AB0Hw_Py5PJdTJNPY8cQn7ouZ2KKDcmnPGBY5t7yLc1QlQ5xHdwW1VhvKn-nXqhJTBgIPgtldC-KDV5z-y2XDwGUc', // gitleaks:allow — published RFC 7515 A.2 example key
  q: 'uQPEfgmVtjL0Uyyx88GZFF1fOunH3-7cepKmtH4pxhtCoHqpWmT8YAmZxaewHgHAjLYsp1ZSe7zFYHj7C6ul7TjeLQeZD_YwD66t62wDmpe_HlB-TnBA-njbglfIsRLtXlnDzQkv5dTltRJ11BKBBypeeF6689rjcJIDEz9RWdc', // gitleaks:allow — published RFC 7515 A.2 example key
  dp: 'BwKfV3Akq5_MFZDFZCnW-wzl-CCo83WoZvnLQwCTeDv8uzluRSnm71I3QCLdhrqE2e9YkxvuxdBfpT_PI7Yz-FOKnu1R6HsJeDCjn12Sk3vmAktV2zb34MCdy7cpdTh_YVr7tss2u6vneTwrA86rZtu5Mbr1C1XsmvkxHQAdYo0', // gitleaks:allow — published RFC 7515 A.2 example key
  dq: 'h_96-mK1R_7glhsum81dZxjTnYynPbZpHziZjeeHcXYsXaaMwkOlODsWa7I9xXDoRwbKgB719rrmI2oKr6N3Do9U0ajaHF-NKJnwgjMd2w9cjz3_-kyNlxAr2v4IKhGNpmM5iIgOS1VZnOZ68m6_pbLBSp3nssTdlqvd0tIiTHU', // gitleaks:allow — published RFC 7515 A.2 example key
  qi: 'IYd7DHOhrWvxkwPQsRM2tOgrjbcrfvtQJipd-DlcxyVuuM9sQLdgjVk2oy26F0EmpScGLq2MowX7fhd_QJQ3ydy5cY7YIBi87w93IKLEdfnbJtoOPLUW0ITrJReOgo1cq9SbsxYawBgfp_gh6A5603k2-ZQwVK0JKSHuLFkuQ3U', // gitleaks:allow — published RFC 7515 A.2 example key
};
const A2_TOKEN =
  'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.cC4hiUPoj9Eetdgtv3hF80EGrhuB__dzERat0XF9g2VtQgr9PJbu3XOiZj5RZmh7AAuHIm4Bh-0Qc_lF5YKt_O8W2Fp5jujGbds9uJdbF9CUAr7t1dnZcAcQjbKBYNX4BAynRFdiuB--f_nZLgrnbyTyWzO75vRK5h6xBArLIARNPvkSjtQBMHlb1L07Qe7K0GarZRmB_eSN9383LcOLn6_dO--xi12jzDwusC-eOkHWEsqtFZESc6BfI7noOPqvhJ1phCnvWh6IeYI2w9QOYEUipUTI8np6LbgGY9Fs98rqVt5AXLIhWkWywlVmtVrBp0igcN_IoypGlUPQGe77Rw'; // gitleaks:allow — published RFC 7515 A.2 example token
const A_PAYLOAD = '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}';

const verified = async (token: string, key: string) => {
  const decoded = decodeToken(token);
  if (!decoded.ok) throw new Error(decoded.message);
  return verifyToken(decoded.token, parseKey({ kind: 'public', text: key }));
};
const sign = (r: Partial<SignRequest> & Pick<SignRequest, 'key'>) =>
  signToken({ header: '{"alg":"HS256","typ":"JWT"}', payload: '{"sub":"u"}', compact: true, ...r });

describe('§16 known answers (RFC 7515 Appendix A)', () => {
  it("A.1: HS256 with the RFC's key, the header and payload byte for byte", async () => {
    const r = await signToken({
      header: '{"typ":"JWT",\r\n "alg":"HS256"}',
      payload: A_PAYLOAD,
      compact: false,
      key: { kind: 'secret', text: JSON.stringify({ kty: 'oct', k: RFC7515_A1_K }), format: 'jwk' },
    });
    expect(r).toEqual({ ok: true, token: RFC7515_A1, alg: 'HS256', notes: [] });
  });

  it("A.2: RS256 with the RFC's RSA key (deterministic PKCS#1 v1.5)", async () => {
    const r = await signToken({
      header: '{"alg":"RS256"}',
      payload: A_PAYLOAD,
      compact: false,
      key: { kind: 'private', text: JSON.stringify(A2_JWK) },
    });
    expect(r.ok && r.token).toBe(A2_TOKEN);
  });
});

describe("§16: every algorithm, signed and accepted by the tool's own verification", () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = (k: KeyObject, type: 'spki' | 'pkcs8' | 'pkcs1' | 'sec1') =>
    k.export({ type, format: 'pem' } as never).toString();
  const curves = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' } as const;
  it.each(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'])('%s, PKCS#8 and PKCS#1 and JWK', async alg => {
    const spki = pem(rsa.publicKey, 'spki');
    for (const text of [
      pem(rsa.privateKey, 'pkcs8'),
      pem(rsa.privateKey, 'pkcs1'),
      JSON.stringify(rsa.privateKey.export({ format: 'jwk' })),
    ]) {
      const r = await sign({ header: `{"alg":"${alg}"}`, key: { kind: 'private', text } });
      if (!r.ok) throw new Error(r.message);
      expect((await verified(r.token, spki)).state).toBe('valid');
    }
  });
  it.each(Object.entries(curves))('%s, PKCS#8, SEC1 and JWK; the signature is r ‖ s', async (alg, curve) => {
    const ec = generateKeyPairSync('ec', { namedCurve: curve });
    const spki = pem(ec.publicKey, 'spki');
    for (const text of [
      pem(ec.privateKey, 'pkcs8'),
      pem(ec.privateKey, 'sec1'),
      JSON.stringify(ec.privateKey.export({ format: 'jwk' })),
    ]) {
      const r = await sign({ header: `{"alg":"${alg}"}`, key: { kind: 'private', text } });
      if (!r.ok) throw new Error(r.message);
      const decoded = decodeToken(r.token);
      expect(decoded.ok && decoded.token.signature!.bytes.length).toBe({ ES256: 64, ES384: 96, ES512: 132 }[alg]);
      expect((await verified(r.token, spki)).state).toBe('valid');
    }
  });
  it.each(['EdDSA', 'Ed25519'])('%s, PKCS#8 and JWK', async alg => {
    const ed = generateKeyPairSync('ed25519');
    const spki = pem(ed.publicKey, 'spki');
    for (const text of [pem(ed.privateKey, 'pkcs8'), JSON.stringify(ed.privateKey.export({ format: 'jwk' }))]) {
      const r = await sign({ header: `{"alg":"${alg}"}`, key: { kind: 'private', text } });
      if (!r.ok) throw new Error(r.message);
      expect((await verified(r.token, spki)).state).toBe('valid');
    }
  });
  it.each(['HS256', 'HS384', 'HS512'])('%s with a text secret', async alg => {
    const secret = 'tools-test-secret-0123456789abcdef!-and-some-more-bytes-for-512';
    const r = await sign({ header: `{"alg":"${alg}"}`, key: { kind: 'secret', text: secret, format: 'text' } });
    if (!r.ok) throw new Error(r.message);
    const decoded = decodeToken(r.token);
    if (!decoded.ok) throw new Error('decode');
    const v = await verifyToken(decoded.token, parseKey({ kind: 'secret', text: secret, format: 'text' }));
    expect(v.state).toBe('valid');
  });
});

describe('§16: the parts', () => {
  it('Compact JSON keeps literals as written; off, the bytes as typed', async () => {
    const key = { kind: 'secret' as const, text: 'k'.repeat(32), format: 'text' as const };
    const r = await sign({
      header: '{ "alg": "HS256" }',
      payload: '{\n  "id": 12345678901234567890,\n  "s": "\\u00e9"\n}',
      key,
    });
    const decoded = r.ok ? decodeToken(r.token) : null;
    expect(decoded?.ok && new TextDecoder().decode(Buffer.from(r.ok ? r.token.split('.')[1]! : '', 'base64url'))).toBe(
      '{"id":12345678901234567890,"s":"\\u00e9"}',
    );
    const raw = await sign({ header: '{ "alg": "HS256" }', payload: 'plain text', compact: false, key });
    expect(raw.ok && Buffer.from(raw.token.split('.')[0]!, 'base64url').toString()).toBe('{ "alg": "HS256" }');
    expect(raw.ok && Buffer.from(raw.token.split('.')[1]!, 'base64url').toString()).toBe('plain text');
  });

  it('withAlg sets alg and keeps everything else; headerAlg reads it', () => {
    expect(withAlg('{\n  "alg": "HS256",\n  "typ": "JWT"\n}', 'ES256')).toBe('{\n  "alg": "ES256",\n  "typ": "JWT"\n}');
    expect(withAlg('{"typ":"JWT"}', 'RS256')).toBe('{"alg":"RS256","typ":"JWT"}');
    expect(withAlg('{}', 'RS256')).toBe('{"alg":"RS256"}');
    expect(headerAlg('{"alg":"PS384"}')).toBe('PS384');
    expect(headerAlg('not json')).toBeUndefined();
  });
});

describe('§16: refusals, word for word', () => {
  const secret = { kind: 'secret' as const, text: 's'.repeat(32), format: 'text' as const };
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  it.each([
    [{ header: '{"alg":"none"}', key: secret }, 'header', NONE_REFUSED],
    [{ header: '{"alg":"HS999"}', key: secret }, 'header', 'Algorithm "HS999" is not supported for signing.'],
    [
      { header: '{"alg":"ES256K"}', key: secret },
      'header',
      "ES256K (secp256k1) is not available in the browser's Web Crypto.",
    ],
    [{ header: '{"typ":"JWT"}', key: secret }, 'header', 'The header has no "alg".'],
    [{ header: '{"alg":1}', key: secret }, 'header', 'The header\'s "alg" is not a string.'],
    [{ header: '[1]', key: secret }, 'header', 'The header must be a JSON object.'],
    [{ header: '{"alg":"HS256","alg":"HS512"}', key: secret }, 'header', 'The header has "alg" twice.'],
    [{ header: '{"alg":', key: secret }, 'header', 'The header is not JSON. Line 1, column 8: '],
    [{ payload: 'hello', key: secret }, 'payload', 'The payload is not JSON. Line 1, column 1: '],
    [
      { payload: '{"a":1,"a":2}', key: secret },
      'payload',
      'The payload has "a" twice. Turn off Compact JSON to sign it as text.',
    ],
    [{ key: { kind: 'secret' as const, text: '', format: 'text' as const } }, 'key', 'Enter the secret to sign with.'],
    [{ header: '{"alg":"RS256"}', key: secret }, 'key', 'RS256 signs with a private key, not a shared secret.'],
    [
      { header: '{"alg":"RS256"}', key: { kind: 'private' as const, text: '' } },
      'key',
      'Paste the private key to sign with: PEM (PRIVATE KEY, RSA PRIVATE KEY, EC PRIVATE KEY) or a JWK with "d".',
    ],
    [
      {
        header: '{"alg":"RS256"}',
        key: { kind: 'private' as const, text: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      },
      'key',
      PUBLIC_NOT_PRIVATE,
    ],
    [
      {
        header: '{"alg":"RS256"}',
        key: {
          kind: 'private' as const,
          text: rsa.privateKey
            .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' })
            .toString(),
        },
      },
      'key',
      NOT_THIS_FORM,
    ],
    [
      {
        header: '{"alg":"ES256"}',
        key: { kind: 'private' as const, text: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
      },
      'key',
      'ES256 needs a P-256 key; this key is P-384.',
    ],
    [
      {
        header: '{"alg":"ES384"}',
        key: { kind: 'private' as const, text: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
      },
      'key',
      'The token uses ES384 (EC), but the key is RSA.',
    ],
    [
      {
        header: '{"alg":"RS256"}',
        key: { kind: 'private' as const, text: JSON.stringify({ ...A2_JWK, alg: 'PS256' }) },
      },
      'key',
      'The key is meant for PS256; the header says RS256.',
    ],
  ] as const)('%#', async (request, field, message) => {
    const r = await sign(request as Partial<SignRequest> & Pick<SignRequest, 'key'>);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe(field);
    if (message.endsWith(': ')) expect(r.message.startsWith(message)).toBe(true);
    else expect(r.message).toBe(message);
  });

  it('notes: a short secret, a short RSA key', async () => {
    const short = await sign({ key: { kind: 'secret', text: 'short', format: 'text' } });
    expect(short.ok && short.notes).toEqual([
      'The secret is shorter than 256 bits. RFC 7518 §3.2 requires at least the hash size.',
    ]);
    const weak = await sign({
      header: '{"alg":"RS256"}',
      key: { kind: 'private', text: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    });
    expect(weak.ok && weak.notes).toEqual(['The RSA key is shorter than 2048 bits (RFC 7518 §3.3).']);
  });
});
