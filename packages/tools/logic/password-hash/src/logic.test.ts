import {
  argon2Hash,
  assess,
  bcryptHash,
  checkParams,
  describe as describeHash,
  detectPasswordHash,
  hashPassword,
  parseHash,
  passwordNotes,
  pbkdf2Hash,
  RECOMMENDED,
  resolveSalt,
  runJob,
  scryptHash,
  SECRET_NOTE,
  secretError,
  timingSafeEqual,
  verifyPassword,
} from './index';
import { decodeBcrypt64, encodeAb64, encodeB64, encodeH64, decodeH64, decodeAb64, decodeB64 } from './encoding';
import { describe, expect, it, vi } from 'vitest';
import type { Params, ParsedHash } from './index';

// docs/tools/specs/password-hash.md §10: every row, with its expected value. Samples that look like hashes are test
// vectors (published or made here), not secrets.

const enc = new TextEncoder();
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const bytes = (s: string): Uint8Array => Uint8Array.from(s, c => c.charCodeAt(0));
const SALT16 = Uint8Array.from({ length: 16 }, (_, i) => i);
const ok = (text: string): ParsedHash => {
  const parsed = parseHash(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.hash;
};
const argon = (
  algorithm: 'argon2i' | 'argon2id' | 'argon2d',
  memory: number,
  iterations: number,
  parallelism: number,
) => ({ algorithm, memory, iterations, parallelism }) as const;

describe('Argon2: the reference implementation’s vectors (phc-winner-argon2 src/test.c, version 0x13) — rows 1–10', () => {
  const pw = enc.encode('password');
  const salt = enc.encode('somesalt');
  it('row 1: Argon2i m=65536 t=2 p=1, as a PHC string', async () => {
    const out = await hashPassword({
      password: 'password',
      params: argon('argon2i', 65536, 2, 1),
      format: 'phc',
      salt,
    });
    expect(out).toBe('$argon2i$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$wWKIMhR9lyDFvRz9YTZweHKfbftvj+qf+YFY4NeBbtA'); // gitleaks:allow — published test vector
  });
  it.each([
    [2, 1 << 18, 1, 'password', 'somesalt', '296dbae80b807cdceaad44ae741b506f14db0959267b183b118f9b24229bc7cb'],
    [3, 1 << 8, 1, 'password', 'somesalt', '89e9029f4637b295beb027056a7336c414fadd43f6b208645281cb214a56452f'],
    [4, 1 << 8, 2, 'password', 'somesalt', '4ff5ce2769a1d7f4c8a491df09d41a9fbe90e5eb02155a13e4c01e20cd4eab61'],
    [7, 65536, 1, 'differentpassword', 'somesalt', '14ae8da01afea8700c2358dcef7c5358d9021282bd88663a4562f59fb74d22ee'],
    [8, 65536, 1, 'password', 'diffsalt', 'b0357cccfbef91f3860b0dba447b2348cbefecadaf990abfe9cc40726c521271'],
  ])('row %i: Argon2i m=%i p=%i', async (_row, m, p, password, s, expected) => {
    expect(hex(await argon2Hash(enc.encode(password), enc.encode(s), argon('argon2i', m, 2, p), 32))).toBe(expected);
  });
  it('rows 5, 6: Argon2i t=1 and t=4', async () => {
    expect(hex(await argon2Hash(pw, salt, argon('argon2i', 65536, 1, 1), 32))).toBe(
      'd168075c4d985e13ebeae560cf8b94c3b5d8a16c51916b6f4ac2da3ac11bbecf',
    );
    expect(hex(await argon2Hash(pw, salt, argon('argon2i', 65536, 4, 1), 32))).toBe(
      'aaa953d58af3706ce3df1aefd4a64a84e31d7f54175231f1285259f88174ce5b',
    );
  });
  it('row 9: Argon2id m=65536 t=2 p=1', async () => {
    const out = await hashPassword({
      password: 'password',
      params: argon('argon2id', 65536, 2, 1),
      format: 'phc',
      salt,
    });
    expect(out).toBe('$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc'); // gitleaks:allow — published test vector
  });
  it('row 10: Argon2d m=65536 t=2 p=1 (OpenSSL 4.1)', async () => {
    expect(hex(await argon2Hash(pw, salt, argon('argon2d', 65536, 2, 1), 32))).toBe(
      '955e5d5b163a1b60bba35fc36d0496474fba4f6b59ad53628666f07fb2f93eaf',
    );
  });
});

describe('Argon2 at the OWASP minimum with a fixed salt (OpenSSL 4.1) — rows 12–14', () => {
  it.each([
    [
      'argon2id',
      19456,
      2,
      '$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$xS5rdTl7ppbYZoS3aZJQSPuBks4p4O+PSmBqGMMe/7U',
    ], // gitleaks:allow — test vector made with OpenSSL
    [
      'argon2i',
      19456,
      2,
      '$argon2i$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$6cVdbax53TSd54p1P7Tw2VonmRqSAZq2GRggY69ltc4',
    ], // gitleaks:allow — test vector
    [
      'argon2d',
      19456,
      2,
      '$argon2d$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$0cytacVMHr5J2dqUrcG395PeCBBptblaZsLnMxJ29ik',
    ], // gitleaks:allow — test vector
  ] as const)('%s', async (algorithm, m, t, expected) => {
    const params = argon(algorithm, m, t, 1);
    expect(await hashPassword({ password: 'hunter2', params, format: 'phc', salt: SALT16 })).toBe(expected);
    expect(await verifyPassword('hunter2', ok(expected))).toBe(true);
    expect(await verifyPassword('hunter3', ok(expected))).toBe(false);
  });
});

describe('scrypt: RFC 7914 §12 — rows 15–18', () => {
  const s = (logN: number, r: number, p: number) => ({ algorithm: 'scrypt', logN, r, p }) as const;
  it('row 15: empty password and salt, N=16 r=1 p=1', async () => {
    expect(hex(await scryptHash(new Uint8Array(), new Uint8Array(), s(4, 1, 1), 64))).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    );
  });
  it('row 16: password / NaCl, N=1024 r=8 p=16', async () => {
    expect(hex(await scryptHash(enc.encode('password'), enc.encode('NaCl'), s(10, 8, 16), 64))).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );
  });
  it('row 17: pleaseletmein / SodiumChloride, N=16384 r=8 p=1', async () => {
    expect(hex(await scryptHash(enc.encode('pleaseletmein'), enc.encode('SodiumChloride'), s(14, 8, 1), 64))).toBe(
      '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887',
    );
  });
  it('row 18: the same with N=1048576 (1 GiB of memory)', { timeout: 60_000 }, async () => {
    expect(hex(await scryptHash(enc.encode('pleaseletmein'), enc.encode('SodiumChloride'), s(20, 8, 1), 64))).toBe(
      '2101cb9b6a511aaeaddbbe09cf70f881ec568d574a2ffd4dabe5ee9820adaa478e56fd8f4ba5d09ffa1c6d927c40f4c337304049e8a952fbcbf45c6fa77a41a4',
    );
  });
});

