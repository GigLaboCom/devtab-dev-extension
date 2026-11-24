#!/usr/bin/env node
// DEVTAB_LICENCE_TEST — makes the e2e build's licence test key: a new ES256 (P-256) pair from Node's WebCrypto with
// the id `test-<8 random hex>`, written to .state/licence-test/ (git-ignored, like all of .state/):
//   public.json   the public key as the extension trusts it — `{ kid, jwk: { kty, crv, x, y } }` (PublicKeyEntry); the
//                 build of DEVTAB_VARIANT=…,licence:test reads it as `virtual:licence-test-key` (extension/vite.config.ts)
//   private.json  the private JWK (with `d`) and its kid; only the tests in Node sign with it — it never enters a build
// Every run makes a new pair and replaces both files; nothing is written outside .state/. Prints the folder.
//
// Usage: node scripts/licence-test-key.mjs
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.state', 'licence-test');

const { subtle } = webcrypto;
const kid = `test-${Buffer.from(webcrypto.getRandomValues(new Uint8Array(4))).toString('hex')}`;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const { x, y } = await subtle.exportKey('jwk', pair.publicKey);
const privateJwk = await subtle.exportKey('jwk', pair.privateKey);

mkdirSync(DIR, { recursive: true, mode: 0o700 });
writeFileSync(
  join(DIR, 'public.json'),
  `${JSON.stringify({ kid, jwk: { kty: 'EC', crv: 'P-256', x, y } }, null, 2)}\n`,
);
writeFileSync(join(DIR, 'private.json'), `${JSON.stringify({ kid, jwk: privateJwk }, null, 2)}\n`, { mode: 0o600 });
chmodSync(join(DIR, 'private.json'), 0o600);
process.stdout.write(`${DIR}\n`);
