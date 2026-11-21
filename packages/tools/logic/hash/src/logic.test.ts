import {
  ALGORITHMS,
  compareExpected,
  decodeInput,
  formatDigest,
  formatRate,
  formatRemaining,
  formatSize,
  hashAll,
  hashBlob,
  MAX_INPUT_BYTES,
  textHints,
} from './index';
import { describe, expect, it } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Algorithm, Digests } from './index';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const hexOf = (d: Uint8Array): string => formatDigest(d, 'hex');
const bytes = (hex: string): Uint8Array => {
  const decoded = decodeInput(hex, 'hex');
  if (!decoded.ok) throw new Error(decoded.message);
  return decoded.bytes;
};
const repeat = (byte: number, n: number): Uint8Array => new Uint8Array(n).fill(byte);
const hexes = async (input: Uint8Array, key?: Uint8Array): Promise<Record<Algorithm, string>> => {
  const d = await hashAll(input, key ? { key } : {});
  return Object.fromEntries(ALGORITHMS.map(a => [a, hexOf(d[a])])) as Record<Algorithm, string>;
};
const text = (t: string, key?: Uint8Array) => hexes(utf8(t), key);
const decoded = (t: string, f: 'hex' | 'base64') => {
  const r = decodeInput(t, f);
  if (!r.ok) throw new Error(r.message);
  return r.bytes;
};

const ABC = {
  MD5: '900150983cd24fb0d6963f7d28e17f72',
  'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
  'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'SHA-384': 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
  'SHA-512':
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
};
const digestsOfAbc = (): Promise<Digests> => hashAll(utf8('abc'));

