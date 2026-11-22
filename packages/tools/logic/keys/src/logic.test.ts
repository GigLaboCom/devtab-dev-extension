/**
 * docs/tools/specs/keys.md §10, row by row. Published keys (RFC 9500, RFC 8410, RFC 7638, RFC 8037) are known answers;
 * expected fingerprints were produced by ssh-keygen (OpenSSH 10.5) and OpenSSL 4.1 on the machine that wrote the
 * specification. Web Crypto is Node's. The texts of §6 are errors.test.ts.
 */
import {
  ED25519_BER,
  ED25519_SHORT_FIRST,
  ED25519_SHORT_LAST,
  ED25519_SPKI,
  ED25519_V1,
  ED25519_V2,
  pem,
  TEST_ECC_P256,
  TEST_ECC_P384,
  TEST_ECC_P521,
  TEST_RSA1024,
  TEST_RSA2048,
  TEST_RSA4096,
} from './fixtures';
import {
  completeKey,
  describe as describeKey,
  detectKeys,
  fingerprints,
  generatePair,
  md5,
  pkcs8,
  privateForms,
  privateText,
  publicForms,
  publicText,
  readKeys,
  spki,
  thumbprint,
  WEAK_RSA,
} from './logic';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { bytesToHex } from '@workspace/tools-shared/hex';
import { describe, expect, it } from 'vitest';
import type { ReadItem, ReadKey } from './logic';

export const one = (text: string): ReadItem => {
  const r = readKeys(text);
  expect(r.message).toBeUndefined();
  expect(r.items).toHaveLength(1);
  return r.items[0]!;
};
const key = (text: string): ReadKey => {
  const item = one(text);
  if (!item.ok) throw new Error(item.message);
  return item.key;
};
const complete = async (text: string): Promise<ReadKey> => {
  const item = await completeKey(key(text));
  if (!item.ok) throw new Error(item.message);
  return item.key;
};
const refusal = async (text: string): Promise<string> => {
  const r = readKeys(text);
  if (r.message) return r.message;
  const item = r.items[0]!;
  if (!item.ok) return item.message;
  const done = await completeKey(item.key);
  if (done.ok) throw new Error('read');
  return done.message;
};
const b64 = (bytes: Uint8Array): string => bytesToBase64(bytes);