describe('PBKDF2: RFC 7914 §11 (SHA-256) and RFC 6070 (SHA-1) — rows 19–23', () => {
  const p = (algorithm: 'pbkdf2-sha256' | 'pbkdf2-sha1', iterations: number) => ({ algorithm, iterations }) as const;
  it('row 19: passwd / salt, c=1, 64 bytes', async () => {
    expect(hex(await pbkdf2Hash(enc.encode('passwd'), enc.encode('salt'), p('pbkdf2-sha256', 1), 64))).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
  });
  it('row 20: Password / NaCl, c=80000', async () => {
    expect(hex(await pbkdf2Hash(enc.encode('Password'), enc.encode('NaCl'), p('pbkdf2-sha256', 80000), 64))).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    );
  });
  it.each([
    [1, 20, 'password', 'salt', '0c60c80f961f0e71f3a9b524af6012062fe037a6'],
    [2, 20, 'password', 'salt', 'ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957'],
    [4096, 20, 'password', 'salt', '4b007901b765489abead49d926f721d065a429c1'],
    [
      4096,
      25,
      'passwordPASSWORDpassword',
      'saltSALTsaltSALTsaltSALTsaltSALTsalt',
      '3d2eec4fe41c849b80c8d83662c0e44a8b291a964cf2f07038',
    ],
    [4096, 16, 'pass\u{0}word', 'sa\u{0}lt', '56fa6aa75548099dcc37d7f03425e0c3'],
  ])('rows 21–23: SHA-1, c=%i, %i bytes', async (c, len, password, salt, expected) => {
    expect(hex(await pbkdf2Hash(enc.encode(password), enc.encode(salt), p('pbkdf2-sha1', c), len))).toBe(expected);
  });
});

describe('bcrypt: crypt_blowfish’s vectors (wrapper.c) — rows 24–28', () => {
  const check = async (vector: string, password: Uint8Array) => {
    const salt = decodeBcrypt64(vector.slice(7, 29))!;
    return (await bcryptHash(password, salt, Number(vector.slice(4, 6)))) === vector.slice(29);
  };
  it.each([
    ['$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW', 'U*U'], // gitleaks:allow — published bcrypt test vector
    ['$2a$05$CCCCCCCCCCCCCCCCCCCCC.VGOzA784oUp/Z0DY336zx7pLYAy0lwK', 'U*U*'], // gitleaks:allow — published bcrypt test vector
    ['$2a$05$XXXXXXXXXXXXXXXXXXXXXOAcXxm9kjPGEMsLznoKqmqw7tc8WCx4a', 'U*U*U'], // gitleaks:allow — published bcrypt test vector
  ])('%s', async (vector, password) => {
    expect(await check(vector, enc.encode(password))).toBe(true);
    // The same through the tool's own reading and check.
    expect(await verifyPassword(password, ok(vector))).toBe(true);
  });
  it('row 26: only the first 72 bytes count', async () => {
    const password =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789chars after 72 are ignored';
    const vector = '$2a$05$abcdefghijklmnopqrstuu5s2v8.iXieOjg/.AySBTTZIIVFJeBui'; // gitleaks:allow — published bcrypt test vector
    expect(await verifyPassword(password, ok(vector))).toBe(true);
    expect(passwordNotes(password, 'bcrypt').notes).toEqual([
      'bcrypt uses only the first 72 bytes of a password; this one is 98 bytes in UTF-8, so the rest is ignored.',
    ]);
  });
  it('row 27: bytes ≥ 0x80 (on bytes, not text)', async () => {
    const password = bytes('\xaa'.repeat(72) + 'chars after 72 are ignored as usual').slice(0, 72);
    expect(await check('$2a$05$/OK.fbVrR/bpIqNJ5ianF.swQOIzjOiJ9GHEPuhEkvqrUyvWhEMx6', password)).toBe(true); // gitleaks:allow — published vector
  });
  it('row 28: on ff ff a3 the library gives crypt_blowfish’s $2a$ (its safety measure), not $2b$/$2y$', async () => {
    const password = bytes('\xff\xff\xa3');
    expect(await check('$2a$05$/OK.fbVrR/bpIqNJ5ianF.nqd1wy.pTMdcvrRWxyiGL2eMz.2a85.', password)).toBe(true); // gitleaks:allow — published vector
    expect(await check('$2b$05$/OK.fbVrR/bpIqNJ5ianF.CE5elHaaO4EbggVDjb8P19RukzXSM3e', password)).toBe(false); // gitleaks:allow — published vector
  });
});

