/**
 * docs/tools/specs/keys.md §6: every refusal and note, word for word — the strict reading of §5.5 (wrong label for the
 * content, bytes after the key, non-minimal DER, truncated SSH blobs, Base64 padding in a JWK, unsupported curves) and
 * the checks of §5.6 (RSA numbers that do not belong together, a point off the curve, a stored public key that is not
 * the private key's). Encrypted keys are built here from their outer structure only — no real key inside.
 */
import { bitString, nullValue, octetString, oid, sequence, smallInteger, unsigned } from './der-write';
import { ED25519_SPKI, ED25519_V1, ED25519_V2, pem, TEST_ECC_P256, TEST_RSA2048, TEST_RSA2048_LINES } from './fixtures';
import { completeKey, MAX_INPUT, NO_KEY, readKeys, spki, toPem, TOO_LARGE, TOO_MANY, traditional } from './logic';
import { sshString } from './ssh';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { KeyData, ReadKey } from './logic';

const message = async (text: string): Promise<string> => {
  const r = readKeys(text);
  if (r.message) return r.message;
  const item = r.items[0]!;
  if (!item.ok) return item.message;
  const done = await completeKey(item.key);
  return done.ok ? `read: ${done.key.notes.join(' | ')}` : done.message;
};
const der = (text: string): Buffer =>
  Buffer.from(
    text
      .split('\n')
      .filter(l => !l.startsWith('-----'))
      .join(''),
    'base64',
  );
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const ED_BLOB = Buffer.from('AAAAC3NzaC1lZDI1NTE5AAAAIBm/RAlphM3+hUG6wWfcO5bIUIaqMLa2ywxcOK1wMWbh', 'base64'); // the RFC 8410 key
const P256_SPKI = (curveOid: string, point: Uint8Array) =>
  toPem(sequence(sequence(oid('1.2.840.10045.2.1'), oid(curveOid)), bitString(point)), 'PUBLIC KEY');
const keyOf = async (text: string): Promise<ReadKey> => {
  const r = readKeys(text);
  const item = r.items[0]!;
  if (!item.ok) throw new Error(item.message);
  const done = await completeKey(item.key);
  if (!done.ok) throw new Error(done.message);
  return done.key;
};

afterEach(() => vi.restoreAllMocks());

