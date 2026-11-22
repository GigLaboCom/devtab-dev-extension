// Signing (docs/tools/specs/jwt.md §16) against OpenSSL 4.1 on this machine, both ways: tokens the tool signs are
// verified by `openssl dgst -verify` / `openssl pkeyutl -verify -rawin` (ES: JOSE's r ‖ s turned into the DER OpenSSL
// reads), and signatures OpenSSL makes are accepted by the tool's own verification — for the deterministic schemes
// (RS*, HS*, EdDSA) they are byte for byte the tool's. Keys are made by `openssl genpkey` under .state/jwt-cross of the
// copy and thrown away. Not part of `pnpm check`: it needs OpenSSL. Run:
//   pnpm --filter @workspace/tool-logic-jwt exec vitest run --config scripts/sign-cross-check.config.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeToken, parseKey, signToken, verifyToken } from '../src/index.ts';

const OPENSSL = ['/opt/homebrew/bin/openssl', 'openssl'].find(c => spawnSync(c, ['version']).status === 0);
const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../.state/jwt-cross');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const ossl = (args, input) => execFileSync(OPENSSL, args, input === undefined ? {} : { input });
const file = (name, data) => {
  const p = join(DIR, name);
  writeFileSync(p, data);
  return p;
};
const b64u = buf => Buffer.from(buf).toString('base64url');
const counts = {};
const count = name => (counts[name] = (counts[name] ?? 0) + 1);

/** JOSE r ‖ s → DER ECDSA-Sig-Value, and back. */
const intDer = b => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  let v = b.subarray(i);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.of(0), v]);
  return Buffer.concat([Buffer.of(2, v.length), v]);
};
const toDer = raw => {
  const half = raw.length / 2;
  const body = Buffer.concat([intDer(raw.subarray(0, half)), intDer(raw.subarray(half))]);
  return Buffer.concat([body.length < 128 ? Buffer.of(0x30, body.length) : Buffer.of(0x30, 0x81, body.length), body]);
};
const fromDer = (der, size) => {
  let at = der[1] & 0x80 ? 3 : 2;
  const read = () => {
    const len = der[at + 1];
    const v = der.subarray(at + 2, at + 2 + len);
    at += 2 + len;
    const out = Buffer.alloc(size);
    const t = v[0] === 0 ? v.subarray(1) : v;
    t.copy(out, size - t.length);
    return out;
  };
  return Buffer.concat([read(), read()]);
};

const verifiedByTool = async (token, publicPem) => {
  const d = decodeToken(token);
  return (await verifyToken(d.token, parseKey({ kind: 'public', text: publicPem }))).state;
};

const RUNS = 4;
const HEADER = alg => `{"alg":"${alg}","typ":"JWT"}`;
const payload = i => JSON.stringify({ sub: `user-${i}`, iat: 1763553600 + i, name: 'Žofie 🙂' });