describe('bcrypt in the tool — rows 29–34', () => {
  const b = (cost: number) => ({ algorithm: 'bcrypt', cost }) as const;
  it('row 29: hunter2, salt 00…0f, cost 10, $2b$ (and $2y$ the same characters)', async () => {
    const out = await hashPassword({ password: 'hunter2', params: b(10), format: 'bcrypt-2b', salt: SALT16 });
    expect(out).toBe('$2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK'); // gitleaks:allow — test vector
    expect(await hashPassword({ password: 'hunter2', params: b(10), format: 'bcrypt-2y', salt: SALT16 })).toBe(
      out.replace('$2b$', '$2y$'),
    );
    expect(
      await hashPassword({ password: 'hunter2', params: b(10), format: 'htpasswd', salt: SALT16, user: 'alice' }),
    ).toBe(`alice:${out.replace('$2b$', '$2y$')}`);
  });
  it('rows 30, 31: htpasswd lines made by Apache with UTF-8 passwords', async () => {
    const line = 'alice:$2y$05$FqjVqRCQToguCayDD8.AseYCNXEWIWJI0V/vZHmH2ktYAuI7abSfG'; // gitleaks:allow — made by htpasswd for a test
    const hash = ok(line);
    expect(await verifyPassword('пароль', hash)).toBe(true);
    expect(await verifyPassword('парол', hash)).toBe(false);
    expect(describeHash(hash)).toEqual([
      { name: 'Algorithm', value: 'bcrypt ($2y$)' },
      { name: 'Format', value: 'htpasswd line' },
      { name: 'User', value: 'alice' },
      { name: 'Parameters', value: 'cost 5 (32 rounds)' },
      { name: 'Salt', value: '16 bytes' },
      { name: 'Hash', value: '23 bytes' },
    ]);
    expect(
      await verifyPassword('émoji 🙂', ok('alice:$2y$05$vMXEYEmkvH.igNZMf5iKOuq9Em/5/bWlHQPXkLxgj9/rjvA3RdmSq')),
    ).toBe(true); // gitleaks:allow — made by htpasswd
  });
  it('row 32: the same hash under $2a$ and $2b$ matches too (one computation for UTF-8)', async () => {
    const body = '05$FqjVqRCQToguCayDD8.AseYCNXEWIWJI0V/vZHmH2ktYAuI7abSfG'; // gitleaks:allow — made by htpasswd
    for (const prefix of ['$2a$', '$2b$', '$2y$']) expect(await verifyPassword('пароль', ok(prefix + body))).toBe(true);
  });
  it('row 33: bcrypt stops at a NUL; the note says so', async () => {
    const a = await hashPassword({ password: 'a\u{0}b', params: b(4), format: 'bcrypt-2b', salt: SALT16 });
    expect(a).toBe(await hashPassword({ password: 'a', params: b(4), format: 'bcrypt-2b', salt: SALT16 }));
    expect(passwordNotes('a\u{0}b', 'bcrypt')).toEqual({
      notes: ['bcrypt stops reading at the NUL character (U+0000): only the part before it counts.'],
    });
    expect(passwordNotes('\u{0}ab', 'bcrypt').error).toBe(
      'bcrypt would hash an empty password: it stops at the NUL character (U+0000) at the start.',
    );
    expect(passwordNotes('a\u{0}b', 'argon2id')).toEqual({ notes: [] });
  });
  it('row 34: 80 bytes hash as their first 72', async () => {
    const long = await hashPassword({ password: 'x'.repeat(80), params: b(4), format: 'bcrypt-2b', salt: SALT16 });
    expect(long).toBe(
      await hashPassword({ password: 'x'.repeat(72), params: b(4), format: 'bcrypt-2b', salt: SALT16 }),
    );
    expect(passwordNotes('x'.repeat(80), 'bcrypt').notes).toEqual([
      'bcrypt uses only the first 72 bytes of a password; this one is 80 bytes in UTF-8, so the rest is ignored.',
    ]);
  });
});