describe('§10, known answers', () => {
  it('1: RFC 7638 §3.1 — the JWK thumbprint of the RSA example', async () => {
    const jwk = JSON.stringify({
      kty: 'RSA',
      n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw', // gitleaks:allow — published RFC 7638 example key
      e: 'AQAB',
      alg: 'RS256',
      kid: '2011-04-29',
    });
    const k = await complete(jwk);
    expect(await thumbprint(k.data)).toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
    expect(describeKey(k)).toBe('RSA 2048-bit public key (JWK), exponent 65537, kid "2011-04-29"');
  });

  it('2: RFC 8037 A.1 — the Ed25519 private JWK: public key derived, thumbprint of A.3', async () => {
    const jwk =
      '{"kty":"OKP","crv":"Ed25519","d":"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}'; // gitleaks:allow — published RFC 8037 example key
    const k = await complete(jwk);
    expect(k.data.type === 'okp' && Buffer.from(k.data.x!).toString('base64url')).toBe(
      '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    );
    expect(await thumbprint(k.data)).toBe('kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k');
    // The public key derived without the stored one is the same.
    const okp = k.data as Extract<ReadKey['data'], { type: 'okp' }>;
    const bare = await completeKey({ ...key(jwk), data: { ...okp, x: undefined }, storedPublic: undefined });
    expect(bare.ok && Buffer.from((bare.key.data as { x: Uint8Array }).x).toString('base64url')).toBe(
      '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    );
    const wrong = jwk.replace('"x":"11qYAYKx', '"x":"11qYAYKy');
    expect(await refusal(wrong)).toBe('The public key stored with this private key does not belong to it.');
  });

  it('3: RFC 8410 §10.3 — the Ed25519 PKCS#8 v1 key; its public key is the SPKI of §4', async () => {
    const k = await complete(ED25519_V1);
    expect(describeKey(k)).toBe('Ed25519 private key (PKCS#8)');
    expect(publicText(k, 'pem')).toBe(ED25519_SPKI);
    const f = await fingerprints(k.data);
    expect(f.spkiBase64).toBe('oekVYFTgT6yJmunydRMs3Ael28TqLCrTof/G4NJTaB8=');
    expect(f.spkiHex).toBe('a1e9156054e04fac899ae9f275132cdc07a5dbc4ea2c2ad3a1ffc6e0d253681f');
    expect(privateText(k, 'pkcs8', { checkint: 1 })).toBe(ED25519_V1);
  });

  it('4: RFC 8410 §10.3 — v2 with an attribute and the public key: the same key, the attribute skipped', async () => {
    const k = await complete(ED25519_V2);
    expect(publicText(k, 'pem')).toBe(ED25519_SPKI);
    expect(k.notes).toContain("The key's attributes were skipped.");
  });

  it('5: RFC 8410 §10.3 — the BER sample is refused', async () => {
    expect(await refusal(ED25519_BER)).toBe('Byte 0: indefinite length is BER, not DER.');
  });

  it('6: RFC 8410 §10.3 — the wrong-length samples are refused (their [1] is also tagged explicitly, against RFC 5958)', async () => {
    const message = 'Byte 48: the public key [1] must be an implicitly tagged BIT STRING (RFC 5958 §2).';
    expect(await refusal(ED25519_SHORT_FIRST)).toBe(message);
    expect(await refusal(ED25519_SHORT_LAST)).toBe(message);
    // With the tag as RFC 5958 has it, the 31-byte public key is what is refused.
    const fixed = (text: string) => {
      const der = Buffer.from(text.split('\n').slice(1, -2).join(''), 'base64');
      const out = Buffer.concat([
        Uint8Array.of(0x30, 0x50),
        der.subarray(2, 48),
        Uint8Array.of(0x81, 0x20),
        der.subarray(52),
      ]);
      return pem('PRIVATE KEY', [out.toString('base64')]);
    };
    expect(await refusal(fixed(ED25519_SHORT_FIRST))).toBe('The Ed25519 public key is 31 bytes; Ed25519 needs 32.');
    expect(await refusal(fixed(ED25519_SHORT_LAST))).toBe('The Ed25519 public key is 31 bytes; Ed25519 needs 32.');
  });

  it('7: RFC 9500 testRSA2048 — kind and the fingerprints of ssh-keygen and openssl', async () => {
    const k = await complete(TEST_RSA2048);
    expect(describeKey(k)).toBe('RSA 2048-bit private key (PKCS#1), exponent 65537');
    expect(await fingerprints(k.data)).toEqual({
      sha256: 'SHA256:oxX93evA00rDZ81xYLtUPJbjAuKCJ3J68lFSZUhyHvA',
      md5: 'MD5:4e:96:c3:a6:fb:59:32:ca:e6:13:7b:bb:04:d7:35:2f',
      spkiHex: '8fb6bad671cfe698393c453357da61b56d757ab8c0f3fb9c87f2849e63131878',
      spkiBase64: 'j7a61nHP5pg5PEUzV9phtW11erjA8/uch/KEnmMTGHg=',
      thumbprint: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(k.notes).toEqual([]);
  });

  it('8: RFC 9500 testECCP256 — kind and fingerprints', async () => {
    const k = await complete(TEST_ECC_P256);
    expect(describeKey(k)).toBe('EC P-256 private key (SEC1)');
    const f = await fingerprints(k.data);
    expect(f.sha256).toBe('SHA256:iZ7NQZ++u9TDmrQaukZrn52DebZINaNol/CuKDOF50E');
    expect(f.md5).toBe('MD5:8f:1a:3d:3c:d3:8e:a1:36:17:d6:24:a9:29:db:d5:b1');
    expect(f.spkiHex).toBe('b2b04340cfaee616ec9c2c62d261b208e54bb197498df52e8cadede23ac0ba5e');
    expect(f.spkiBase64).toBe('srBDQM+u5hbsnCxi0mGyCOVLsZdJjfUujK3t4jrAul4=');
  });

  it('9: RFC 9500 testRSA1024 — the weak-key note', async () => {
    const k = await complete(TEST_RSA1024);
    expect(describeKey(k)).toBe('RSA 1024-bit private key (PKCS#1), exponent 65537');
    expect(k.notes).toEqual([WEAK_RSA]);
  });

  it('10: RFC 9500 testECCP384, testECCP521, testRSA4096 — kinds', async () => {
    expect(describeKey(await complete(TEST_ECC_P384))).toBe('EC P-384 private key (SEC1)');
    expect(describeKey(await complete(TEST_ECC_P521))).toBe('EC P-521 private key (SEC1)');
    expect(describeKey(await complete(TEST_RSA4096))).toBe('RSA 4096-bit private key (PKCS#1), exponent 65537');
  });

  it('18: MD5 — the RFC 1321 A.5 test suite', () => {
    const hex = (s: string) => bytesToHex(md5(new TextEncoder().encode(s)));
    expect(hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'd174ab98d277d9f5a5611c2c9f419d9f',
    );
    expect(hex('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
});

describe('§10 row 11: every form reads back into the same key', () => {
  const samples = [ED25519_V1, TEST_RSA2048, TEST_ECC_P256, TEST_ECC_P384, TEST_ECC_P521, TEST_RSA1024];
  it.each(samples.map((s, i) => [i, s] as const))('sample %i', async (_, sample) => {
    const k = await complete(sample);
    for (const form of publicForms(k.data)) {
      const back = await complete(publicText(k, form));
      expect(b64(spki(back.data))).toBe(b64(spki(k.data)));
    }
    for (const form of privateForms(k.data)) {
      const back = await complete(privateText(k, form, { checkint: 0x12345678 }));
      expect(b64(pkcs8(back.data))).toBe(b64(pkcs8(k.data)));
    }
  });
});

describe('§10 row 17: generated pairs — our SPKI and PKCS#8 are Web Crypto’s bytes', () => {
  const cases = [
    { algorithm: 'Ed25519', size: 3072, rsaAlg: 'RS256' },
    { algorithm: 'X25519', size: 3072, rsaAlg: 'RS256' },
    { algorithm: 'P-256', size: 3072, rsaAlg: 'RS256' },
    { algorithm: 'P-384', size: 3072, rsaAlg: 'RS256' },
    { algorithm: 'P-521', size: 3072, rsaAlg: 'RS256' },
    { algorithm: 'RSA', size: 2048, rsaAlg: 'RS256' },
    { algorithm: 'RSA', size: 2048, rsaAlg: 'PS256' },
    { algorithm: 'RSA', size: 2048, rsaAlg: 'RSA-OAEP-256' },
  ] as const;
  it.each(cases)('$algorithm $rsaAlg', async options => {
    const k = await generatePair(options);
    expect(describeKey(k)).toMatch(/key pair$/);
    const params =
      options.algorithm === 'RSA'
        ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        : options.algorithm === 'Ed25519' || options.algorithm === 'X25519'
          ? { name: options.algorithm }
          : { name: 'ECDSA', namedCurve: options.algorithm };
    const usage = options.algorithm === 'X25519' ? ['deriveBits'] : ['sign'];
    const priv = await crypto.subtle.importKey('pkcs8', pkcs8(k.data).slice(), params, true, usage as never);
    expect(b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', priv)))).toBe(b64(pkcs8(k.data)));
    const pub = await crypto.subtle.importKey(
      'spki',
      spki(k.data).slice(),
      params,
      true,
      (options.algorithm === 'X25519' ? [] : ['verify']) as never,
    );
    expect(b64(new Uint8Array(await crypto.subtle.exportKey('spki', pub)))).toBe(b64(spki(k.data)));
    const jwk = JSON.parse(privateText(k, 'jwk', { checkint: 0 })) as Record<string, string>;
    const algs = {
      Ed25519: 'Ed25519',
      X25519: 'ECDH-ES',
      'P-256': 'ES256',
      'P-384': 'ES384',
      'P-521': 'ES512',
    } as const;
    expect(jwk.alg).toBe(options.algorithm === 'RSA' ? options.rsaAlg : algs[options.algorithm]);
  });
});

describe('§10 row 19: detect', () => {
  it.each([
    ED25519_SPKI,
    TEST_RSA2048,
    pem('OPENSSH PRIVATE KEY', ['b3BlbnNzaC1rZXktdjEAAAAA']),
    pem('ENCRYPTED PRIVATE KEY', ['MIIB']),
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE alice@laptop',
    'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBA==\nssh-rsa AAAAB3NzaC1yc2E= bob',
    '---- BEGIN SSH2 PUBLIC KEY ----\nAAAA\n---- END SSH2 PUBLIC KEY ----',
    '{"kty":"OKP","crv":"Ed25519","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}',
    '{"keys":[{"kty":"EC"}]}',
  ])('yes: %s', text => expect(detectKeys(text)).toBe(true));
  it.each([
    '',
    'hello',
    pem('CERTIFICATE', ['MIIB']),
    `${pem('CERTIFICATE', ['MIIB'])}${ED25519_V1}`,
    pem('CERTIFICATE REQUEST', ['MIIB']),
    pem('PGP PUBLIC KEY BLOCK', ['mQEN']),
    'eyJhbGciOiJIUzI1NiJ9.e30.abc',
    'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=',
    '{"alg":"HS256"}',
    '5f4dcc3b5aa765d61d8327deb882cf99',
    'ssh-ed25519',
    'from="1.2.3.4" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGb9 x',
    '123e4567-e89b-12d3-a456-426614174000',
  ])('no: %s', text => expect(detectKeys(text)).toBe(false));
});
