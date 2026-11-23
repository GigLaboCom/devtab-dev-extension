/**
 * The token's check (pro-entitlement §3, §8.2) with key pairs made in memory for this run: signed and checked, every
 * reason of the fixed order, and the fields' rules — including the plan cards' `term` and `renews`, which are read when
 * well typed and dropped, never fatal, when not.
 */
import { base64urlDecode, base64urlEncode } from './base64url';
import { claimsAt, makeTestKey, signToken } from './testing';
import { parseClaims, verifyToken } from './verify';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WireClaims } from './testing';
import type { PublicKeyEntry } from './types';

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY_S = 86_400;

let one: Awaited<ReturnType<typeof makeTestKey>>;
let two: Awaited<ReturnType<typeof makeTestKey>>;
let stranger: Awaited<ReturnType<typeof makeTestKey>>;
let keys: PublicKeyEntry[];

beforeAll(async () => {
  [one, two, stranger] = await Promise.all([makeTestKey('test-one'), makeTestKey('test-two'), makeTestKey('test-x')]);
  keys = [one.publicKey, two.publicKey];
});

const signer = (key: typeof one) => ({ kid: key.publicKey.kid, privateKey: key.privateKey });
const sign = (claims: WireClaims | Record<string, unknown>, header?: Record<string, unknown>, key = one) =>
  signToken(claims, signer(key), header);
const reasonOf = async (token: string) => {
  const verified = await verifyToken(token, keys);
  return verified.ok ? 'ok' : verified.reason;
};
const parts = (token: string) => token.split('.') as [string, string, string];
const json = (value: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
/** The token with one byte of one part changed (the part stays strict base64url). */
const flipByte = (token: string, part: 0 | 1 | 2, at = 0) => {
  const all = parts(token);
  const bytes = base64urlDecode(all[part])!;
  bytes[at] ^= 0x01;
  all[part] = base64urlEncode(bytes);
  return all.join('.');
};

describe('verifyToken: signed and checked', () => {
  it('a token signed with a key of the list verifies; times come back in milliseconds', async () => {
    const wire = claimsAt(NOW, { paid: Math.floor(NOW / 1000) + 30 * DAY_S });
    const verified = await verifyToken(await sign(wire), keys);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.kid).toBe('test-one');
    expect(verified.claims).toEqual({
      v: 1,
      lid: wire.lid,
      inst: wire.inst,
      plan: 'pro',
      status: 'active',
      iat: wire.iat * 1000,
      chk: wire.chk * 1000,
      warn: wire.warn * 1000,
      exp: wire.exp * 1000,
      paid: wire.paid! * 1000,
    });
  });

  it('with two keys in the list, a token signed with the second verifies', async () => {
    const verified = await verifyToken(await sign(claimsAt(NOW), undefined, two), keys);
    expect(verified).toMatchObject({ ok: true, kid: 'test-two' });
  });

  it('a kid that is not in the list → unknown-key; a kid of the list over another key’s signature → signature', async () => {
    expect(await reasonOf(await sign(claimsAt(NOW), undefined, stranger))).toBe('unknown-key');
    expect(await reasonOf(await sign(claimsAt(NOW), { kid: 'test-one' }, stranger))).toBe('signature');
  });

  it('takes a WebCrypto given to it', async () => {
    let used = 0;
    const subtle = new Proxy(globalThis.crypto.subtle, {
      get: (target, name) => {
        const member = Reflect.get(target, name) as unknown;
        if (name === 'verify') used += 1;
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
    expect((await verifyToken(await sign(claimsAt(NOW)), keys, subtle)).ok).toBe(true);
    expect(used).toBe(1);
  });
});

describe('verifyToken: the signature', () => {
  it('one byte of the header changed (the header still reads the same) → signature', async () => {
    // The same fields with a space after them: other signed bytes, the same header.
    const [, body, signature] = parts(await sign(claimsAt(NOW)));
    const head = base64urlEncode(
      new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: 'test-one', typ: 'devtab-licence' }) + ' '),
    );
    expect(await reasonOf(`${head}.${body}.${signature}`)).toBe('signature');
  });

  it('one byte of the payload changed (still JSON with the same fields) → signature', async () => {
    const token = await sign(claimsAt(NOW));
    const at = new TextDecoder().decode(base64urlDecode(parts(token)[1])!).indexOf('TEST');
    expect(await reasonOf(flipByte(token, 1, at))).toBe('signature');
  });

  it('one byte of the signature changed → signature', async () => {
    const token = await sign(claimsAt(NOW));
    expect(await reasonOf(flipByte(token, 2, 0))).toBe('signature');
    expect(await reasonOf(flipByte(token, 2, 63))).toBe('signature');
  });

  it('a DER signature (70–72 bytes) and one of 63 bytes → malformed', async () => {
    const [head, body] = parts(await sign(claimsAt(NOW)));
    for (const length of [70, 71, 72, 63])
      expect(await reasonOf(`${head}.${body}.${base64urlEncode(new Uint8Array(length).fill(7))}`)).toBe('malformed');
  });
});