describe('the other encoded strings with a fixed salt (Python hashlib) — rows 35–39, 45, 46', () => {
  const scrypt = { algorithm: 'scrypt', logN: 17, r: 8, p: 1 } as const;
  it.each([
    [
      scrypt,
      'scrypt-passlib',
      SALT16,
      undefined,
      '$scrypt$ln=17,r=8,p=1$AAECAwQFBgcICQoLDA0ODw$ZhNf09oUEXBHSxkG5AF1HeOnimHWrDt9fesDVpC3MbE',
    ], // gitleaks:allow — test vector
    [
      scrypt,
      'scrypt-7',
      enc.encode('SodiumChloride'),
      'SodiumChloride',
      '$7$F6..../....SodiumChloride$KhHcii04xP7e3MAGsiGVVEzELAqL7tw/DsGHd0xPPq1',
    ], // gitleaks:allow — test vector
    [
      scrypt,
      'scrypt-django',
      enc.encode('seasalt'),
      'seasalt',
      'scrypt$131072$seasalt$8$1$NS8JPST8rz9jhtSXbOQL/rcnqQ3j6eVj33h4vS/TbDpGotYda8YMekD2sAEMGT82VBMFULEqebNxj9pXxRcLHg==',
    ], // gitleaks:allow — test vector
    [
      { algorithm: 'pbkdf2-sha256', iterations: 600000 },
      'pbkdf2-passlib',
      SALT16,
      undefined,
      '$pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODw$DLXc8p3g.YckaHRcQh4U8q/mKKZKG7s9iuMf1yo8U8c',
    ], // gitleaks:allow — test vector
    [
      { algorithm: 'pbkdf2-sha512', iterations: 220000 },
      'pbkdf2-passlib',
      SALT16,
      undefined,
      '$pbkdf2-sha512$220000$AAECAwQFBgcICQoLDA0ODw$wYhpPX/dKLylRNVLxHeMUxGgE8PU24wrasoWfgkg5jQXlvv87VqQ5JlgL6u77oOYWRw2FF/iKLwlyS0vtxm.Wg',
    ], // gitleaks:allow — test vector
    [
      { algorithm: 'pbkdf2-sha256', iterations: 600000 },
      'pbkdf2-django',
      enc.encode('seasalt'),
      'seasalt',
      'pbkdf2_sha256$600000$seasalt$7uCxJtH3zVvEqsivlVoOARKBXMBCSjTfkxjPv/s82HU=',
    ], // gitleaks:allow — test vector
  ] as const)('%o %s', { timeout: 30_000 }, async (params, format, salt, saltText, expected) => {
    const out = await hashPassword({
      password: 'hunter2',
      params: params as Params,
      format,
      salt,
      ...(saltText ? { saltText } : {}),
    });
    expect(out).toBe(expected);
    expect(await verifyPassword('hunter2', ok(expected))).toBe(true);
    expect(await verifyPassword('hunter3', ok(expected))).toBe(false);
  });
  it('row 46: PBKDF2-SHA1 is read (passlib and Django) and always called legacy', { timeout: 30_000 }, async () => {
    for (const text of [
      '$pbkdf2$1400000$AAECAwQFBgcICQoLDA0ODw$bThDBNoArwrGVK5TFkrTxfMdEpc', // gitleaks:allow — test vector
      'pbkdf2_sha1$1400000$seasalt$AqbRwoIf37QvZhtoxjmNsgqdMzg=', // gitleaks:allow — test vector
    ]) {
      const hash = ok(text);
      expect(await verifyPassword('hunter2', hash)).toBe(true);
      expect(assess(hash.params).map(w => w.kind)).toEqual(['legacy']);
    }
  });
});

describe('strings written by other programs — rows 40–44', () => {
  it('row 40: passlib’s documented $scrypt$ sample', async () => {
    const hash = ok('$scrypt$ln=16,r=8,p=1$aM15713r3Xsvxbi31lqr1Q$nFNh2CVHVjNldFVKDHDlm4CbdRSCdEBsjjJxD+iCs5E'); // gitleaks:allow — passlib documentation sample
    expect(await verifyPassword('password', hash)).toBe(true);
    expect(describeHash(hash).find(r => r.name === 'Parameters')?.value).toBe('N=2^16 (65,536), r=8, p=1 — 64 MiB');
    expect(describeHash(hash).find(r => r.name === 'Format')?.value).toBe('passlib');
    expect(assess(hash.params, hash.salt.length).map(w => w.kind)).toEqual(['below']);
  });
  it('row 41: passlib’s documented $pbkdf2-sha256$ sample', async () => {
    const hash = ok('$pbkdf2-sha256$6400$0ZrzXitFSGltTQnBWOsdAw$Y11AchqV4b0sUisdZd0Xr97KWoymNE0LNNrnEgY4H9M'); // gitleaks:allow — passlib documentation sample
    expect(await verifyPassword('password', hash)).toBe(true);
    expect(describeHash(hash).find(r => r.name === 'Parameters')?.value).toBe('6,400 iterations');
    expect(assess(hash.params).map(w => w.kind)).toEqual(['below']);
  });
  it('row 42: Django’s test string for pbkdf2_sha256', async () => {
    const hash = ok('pbkdf2_sha256$10000$seasalt$CWWFdHOWwPnki7HvkcqN9iA2T3KLW1cf2uZ5kvArtVY='); // gitleaks:allow — Django test sample
    expect(await verifyPassword('lètmein', hash)).toBe(true);
    expect(describeHash(hash).find(r => r.name === 'Salt')?.value).toBe('7 characters (text)');
    expect(describeHash(hash).find(r => r.name === 'Format')?.value).toBe('Django');
    expect(assess(hash.params, hash.salt.length).map(w => w.kind)).toEqual(['below', 'short-salt']);
  });
  it('row 43: Django’s test string for scrypt', async () => {
    const hash = ok(
      'scrypt$16384$seasalt$8$1$Qj3+9PPyRjSJIebHnG81TMjsqtaIGxNQG/aEB/NYafTJ7tibgfYz71m0ldQESkXFRkdVCBhhY8mx7rQwite/Pw==', // gitleaks:allow — Django test sample
    );
    expect(await verifyPassword('lètmein', hash)).toBe(true);
  });
  it('row 44: the $7$ vector of scrypt/yescrypt — RFC 7914 vector 3 in libsodium’s string', async () => {
    const text = '$7$C6..../....SodiumChloride$kBGj9fHznVYFQMEn/qDCfrDevf9YDtcDdKvEqHJLV8D'; // gitleaks:allow — published vector
    const hash = ok(text);
    expect(hash.params).toEqual({ algorithm: 'scrypt', logN: 14, r: 8, p: 1 });
    expect(hex(hash.digest)).toBe('7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2');
    expect(await verifyPassword('pleaseletmein', hash)).toBe(true);
    expect(describeHash(hash).slice(1, 2)).toEqual([{ name: 'Format', value: 'libsodium ($7$)' }]);
  });
  it('Django’s argon2 and bcrypt prefixes are read', async () => {
    const phc = '$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$xS5rdTl7ppbYZoS3aZJQSPuBks4p4O+PSmBqGMMe/7U'; // gitleaks:allow — test vector
    expect(await verifyPassword('hunter2', ok(`argon2${phc}`))).toBe(true);
    expect(ok(`argon2${phc}`).format).toBe('django-argon2');
    const bc = '$2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK'; // gitleaks:allow — test vector
    expect(await verifyPassword('hunter2', ok(`bcrypt$${bc}`))).toBe(true);
  });
});

