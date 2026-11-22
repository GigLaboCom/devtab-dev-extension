/**
 * The hashes themselves, on hash-wasm 4.12.0 (docs/tools/specs/password-hash.md §5.1): bcrypt, Argon2 (id, i, d),
 * scrypt and PBKDF2, each compiled from C to WebAssembly and embedded in the JavaScript as Base64 — compiled on first
 * use (`WebAssembly.compile`, allowed by the extension's `'wasm-unsafe-eval'`), nothing fetched, no `eval`, no worker of
 * its own. The page never imports this module: the tool's worker does (and, without workers, a dynamic import), so the
 * library stays out of the page's chunk. Then the encoded strings of §5.6 and the check of §5.8.
 */
import { timingSafeEqual } from './compare';
import { encodeAb64, encodeB64, encodeBcrypt64, encodeH64, encodeH64Int } from './encoding';
import { bcryptBytes, utf8 } from './input';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { argon2d, argon2i, argon2id, bcrypt, createSHA1, createSHA256, createSHA512, pbkdf2, scrypt } from 'hash-wasm';
import type { ParsedHash } from './parse';
import type { Argon2Params, Format, Params, Pbkdf2Params, ScryptParams } from './types';

const ARGON2 = { argon2id, argon2i, argon2d } as const;
const DIGEST = { 'pbkdf2-sha256': createSHA256, 'pbkdf2-sha512': createSHA512, 'pbkdf2-sha1': createSHA1 } as const;
const DIGEST_BYTES = { 'pbkdf2-sha256': 32, 'pbkdf2-sha512': 64, 'pbkdf2-sha1': 20 } as const;

/**
 * bcrypt's 31 hash characters for a password (text: UTF-8, the first 72 bytes) and a 16-byte salt. hash-wasm runs
 * crypt_blowfish in its `$2a$` mode, which for any UTF-8 password equals `$2b$` and `$2y$` (§5.1); it stops at a NUL.
 */
export const bcryptHash = async (password: Uint8Array, salt: Uint8Array, cost: number): Promise<string> => {
  const encoded = await bcrypt({ password, salt, costFactor: cost, outputType: 'encoded' });
  return encoded.slice(29);
};

/** Argon2 with an optional secret key K (a pepper; RFC 9106 §3.1) — empty means none, as the library takes it. */
export const argon2Hash = (
  password: Uint8Array,
  salt: Uint8Array,
  p: Argon2Params,
  length: number,
  secret?: Uint8Array,
): Promise<Uint8Array> =>
  ARGON2[p.algorithm]({
    password,
    salt,
    ...(secret && secret.length > 0 ? { secret } : {}),
    iterations: p.iterations,
    parallelism: p.parallelism,
    memorySize: p.memory,
    hashLength: length,
    outputType: 'binary',
  });

export const scryptHash = (
  password: Uint8Array,
  salt: Uint8Array,
  p: ScryptParams,
  length: number,
): Promise<Uint8Array> =>
  scrypt({
    password,
    salt,
    costFactor: 2 ** p.logN,
    blockSize: p.r,
    parallelism: p.p,
    hashLength: length,
    outputType: 'binary',
  });

export const pbkdf2Hash = (
  password: Uint8Array,
  salt: Uint8Array,
  p: Pbkdf2Params,
  length: number,
): Promise<Uint8Array> =>
  pbkdf2({
    password,
    salt,
    iterations: p.iterations,
    hashLength: length,
    hashFunction: DIGEST[p.algorithm](),
    outputType: 'binary',
  });

export interface HashRequest {
  password: string;
  params: Params;
  format: Format;
  /** The salt's bytes; for a text-salt format (Django, `$7$`) the UTF-8 of `saltText`. */
  salt: Uint8Array;
  saltText?: string;
  /** `htpasswd` only. */
  user?: string;
  /** Argon2 only: the secret key (pepper), UTF-8 of what was typed. Not part of the string; never recorded. */
  secret?: string;
}

/** The output length of a format (§5.6): fixed per format in Hash. */
export const outputLength = (params: Params, format: Format): number => {
  if (params.algorithm === 'scrypt') return format === 'scrypt-django' ? 64 : 32;
  if (
    params.algorithm === 'pbkdf2-sha256' ||
    params.algorithm === 'pbkdf2-sha512' ||
    params.algorithm === 'pbkdf2-sha1'
  )
    return format === 'pbkdf2-django' ? 32 : DIGEST_BYTES[params.algorithm];
  return 32;
};