describe('verifyToken: the header → unsupported', () => {
  it('alg: none without a signature', async () => {
    const [, body] = parts(await sign(claimsAt(NOW)));
    expect(await reasonOf(`${json({ alg: 'none', kid: 'test-one', typ: 'devtab-licence' })}.${body}.`)).toBe(
      'unsupported',
    );
  });

  it('alg: HS256 with an HMAC signature (32 bytes)', async () => {
    const head = json({ alg: 'HS256', kid: 'test-one', typ: 'devtab-licence' });
    const [, body] = parts(await sign(claimsAt(NOW)));
    const hmacKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(1),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await globalThis.crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`${head}.${body}`));
    expect(mac.byteLength).toBe(32);
    expect(await reasonOf(`${head}.${body}.${base64urlEncode(new Uint8Array(mac))}`)).toBe('unsupported');
  });

  it.each([
    ['ES384', { alg: 'ES384' }],
    ['another typ', { typ: 'JWT' }],
    ['an extra field', { jku: 'https://licence.example.invalid/keys' }],
    ['no kid', { kid: undefined }],
    ['a kid against its rule', { kid: 'Test_One' }],
    ['a kid longer than 32', { kid: 'test-' + 'a'.repeat(28) }],
  ])('%s', async (_name, header) => {
    expect(await reasonOf(await sign(claimsAt(NOW), header))).toBe('unsupported');
  });
});

describe('verifyToken: the form → malformed', () => {
  it.each([
    ['= padding', (t: string) => t.replace(/\.([^.]*)$/, '.$1==')],
    ['+ in a part', (t: string) => t.replace(/^./, '+')],
    ['/ in a part', (t: string) => t.replace(/^./, '/')],
    ['a space', (t: string) => t.replace('.', ' .')],
    ['four parts', (t: string) => `${t}.e30`],
    ['two parts', (t: string) => t.split('.').slice(0, 2).join('.')],
    [
      'a header that is not JSON',
      (t: string) => `${base64urlEncode(new TextEncoder().encode('{alg'))}.${t.split('.')[1]}.${t.split('.')[2]}`,
    ],
    ['a payload that is a JSON array', (t: string) => `${t.split('.')[0]}.${json([1])}.${t.split('.')[2]}`],
  ])('%s', async (_name, change) => {
    expect(await reasonOf(change(await sign(claimsAt(NOW))))).toBe('malformed');
  });

  it('a token of 4 097 characters → malformed; 4 096 is read on', async () => {
    const pad = (n: number) => ({ ...claimsAt(NOW), pad: 'x'.repeat(n) });
    let n = 3000;
    let token = await sign(pad(n));
    // Find a padding whose token is exactly 4 096 characters long (base64url grows in steps of 4 per 3 bytes).
    while (token.length < 4096) token = await sign(pad(++n));
    while (token.length > 4096) token = await sign(pad(--n));
    if (token.length === 4096) expect(await reasonOf(token)).toBe('ok');
    expect(await reasonOf(`${token}A`)).toBe('malformed');
    expect(await reasonOf('a'.repeat(4097))).toBe('malformed');
  });

  it('what is not a string', async () => {
    expect(await reasonOf(undefined as unknown as string)).toBe('malformed');
  });
});

