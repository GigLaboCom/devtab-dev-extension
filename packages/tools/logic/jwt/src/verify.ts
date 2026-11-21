/**
 * Checking a token's signature (docs/tools/specs/jwt.md §5.3–§5.5) with WebCrypto only: the key is chosen (a JWKS by
 * `kid`, or by `kty` and `crv`), checked against the header's `alg` before WebCrypto sees it, then
 * `crypto.subtle.verify` decides — for HMAC too, never a comparison of strings. A key carried in the token itself is
 * never used, and nothing is fetched.
 */
import { readTlv, spkiKind } from './der';
import { jwkDescription, jwkKind, kindWords } from './key';
import type { Decoded } from './decode';
import type { Jwk, ParsedKey, VerifyKey } from './key';

export type Verification =
  | { state: 'no-key' }
  // key: which key of a set was used, in words
  | { state: 'valid'; warnings: string[]; key?: string }
  | { state: 'invalid'; reason?: string; warnings: string[]; key?: string }
  | { state: 'cannot-verify'; reason: string }
  | { state: 'unsecured'; hasSignature: boolean };

type Family = 'HS' | 'RS' | 'PS' | 'ES' | 'Ed';
type Hash = 'SHA-256' | 'SHA-384' | 'SHA-512';
interface Algorithm {
  family: Family;
  hash?: Hash;
  /** ES: the curve and the length of r ‖ s. */
  curve?: 'P-256' | 'P-384' | 'P-521';
  size?: number;
}

const SHA = (bits: 256 | 384 | 512): Hash => `SHA-${bits}`;
const ALGORITHMS: Record<string, Algorithm> = {
  HS256: { family: 'HS', hash: SHA(256) },
  HS384: { family: 'HS', hash: SHA(384) },
  HS512: { family: 'HS', hash: SHA(512) },
  RS256: { family: 'RS', hash: SHA(256) },
  RS384: { family: 'RS', hash: SHA(384) },
  RS512: { family: 'RS', hash: SHA(512) },
  PS256: { family: 'PS', hash: SHA(256) },
  PS384: { family: 'PS', hash: SHA(384) },
  PS512: { family: 'PS', hash: SHA(512) },
  ES256: { family: 'ES', hash: SHA(256), curve: 'P-256', size: 64 },
  ES384: { family: 'ES', hash: SHA(384), curve: 'P-384', size: 96 },
  ES512: { family: 'ES', hash: SHA(512), curve: 'P-521', size: 132 },
  EdDSA: { family: 'Ed' },
  Ed25519: { family: 'Ed' },
};
const HASH_BYTES: Record<Hash, number> = { 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 };
/** Algorithms that have a name but no implementation in the browser's Web Crypto (§5.3). */
const UNAVAILABLE: Record<string, string> = {
  ES256K: "ES256K (secp256k1) is not available in the browser's Web Crypto.",
  Ed448: "Ed448 is not available in the browser's Web Crypto.",
};

/** The algorithm's name for people (§8): "HMAC with SHA-256"; undefined for an algorithm the tool does not know. */
export const algorithmName = (alg: string): string | undefined => {
  if (alg === 'none') return 'No signature (unsecured)';
  if (alg === 'ES256K') return 'ECDSA secp256k1 with SHA-256';
  if (alg === 'Ed448') return 'Ed448';
  const a = ALGORITHMS[alg];
  if (!a) return undefined;
  switch (a.family) {
    case 'HS':
      return `HMAC with ${a.hash}`;
    case 'RS':
      return `RSASSA-PKCS1-v1_5 with ${a.hash}`;
    case 'PS':
      return `RSASSA-PSS with ${a.hash}`;
    case 'ES':
      return `ECDSA ${a.curve} with ${a.hash}`;
    case 'Ed':
      return 'Ed25519';
  }
};

/** Which key field the token needs (§3): a secret, a public key, or none (`none`, unknown algorithms, a JWE). */
export const keyFieldOf = (token: Decoded): 'secret' | 'public' | undefined => {
  if (token.kind !== 'jws' || !token.alg || !Object.hasOwn(ALGORITHMS, token.alg)) return undefined;
  return ALGORITHMS[token.alg]!.family === 'HS' ? 'secret' : 'public';
};

const cannot = (reason: string): Verification => ({ state: 'cannot-verify', reason });

/** What a candidate key is, as the type check needs it. */
const kindOf = (key: VerifyKey) =>
  key.type === 'secret' ? ({ type: 'oct' } as const) : key.type === 'spki' ? spkiKind(key.der) : jwkKind(key.jwk);
type KeyKind = ReturnType<typeof kindOf>;

const FAMILY_WORDS: Record<Family, string> = { HS: 'HMAC', RS: 'RSA', PS: 'RSA', ES: 'EC', Ed: 'Ed25519' };
/** "RSA", "EC P-256", "Ed448", "a shared secret (oct)" — the words of §5.4's messages. */
const describeKind = (kind: KeyKind): string | undefined =>
  kind.type === 'oct' ? 'a shared secret (oct)' : kind.type === 'RSA' ? 'RSA' : kindWords(kind);

