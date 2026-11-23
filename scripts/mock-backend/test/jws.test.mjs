// The token format: what the mock signs verifies with its public key and fails with one bit changed, and the
// reference check gives the reasons of pro-entitlement-implementation.md §4.1 rows 3–7.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import { DAY, issueClaims } from '../contract.mjs';
import { base64url, breakSignature, generateSigningKey, signToken, verifyToken } from '../jws.mjs';

const key = await generateSigningKey('mock-test0001-p1');
const other = await generateSigningKey('mock-test0001-p2');
const keys = [key.publicEntry, other.publicEntry];
const iat = 1_795_392_000;
const claims = issueClaims({
  lid: 'lic_mock_jws000000',
  inst: 'q3V2mZ0bTEST0000000000',
  iat,
  licence: { status: 'active', term: 'month', renews: true, paid: iat + 30 * DAY },
});

const flipBit = (compact, part, byte = 0) => {
  const parts = compact.split('.');
  const bytes = base64url.decode(parts[part]);
  bytes[byte] ^= 0x01;
  parts[part] = base64url.encode(bytes);
  return parts.join('.');
};
const encodeJson = v => base64url.encode(Buffer.from(JSON.stringify(v)));

describe('a signed token', () => {
  test('verifies with the public key and keeps every field', async () => {
    const token = await signToken(claims, key);
    const result = await verifyToken(token, keys);
    assert.equal(result.ok, true);
    assert.deepEqual(result.claims, claims);
    assert.deepEqual(result.header, { alg: 'ES256', kid: key.kid, typ: 'devtab-licence' });
    assert.ok(token.length < 700, `a token of ${token.length} characters`);
  });

  test('signed with the second key of the list verifies too', async () => {
    assert.equal((await verifyToken(await signToken(claims, other), keys)).ok, true);
  });

  test('fails with one bit changed in the header, the payload or the signature', async () => {
    const token = await signToken(claims, key);
    // A bit inside the lid's value keeps the payload valid JSON with valid fields: only the signature catches it.
    const at = Buffer.from(base64url.decode(token.split('.')[1])).indexOf('jws');
    assert.equal((await verifyToken(flipBit(token, 1, at), keys)).reason, 'signature');
    assert.equal((await verifyToken(flipBit(token, 2, 10), keys)).reason, 'signature');
    assert.equal((await verifyToken(breakSignature(token), keys)).reason, 'signature');
    // A header that names the other key of the list: the signed bytes change, the signature no longer matches.
    const head = encodeJson({ alg: 'ES256', kid: other.kid, typ: 'devtab-licence' });
    assert.equal((await verifyToken([head, ...token.split('.').slice(1)].join('.'), keys)).reason, 'signature');
  });

  test('with a key id not in the list is unknown-key', async () => {
    assert.equal((await verifyToken(await signToken(claims, key), [other.publicEntry])).reason, 'unknown-key');
  });

  test('is malformed when the encoding, the parts, the length or the signature size are wrong', async () => {
    const token = await signToken(claims, key);
    const [h, p, s] = token.split('.');
    for (const broken of [
      `${h}=.${p}.${s}`,
      `${h}.${p.replace(/-/g, '+').replace(/_/g, '/')}x+.${s}`,
      `${h}.${p} .${s}`,
      `${h}.${p}.${s}.${s}`,
      `${h}.${p}`,
      `${h}.${p}.${s}${'A'.repeat(4097 - token.length)}`,
      `${h}.${p}.${base64url.encode(Buffer.alloc(63))}`,
      `${h}.${p}.${base64url.encode(Buffer.alloc(71))}`,
    ])
      assert.equal((await verifyToken(broken, keys)).reason, 'malformed', broken.slice(0, 40));
  });

  test('is unsupported with another alg or typ or an extra header field', async () => {
    for (const header of [{ alg: 'ES384' }, { typ: 'JWT' }, { extra: 1 }])
      assert.equal((await verifyToken(await signToken(claims, key, header), keys)).reason, 'unsupported');
    const none = `${encodeJson({ alg: 'none', kid: key.kid, typ: 'devtab-licence' })}.${encodeJson(claims)}.`;
    assert.equal((await verifyToken(none, keys)).reason, 'unsupported');
    const hsInput = `${encodeJson({ alg: 'HS256', kid: key.kid, typ: 'devtab-licence' })}.${encodeJson(claims)}`;
    const hs = `${hsInput}.${base64url.encode(createHmac('sha256', 'k').update(hsInput).digest())}`;
    assert.equal((await verifyToken(hs, keys)).reason, 'unsupported');
  });

  test('breaking the fields is claims (v other than 1: unsupported); extra fields are accepted', async () => {
    const cases = [
      [{ ...claims, plan: 'free' }, 'claims'],
      [{ ...claims, status: 'paused' }, 'claims'],
      [{ ...claims, reason: 'refund' }, 'claims'],
      [{ ...claims, status: 'revoked' }, 'claims'],
      [{ ...claims, warn: claims.exp + 1 }, 'claims'],
      [{ ...claims, iat: 'now' }, 'claims'],
      [{ ...claims, v: 2 }, 'unsupported'],
    ];
    for (const name of ['lid', 'inst', 'iat', 'chk', 'warn', 'exp', 'paid']) {
      cases.push([Object.fromEntries(Object.entries(claims).filter(([k]) => k !== name)), 'claims']);
    }
    for (const [fields, reason] of cases)
      assert.equal((await verifyToken(await signToken(fields, key), keys)).reason, reason, JSON.stringify(fields));
    const extra = await verifyToken(await signToken({ ...claims, seats: 3 }, key), keys);
    assert.equal(extra.ok, true);
  });

  test('term and renews of a wrong type are not read, the token stays valid (plans §3.4)', async () => {
    const result = await verifyToken(await signToken({ ...claims, term: 'week', renews: 'yes' }, key), keys);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ignored, ['term', 'renews']);
  });
});