// docs/tools/specs/hash.md §10, row by row.
describe('§10 examples', () => {
  it('1: the empty text (RFC 1321 A.5, FIPS 180-4)', async () => {
    expect(await text('')).toEqual({
      MD5: 'd41d8cd98f00b204e9800998ecf8427e',
      'SHA-1': 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      'SHA-256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'SHA-384': '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
      'SHA-512':
        'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    });
  });

  it('2: abc (RFC 1321 A.5, NIST examples to FIPS 180-4)', async () => {
    expect(await text('abc')).toEqual(ABC);
  });

  it('3: abc with a line break, and its hint', async () => {
    const d = await text('abc\n');
    expect(d['SHA-256']).toBe('edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb');
    expect(d.MD5).toBe('0bee89b07a248e27c83fc3d5951213c1');
    expect(textHints('abc\n')).toEqual(['trailing-newline']);
  });

  it('4: message digest (RFC 1321 A.5)', async () => {
    expect((await text('message digest')).MD5).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  it('5: the quick brown fox', async () => {
    const d = await text('The quick brown fox jumps over the lazy dog');
    expect(d.MD5).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(d['SHA-1']).toBe('2fd4e1c67a2d28fced849ee1bb76e7391b93eb12');
    expect(d['SHA-256']).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });

  it('6: привет — 12 bytes of UTF-8', async () => {
    expect(utf8('привет').length).toBe(12);
    const d = await text('привет');
    expect(d.MD5).toBe('608333adc72f545078ede3aad71bfe74');
    expect(d['SHA-256']).toBe('e58f1e8c55fa105bdd3f40e5037eb0b039b5998d52c05e6cd98878dd2da5cab2');
  });

  it('7: 🙂 — the 4 bytes f0 9f 99 82', async () => {
    expect(formatDigest(utf8('🙂'), 'hex')).toBe('f09f9982');
    const d = await text('🙂');
    expect(d.MD5).toBe('5c8d6d302301d0e25c0e051418dff305');
    expect(d['SHA-256']).toBe('d06f1525f791397809f9bc98682b5c13318eca4c3123433467fd4dffda44fd14');
  });

  it('8: hex 61 0d 0a 62 (a\\r\\nb, which a textarea cannot give)', async () => {
    const d = await hexes(decoded('61 0d 0a 62', 'hex'));
    expect(d.MD5).toBe('65d5f03c46e62e3f2babbe712d2ce464');
    expect(d['SHA-256']).toBe('18745f36a05e29072709042d6062ce54f1b08ff36c27ba80c39f81fb010c8ce2');
  });

  it('9: hex 0x00FF, and 00 FF the same', async () => {
    const sha = '06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8';
    expect((await hexes(decoded('0x00FF', 'hex')))['SHA-256']).toBe(sha);
    expect((await hexes(decoded('00 FF', 'hex')))['SHA-256']).toBe(sha);
    expect((await hexes(decoded('0x00ff', 'hex')))['SHA-256']).toBe(sha);
  });

  it('10: Output Base64', async () => {
    const d = await digestsOfAbc();
    expect(formatDigest(d['SHA-256'], 'base64')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    expect(formatDigest(d.MD5, 'base64')).toBe('kAFQmDzST7DWlj99KOF/cg==');
  });

  it('11: Output HEX', async () => {
    expect(formatDigest((await digestsOfAbc()).MD5, 'HEX')).toBe('900150983CD24FB0D6963F7D28E17F72');
  });

  it('12: HMAC, Hi There, key hex 0b × 20 (RFC 4231 §4.2)', async () => {
    expect(await text('Hi There', repeat(0x0b, 20))).toEqual({
      MD5: '5ccec34ea9656392457fa1ac27f08fbc',
      'SHA-1': 'b617318655057264e28bc0b6fb378c8ef146be00',
      'SHA-256': 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      'SHA-384': 'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
      'SHA-512':
        '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    });
  });

  it('13: HMAC, what do ya want for nothing?, key Jefe (RFC 2202, RFC 4231 §4.3)', async () => {
    expect(await text('what do ya want for nothing?', utf8('Jefe'))).toEqual({
      MD5: '750c783e6ab0b503eaa86e310a5db738',
      'SHA-1': 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
      'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      'SHA-384': 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
      'SHA-512':
        '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    });
  });

  it('14: HMAC with a key longer than the block, hex aa × 131 (RFC 4231 §4.7)', async () => {
    const d = await text('Test Using Larger Than Block-Size Key - Hash Key First', decoded('aa'.repeat(131), 'hex'));
    expect(d.MD5).toBe('bfecaf4efff90a3a668f3922fec3762d');
    expect(d['SHA-256']).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
    expect(d['SHA-384']).toBe(
      '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
    );
    expect(d['SHA-512']).toBe(
      '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
    );
  });

  it('15: HMAC, the quick brown fox, key key', async () => {
    const d = await text('The quick brown fox jumps over the lazy dog', utf8('key'));
    expect(d.MD5).toBe('80070713463e7749b90c2dc24911e275');
    expect(d['SHA-1']).toBe('de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9');
    expect(d['SHA-256']).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('16: an empty key is never hashed with (the component shows "Enter a key.")', async () => {
    await expect(hashAll(utf8('abc'), { key: new Uint8Array() })).rejects.toThrow(RangeError);
    await expect(hashBlob(new Blob(['abc']), { key: new Uint8Array() })).rejects.toThrow(RangeError);
  });

  it('17: a × 1 000 000 (NIST example to FIPS 180-4)', async () => {
    const d = await hexes(repeat(0x61, 1_000_000));
    expect(d['SHA-1']).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
    expect(d['SHA-256']).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    expect(d['SHA-384']).toBe(
      '9d0e1809716474cb086e834e310a4a1ced149e9c00f248527972cec5704c2a5b07b8b3dc38ecc4ebae97ddd87f3d8985',
    );
    expect(d['SHA-512']).toBe(
      'e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b',
    );
    expect(d.MD5).toBe('7707d6ae4e027c70eea2a935c2296f21');
  });

  it('18: the messages of §6, word for word, with their positions', () => {
    expect(decodeInput('abc', 'hex')).toEqual({ ok: false, message: 'Hex needs an even number of digits (3 found).' });
    expect(decodeInput('0g', 'hex')).toEqual({
      ok: false,
      message: 'Position 2: "g" is not a hex digit.',
      position: 1,
    });
    expect(decodeInput('YW=Jj', 'base64')).toEqual({
      ok: false,
      message: 'Position 3: "=" can only appear at the end.',
      position: 2,
    });
    expect(decodeInput('YWJjZ', 'base64')).toEqual({
      ok: false,
      message: 'Base64 length is not valid: one character too many or missing.',
    });
    expect(decodeInput('a+b_', 'base64')).toEqual({
      ok: false,
      message: 'Position 4: "_" belongs to the URL-safe alphabet, but "+" was used before.',
      position: 3,
    });
    // §6: a key in hex `zz`.
    expect(decodeInput('zz', 'hex')).toMatchObject({ message: 'Position 1: "z" is not a hex digit.' });
  });

  it('19: sha256sum output', async () => {
    expect(compareExpected(`${ABC['SHA-256']}  file.txt`, await digestsOfAbc())).toEqual({
      kind: 'match',
      algorithm: 'SHA-256',
    });
  });

  it('20: BSD output, uppercase', async () => {
    expect(compareExpected(`SHA256 (x) = ${ABC['SHA-256'].toUpperCase()}`, await digestsOfAbc())).toEqual({
      kind: 'match',
      algorithm: 'SHA-256',
    });
  });

  it('21: Base64 of MD5', async () => {
    expect(compareExpected('kAFQmDzST7DWlj99KOF/cg==', await digestsOfAbc())).toEqual({
      kind: 'match',
      algorithm: 'MD5',
    });
  });

  it('22: hex with colons', async () => {
    const colons = ABC.MD5.match(/../g)!.join(':');
    expect(colons.startsWith('90:01:50:98:')).toBe(true);
    expect(compareExpected(colons, await digestsOfAbc())).toEqual({ kind: 'match', algorithm: 'MD5' });
  });

  it('23: not a hash, and nothing', async () => {
    const d = await digestsOfAbc();
    expect(compareExpected('abc', d)).toEqual({ kind: 'unparsed' });
    expect(compareExpected('', d)).toEqual({ kind: 'empty' });
  });

  it('24: 3 MiB in chunks of 1 MiB reports growing fractions, the last 1', async () => {
    const fractions: number[] = [];
    const input = randomBytes(3 * 1024 * 1024);
    const d = await hashAll(input, { chunkSize: 1024 * 1024, onProgress: f => fractions.push(f) });
    expect(fractions.length).toBeGreaterThanOrEqual(3);
    expect(fractions.every((f, i) => i === 0 || f > fractions[i - 1]!)).toBe(true);
    expect(fractions.at(-1)).toBe(1);
    expect(hexOf(d.MD5)).toBe(createHash('md5').update(input).digest('hex'));
  });

  it('25: an aborted signal rejects with an AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(hashAll(utf8('abc'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(hashBlob(new Blob(['abc']), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('26: text hints', () => {
    expect(textHints('abc\n')).toEqual(['trailing-newline']);
    expect(textHints(' abc')).toEqual(['edge-space']);
    expect(textHints('abc')).toEqual([]);
  });
});

// What §5 and §6 state beyond the rows of §10, and the published vectors the rows do not repeat.
describe('§5.1 published vectors', () => {
  it('RFC 1321 A.5, the whole suite', async () => {
    const md5 = async (t: string) => (await text(t)).MD5;
    expect(await md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(await md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(await md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'd174ab98d277d9f5a5611c2c9f419d9f',
    );
    expect(await md5('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('FIPS 180-4 examples: the two-block messages', async () => {
    const short = await text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
    expect(short['SHA-1']).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
    expect(short['SHA-256']).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    const long = await text(
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    );
    expect(long['SHA-384']).toBe(
      '09330c33f71147e83d192fc782cd1b4753111b173b3b05d22fa08086e3b0f712fcc7c71a557e2db966c3e9fa91746039',
    );
    expect(long['SHA-512']).toBe(
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    );
  });
});

describe('§5.2 HMAC published vectors', () => {
  it('RFC 2202: HMAC-MD5 and HMAC-SHA-1 test cases 1, 3, 4, 6, 7', async () => {
    const md5 = async (key: Uint8Array, data: Uint8Array) => (await hexes(data, key)).MD5;
    const sha1 = async (key: Uint8Array, data: Uint8Array) => (await hexes(data, key))['SHA-1'];
    expect(await md5(repeat(0x0b, 16), utf8('Hi There'))).toBe('9294727a3638bb1c13f48ef8158bfc9d');
    expect(await md5(repeat(0xaa, 16), repeat(0xdd, 50))).toBe('56be34521d144c88dbb8c733f0e8b3f6');
    expect(await sha1(repeat(0xaa, 20), repeat(0xdd, 50))).toBe('125d7342b9ac11cd91a39af48aa17b4f63f175d3');
    const counting = bytes('0102030405060708090a0b0c0d0e0f10111213141516171819');
    expect(await md5(counting, repeat(0xcd, 50))).toBe('697eaf0aca3a3aea3a75164746ffaa79');
    expect(await sha1(counting, repeat(0xcd, 50))).toBe('4c9007f4026250c6bc8414f9bf50c86c2d7235da');
    const big = repeat(0xaa, 80);
    const first = utf8('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(await md5(big, first)).toBe('6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd');
    expect(await sha1(big, first)).toBe('aa4ae5e15272d00e95705637ce8a3b55ed402112');
    const two = utf8('Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data');
    expect(await md5(big, two)).toBe('6f630fad67cda0ee1fb1f562db3aa53e');
    expect(await sha1(big, two)).toBe('e8e99d0f45237d786d6bbaa7965c7808bbff1a91');
  });

  it('RFC 4231: test cases 4 and 7 (SHA-256, SHA-384, SHA-512)', async () => {
    const four = await hexes(repeat(0xcd, 50), bytes('0102030405060708090a0b0c0d0e0f10111213141516171819'));
    expect(four['SHA-256']).toBe('82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b');
    expect(four['SHA-384']).toBe(
      '3e8a69b7783c25851933ab6290af6ca77a9981480850009cc5577c6e1f573b4e6801dd23c4a7d679ccf8a386c674cffb',
    );
    expect(four['SHA-512']).toBe(
      'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd',
    );
    const seven = await text(
      'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
      repeat(0xaa, 131),
    );
    expect(seven['SHA-256']).toBe('9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2');
    expect(seven['SHA-512']).toBe(
      'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58',
    );
  });

  it('a key shorter than the digest is used as it is (RFC 2104 §3 only advises against it)', async () => {
    const d = await text('data', utf8('k'));
    expect(d['SHA-512']).toBe(createHmac('sha512', 'k').update('data').digest('hex'));
  });
});

describe('the same bytes give the same digests from memory and from a file (§5.3), equal to node:crypto', () => {
  const NODE: Record<Algorithm, string> = {
    MD5: 'md5',
    'SHA-1': 'sha1',
    'SHA-256': 'sha256',
    'SHA-384': 'sha384',
    'SHA-512': 'sha512',
  };
  const lengths = [0, 1, 55, 56, 63, 64, 65, 111, 112, 127, 128, 129, 1000, 70_000];

  it.each(lengths)('%i random bytes, plain and HMAC', async length => {
    const input = randomBytes(length);
    const key = randomBytes(1 + (length % 200));
    for (const k of [undefined, key]) {
      const memory = await hashAll(input, k ? { key: k, chunkSize: 4096 } : { chunkSize: 4096 });
      const file = await hashBlob(new Blob([input]), k ? { key: k, chunkSize: 1000 } : { chunkSize: 1000 });
      for (const a of ALGORITHMS) {
        const expected = (k ? createHmac(NODE[a], k) : createHash(NODE[a])).update(input).digest('hex');
        expect(hexOf(memory[a]), `${a} memory`).toBe(expected);
        expect(hexOf(file[a]!), `${a} file`).toBe(expected);
      }
    }
  });
});

describe('hashBlob (files, read in chunks)', () => {
  it('reports bytes and growing fractions, the last 1; an empty file is the empty input', async () => {
    const seen: number[] = [];
    const fractions: number[] = [];
    await hashBlob(new Blob([randomBytes(2500)]), {
      chunkSize: 1000,
      onBytes: b => seen.push(b),
      onProgress: f => fractions.push(f),
    });
    expect(seen).toEqual([1000, 2000, 2500]);
    expect(fractions).toEqual([0.4, 0.8, 1]);
    const empty = await hashBlob(new Blob([]));
    expect(hexOf(empty.MD5!)).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('computes only the algorithms asked for', async () => {
    const d = await hashBlob(new Blob(['abc']), { algorithms: ['SHA-1', 'SHA-384'] });
    expect(Object.keys(d)).toEqual(['SHA-1', 'SHA-384']);
    expect(hexOf(d['SHA-384']!)).toBe(ABC['SHA-384']);
  });

  it('stops between chunks when aborted', async () => {
    const controller = new AbortController();
    const run = hashBlob(new Blob([randomBytes(10_000)]), {
      chunkSize: 1000,
      signal: controller.signal,
      onBytes: b => b >= 3000 && controller.abort(),
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when the file cannot be read', async () => {
    const broken = {
      size: 10,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }),
    } as unknown as Blob;
    await expect(hashBlob(broken)).rejects.toThrow('NotReadableError');
  });

  it('an abort during hashAll stops it too', async () => {
    const controller = new AbortController();
    const run = hashAll(randomBytes(4 * 1024 * 1024), {
      chunkSize: 1024 * 1024,
      signal: controller.signal,
      onProgress: f => f > 0.3 && controller.abort(),
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('§5.4 hex', () => {
  it('skips white space anywhere, takes 0x or 0X at the start, digits in any case', () => {
    expect(formatDigest(decoded(' 0X 0a\tB c\nD0 ', 'hex'), 'hex')).toBe('0abcd0');
    expect(formatDigest(decoded('\n  0xDEADbeef', 'hex'), 'hex')).toBe('deadbeef');
  });

  it('empty, white space or a bare 0x is no bytes (the hash of the empty input), not an error', () => {
    expect(decoded('', 'hex')).toEqual(new Uint8Array());
    expect(decoded('  \n', 'hex')).toEqual(new Uint8Array());
    expect(decoded('0x', 'hex')).toEqual(new Uint8Array());
  });

  it('names the first wrong character at its UTF-16 position in the field as typed', () => {
    expect(decodeInput(' 0 g', 'hex')).toMatchObject({ message: 'Position 4: "g" is not a hex digit.', position: 3 });
    expect(decodeInput('00x1', 'hex')).toMatchObject({ message: 'Position 3: "x" is not a hex digit.' });
    expect(decodeInput('0x0x', 'hex')).toMatchObject({ message: 'Position 4: "x" is not a hex digit.' });
    // A character outside the BMP is quoted whole; its position is its first UTF-16 unit.
    expect(decodeInput('a🙂b', 'hex')).toMatchObject({ message: 'Position 2: "🙂" is not a hex digit.', position: 1 });
    // A wrong character is reported before an odd count.
    expect(decodeInput('abg', 'hex')).toMatchObject({ message: 'Position 3: "g" is not a hex digit.' });
  });
});

describe('§5.4 Base64', () => {
  it('takes either alphabet, white space anywhere, = optional', () => {
    expect(decoded('+/8=', 'base64')).toEqual(new Uint8Array([0xfb, 0xff]));
    expect(decoded('-_8', 'base64')).toEqual(new Uint8Array([0xfb, 0xff]));
    expect(decoded('YW Jj\nZA', 'base64')).toEqual(utf8('abcd'));
    expect(decoded('YWJjZA==', 'base64')).toEqual(utf8('abcd'));
    expect(decoded('', 'base64')).toEqual(new Uint8Array());
  });

  it('does not check the unused bits of the last character', () => {
    expect(decoded('YR==', 'base64')).toEqual(decoded('YQ==', 'base64'));
  });

  it('refuses mixed alphabets, either way round, at the first character of the other one', () => {
    expect(decodeInput('ab-c/', 'base64')).toEqual({
      ok: false,
      message: 'Position 5: "/" belongs to the standard alphabet, but "-" was used before.',
      position: 4,
    });
  });

  it('refuses = before the end, more than two =, and a character of neither alphabet', () => {
    expect(decodeInput('=YWJj', 'base64')).toMatchObject({ message: 'Position 1: "=" can only appear at the end.' });
    expect(decodeInput('YQ===', 'base64')).toEqual({
      ok: false,
      message: 'Position 5: Base64 ends with at most two "=".',
      position: 4,
    });
    expect(decodeInput('YW!j', 'base64')).toEqual({
      ok: false,
      message: 'Position 3: "!" is not a Base64 character.',
      position: 2,
    });
  });
});

describe('§3 text', () => {
  it('is UTF-8 as typed: no trimming, no normalisation, a lone surrogate becomes U+FFFD', () => {
    const t = decodeInput(' a\n', 'text');
    expect(t.ok && Array.from(t.bytes)).toEqual([0x20, 0x61, 0x0a]);
    const nfd = decodeInput('é', 'text');
    expect(nfd.ok && nfd.bytes.length).toBe(3);
    const lone = decodeInput('\ud83d', 'text');
    expect(lone.ok && Array.from(lone.bytes)).toEqual([0xef, 0xbf, 0xbd]);
  });

  it('hints: spaces only, a tab, both hints at once', () => {
    expect(textHints('   ')).toEqual(['edge-space']);
    expect(textHints('abc\t')).toEqual(['edge-space']);
    expect(textHints(' abc\n')).toEqual(['trailing-newline', 'edge-space']);
    expect(textHints('')).toEqual([]);
  });
});

describe('§5.3 output', () => {
  it('hex lowercase, HEX uppercase, Base64 padded, no separators', async () => {
    const d = await digestsOfAbc();
    expect(formatDigest(d['SHA-1'], 'hex')).toBe(ABC['SHA-1']);
    expect(formatDigest(d['SHA-512'], 'HEX')).toBe(ABC['SHA-512'].toUpperCase());
    expect(formatDigest(d['SHA-1'], 'base64')).toBe('qZk+NkcGgWq6PiVxeFDCbJzQ2J0=');
  });
});

describe('§5.5 comparison', () => {
  it('takes the first hex word of a valid length, ignores others; Base64 of each length', async () => {
    const d = await digestsOfAbc();
    expect(compareExpected(`deadbeef ${ABC['SHA-1']} ${ABC.MD5}`, d)).toEqual({ kind: 'match', algorithm: 'SHA-1' });
    expect(compareExpected(`  ${ABC['SHA-512']}\n`, d)).toEqual({ kind: 'match', algorithm: 'SHA-512' });
    for (const a of ALGORITHMS)
      expect(compareExpected(formatDigest(d[a], 'base64'), d)).toEqual({ kind: 'match', algorithm: a });
  });

  it('a hash of other bytes does not match; a hex word of the wrong length is no hash', async () => {
    const d = await digestsOfAbc();
    expect(compareExpected('d41d8cd98f00b204e9800998ecf8427e', d)).toEqual({ kind: 'no-match' });
    expect(compareExpected(ABC.MD5.slice(2), d)).toEqual({ kind: 'unparsed' });
    expect(compareExpected('   ', d)).toEqual({ kind: 'empty' });
  });
});

describe('§8 progress of a file', () => {
  it('throughput in MB/s and the time left', () => {
    expect(formatRate(312.4 * 1024 * 1024)).toBe('312 MB/s');
    expect(formatRemaining(0.2)).toBe('about 1 s left');
    expect(formatRemaining(12.4)).toBe('about 12 s left');
    expect(formatRemaining(59)).toBe('about 59 s left');
    expect(formatRemaining(185)).toBe('about 3 min left');
  });
});

describe('§8 sizes and §12 limits', () => {
  it('base 1 024, bytes / KB / MB, one decimal at most', () => {
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(1)).toBe('1 byte');
    expect(formatSize(1023)).toBe('1,023 bytes');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(Math.round(4.2 * 1024 * 1024))).toBe('4.2 MB');
    expect(formatSize(256 * 1024 * 1024)).toBe('256 MB');
    expect(formatSize(5 * 1024 * 1024 * 1024)).toBe('5,120 MB');
    expect(formatSize(MAX_INPUT_BYTES)).toBe('16 MB');
  });
});