describe.runIf(OPENSSL)(
  `signing against ${OPENSSL ? execFileSync(OPENSSL, ['version']).toString().trim() : 'OpenSSL'}`,
  () => {
    afterAll(() => {
      writeFileSync(join(DIR, '../jwt-cross-counts.json'), JSON.stringify(counts, null, 1));
      rmSync(DIR, { recursive: true, force: true });
    });

    const rsaCases = [
      ['RS256', 'sha256', []],
      ['RS384', 'sha384', []],
      ['RS512', 'sha512', []],
      ['PS256', 'sha256', ['-sigopt', 'rsa_padding_mode:pss', '-sigopt', 'rsa_pss_saltlen:32']],
      ['PS384', 'sha384', ['-sigopt', 'rsa_padding_mode:pss', '-sigopt', 'rsa_pss_saltlen:48']],
      ['PS512', 'sha512', ['-sigopt', 'rsa_padding_mode:pss', '-sigopt', 'rsa_pss_saltlen:64']],
    ];
    it.each(rsaCases)('%s', async (alg, dgst, opts) => {
      for (let i = 0; i < RUNS; i++) {
        const key = file(
          `rsa-${alg}-${i}.pem`,
          ossl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048']),
        );
        const pub = ossl(['pkey', '-in', key, '-pubout']).toString();
        const pubPath = file(`rsa-${alg}-${i}.pub`, pub);
        const r = await signToken({
          header: HEADER(alg),
          payload: payload(i),
          compact: true,
          key: { kind: 'private', text: readFileSync(key, 'utf8') },
        });
        expect(r.ok).toBe(true);
        const [h, p, s] = r.token.split('.');
        const input = file('input', `${h}.${p}`);
        const sig = file('sig', Buffer.from(s, 'base64url'));
        const out = spawnSync(OPENSSL, ['dgst', `-${dgst}`, ...opts, '-verify', pubPath, '-signature', sig, input], {
          encoding: 'utf8',
        });
        expect(out.stdout.trim()).toBe('Verified OK');
        count(`${alg}: OpenSSL verifies the tool's signature`);
        const theirs = ossl(['dgst', `-${dgst}`, ...opts, '-sign', key, input]);
        expect(await verifiedByTool(`${h}.${p}.${b64u(theirs)}`, pub)).toBe('valid');
        count(`${alg}: the tool verifies OpenSSL's signature`);
        if (alg.startsWith('RS')) {
          expect(b64u(theirs)).toBe(s);
          count(`${alg}: byte for byte equal (deterministic)`);
        }
      }
    });

    it.each([
      ['ES256', 'P-256', 'sha256', 32],
      ['ES384', 'P-384', 'sha384', 48],
      ['ES512', 'P-521', 'sha512', 66],
    ])('%s', async (alg, curve, dgst, size) => {
      for (let i = 0; i < RUNS; i++) {
        const key = file(
          `ec-${alg}-${i}.pem`,
          ossl([
            'genpkey',
            '-algorithm',
            'EC',
            '-pkeyopt',
            `ec_paramgen_curve:${curve}`,
            '-pkeyopt',
            'ec_param_enc:named_curve',
          ]),
        );
        const pub = ossl(['pkey', '-in', key, '-pubout']).toString();
        const pubPath = file(`ec-${alg}-${i}.pub`, pub);
        // Signed with the traditional SEC1 form on even runs, PKCS#8 on odd.
        const text = i % 2 ? readFileSync(key, 'utf8') : ossl(['ec', '-in', key]).toString();
        const r = await signToken({
          header: HEADER(alg),
          payload: payload(i),
          compact: true,
          key: { kind: 'private', text },
        });
        expect(r.ok).toBe(true);
        const [h, p, s] = r.token.split('.');
        const raw = Buffer.from(s, 'base64url');
        expect(raw.length).toBe(2 * size);
        const input = file('input', `${h}.${p}`);
        const sig = file('sig', toDer(raw));
        const out = spawnSync(OPENSSL, ['dgst', `-${dgst}`, '-verify', pubPath, '-signature', sig, input], {
          encoding: 'utf8',
        });
        expect(out.stdout.trim()).toBe('Verified OK');
        count(`${alg}: OpenSSL verifies the tool's r‖s (as DER)`);
        const theirs = fromDer(ossl(['dgst', `-${dgst}`, '-sign', key, input]), size);
        expect(await verifiedByTool(`${h}.${p}.${b64u(theirs)}`, pub)).toBe('valid');
        count(`${alg}: the tool verifies OpenSSL's signature (DER → r‖s)`);
      }
    });

    it('EdDSA and Ed25519', async () => {
      for (let i = 0; i < RUNS; i++) {
        const alg = i % 2 ? 'Ed25519' : 'EdDSA';
        const key = file(`ed-${i}.pem`, ossl(['genpkey', '-algorithm', 'ED25519']));
        const pub = ossl(['pkey', '-in', key, '-pubout']).toString();
        const pubPath = file(`ed-${i}.pub`, pub);
        const r = await signToken({
          header: HEADER(alg),
          payload: payload(i),
          compact: true,
          key: { kind: 'private', text: readFileSync(key, 'utf8') },
        });
        const [h, p, s] = r.token.split('.');
        const input = file('input', `${h}.${p}`);
        const sig = file('sig', Buffer.from(s, 'base64url'));
        const out = spawnSync(
          OPENSSL,
          ['pkeyutl', '-verify', '-pubin', '-inkey', pubPath, '-rawin', '-in', input, '-sigfile', sig],
          { encoding: 'utf8' },
        );
        expect(out.stdout.trim()).toBe('Signature Verified Successfully');
        count(`${alg}: OpenSSL verifies the tool's signature`);
        const theirs = ossl(['pkeyutl', '-sign', '-inkey', key, '-rawin', '-in', input]);
        expect(b64u(theirs)).toBe(s);
        count(`${alg}: byte for byte equal (deterministic)`);
        expect(await verifiedByTool(`${h}.${p}.${b64u(theirs)}`, pub)).toBe('valid');
      }
    });

    it.each(['HS256', 'HS384', 'HS512'])('%s', async alg => {
      for (let i = 0; i < RUNS; i++) {
        const secret = `secret-${i}-${'x'.repeat(64)}`;
        const r = await signToken({
          header: HEADER(alg),
          payload: payload(i),
          compact: true,
          key: { kind: 'secret', text: secret, format: 'text' },
        });
        const [h, p, s] = r.token.split('.');
        const mac = ossl(
          ['dgst', `-sha${alg.slice(2)}`, '-mac', 'HMAC', '-macopt', `key:${secret}`, '-binary'],
          `${h}.${p}`,
        );
        expect(b64u(mac)).toBe(s);
        count(`${alg}: OpenSSL's HMAC equals the tool's`);
      }
    });
  },
);