describe('verifyToken: the fields', () => {
  const REQUIRED = ['v', 'lid', 'inst', 'plan', 'status', 'iat', 'chk', 'warn', 'exp', 'paid'] as const;

  it.each(REQUIRED)('without %s → claims', async field => {
    const wire: Record<string, unknown> = { ...claimsAt(NOW) };
    delete wire[field];
    expect(await reasonOf(await sign(wire))).toBe('claims');
  });

  it.each([
    ['v as a string', { v: '1' }],
    ['lid as a number', { lid: 12345678 }],
    ['lid too short', { lid: 'lic_1' }],
    ['inst of 21 characters', { inst: 'testInstTEST000000000' }],
    ['inst with a dot', { inst: 'testInstTEST00000000.0' }],
    ['plan: free', { plan: 'free' }],
    ['status unknown', { status: 'paused' }],
    ['iat as a string', { iat: '1795392000' }],
    ['chk with a fraction', { chk: 1795392000.5 }],
    ['warn negative', { warn: -1 }],
    ['exp as null', { exp: null }],
    ['paid as a string', { paid: 'never' }],
    ['iat after chk', { chk: Math.floor(NOW / 1000) - 1 }],
    ['warn after exp', { warn: Math.floor(NOW / 1000) + 31 * DAY_S }],
    ['chk after warn', { chk: Math.floor(NOW / 1000) + 24 * DAY_S }],
    ['reason on an active token', { reason: 'refund' }],
  ])('%s → claims', async (_name, overrides) => {
    expect(await reasonOf(await sign({ ...claimsAt(NOW), ...overrides }))).toBe('claims');
  });

  it('a revoked token without a reason, or with an unknown one → claims; with each of the five → read', async () => {
    const iat = Math.floor(NOW / 1000);
    const revoked = { ...claimsAt(NOW), status: 'revoked', chk: iat, warn: iat, exp: iat };
    expect(await reasonOf(await sign(revoked))).toBe('claims');
    expect(await reasonOf(await sign({ ...revoked, reason: 'expired' }))).toBe('claims');
    for (const reason of ['refund', 'deactivated', 'key-blocked', 'seat-limit', 'unknown-installation'])
      expect(await verifyToken(await sign({ ...revoked, reason }), keys)).toMatchObject({
        ok: true,
        claims: { status: 'revoked', reason },
      });
  });

  it('ended and revoked need warn = exp = iat ≤ chk', async () => {
    const iat = Math.floor(NOW / 1000);
    const ended = { ...claimsAt(NOW), status: 'ended', chk: iat + 7 * DAY_S, warn: iat, exp: iat };
    expect(await reasonOf(await sign(ended))).toBe('ok');
    expect(await reasonOf(await sign({ ...ended, exp: iat + 1 }))).toBe('claims');
    expect(await reasonOf(await sign({ ...ended, chk: iat - 1 }))).toBe('claims');
  });

  it('a numeric v other than 1 → unsupported (after the signature); a missing v → claims', async () => {
    expect(await reasonOf(await sign({ ...claimsAt(NOW), v: 2 }))).toBe('unsupported');
    expect(await reasonOf(await sign({ ...claimsAt(NOW), v: 0 }))).toBe('unsupported');
  });

  it('an extra field is accepted and not read', async () => {
    const verified = await verifyToken(await sign({ ...claimsAt(NOW), seats: 3, note: 'x' }), keys);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(Object.keys(verified.claims)).not.toContain('seats');
  });

  it('term and renews of the right type are read', async () => {
    for (const term of ['month', 'year'] as const)
      for (const renews of [true, false]) {
        const verified = await verifyToken(await sign(claimsAt(NOW, { term, renews })), keys);
        expect(verified).toMatchObject({ ok: true, claims: { term, renews } });
      }
  });

  it('term or renews of a wrong type: the token is accepted without them', async () => {
    for (const [term, renews] of [
      ['week', 'yes'],
      [1, 1],
      [null, null],
      ['Month', 0],
    ]) {
      const verified = await verifyToken(await sign({ ...claimsAt(NOW), term, renews }), keys);
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect('term' in verified.claims).toBe(false);
        expect('renews' in verified.claims).toBe(false);
      }
    }
    const one = await verifyToken(await sign({ ...claimsAt(NOW), term: 'year', renews: 'no' }), keys);
    expect(one).toMatchObject({ ok: true, claims: { term: 'year' } });
    if (one.ok) expect('renews' in one.claims).toBe(false);
  });

  it('without term and renews: neither is there', async () => {
    const verified = await verifyToken(await sign(claimsAt(NOW)), keys);
    expect(verified.ok && ('term' in verified.claims || 'renews' in verified.claims)).toBe(false);
  });
});

describe('parseClaims', () => {
  it('reads wire fields into milliseconds and refuses what is not an object', () => {
    const wire = claimsAt(NOW, { term: 'month', renews: true });
    expect(parseClaims(wire)).toMatchObject({ iat: wire.iat * 1000, term: 'month', renews: true });
    expect(parseClaims(null)).toBeUndefined();
    expect(parseClaims([wire])).toBeUndefined();
    expect(parseClaims({ ...wire, v: 2 })).toBeUndefined();
  });
});