describe('§6: what cannot be read, in words — row 47', () => {
  const message = (text: string) => {
    const parsed = parseHash(text);
    return parsed.ok ? 'read' : parsed.message;
  };
  const bc = '$2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK'; // gitleaks:allow — test vector
  it.each([
    ['', 'Paste a hash and type the password to check it.'],
    ['   ', 'Paste a hash and type the password to check it.'],
    ['hello', 'Not a password hash this tool knows. It reads bcrypt, Argon2, scrypt and PBKDF2 strings.'],
    ['$2b$10$abc', 'This looks like a bcrypt hash, but it cannot be read: it should be 60 characters long.'],
    [
      bc.replace('$10$', '$03$'),
      'This looks like a bcrypt hash, but it cannot be read: the cost must be from 4 to 31.',
    ],
    [
      bc.replace('$10$', '$32$'),
      'This looks like a bcrypt hash, but it cannot be read: the cost must be from 4 to 31.',
    ],
    [
      bc.slice(0, 59) + '!',
      'This looks like a bcrypt hash, but it cannot be read: it has characters outside bcrypt’s alphabet.',
    ],
    [
      bc.replace('$2b$', '$2x$'),
      '$2x$ marks hashes made by crypt_blowfish’s bug-compatible mode; the tool does not compute it.',
    ],
    [
      '$argon2id$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      'Argon2 version 16 (1.0) is not supported: the library computes version 19 (1.3) only.',
    ],
    [
      '$argon2id$v=16$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      'Argon2 version 16 (1.0) is not supported: the library computes version 19 (1.3) only.',
    ],
    [
      '$argon2id$v=19$m=65536,t=2,p=1,keyid=AAAA$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      'This Argon2 hash uses a key id or associated data; the tool does not take them.',
    ],
    [
      '$argon2id$v=19$m=8,t=1,p=1$!!!$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      'This looks like an Argon2 hash, but it cannot be read: the salt is not valid Base64.',
    ],
    [
      '$6$rounds=5000$saltsalt$abc',
      'SHA-512-crypt ($6$) hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.',
    ],
    [
      '$1$abc$def',
      'MD5-crypt ($1$) hashes are not supported: it is an outdated MD5 scheme. The tool reads bcrypt, Argon2, scrypt and PBKDF2.',
    ],
    [
      'alice:$apr1$abc$def',
      'Apache MD5 ($apr1$) hashes are not supported: it is an outdated MD5 scheme. The tool reads bcrypt, Argon2, scrypt and PBKDF2.',
    ],
    ['$y$j9T$abc$def', 'yescrypt ($y$) hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.'],
    [
      '{SSHA}abcdef',
      'LDAP salted SHA ({SSHA}) hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.',
    ],
    [
      'bcrypt_sha256$$2b$12$abc',
      'Django bcrypt_sha256 hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.',
    ],
    [
      '5f4dcc3b5aa765d61d8327deb882cf99',
      'This looks like a plain MD5 digest, not a password hash. Plain digests are compared in the Hash tool.',
    ],
    [
      '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8',
      'This looks like a plain SHA-1 digest, not a password hash. Plain digests are compared in the Hash tool.',
    ],
    ['scrypt$1000$salt$8$1$AAAA', 'This looks like a scrypt hash, but it cannot be read: N must be a power of 2.'],
    [`  ${bc}\n`, 'read'],
  ])('%j', (text, expected) => expect(message(text)).toBe(expected));
});