/** Does a key's kind fit the algorithm (§5.4)? A reason when it does not; undefined when it fits or cannot be told. */
const mismatch = (alg: string, a: Algorithm, kind: KeyKind): string | undefined => {
  if (kind.type === 'unknown') return undefined;
  const uses = alg === FAMILY_WORDS[a.family] ? alg : `${alg} (${FAMILY_WORDS[a.family]})`;
  const wrongType = `The token uses ${uses}, but the key is ${describeKind(kind)}.`;
  if (a.family === 'RS' || a.family === 'PS') return kind.type === 'RSA' ? undefined : wrongType;
  if (a.family === 'Ed') return kind.type === 'Ed25519' ? undefined : wrongType;
  if (kind.type !== 'EC') return wrongType;
  return kind.curve === a.curve ? undefined : `${alg} needs a ${a.curve} key; this key is ${kind.curve}.`;
};

/** A JWK's own word on its purpose (RFC 7517 §4.2–§4.4). */
const jwkRefusal = (jwk: Jwk | undefined, alg: string): string | undefined => {
  if (!jwk) return undefined;
  if (
    (jwk.use !== undefined && jwk.use !== 'sig') ||
    (jwk.key_ops !== undefined && !(Array.isArray(jwk.key_ops) && jwk.key_ops.includes('verify')))
  )
    return 'The key is not meant for verifying signatures.';
  if (jwk.alg !== undefined && jwk.alg !== alg)
    return `The key is meant for ${String(jwk.alg)}; the token says ${alg}.`;
  return undefined;
};

/** Chooses the key of a JWKS (§5.4): the token's kid, exactly; without one, the only key that suits the algorithm. */
const choose = (key: Extract<ParsedKey, { ok: true }>, alg: string, a: Algorithm, kid: unknown): VerifyKey | string => {
  if (!key.set) return key.candidates[0]!;
  const suits = (c: VerifyKey) => mismatch(alg, a, kindOf(c)) === undefined && kindOf(c).type !== 'unknown';
  if (typeof kid === 'string') {
    const named = key.candidates.filter(c => c.type === 'jwk' && c.jwk.kid === kid);
    if (named.length === 0) return `No key with kid ${JSON.stringify(kid)} in the set.`;
    return named.find(suits) ?? named[0]!;
  }
  const suitable = key.candidates.filter(suits);
  if (suitable.length === 1) return suitable[0]!;
  return suitable.length === 0
    ? `The set has no key for ${alg}.`
    : `The set has ${suitable.length} suitable keys and the token has no kid.`;
};

/** JWK members WebCrypto needs, and nothing else (no alg, use or kid to trip over). */
const publicJwk = (jwk: Jwk): Record<string, unknown> => {
  const pick = (names: string[]) => Object.fromEntries(names.filter(n => n in jwk).map(n => [n, jwk[n]]));
  return jwk.kty === 'RSA'
    ? pick(['kty', 'n', 'e'])
    : jwk.kty === 'EC'
      ? pick(['kty', 'crv', 'x', 'y'])
      : pick(['kty', 'crv', 'x']);
};

const importParams = (a: Algorithm) =>
  a.family === 'HS'
    ? { name: 'HMAC', hash: a.hash! }
    : a.family === 'RS'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: a.hash! }
      : a.family === 'PS'
        ? { name: 'RSA-PSS', hash: a.hash! }
        : a.family === 'ES'
          ? { name: 'ECDSA', namedCurve: a.curve! }
          : { name: 'Ed25519' };

const verifyParams = (a: Algorithm) =>
  a.family === 'HS'
    ? { name: 'HMAC' }
    : a.family === 'RS'
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : a.family === 'PS'
        ? { name: 'RSA-PSS', saltLength: HASH_BYTES[a.hash!] }
        : a.family === 'ES'
          ? { name: 'ECDSA', hash: a.hash! }
          : { name: 'Ed25519' };

const errorName = (error: unknown): string =>
  error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
    ? String((error as { name: unknown }).name)
    : 'Error';

/** A DER SEQUENCE spanning all the bytes: an ECDSA signature in X.509's form, not JWS's r ‖ s. */
const looksDer = (bytes: Uint8Array): boolean => bytes[0] === 0x30 && readTlv(bytes, 0)?.end === bytes.length;

/** What is left for WebCrypto once every check that needs none has passed. */
interface Plan {
  a: Algorithm;
  chosen: VerifyKey;
  warnings: string[];
  withKey: { key?: string };
}