describe('§6: PEM and DER', () => {
  it('text that is no key', async () => {
    expect(await message('hello')).toBe(NO_KEY);
    expect(await message('aGVsbG8gd29ybGQsIHRoaXMgaXMganVzdCBzb21lIHRleHQ=')).toBe(NO_KEY);
    expect(await message('{"name":"x"}')).toBe(NO_KEY);
    expect(NO_KEY).toBe(
      'No key found. Paste a PEM block (-----BEGIN PUBLIC KEY-----), a JWK, a JWK Set or an OpenSSH public key line.',
    );
  });

  it('a block without its END line, an END line for another label', async () => {
    expect(await message(ED25519_SPKI.split('\n').slice(0, 2).join('\n'))).toBe(
      'The PUBLIC KEY block has no END line.',
    );
    expect(await message(ED25519_SPKI.replace('END PUBLIC KEY', 'END PRIVATE KEY'))).toBe(
      'The PUBLIC KEY block ends with an END line for "PRIVATE KEY".',
    );
  });

  it('a body that is not Base64, with its place', async () => {
    expect(await message(pem('PUBLIC KEY', ['MCowBQYD', 'K2Vw!AyEA']))).toBe(
      'The PUBLIC KEY block is not valid Base64. Line 3, column 5: invalid character "!".',
    );
    expect(await message(pem('PUBLIC KEY', []))).toBe('The PUBLIC KEY block is empty.');
  });

  it('a label that does not fit the content', async () => {
    expect(await message(ED25519_V1.replace(/PRIVATE KEY/g, 'PUBLIC KEY'))).toBe(
      'The PUBLIC KEY block holds a private key (PKCS#8), not a public key (SPKI).',
    );
    expect(await message(ED25519_SPKI.replace(/PUBLIC KEY/g, 'PRIVATE KEY'))).toBe(
      'The PRIVATE KEY block holds a public key (SPKI), not a private key (PKCS#8).',
    );
    expect(await message(TEST_RSA2048.replace(/RSA PRIVATE KEY/g, 'EC PRIVATE KEY'))).toBe(
      'The EC PRIVATE KEY block holds an RSA private key (PKCS#1), not an EC private key (SEC1).',
    );
  });

  it('bytes after the key', async () => {
    const extra = Buffer.concat([der(ED25519_SPKI), Uint8Array.of(0, 1, 2)]);
    expect(await message(toPem(extra, 'PUBLIC KEY'))).toBe(
      '3 bytes follow the key in the PUBLIC KEY block; a key block holds one key.',
    );
  });

  it('BER and truncation', async () => {
    const spkiDer = der(ED25519_SPKI);
    // 30 2A … written with a long-form length 81 2A.
    const ber = Buffer.concat([Uint8Array.of(0x30, 0x81, 0x2a), spkiDer.subarray(2)]);
    expect(await message(toPem(ber, 'PUBLIC KEY'))).toBe(
      'Byte 0: the length is not in its shortest form (BER, not DER).',
    );
    expect(await message(toPem(spkiDer.subarray(0, 30), 'PUBLIC KEY'))).toBe(
      'Byte 0: the element is longer than the data left (truncated key?).',
    );
  });

  it('encrypted keys are named, not read', async () => {
    const encrypted = sequence(sequence(oid('1.2.840.113549.1.5.13'), sequence()), octetString(new Uint8Array(16)));
    expect(await message(toPem(encrypted, 'ENCRYPTED PRIVATE KEY'))).toBe(
      'This private key is encrypted with a password (PKCS#8, PBES2). This tool does not decrypt keys: nothing of it was read.',
    );
    const legacy = [
      '-----BEGIN RSA PRIVATE KEY-----', // gitleaks:allow — an armour with no key inside (the encrypted shape only)
      'Proc-Type: 4,ENCRYPTED',
      'DEK-Info: AES-256-CBC,2C8E2F4D8F8A1B3C4D5E6F708192A3B4',
      '',
      'AAAA',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(await message(legacy)).toBe(
      'This RSA PRIVATE KEY is encrypted with a password (DEK-Info: AES-256-CBC). This tool does not decrypt keys: nothing of it was read.',
    );
    const openssh = Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      sshString('aes256-ctr'),
      sshString('bcrypt'),
      sshString(new Uint8Array(24)),
    ]);
    expect(await message(pem('OPENSSH PRIVATE KEY', [b64(openssh)]))).toBe(
      'This OpenSSH private key is encrypted with a passphrase (aes256-ctr, bcrypt). This tool does not decrypt keys: nothing of it was read.',
    );
  });

  it('certificates, requests, DSA, PGP', async () => {
    expect(await message(pem('CERTIFICATE', ['MIIB']))).toBe(
      'This is a certificate, not a key. The X.509 Certificate tool reads certificates and shows their public key.',
    );
    expect(await message(pem('CERTIFICATE REQUEST', ['MIIB']))).toBe('This is a certificate request (CSR), not a key.');
    const dsa = 'DSA keys are not supported: the tool reads RSA, EC P-256, P-384, P-521, Ed25519 and X25519.';
    expect(await message(pem('DSA PRIVATE KEY', ['MIIB']))).toBe(dsa);
    expect(await message(`ssh-dss ${b64(Buffer.concat([sshString('ssh-dss'), sshString('x')]))}`)).toBe(dsa);
    expect(await message(pem('PGP PRIVATE KEY BLOCK', ['lQ']))).toBe('PGP keys are not supported.');
  });

  it('curves and algorithms Web Crypto has not', async () => {
    expect(await message(P256_SPKI('1.3.132.0.10', new Uint8Array(65).fill(4, 0, 1)))).toBe(
      'The curve secp256k1 is not supported: Web Crypto has P-256, P-384 and P-521.',
    );
    const explicit = toPem(
      sequence(sequence(oid('1.2.840.10045.2.1'), sequence(smallInteger(1))), bitString(Uint8Array.of(4))),
      'PUBLIC KEY',
    );
    expect(await message(explicit)).toBe(
      'This EC key spells out its curve instead of naming it; only named curves are read (RFC 5480 §2.1.1).',
    );
    const ed448 = toPem(sequence(sequence(oid('1.3.101.113')), bitString(new Uint8Array(57))), 'PUBLIC KEY');
    expect(await message(ed448)).toBe("Ed448 keys are not supported: the browser's Web Crypto has no Ed448.");
    const pss = toPem(
      sequence(
        sequence(oid('1.2.840.113549.1.1.10')),
        bitString(sequence(unsigned(Uint8Array.of(9)), unsigned(Uint8Array.of(3)))),
      ),
      'PUBLIC KEY',
    );
    expect(await message(pss)).toBe(
      'RSA-PSS-only keys (id-RSASSA-PSS) are not supported; a plain RSA key (rsaEncryption) is.',
    );
    const rsaParams = toPem(
      sequence(sequence(oid('1.2.840.113549.1.1.1'), smallInteger(0)), bitString(new Uint8Array(4))),
      'PUBLIC KEY',
    );
    expect(await message(rsaParams)).toBe("Byte 15: RSA's algorithm parameters must be NULL.");
  });
});

