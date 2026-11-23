#!/usr/bin/env node
// DEVTAB_LICENCE_TEST — test material only.
//
// Writes packages/licence/testdata/vectors.json: a public key made for this run and eight tokens signed with it (and
// one with a key that is not listed), each with what `verifyToken` and `evaluate` must say at the given `now` and
// `seen`. The private key is never written anywhere: it lives in this process and is gone when it ends. The licence
// server's own tests run the same file through their check, so both sides agree without sharing a secret.
//
// Usage: node packages/licence/scripts/vectors.mjs   (run once; re-running makes new keys and new tokens)
import { webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../testdata/vectors.json');
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' };
const DAY_S = 86_400;
const DAY_MS = DAY_S * 1000;

const b64url = bytes => Buffer.from(bytes).toString('base64url');
const json = value => b64url(Buffer.from(JSON.stringify(value), 'utf8'));
const hex = n => Buffer.from(webcrypto.getRandomValues(new Uint8Array(n))).toString('hex');

const keyPair = async kid => {
  const pair = await subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const { x, y } = await subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, publicKey: { kid, jwk: { kty: 'EC', crv: 'P-256', x, y } } };
};

const sign = async (claims, key, header = {}) => {
  const signed = `${json({ alg: 'ES256', kid: key.kid, typ: 'devtab-licence', ...header })}.${json(claims)}`;
  const signature = await subtle.sign(SIGNING, key.privateKey, Buffer.from(signed, 'ascii'));
  return `${signed}.${b64url(new Uint8Array(signature))}`;
};

const flipLastSignatureByte = token => {
  const parts = token.split('.');
  const bytes = Buffer.from(parts[2], 'base64url');
  bytes[bytes.length - 1] ^= 0x01;
  return `${parts[0]}.${parts[1]}.${b64url(bytes)}`;
};

const stamp = hex(4);
const key = await keyPair(`test-${stamp}`);
const unlisted = await keyPair(`test-${stamp}-unlisted`);

// Made-up values, the specification's example: 2026-11-23T00:00:00Z.
const IAT = 1795392000;
const INST = 'q3V2mZ0bTEST0000000000';
const base = { v: 1, lid: 'lic_01JD5QX7Y2Z9TEST', inst: INST, plan: 'pro' };
const active = {
  ...base,
  status: 'active',
  iat: IAT,
  chk: IAT + 7 * DAY_S,
  warn: IAT + 23 * DAY_S,
  exp: IAT + 30 * DAY_S,
  paid: IAT + 30 * DAY_S,
  term: 'month',
  renews: true,
};
const ended = {
  ...base,
  status: 'ended',
  iat: IAT,
  chk: IAT + 7 * DAY_S,
  warn: IAT,
  exp: IAT,
  paid: IAT - 14 * DAY_S,
  term: 'year',
  renews: false,
};
const revoked = { ...base, status: 'revoked', reason: 'refund', iat: IAT, chk: IAT, warn: IAT, exp: IAT, paid: null };
const at = days => IAT * 1000 + days * DAY_MS;
const activeToken = await sign(active, key);

const vectors = [
  { name: 'active', token: activeToken, now: at(1), seen: 0, verify: 'ok', state: { kind: 'active', due: false } },
  { name: 'grace', token: activeToken, now: at(25), seen: 0, verify: 'ok', state: { kind: 'grace' } },
  {
    name: 'expired (the clock put back after the window: counted by the mark)',
    token: activeToken,
    now: at(10),
    seen: at(31),
    verify: 'ok',
    state: { kind: 'expired' },
  },
  { name: 'ended', token: await sign(ended, key), now: at(1), seen: 0, verify: 'ok', state: { kind: 'ended' } },
  {
    name: 'revoked',
    token: await sign(revoked, key),
    now: at(1),
    seen: 0,
    verify: 'ok',
    state: { kind: 'revoked', reason: 'refund' },
  },
  {
    name: 'a changed signature',
    token: flipLastSignatureByte(activeToken),
    now: at(1),
    seen: 0,
    verify: 'signature',
    state: { kind: 'invalid', reason: 'signature' },
  },
  {
    name: 'a key id the build does not know',
    token: await sign(active, unlisted),
    now: at(1),
    seen: 0,
    verify: 'unknown-key',
    state: { kind: 'invalid', reason: 'unknown-key' },
  },
  {
    name: 'alg: none without a signature',
    token: `${json({ alg: 'none', kid: key.kid, typ: 'devtab-licence' })}.${json(active)}.`,
    now: at(1),
    seen: 0,
    verify: 'unsupported',
    state: { kind: 'invalid', reason: 'unsupported' },
  },
].map(v => ({ ...v, inst: INST }));

const body = {
  note:
    'DEVTAB_LICENCE_TEST. Test vectors of the licence token: a public key made for one run of ' +
    'packages/licence/scripts/vectors.mjs (its private key was never stored) and tokens signed with it. Not a ' +
    'key or a token of the product. `verify` is the outcome of verifyToken against `keys` ("ok" or the reason); ' +
    '`state` is what evaluate gives for the record { inst, token } at `now` with the clock mark `seen` (ms).',
  keys: [key.publicKey],
  vectors,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(body, null, 2)}\n`);
console.log(OUT);