/** Every check of §5.3–§5.5 that needs no WebCrypto: its verdict, or the plan for crypto.subtle. */
const plan = (token: Decoded, key: ParsedKey | undefined): Verification | Plan => {
  if (token.kind === 'jwe') return cannot('an encrypted token (JWE) has no signature to check.');
  if (!token.header.ok) return cannot('the header is not a JSON object.');
  const header = token.header.json as Record<string, unknown>;
  if (!('alg' in header)) return cannot('the header has no "alg".');
  const alg = token.alg;
  if (alg === undefined) return cannot('the header\'s "alg" is not a string.');
  if (alg === 'none') return { state: 'unsecured', hasSignature: token.signature!.text.length > 0 };
  if ('crit' in header) {
    const crit = header.crit;
    if (!Array.isArray(crit) || !crit.every(c => typeof c === 'string'))
      return cannot('"crit" must be a list of header parameter names.');
    if (crit.length === 0) return cannot('"crit" must not be empty.');
    return cannot(`the header lists critical parameters this tool doesn't support: ${crit.join(', ')}.`);
  }
  const a = Object.hasOwn(ALGORITHMS, alg) ? ALGORITHMS[alg]! : undefined;
  if (!a) return cannot(UNAVAILABLE[alg] ?? `algorithm ${JSON.stringify(alg)} is not supported.`);
  if (!key || !key.ok) return { state: 'no-key' };

  const isSecret = key.candidates.every(c => c.type === 'secret');
  if (a.family === 'HS' && !isSecret) return cannot(`${alg} needs a shared secret, not a public key.`);
  if (a.family !== 'HS' && isSecret) return cannot(`${alg} needs a public key, not a shared secret.`);
  const chosen = choose(key, alg, a, header.kid);
  if (typeof chosen === 'string') return cannot(chosen);
  const refusal = jwkRefusal(chosen.type === 'spki' ? undefined : chosen.jwk, alg);
  if (refusal) return cannot(refusal);
  const kind = kindOf(chosen);
  if (a.family !== 'HS') {
    const wrong = mismatch(alg, a, kind);
    if (wrong) return cannot(wrong);
  }

  const warnings: string[] = [];
  if (chosen.type === 'secret') {
    if (chosen.looksPublic)
      warnings.push(
        `This looks like a public key. ${alg} uses a shared secret; using a public key as an HMAC secret is a known attack (algorithm confusion).`,
      );
    const need = HASH_BYTES[a.hash!];
    if (chosen.bytes.length < need)
      warnings.push(`The secret is shorter than ${need * 8} bits. RFC 7518 §3.2 requires at least the hash size.`);
  }
  if (kind.type === 'RSA' && kind.bits > 0 && kind.bits < 2048)
    warnings.push('The RSA key is shorter than 2048 bits (RFC 7518 §3.3).');
  const used = key.set && chosen.type === 'jwk' ? `${jwkDescription(chosen.jwk)} from the set` : undefined;
  const withKey = used ? { key: used } : {};

  const signature = token.signature!.bytes;
  if (a.family === 'ES' && signature.length !== a.size)
    return {
      state: 'invalid',
      reason: looksDer(signature)
        ? 'The signature is DER-encoded; JWS needs raw r‖s (RFC 7518 §3.4).'
        : `The signature is ${signature.length} bytes; ${alg} needs ${a.size}.`,
      warnings,
      ...withKey,
    };
  return { a, chosen, warnings, withKey };
};

/**
 * The verdict when it needs no WebCrypto (no key yet, `none`, an algorithm or a key that cannot be used, a signature of
 * the wrong length); undefined when only crypto.subtle can tell. Lets a page show it at once, without "Checking…".
 */
export const verificationWithoutCrypto = (token: Decoded, key: ParsedKey | undefined): Verification | undefined => {
  const p = plan(token, key);
  return 'state' in p ? p : undefined;
};

/** Picks the key (kid, kty, crv), checks it against alg (§5.4) and calls crypto.subtle.verify. */
export const verifyToken = async (token: Decoded, key: ParsedKey | undefined): Promise<Verification> => {
  const p = plan(token, key);
  if ('state' in p) return p;
  const { a, chosen, warnings, withKey } = p;
  const signature = token.signature!.bytes;
  let cryptoKey: Awaited<ReturnType<typeof crypto.subtle.importKey>>;
  try {
    const params = importParams(a);
    cryptoKey =
      chosen.type === 'secret'
        ? await crypto.subtle.importKey('raw', chosen.bytes.slice(), params, false, ['verify'])
        : chosen.type === 'spki'
          ? await crypto.subtle.importKey('spki', chosen.der.slice(), params, false, ['verify'])
          : await crypto.subtle.importKey('jwk', publicJwk(chosen.jwk), params, false, ['verify']);
  } catch (error) {
    const name = errorName(error);
    if (a.family === 'Ed' && name === 'NotSupportedError')
      return cannot('this browser has no Ed25519 support (Chrome 137 or later is needed).');
    return cannot(`the browser could not read this key (${name}).`);
  }
  try {
    const data = new TextEncoder().encode(token.signingInput);
    const ok = await crypto.subtle.verify(verifyParams(a), cryptoKey, signature.slice(), data);
    return ok ? { state: 'valid', warnings, ...withKey } : { state: 'invalid', warnings, ...withKey };
  } catch (error) {
    return cannot(`the browser could not check the signature (${errorName(error)}).`);
  }
};
