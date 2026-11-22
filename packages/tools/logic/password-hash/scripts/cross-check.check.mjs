// The library against independent implementations already on this machine (docs/tools/specs/password-hash.md §10,
// «Сверка»): OpenSSL (`openssl kdf`: ARGON2ID/I/D, SCRYPT, PBKDF2), Python's hashlib (scrypt, pbkdf2_hmac) and Apache's
// `htpasswd -B` (bcrypt $2y$). Not part of `pnpm check`: it needs those programs, installs nothing and skips what is
// missing. Run: pnpm --filter @workspace/tool-logic-password-hash exec vitest run --config scripts/cross-check.config.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argon2d, argon2i, argon2id } from 'hash-wasm';
import { describe, expect, it } from 'vitest';
import { argon2Hash, hashPassword, parseHash, pbkdf2Hash, scryptHash, verifyPassword } from '../src/index.ts';

const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const OPENSSL = has('openssl', ['kdf', '-help']) || has('openssl', ['version']);
const PYTHON = has('python3', ['-c', 'import hashlib; hashlib.scrypt']);
const HTPASSWD = spawnSync('htpasswd', ['-nbB', '-C', '4', 'u', 'p']).status === 0;

const seeded = seed => () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), seed);
const ALPHABET = [...'aZ7 $:\\é', 'ж', 'ё', '日', '本', '🙂', '€', 'ß'];
const passwordOf = (next, max = 30) =>
  Array.from({ length: 1 + (next() % max) }, () => ALPHABET[next() % ALPHABET.length]).join('');
const bytesOf = (next, n) => Uint8Array.from({ length: n }, () => next() & 255);
const hex = b => Buffer.from(b).toString('hex');
const enc = new TextEncoder();

const ossl = (alg, opts, keylen) =>
  execFileSync('openssl', ['kdf', '-keylen', String(keylen), ...opts.flatMap(o => ['-kdfopt', o]), alg])
    .toString()
    .trim()
    .replaceAll(':', '')
    .toLowerCase();

const counts = {};
const count = name => (counts[name] = (counts[name] ?? 0) + 1);