describe('the limits of §12 — row 48', () => {
  const messages = (p: Params) => checkParams(p).map(e => e.message);
  it('accepts the edges', () => {
    expect(messages(argon('argon2id', 8, 1, 1))).toEqual([]);
    expect(messages(argon('argon2id', 1_048_576, 16, 255))).toEqual([]);
    expect(messages({ algorithm: 'bcrypt', cost: 4 })).toEqual([]);
    expect(messages({ algorithm: 'bcrypt', cost: 18 })).toEqual([]);
    expect(messages({ algorithm: 'scrypt', logN: 20, r: 8, p: 8 })).toEqual([]);
    expect(messages({ algorithm: 'pbkdf2-sha256', iterations: 10_000_000 })).toEqual([]);
  });
  it('refuses one step further, with the texts of §6', () => {
    expect(messages(argon('argon2id', 4_194_304, 2, 1))).toEqual([
      'Memory must be a whole number from 8 to 1,048,576 KiB.',
    ]);
    expect(messages(argon('argon2id', 8, 2, 2))).toEqual(['Memory must be at least 8 KiB per lane (8 × parallelism).']);
    expect(messages(argon('argon2id', 1_048_576, 32, 1))).toEqual([
      'This would take too long: memory × iterations must be at most 16,777,216 KiB.',
    ]);
    expect(messages(argon('argon2id', 19456, 0, 256))).toEqual([
      'Iterations must be a whole number from 1 to 1,024.',
      'Parallelism must be a whole number from 1 to 255.',
    ]);
    expect(messages(argon('argon2id', 19456, 1.5, 1))).toEqual(['Iterations must be a whole number from 1 to 1,024.']);
    expect(messages({ algorithm: 'bcrypt', cost: 3 })).toEqual(['Cost must be a whole number from 4 to 18.']);
    expect(messages({ algorithm: 'bcrypt', cost: 19 })).toEqual(['Cost must be a whole number from 4 to 18.']);
    expect(messages({ algorithm: 'scrypt', logN: 21, r: 0, p: 65 })).toEqual([
      'Cost (log2 N) must be a whole number from 1 to 20.',
      'Block size must be a whole number from 1 to 64.',
      'Parallelism must be a whole number from 1 to 64.',
    ]);
    expect(messages({ algorithm: 'scrypt', logN: 20, r: 16, p: 1 })).toEqual([
      'This needs 2 GiB of memory (128 × N × r); the tool allows up to 1 GiB.',
    ]);
    expect(messages({ algorithm: 'scrypt', logN: 20, r: 8, p: 16 })).toEqual([
      'This would take too long: N × r × p must be at most 67,108,864.',
    ]);
    expect(messages({ algorithm: 'pbkdf2-sha512', iterations: 20_000_000 })).toEqual([
      'Iterations must be a whole number from 1 to 10,000,000.',
    ]);
    expect(messages({ algorithm: 'bcrypt', cost: Number.NaN })).toEqual(['Cost must be a whole number from 4 to 18.']);
  });
  it('the defaults are within the limits and not below the minimum; Argon2i and Argon2d keep their notes', () => {
    for (const params of Object.values(RECOMMENDED)) {
      expect(checkParams(params)).toEqual([]);
      const kinds = assess(params).map(w => w.kind);
      if (params.algorithm === 'argon2d') expect(kinds).toEqual(['not-for-passwords']);
      else if (params.algorithm === 'argon2i') expect(kinds).toEqual(['supplementary']);
      else if (params.algorithm === 'pbkdf2-sha1') expect(kinds).toEqual(['legacy']);
      else expect(kinds).toEqual([]);
    }
  });
});

describe('the recommendations of §5.2 — row 49', () => {
  const below = (p: Params) => assess(p).map(w => w.kind);
  it('Argon2', () => {
    expect(below(argon('argon2id', 19456, 2, 1))).toEqual([]);
    expect(below(argon('argon2id', 19455, 2, 1))).toEqual(['below']);
    expect(below(argon('argon2id', 47104, 1, 1))).toEqual([]);
    expect(below(argon('argon2id', 7168, 5, 1))).toEqual([]);
    expect(below(argon('argon2i', 19456, 2, 1))).toEqual(['supplementary', 'below']);
    expect(below(argon('argon2i', 12288, 3, 4))).toEqual(['supplementary']);
    expect(below(argon('argon2d', 1_048_576, 8, 1))).toEqual(['not-for-passwords']);
  });
  it('bcrypt, scrypt, PBKDF2', () => {
    expect(below({ algorithm: 'bcrypt', cost: 9 })).toEqual(['below']);
    expect(below({ algorithm: 'bcrypt', cost: 10 })).toEqual([]);
    expect(below({ algorithm: 'scrypt', logN: 17, r: 8, p: 1 })).toEqual([]);
    expect(below({ algorithm: 'scrypt', logN: 16, r: 8, p: 1 })).toEqual(['below']);
    expect(below({ algorithm: 'scrypt', logN: 14, r: 8, p: 5 })).toEqual([]);
    expect(below({ algorithm: 'scrypt', logN: 14, r: 16, p: 3 })).toEqual([]);
    expect(below({ algorithm: 'pbkdf2-sha256', iterations: 599_999 })).toEqual(['below']);
    expect(below({ algorithm: 'pbkdf2-sha256', iterations: 600_000 })).toEqual([]);
    expect(below({ algorithm: 'pbkdf2-sha512', iterations: 220_000 })).toEqual([]);
    expect(below({ algorithm: 'pbkdf2-sha1', iterations: 1_400_000 })).toEqual(['legacy']);
  });
  it('a short salt', () => {
    expect(assess({ algorithm: 'bcrypt', cost: 10 }, 15).map(w => w.message)).toEqual([
      'Salts shorter than 16 bytes are below the usual recommendation (128 bits).',
    ]);
  });
});