describe('§6: OpenSSH lines', () => {
  it('FIDO keys, certificates, options', async () => {
    expect(await message('sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29t x')).toBe(
      'Security-key (FIDO) keys are not supported: their private part lives on the device.',
    );
    expect(await message('ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlcnQtdjAxQG9wZW5zc2guY29t x')).toBe(
      'This is an OpenSSH certificate, not a public key line.',
    );
    expect(await message(`from="10.0.0.1" ssh-ed25519 ${b64(ED_BLOB)} alice`)).toBe(
      'authorized_keys options before the key type are not read; paste the line from the key type on.',
    );
  });

  it('a type that differs from the blob, a truncated blob, bytes after the last field, bad Base64', async () => {
    expect(await message(`ssh-rsa ${b64(ED_BLOB)}`)).toBe('The line says ssh-rsa, but the key inside is ssh-ed25519.');
    expect(await message(`ssh-ed25519 ${b64(ED_BLOB.subarray(0, 40))}`)).toBe(
      'The key data ends inside its "public key" field (truncated?).',
    );
    expect(await message(`ssh-ed25519 ${b64(Buffer.concat([ED_BLOB, Uint8Array.of(0, 0, 0, 0)]))}`)).toBe(
      'The key data has 4 bytes after its last field.',
    );
    expect(await message('ssh-ed25519 AAAA!xyz')).toBe('The key data is not valid Base64: position 5, "!".');
  });

  it('the line reads, with its comment', async () => {
    const k = await keyOf(`ssh-ed25519 ${b64(ED_BLOB)} alice@laptop`);
    expect(spki(k.data)).toEqual(new Uint8Array(der(ED25519_SPKI)));
    expect(k.comment).toBe('alice@laptop');
  });
});