const DJANGO_PBKDF2 = {
  'pbkdf2-sha256': 'pbkdf2_sha256',
  'pbkdf2-sha1': 'pbkdf2_sha1',
  'pbkdf2-sha512': 'pbkdf2_sha512',
} as const;
const PASSLIB_PBKDF2 = {
  'pbkdf2-sha256': '$pbkdf2-sha256$',
  'pbkdf2-sha512': '$pbkdf2-sha512$',
  'pbkdf2-sha1': '$pbkdf2$',
} as const;

/** The encoded string of §5.6 for a password, its parameters, format and salt. */
export const hashPassword = async (request: HashRequest): Promise<string> => {
  const { params, format, salt } = request;
  const password = utf8(request.password);
  const length = outputLength(params, format);
  switch (params.algorithm) {
    case 'bcrypt': {
      const cost = String(params.cost).padStart(2, '0');
      const body = `${cost}$${encodeBcrypt64(salt)}${await bcryptHash(bcryptBytes(request.password), salt, params.cost)}`;
      if (format === 'htpasswd') return `${request.user ?? ''}:$2y$${body}`;
      return `${format === 'bcrypt-2y' ? '$2y$' : '$2b$'}${body}`;
    }
    case 'argon2id':
    case 'argon2i':
    case 'argon2d': {
      const digest = await argon2Hash(password, salt, params, length, secretBytes(request.secret));
      return `$${params.algorithm}$v=19$m=${params.memory},t=${params.iterations},p=${params.parallelism}$${encodeB64(salt)}$${encodeB64(digest)}`;
    }
    case 'scrypt': {
      const digest = await scryptHash(password, salt, params, length);
      if (format === 'scrypt-7')
        return `$7$${encodeH64Int(params.logN, 1)}${encodeH64Int(params.r, 5)}${encodeH64Int(params.p, 5)}${request.saltText ?? ''}$${encodeH64(digest)}`;
      if (format === 'scrypt-django')
        return `scrypt$${2 ** params.logN}$${request.saltText ?? ''}$${params.r}$${params.p}$${bytesToBase64(digest)}`;
      return `$scrypt$ln=${params.logN},r=${params.r},p=${params.p}$${encodeB64(salt)}$${encodeB64(digest)}`;
    }
    default: {
      const digest = await pbkdf2Hash(password, salt, params, length);
      if (format === 'pbkdf2-django')
        return `${DJANGO_PBKDF2[params.algorithm]}$${params.iterations}$${request.saltText ?? ''}$${bytesToBase64(digest)}`;
      return `${PASSLIB_PBKDF2[params.algorithm]}${params.iterations}$${encodeAb64(salt)}$${encodeAb64(digest)}`;
    }
  }
};

const secretBytes = (secret: string | undefined): Uint8Array | undefined => (secret ? utf8(secret) : undefined);

const ascii = (text: string): Uint8Array => Uint8Array.from(text, c => c.charCodeAt(0) & 0xff);

/**
 * Does `password` give `hash` (§5.8)? The hash is computed again with the string's salt and parameters; bcrypt compares
 * the whole rebuilt string with the original (as OpenBSD does), the others the digest bytes — both in constant time.
 */
export const verifyPassword = async (password: string, hash: ParsedHash, secret?: string): Promise<boolean> => {
  const { params, salt, digest } = hash;
  const bytes = utf8(password);
  switch (params.algorithm) {
    case 'bcrypt': {
      // Rebuilt as OpenBSD does: the salt re-encoded from its 16 bytes, so a non-canonical salt character does not match.
      const rebuilt =
        hash.encoded.slice(0, 7) + encodeBcrypt64(salt) + (await bcryptHash(bcryptBytes(password), salt, params.cost));
      return timingSafeEqual(ascii(rebuilt), ascii(hash.encoded));
    }
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return timingSafeEqual(await argon2Hash(bytes, salt, params, digest.length, secretBytes(secret)), digest);
    case 'scrypt':
      return timingSafeEqual(await scryptHash(bytes, salt, params, digest.length), digest);
    default:
      return timingSafeEqual(await pbkdf2Hash(bytes, salt, params, digest.length), digest);
  }
};