describe('the defaults decided 2026-11-22 «by best practices» (§5.2) — rows 54–56', () => {
  it('row 54: Argon2id, Argon2i and Argon2d open on RFC 9106’s second option; bcrypt on 12; scrypt and PBKDF2 on OWASP', () => {
    for (const a of ['argon2id', 'argon2i', 'argon2d'] as const)
      expect(RECOMMENDED[a]).toEqual({ algorithm: a, memory: 65_536, iterations: 3, parallelism: 4 });
    expect(RECOMMENDED.bcrypt).toEqual({ algorithm: 'bcrypt', cost: 12 });
    expect(RECOMMENDED.scrypt).toEqual({ algorithm: 'scrypt', logN: 17, r: 8, p: 1 });
    expect(RECOMMENDED['pbkdf2-sha256']).toEqual({ algorithm: 'pbkdf2-sha256', iterations: 600_000 });
    expect(RECOMMENDED['pbkdf2-sha512']).toEqual({ algorithm: 'pbkdf2-sha512', iterations: 220_000 });
    // The minimum stays OWASP's: at it no warning, under it a warning.
    expect(assess({ algorithm: 'bcrypt', cost: 10 })).toEqual([]);
    expect(assess(argon('argon2id', 19456, 2, 1))).toEqual([]);
  });
  it.each([
    [
      'argon2id',
      '$argon2id$v=19$m=65536,t=3,p=4$AAECAwQFBgcICQoLDA0ODw$i9IEUdjuDB2zbYs7gVvgymFH2HJWigtsFYT4gm0fp50',
      'dhcmSn8o1Aho1xaY2UP91OGWLdtliCkmkqNzglcopSA',
    ], // gitleaks:allow — test vectors made with OpenSSL
    [
      'argon2i',
      '$argon2i$v=19$m=65536,t=3,p=4$AAECAwQFBgcICQoLDA0ODw$ymW+V1JY/Ma4BwPqxDl/CTLEEKhLE1/+vUctzNrtQCo',
      'jIX7uWJEKprYSGJbfhHi5rwGupYRsIxG6lDugpTDeHs',
    ], // gitleaks:allow — test vectors made with OpenSSL
    [
      'argon2d',
      '$argon2d$v=19$m=65536,t=3,p=4$AAECAwQFBgcICQoLDA0ODw$sPD/PBFiPAkoS+7VBkepRsaBCkXnbNY6c3xD9Bag1uI',
      'iSPtjD+VN8mtFmi36SjiiiRxmDnWyvaiwPkiyM8lAaU',
    ], // gitleaks:allow — test vectors made with OpenSSL
  ] as const)(
    'rows 55, 56: %s with 4 lanes, without and with the secret key pepper (OpenSSL 4.1)',
    async (a, plain, keyed) => {
      const params = RECOMMENDED[a];
      expect(await hashPassword({ password: 'hunter2', params, format: 'phc', salt: SALT16 })).toBe(plain);
      const withKey = await hashPassword({
        password: 'hunter2',
        params,
        format: 'phc',
        salt: SALT16,
        secret: 'pepper',
      });
      // The key is not in the string: the string differs only in the hash.
      expect(withKey).toBe(`${plain.slice(0, plain.lastIndexOf('$') + 1)}${keyed}`);
      expect(withKey).not.toContain('pepper');
      expect(await verifyPassword('hunter2', ok(withKey), 'pepper')).toBe(true);
      expect(await verifyPassword('hunter2', ok(withKey))).toBe(false); // made with a key, checked without: no match
      expect(await verifyPassword('hunter2', ok(withKey), 'pepper!')).toBe(false);
      expect(await verifyPassword('hunter2', ok(plain), 'pepper')).toBe(false); // made without, checked with
      expect(await runJob({ op: 'verify', password: 'hunter2', hash: withKey, secret: 'pepper' })).toMatchObject({
        match: true,
      });
    },
  );
  it('the secret key: notes and limit', () => {
    expect(secretError('k'.repeat(1024))).toBeUndefined();
    expect(secretError('k'.repeat(1025))).toBe('The secret key is longer than 1,024 bytes.');
    expect(SECRET_NOTE).toBe('The secret key is not part of the hash string: verifying needs the same key again.');
  });
});