describe('§6: JWK', () => {
  const ED = (extra: object) =>
    JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo', ...extra });
  it.each([
    ['{"kty":', 'The JSON is not valid. Line 1, column 8: '],
    ['{"kty":"RSA","e":"AQAB"}', 'The JWK has no "n".'],
    [
      ED({ x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo=' }),
      'The JWK\'s "x" has "=" padding; JWK uses Base64url without padding (RFC 7515 §2).',
    ],
    [ED({ x: '11qY+YKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' }), 'The JWK\'s "x" is not Base64url: position 5, "+".'],
    [ED({ x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHUR' }), 'The JWK\'s "x" is 31 bytes; Ed25519 needs 32.'],
    ['{"kty":"oct","k":"AAAA"}', 'This JWK is a shared secret (kty "oct"), not a key pair.'],
    [
      '{"kty":"RSA","n":"AQAB","e":"AQAB","d":"AQAB"}',
      'The JWK has "d" but not "p", "q", "dp", "dq" and "qi"; RSA private keys without them are not read.',
    ],
    ['{"kty":"OKP","kty":"OKP"}', 'The JWK has "kty" twice.'],
    ['{"keys":[]}', 'The set has no keys.'],
    [
      '{"kty":"EC","crv":"secp256k1","x":"AA","y":"AA"}',
      'The curve secp256k1 is not supported: Web Crypto has P-256, P-384 and P-521.',
    ],
    ['{"kty":"OKP","crv":"Ed448","x":"AA"}', "Ed448 keys are not supported: the browser's Web Crypto has no Ed448."],
  ])('%s', async (input, expected) => {
    const got = await message(input);
    if (expected.endsWith(': ')) expect(got.startsWith(expected)).toBe(true);
    else expect(got).toBe(expected);
  });

  it('a set: keys in order, a shared secret skipped with a note, a bad key refused in its place', () => {
    const r = readKeys(
      JSON.stringify({ keys: [JSON.parse(ED({ kid: 'a' })), { kty: 'oct', k: 'AA' }, { kty: 'RSA' }] }),
    );
    expect(r.items.map(i => (i.ok ? i.key.jwk?.kid : i.message))).toEqual(['a', 'The JWK has no "n".']);
    expect(r.notes).toEqual(['Key 2 of the set is a shared secret (kty "oct") and was skipped.']);
  });
});

describe('§6: the checks of §5.6', () => {
  it('an exponent other than 65537 is a note', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 });
    expect(await message(publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBe(
      'read: The public exponent is 3, not the usual 65537.',
    );
  });

  it('RSA numbers that do not belong together', async () => {
    const base = readKeys(TEST_RSA2048).items[0]!;
    if (!base.ok || base.key.data.type !== 'rsa') throw new Error('unread');
    const rsa = base.key.data;
    const bump = (b: Uint8Array) => {
      const c = b.slice();
      c[c.length - 1]! ^= 2;
      return c;
    };
    const variant = async (priv: Partial<NonNullable<typeof rsa.priv>>) => {
      const data: KeyData = { ...rsa, priv: { ...rsa.priv!, ...priv } };
      return message(toPem(traditional(data)!, 'RSA PRIVATE KEY'));
    };
    const head = "The RSA private key's numbers do not belong together: ";
    expect(await variant({ dp: bump(rsa.priv!.dp) })).toBe(`${head}dp is not d mod (p − 1).`);
    expect(await variant({ q: bump(rsa.priv!.q) })).toBe(`${head}n is not p × q.`);
    expect(await variant({ dq: bump(rsa.priv!.dq) })).toBe(`${head}dq is not d mod (q − 1).`);
    expect(await variant({ qi: bump(rsa.priv!.qi) })).toBe(`${head}qi is not the inverse of q mod p.`);
    expect(TEST_RSA2048_LINES.length).toBeGreaterThan(0);
  });

  it('a point off the curve is refused by Web Crypto', async () => {
    const k = await keyOf(TEST_ECC_P256);
    const point = new Uint8Array(der(toPem(spki(k.data), 'PUBLIC KEY')).subarray(-65));
    point[64]! ^= 1;
    expect(await message(P256_SPKI('1.2.840.10045.3.1.7', point))).toBe(
      'The public point is not on the P-256 curve; the key was refused.',
    );
  });

  it('a stored public key that is not the private key’s', async () => {
    const k = await keyOf(TEST_ECC_P256);
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
    const data = { ...k.data, x: Buffer.from(other.x!, 'base64url'), y: Buffer.from(other.y!, 'base64url') } as KeyData;
    expect(await message(toPem(traditional(data)!, 'EC PRIVATE KEY'))).toBe(
      'The public key stored with this private key does not belong to it.',
    );
  });

  it('without Ed25519 in Web Crypto: no derivation, or the stored key with a note', async () => {
    const real = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'importKey').mockImplementation((format, keyData, algorithm, extractable, usages) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name === 'Ed25519') return Promise.reject(new DOMException('no', 'NotSupportedError'));
      return real(format as 'pkcs8', keyData as never, algorithm, extractable, usages);
    });
    expect(await message(ED25519_V1)).toBe(
      'This browser has no Ed25519 in Web Crypto (Chrome 137 or later), so the public key cannot be derived here.',
    );
    expect(await message(ED25519_V2)).toBe(
      "read: The key's attributes were skipped. | This browser cannot check that the public key belongs to the private key (no Ed25519 in Web Crypto).",
    );
  });
});

describe('§6: limits and bare DER', () => {
  it('more than 20 keys, more than 1 MB', () => {
    const line = `ssh-ed25519 ${b64(ED_BLOB)}`;
    const r = readKeys(Array.from({ length: 21 }, () => line).join('\n'));
    expect(r.items).toHaveLength(20);
    expect(r.notes).toEqual([TOO_MANY]);
    expect(TOO_MANY).toBe('Only the first 20 keys are shown.');
    expect(readKeys('x'.repeat(MAX_INPUT + 1)).message).toBe(TOO_LARGE);
    expect(TOO_LARGE).toBe('The text is larger than 1 MB; keys are much smaller.');
  });

  it('bare Base64 DER of a public or private key', async () => {
    const pub = await keyOf(b64(der(ED25519_SPKI)));
    expect(pub.source).toBe('der');
    const priv = await keyOf(b64(der(ED25519_V1)));
    expect(priv.source).toBe('der');
    expect(await message(b64(der(ED25519_SPKI)).replace(/(.{20})/g, '$1\n'))).toBe('read: ');
  });

  it('an EC PARAMETERS block before the key is skipped with a note', () => {
    const r = readKeys(`${pem('EC PARAMETERS', ['BggqhkjOPQMBBw=='])}${TEST_ECC_P256}`);
    expect(r.items).toHaveLength(1);
    expect(r.notes).toEqual(['The EC PARAMETERS block was skipped: the key names its curve itself.']);
  });

  it('PEM pasted out of JSON (\\n as two characters) reads', async () => {
    expect((await keyOf(ED25519_SPKI.replace(/\n/g, '\\n'))).source).toBe('spki');
    expect(nullValue()).toEqual(Uint8Array.of(5, 0));
  });
});
