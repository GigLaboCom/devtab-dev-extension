/**
 * DEVTAB_LICENCE_TEST — test material only: key pairs made in memory for one run and tokens signed with them. Tests and
 * scripts import this module; nothing in the extension's sources may (an ESLint rule), and a store build carrying the
 * mark is refused.
 */
import { base64urlEncode } from './base64url';
import { TOKEN_TYPE } from './verify';
import type { Claims, PublicKeyEntry } from './types';

export const TEST_MARK = 'DEVTAB_LICENCE_TEST';

const DAY_S = 86_400;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** The token's fields as on the wire: times in seconds. */
export type WireClaims = Omit<Claims, 'iat' | 'chk' | 'warn' | 'exp' | 'paid'> & {
  readonly iat: number;
  readonly chk: number;
  readonly warn: number;
  readonly exp: number;
  readonly paid: number | null;
};

const randomHex = (bytes: number): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');

/** A new ES256 key pair for this run; the id starts with `test-` and has a random part. */
export const makeTestKey = async (
  kid: string = `test-${randomHex(4)}`,
): Promise<{ readonly publicKey: PublicKeyEntry; readonly privateKey: CryptoKey }> => {
  const pair = await globalThis.crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    publicKey: { kid, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } },
    privateKey: pair.privateKey,
  };
};

const encodeJson = (value: unknown): string => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));

/** Signs `claims` as the token format says; `header` overrides fields to make broken tokens. */
export const signToken = async (
  claims: WireClaims | Record<string, unknown>,
  key: { readonly kid: string; readonly privateKey: CryptoKey },
  header?: Record<string, unknown>,
): Promise<string> => {
  const signed = `${encodeJson({ alg: 'ES256', kid: key.kid, typ: TOKEN_TYPE, ...header })}.${encodeJson(claims)}`;
  const signature = await globalThis.crypto.subtle.sign(SIGNING, key.privateKey, new TextEncoder().encode(signed));
  return `${signed}.${base64urlEncode(new Uint8Array(signature))}`;
};

/** An `active` token's fields issued at `nowMs` with the usual spans (7 / 23 / 30 days); `overrides` replace fields (term, renews too). */
export const claimsAt = (nowMs: number, overrides?: Partial<WireClaims>): WireClaims => {
  const iat = Math.floor(nowMs / 1000);
  return {
    v: 1,
    lid: 'lic_TEST0000000001',
    inst: 'testInstTEST0000000000',
    plan: 'pro',
    status: 'active',
    iat,
    chk: iat + 7 * DAY_S,
    warn: iat + 23 * DAY_S,
    exp: iat + 30 * DAY_S,
    paid: null,
    ...overrides,
  };
};