describe('timingSafeEqual — row 50', () => {
  it('compares', () => {
    expect(timingSafeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
    expect(timingSafeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(timingSafeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(timingSafeEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });
  it('agrees with Buffer.equals on 1,000 random pairs (seeded)', () => {
    let seed = 0x9e3779b9;
    const next = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), seed);
    for (let i = 0; i < 1000; i++) {
      const n = next() % 8;
      const a = Uint8Array.from({ length: n }, () => next() % 3);
      const b = Uint8Array.from({ length: next() % 2 ? n : next() % 8 }, () => next() % 3);
      expect(timingSafeEqual(a, b)).toBe(Buffer.from(a).equals(Buffer.from(b)));
    }
  });
  it('looks at every byte: no early exit (the loop count is the length)', () => {
    const source = timingSafeEqual.toString();
    expect(source).not.toMatch(/for \([^\n]*\)[^\n]*return/);
    expect(source).toMatch(/diff \|=/);
  });
});

describe('detectPasswordHash (§7) — row 51', () => {
  it.each([
    '$2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK', // gitleaks:allow — test vector
    'alice:$2y$05$FqjVqRCQToguCayDD8.AseYCNXEWIWJI0V/vZHmH2ktYAuI7abSfG', // gitleaks:allow — test vector
    '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc', // gitleaks:allow — test vector
    '$scrypt$ln=16,r=8,p=1$aM15713r3Xsvxbi31lqr1Q$nFNh2CVHVjNldFVKDHDlm4CbdRSCdEBsjjJxD+iCs5E', // gitleaks:allow — test vector
    '$7$C6..../....SodiumChloride$kBGj9fHznVYFQMEn/qDCfrDevf9YDtcDdKvEqHJLV8D', // gitleaks:allow — test vector
    '$pbkdf2-sha256$6400$0ZrzXitFSGltTQnBWOsdAw$Y11AchqV4b0sUisdZd0Xr97KWoymNE0LNNrnEgY4H9M', // gitleaks:allow — test vector
    'pbkdf2_sha256$10000$seasalt$CWWFdHOWwPnki7HvkcqN9iA2T3KLW1cf2uZ5kvArtVY=', // gitleaks:allow — test vector
    '  $2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK\n', // gitleaks:allow — test vector
  ])('recognises %s', text => expect(detectPasswordHash(text)).toBe(true));
  it.each([
    '$6$rounds=5000$saltsalt$abcdefghijklmnop',
    'alice:$apr1$abcdefgh$abcdefghijklmnop',
    '$2x$05$/OK.fbVrR/bpIqNJ5ianF.CE5elHaaO4EbggVDjb8P19RukzXSM3e', // gitleaks:allow — test vector
    '5f4dcc3b5aa765d61d8327deb882cf99',
    'hello',
    '$argon2id$',
    'price: $2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK', // gitleaks:allow — test vector
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc', // gitleaks:allow — not a token, a shape
    '123e4567-e89b-12d3-a456-426614174000',
    '-----BEGIN CERTIFICATE-----',
    '{"a": 1}',
    '0 9 * * 1-5',
    'x'.repeat(2000),
  ])('does not recognise %s', text => expect(detectPasswordHash(text)).toBe(false));
  it('is linear: a megabyte of dollars and letters answers at once', () => {
    const big = '$2b$'.repeat(250_000);
    const began = performance.now();
    expect(detectPasswordHash(big)).toBe(false);
    expect(parseHash(big).ok).toBe(false);
    expect(performance.now() - began).toBeLessThan(500);
  });
});

describe('salts — row 52 and §5.4', () => {
  it('random salts: 16 bytes, all different; Django 22 alphanumerics; $7$ 43 crypt-base64 characters', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = resolveSalt({ mode: 'random' }, 'argon2id', 'phc');
      if (!r.ok) throw new Error('salt');
      expect(r.salt.length).toBe(16);
      seen.add(hex(r.salt));
    }
    expect(seen.size).toBe(1000);
    const django = resolveSalt({ mode: 'random' }, 'pbkdf2-sha256', 'pbkdf2-django');
    expect(django.ok && django.text).toMatch(/^[A-Za-z0-9]{22}$/);
    const seven = resolveSalt({ mode: 'random' }, 'scrypt', 'scrypt-7');
    expect(seven.ok && seven.text).toMatch(/^[./0-9A-Za-z]{43}$/);
  });
  it('custom salts, with the texts of §6', () => {
    const custom = (
      text: string,
      format: 'text' | 'hex' | 'base64',
      algorithm: Params['algorithm'] = 'pbkdf2-sha256',
      f = 'pbkdf2-passlib' as const,
    ) => resolveSalt({ mode: 'custom', text, format }, algorithm, f);
    expect(custom('', 'text')).toEqual({ ok: false, message: 'Enter a salt or choose Random.' });
    expect(custom('0001020304', 'hex', 'bcrypt', 'bcrypt-2b' as never)).toEqual({
      ok: false,
      message: 'bcrypt needs a salt of exactly 16 bytes; this one is 5 bytes.',
    });
    expect(custom('abcde', 'text', 'argon2id', 'phc' as never)).toEqual({
      ok: false,
      message: 'Argon2 needs a salt of at least 8 bytes; this one is 5 bytes.',
    });
    expect(custom('0g', 'hex')).toEqual({ ok: false, message: 'Position 2: "g" is not a hex digit.' });
    expect(custom('abc', 'hex')).toEqual({ ok: false, message: 'Hex needs an even number of digits (3 found).' });
    expect(resolveSalt({ mode: 'custom', text: 'a$b', format: 'text' }, 'pbkdf2-sha256', 'pbkdf2-django')).toEqual({
      ok: false,
      message: 'This format writes the salt as text: use printable ASCII without "$".',
    });
    expect(resolveSalt({ mode: 'custom', text: 'пароль', format: 'text' }, 'scrypt', 'scrypt-7').ok).toBe(false);
    const short = custom('0001020304050607', 'hex');
    expect(short).toEqual({
      ok: true,
      salt: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7),
      warning: 'Salts shorter than 16 bytes are below the usual recommendation (128 bits).',
    });
    expect(custom('AAECAwQFBgcICQoLDA0ODw==', 'base64')).toEqual({ ok: true, salt: SALT16 });
    expect(custom('AA!', 'base64')).toEqual({ ok: false, message: 'Position 3: invalid character "!".' });
    expect(custom('00'.repeat(1025), 'hex')).toEqual({ ok: false, message: 'The salt is longer than 1,024 bytes.' });
  });
});

describe('the password field (§5.3)', () => {
  it('notes and errors', () => {
    expect(passwordNotes('x'.repeat(4097), 'argon2id')).toEqual({
      error: 'The password is longer than 4,096 bytes.',
      notes: [],
    });
    expect(passwordNotes(' pass', 'argon2id').notes).toEqual([
      'The password starts or ends with a space. It is part of the hashed bytes.',
    ]);
    expect(passwordNotes('pass', 'bcrypt')).toEqual({ notes: [] });
  });
});

describe('the encodings of §5.5 round-trip', () => {
  it('on every length up to 70', () => {
    for (let n = 0; n <= 70; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect(decodeB64(encodeB64(b))).toEqual(b);
      expect(decodeAb64(encodeAb64(b))).toEqual(b);
      expect(decodeH64(encodeH64(b))).toEqual(b);
    }
  });
});

describe('the worker’s job — rows 45, 53', () => {
  it('hashes and verifies, and never writes to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m));
    const hashed = await runJob({
      op: 'hash',
      request: { password: 'hunter2', params: RECOMMENDED.argon2id, format: 'phc', salt: SALT16 },
    });
    expect(hashed).toMatchObject({
      ok: true,
      op: 'hash',
      encoded: expect.stringMatching(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/),
    });
    const encoded = hashed.ok && hashed.op === 'hash' ? hashed.encoded : '';
    expect(await runJob({ op: 'verify', password: 'hunter2', hash: encoded })).toMatchObject({ ok: true, match: true });
    expect(await runJob({ op: 'verify', password: 'hunter3', hash: encoded })).toMatchObject({
      ok: true,
      match: false,
    });
    expect(await runJob({ op: 'verify', password: 'x', hash: 'hello' })).toEqual({
      ok: false,
      message: 'Not a password hash this tool knows. It reads bcrypt, Argon2, scrypt and PBKDF2 strings.',
    });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
