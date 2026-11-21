// The `Digester` contract (AGENTS.md, "Replaceable Behavior": one shared suite, run against every implementation):
// published vectors, RFC 2104 HMAC with short and long keys, node:crypto at the block boundaries fed in uneven pieces,
// and the whole of hashAll / hashBlob on top of each implementation.
import { defaultDigester, hashAll, hashBlob, nobleDigester, wasmDigester } from './index';
import { describe, expect, it } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Algorithm, Digester } from './index';

const NODE: Record<Algorithm, string> = {
  MD5: 'md5',
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
};
const ALL = Object.keys(NODE) as Algorithm[];
const hex = (u8: Uint8Array): string => Buffer.from(u8).toString('hex');
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const once = async (d: Digester, algorithm: Algorithm, data: Uint8Array, key?: Uint8Array, piece = 777) => {
  const stream = await d.create(algorithm, key);
  for (let at = 0; at < data.length; at += piece) stream.update(data.subarray(at, at + piece));
  return hex(stream.digest());
};

describe.each([nobleDigester, wasmDigester])('Digester contract: $name', digester => {
  it('gives the published vectors (RFC 1321, FIPS 180-4)', async () => {
    expect(await once(digester, 'MD5', utf8('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(await once(digester, 'SHA-1', utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
    expect(await once(digester, 'SHA-256', utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await once(digester, 'SHA-512', new Uint8Array())).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    );
  });

  it('gives RFC 2202 / RFC 4231 HMAC, a key longer than the block too', async () => {
    const data = utf8('what do ya want for nothing?');
    expect(await once(digester, 'MD5', data, utf8('Jefe'))).toBe('750c783e6ab0b503eaa86e310a5db738');
    expect(await once(digester, 'SHA-384', data, utf8('Jefe'))).toBe(
      'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
    );
    const long = utf8('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(await once(digester, 'SHA-256', long, new Uint8Array(131).fill(0xaa))).toBe(
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    );
  });

  it.each([0, 1, 55, 56, 63, 64, 65, 111, 112, 127, 128, 129, 1000, 70_000])(
    'agrees with node:crypto on %i random bytes in uneven pieces, plain and HMAC',
    async length => {
      const data = randomBytes(length);
      const key = randomBytes(1 + (length % 200));
      for (const algorithm of ALL)
        for (const k of [undefined, key]) {
          const want = (k ? createHmac(NODE[algorithm], k) : createHash(NODE[algorithm])).update(data).digest('hex');
          expect(await once(digester, algorithm, data, k), `${algorithm}${k ? ' HMAC' : ''}`).toBe(want);
        }
    },
  );

  it('streams are independent: two at once do not share state', async () => {
    const a = await digester.create('SHA-256');
    const b = await digester.create('SHA-256');
    a.update(utf8('ab'));
    b.update(utf8('x'));
    a.update(utf8('c'));
    expect(hex(a.digest())).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(b.digest())).toBe(createHash('sha256').update('x').digest('hex'));
  });

  it('drives hashAll and hashBlob to the same digests as node:crypto', async () => {
    const data = randomBytes(3 * 4096 + 5);
    const key = randomBytes(40);
    const memory = await hashAll(data, { digester, key, chunkSize: 4096 });
    const file = await hashBlob(new Blob([data]), { digester, key, chunkSize: 1000 });
    for (const algorithm of ALL) {
      const want = createHmac(NODE[algorithm], key).update(data).digest('hex');
      expect(hex(memory[algorithm]), `${algorithm} memory`).toBe(want);
      expect(hex(file[algorithm]!), `${algorithm} file`).toBe(want);
    }
  });
});

describe('the choice (behaviors.ts)', () => {
  it('is hash-wasm', () => {
    expect(defaultDigester).toBe(wasmDigester);
  });
});