describe.runIf(OPENSSL)('OpenSSL', () => {
  it('reproduces the three vectors of RFC 9106 §5 (with K and X — which hash-wasm cannot take)', () => {
    const opts = [
      `hexpass:${'01'.repeat(32)}`,
      `hexsalt:${'02'.repeat(16)}`,
      `hexsecret:${'03'.repeat(8)}`,
      `hexad:${'04'.repeat(12)}`,
      'iter:3',
      'memcost:32',
      'lanes:4',
      'threads:1',
    ];
    expect(ossl('ARGON2D', opts, 32)).toBe('512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb');
    expect(ossl('ARGON2I', opts, 32)).toBe('c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8');
    expect(ossl('ARGON2ID', opts, 32)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
    count('RFC 9106 vectors (OpenSSL)');
  });

  it('Argon2id/i/d: hash-wasm equals OpenSSL on 3 × 40 generated inputs, and 3 × 10 with a secret key', async () => {
    const next = seeded(101);
    const lib = { ARGON2ID: argon2id, ARGON2I: argon2i, ARGON2D: argon2d };
    for (const variant of ['ARGON2ID', 'ARGON2I', 'ARGON2D'])
      for (let i = 0; i < 50; i++) {
        const password = enc.encode(passwordOf(next));
        const salt = bytesOf(next, 8 + (next() % 25));
        const p = 1 + (next() % 4);
        const m = 8 * p + (next() % 2048);
        const t = 1 + (next() % 3);
        const len = 4 + (next() % 61);
        const secret = i >= 40 ? bytesOf(next, 1 + (next() % 32)) : undefined;
        const opts = [
          `hexpass:${hex(password)}`,
          `hexsalt:${hex(salt)}`,
          `iter:${t}`,
          `memcost:${m}`,
          `lanes:${p}`,
          'threads:1',
        ];
        if (secret) opts.push(`hexsecret:${hex(secret)}`);
        const theirs = ossl(variant, opts, len);
        const ours = secret
          ? hex(
              await lib[variant]({
                password,
                salt,
                secret,
                iterations: t,
                parallelism: p,
                memorySize: m,
                hashLength: len,
                outputType: 'binary',
              }),
            )
          : hex(
              await argon2Hash(
                password,
                salt,
                { algorithm: variant.toLowerCase(), memory: m, iterations: t, parallelism: p },
                len,
              ),
            );
        expect(ours, `${variant} m=${m} t=${t} p=${p}`).toBe(theirs);
        count(`Argon2 ${secret ? 'with K ' : ''}(OpenSSL)`);
      }
  }, 600_000);

  it('Argon2 with 4 lanes (the default): the tool equals OpenSSL on 3 × 30 inputs, half with a secret key (pepper)', async () => {
    const next = seeded(707);
    for (const variant of ['ARGON2ID', 'ARGON2I', 'ARGON2D'])
      for (let i = 0; i < 30; i++) {
        const password = enc.encode(passwordOf(next));
        const salt = bytesOf(next, 8 + (next() % 25));
        // A third at the default (64 MiB, t=3), the rest small, every one with p=4.
        const m = i % 3 === 0 ? 65_536 : 32 + (next() % 4096);
        const t = i % 3 === 0 ? 3 : 1 + (next() % 3);
        const secret = i % 2 ? passwordOf(next, 20) : '';
        const opts = [
          `hexpass:${hex(password)}`,
          `hexsalt:${hex(salt)}`,
          `iter:${t}`,
          `memcost:${m}`,
          'lanes:4',
          'threads:1',
        ];
        if (secret) opts.push(`hexsecret:${hex(enc.encode(secret))}`);
        const theirs = ossl(variant, opts, 32);
        const params = { algorithm: variant.toLowerCase(), memory: m, iterations: t, parallelism: 4 };
        const ours = hex(await argon2Hash(password, salt, params, 32, secret ? enc.encode(secret) : undefined));
        expect(ours, `${variant} m=${m} t=${t} p=4 ${secret ? 'with K' : ''}`).toBe(theirs);
        count(`Argon2 p=4${secret ? ' with K' : ''} (OpenSSL)`);
      }
  }, 600_000);

  it('scrypt: equals OpenSSL on 40 generated inputs', async () => {
    const next = seeded(202);
    for (let i = 0; i < 40; i++) {
      const password = enc.encode(passwordOf(next));
      const salt = bytesOf(next, 1 + (next() % 32));
      const params = { algorithm: 'scrypt', logN: 1 + (next() % 12), r: 1 + (next() % 8), p: 1 + (next() % 3) };
      const theirs = ossl(
        'SCRYPT',
        [`hexpass:${hex(password)}`, `hexsalt:${hex(salt)}`, `n:${2 ** params.logN}`, `r:${params.r}`, `p:${params.p}`],
        32,
      );
      expect(hex(await scryptHash(password, salt, params, 32))).toBe(theirs);
      count('scrypt (OpenSSL)');
    }
  }, 600_000);

  it('PBKDF2: equals OpenSSL on 3 × 20 generated inputs', async () => {
    const next = seeded(303);
    for (const [algorithm, digest, len] of [
      ['pbkdf2-sha1', 'SHA1', 20],
      ['pbkdf2-sha256', 'SHA256', 32],
      ['pbkdf2-sha512', 'SHA512', 64],
    ])
      for (let i = 0; i < 20; i++) {
        const password = enc.encode(passwordOf(next));
        const salt = bytesOf(next, 1 + (next() % 32));
        const iterations = 1 + (next() % 5000);
        const theirs = ossl(
          'PBKDF2',
          [`hexpass:${hex(password)}`, `hexsalt:${hex(salt)}`, `iter:${iterations}`, `digest:${digest}`],
          len,
        );
        expect(hex(await pbkdf2Hash(password, salt, { algorithm, iterations }, len))).toBe(theirs);
        count('PBKDF2 (OpenSSL)');
      }
  }, 600_000);
});

describe.runIf(PYTHON)('Python hashlib', () => {
  it('scrypt and PBKDF2 strings of the tool equal hashlib on 30 + 30 generated inputs', async () => {
    const next = seeded(404);
    const jobs = [];
    for (let i = 0; i < 60; i++) {
      const password = passwordOf(next);
      const salt = bytesOf(next, 16);
      if (i < 30) {
        const params = { algorithm: 'scrypt', logN: 1 + (next() % 14), r: 1 + (next() % 8), p: 1 + (next() % 2) };
        jobs.push({
          kind: 'scrypt',
          password,
          salt: hex(salt),
          n: 2 ** params.logN,
          r: params.r,
          p: params.p,
          ours: await hashPassword({ password, params, format: 'scrypt-passlib', salt }),
        });
      } else {
        const algorithm = ['pbkdf2-sha1', 'pbkdf2-sha256', 'pbkdf2-sha512'][i % 3];
        const iterations = 1 + (next() % 20000);
        jobs.push({
          kind: 'pbkdf2',
          hash: algorithm.slice(7),
          password,
          salt: hex(salt),
          iterations,
          ours: await hashPassword({ password, params: { algorithm, iterations }, format: 'pbkdf2-passlib', salt }),
        });
      }
    }
    const script = [
      'import base64, hashlib, json, sys',
      'out = []',
      'for j in json.load(sys.stdin):',
      '    pw = j["password"].encode(); salt = bytes.fromhex(j["salt"])',
      '    if j["kind"] == "scrypt":',
      '        d = hashlib.scrypt(pw, salt=salt, n=j["n"], r=j["r"], p=j["p"], dklen=32, maxmem=2**30)',
      '        out.append(base64.b64encode(d).decode().rstrip("="))',
      '    else:',
      '        d = hashlib.pbkdf2_hmac(j["hash"], pw, salt, j["iterations"])',
      '        out.append(base64.b64encode(d).decode().rstrip("=").replace("+", "."))',
      'print(json.dumps(out))',
    ].join('\n');
    const theirs = JSON.parse(
      execFileSync('python3', ['-I', '-c', script], { input: JSON.stringify(jobs) }).toString(),
    );
    jobs.forEach((job, i) => {
      expect(job.ours.split('$').at(-1)).toBe(theirs[i]);
      count(`${job.kind} (Python)`);
    });
  }, 600_000);
});

describe.runIf(HTPASSWD)('htpasswd -B (Apache APR, $2y$)', () => {
  it('lines htpasswd makes from generated UTF-8 passwords verify in the tool, and lines the tool makes verify in htpasswd', async () => {
    const next = seeded(505);
    const dir = mkdtempSync(join(tmpdir(), 'password-hash-'));
    try {
      for (let i = 0; i < 40; i++) {
        const password = passwordOf(next, 20);
        // htpasswd → the tool.
        const line = execFileSync('htpasswd', ['-nbB', '-C', '4', 'user', password]).toString().trim();
        const parsed = parseHash(line);
        expect(parsed.ok, line).toBe(true);
        expect(await verifyPassword(password, parsed.hash)).toBe(true);
        expect(await verifyPassword(`${password}!`, parsed.hash)).toBe(false);
        count('bcrypt: htpasswd → tool');
        // The tool → htpasswd.
        const ours = await hashPassword({
          password,
          params: { algorithm: 'bcrypt', cost: 4 },
          format: 'htpasswd',
          salt: bytesOf(next, 16),
          user: 'user',
        });
        const file = join(dir, 'h');
        writeFileSync(file, `${ours}\n`);
        expect(spawnSync('htpasswd', ['-vb', file, 'user', password], { stdio: 'ignore' }).status, ours).toBe(0);
        expect(spawnSync('htpasswd', ['-vb', file, 'user', `${password}!`], { stdio: 'ignore' }).status).not.toBe(0);
        count('bcrypt: tool → htpasswd');
        expect(readFileSync(file, 'utf8')).toBe(`${ours}\n`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});

describe('summary', () => {
  it('prints what was compared', () => {
    process.stdout.write(
      `\ncross-check: ${JSON.stringify({ openssl: OPENSSL, python: PYTHON, htpasswd: HTPASSWD, ...counts })}\n`,
    );
  });
});
