import { hashPassword, parseHash, verifyPassword } from './index';
import { describe, expect, it } from 'vitest';
import { pbkdf2Sync, scryptSync } from 'node:crypto';
import type { Params } from './index';

// Properties over generated inputs with a fixed seed: the library against Node's own scrypt and PBKDF2 (OpenSSL, an
// independent implementation), and every Hash string read back by Verify. Argon2 and bcrypt are compared with OpenSSL
// and htpasswd by scripts/cross-check.mjs (they are not in Node 22).

const seeded = (seed: number) => () => (
  (seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0),
  seed
);
const ALPHABET = ['a', 'Z', '7', ' ', '$', 'ж', 'ё', '日', '本', '🙂', 'é', ':', '\\'];
const passwordOf = (next: () => number): string =>
  Array.from({ length: 1 + (next() % 17) }, () => ALPHABET[next() % ALPHABET.length]).join('');
const bytesOf = (next: () => number, n: number): Uint8Array => Uint8Array.from({ length: n }, () => next() & 255);

describe('scrypt and PBKDF2 equal Node’s (OpenSSL) on generated inputs', () => {
  it('40 scrypt inputs', () => {
    const next = seeded(7);
    return (async () => {
      for (let i = 0; i < 40; i++) {
        const password = passwordOf(next);
        const salt = bytesOf(next, 1 + (next() % 32));
        const logN = 1 + (next() % 10);
        const r = 1 + (next() % 8);
        const p = 1 + (next() % 3);
        const params: Params = { algorithm: 'scrypt', logN, r, p };
        const text = await hashPassword({ password, params, format: 'scrypt-passlib', salt });
        const theirs = scryptSync(password, salt, 32, { N: 2 ** logN, r, p, maxmem: 2 ** 28 })
          .toString('base64')
          .replace(/=+$/, '');
        expect(text.split('$').at(-1)).toBe(theirs);
      }
    })();
  });
  it('60 PBKDF2 inputs over SHA-1, SHA-256 and SHA-512', async () => {
    const next = seeded(11);
    const algorithms = ['pbkdf2-sha1', 'pbkdf2-sha256', 'pbkdf2-sha512'] as const;
    for (let i = 0; i < 60; i++) {
      const algorithm = algorithms[i % 3]!;
      const password = passwordOf(next);
      const salt = bytesOf(next, 1 + (next() % 32));
      const iterations = 1 + (next() % 3000);
      const text = await hashPassword({ password, params: { algorithm, iterations }, format: 'pbkdf2-passlib', salt });
      const theirs = pbkdf2Sync(
        password,
        salt,
        iterations,
        { 'pbkdf2-sha1': 20, 'pbkdf2-sha256': 32, 'pbkdf2-sha512': 64 }[algorithm],
        algorithm.slice(7),
      )
        .toString('base64')
        .replace(/=+$/, '')
        .replaceAll('+', '.');
      expect(text.split('$').at(-1)).toBe(theirs);
    }
  });
});

describe('every format Hash writes, Verify reads back (generated passwords)', () => {
  it('matches the password and not another one', { timeout: 60_000 }, async () => {
    const next = seeded(23);
    const cases: Array<[Params, Parameters<typeof hashPassword>[0]['format'], string?]> = [
      [{ algorithm: 'argon2id', memory: 64, iterations: 1, parallelism: 2 }, 'phc'],
      [{ algorithm: 'argon2i', memory: 64, iterations: 2, parallelism: 1 }, 'phc'],
      [{ algorithm: 'argon2d', memory: 33, iterations: 1, parallelism: 1 }, 'phc'],
      [{ algorithm: 'bcrypt', cost: 4 }, 'bcrypt-2b'],
      [{ algorithm: 'bcrypt', cost: 4 }, 'bcrypt-2y'],
      [{ algorithm: 'bcrypt', cost: 4 }, 'htpasswd'],
      [{ algorithm: 'scrypt', logN: 4, r: 2, p: 1 }, 'scrypt-passlib'],
      [{ algorithm: 'scrypt', logN: 4, r: 2, p: 1 }, 'scrypt-7', 'AbCdEfGh./12'],
      [{ algorithm: 'scrypt', logN: 4, r: 2, p: 1 }, 'scrypt-django', 'seasaltseasalt'],
      [{ algorithm: 'pbkdf2-sha256', iterations: 10 }, 'pbkdf2-passlib'],
      [{ algorithm: 'pbkdf2-sha512', iterations: 10 }, 'pbkdf2-passlib'],
      [{ algorithm: 'pbkdf2-sha256', iterations: 10 }, 'pbkdf2-django', 'abcdefghij'],
    ];
    for (let round = 0; round < 5; round++)
      for (const [params, format, saltText] of cases) {
        const password = passwordOf(next);
        const salt = saltText ? new TextEncoder().encode(saltText) : bytesOf(next, 16);
        const text = await hashPassword({
          password,
          params,
          format,
          salt,
          ...(saltText ? { saltText } : {}),
          user: 'u',
        });
        const parsed = parseHash(text);
        if (!parsed.ok) throw new Error(`${text}: ${parsed.message}`);
        expect(parsed.hash.params).toEqual(params);
        expect(await verifyPassword(password, parsed.hash)).toBe(true);
        expect(await verifyPassword(`${password}x`, parsed.hash)).toBe(false);
      }
  });
});
