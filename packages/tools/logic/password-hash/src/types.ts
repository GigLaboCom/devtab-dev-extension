/** The algorithms, their parameters and the encoded strings of docs/tools/specs/password-hash.md §5.1, §5.6, §9. */

export type Argon2Algorithm = 'argon2id' | 'argon2i' | 'argon2d';
export type Pbkdf2Algorithm = 'pbkdf2-sha256' | 'pbkdf2-sha512' | 'pbkdf2-sha1';
export type Algorithm = Argon2Algorithm | 'bcrypt' | 'scrypt' | Pbkdf2Algorithm;

/** What Hash offers, in the order of §4 (PBKDF2-SHA1 is read only: "legacy only"). */
export const HASH_ALGORITHMS: readonly Algorithm[] = [
  'argon2id',
  'argon2i',
  'argon2d',
  'bcrypt',
  'scrypt',
  'pbkdf2-sha256',
  'pbkdf2-sha512',
];

export const ALGORITHM_NAMES: Readonly<Record<Algorithm, string>> = {
  argon2id: 'Argon2id',
  argon2i: 'Argon2i',
  argon2d: 'Argon2d',
  bcrypt: 'bcrypt',
  scrypt: 'scrypt',
  'pbkdf2-sha256': 'PBKDF2-SHA256',
  'pbkdf2-sha512': 'PBKDF2-SHA512',
  'pbkdf2-sha1': 'PBKDF2-SHA1',
};

export interface Argon2Params {
  algorithm: Argon2Algorithm;
  /** KiB. */
  memory: number;
  iterations: number;
  parallelism: number;
}
export interface BcryptParams {
  algorithm: 'bcrypt';
  cost: number;
}
export interface ScryptParams {
  algorithm: 'scrypt';
  /** log2 N. */
  logN: number;
  r: number;
  p: number;
}
export interface Pbkdf2Params {
  algorithm: Pbkdf2Algorithm;
  iterations: number;
}
export type Params = Argon2Params | BcryptParams | ScryptParams | Pbkdf2Params;

export type Format =
  | 'bcrypt-2b'
  | 'bcrypt-2y'
  | 'htpasswd'
  /** Read only. */
  | 'bcrypt-2a'
  /** Read only: Django's `bcrypt$` + a modular crypt string. */
  | 'django-bcrypt'
  | 'phc'
  /** Read only: Django's `argon2` + a PHC string. */
  | 'django-argon2'
  | 'scrypt-passlib'
  | 'scrypt-7'
  | 'scrypt-django'
  | 'pbkdf2-passlib'
  | 'pbkdf2-django';

export const FORMAT_NAMES: Readonly<Record<Format, string>> = {
  'bcrypt-2b': '$2b$',
  'bcrypt-2y': '$2y$',
  htpasswd: 'htpasswd line',
  'bcrypt-2a': '$2a$',
  'django-bcrypt': 'Django',
  phc: 'PHC string',
  'django-argon2': 'Django',
  'scrypt-passlib': '$scrypt$ (passlib)',
  'scrypt-7': '$7$ (libsodium)',
  'scrypt-django': 'Django',
  'pbkdf2-passlib': 'passlib',
  'pbkdf2-django': 'Django',
};

/** The formats Hash offers for an algorithm, the first the default (§5.6). */
export const formatsOf = (algorithm: Algorithm): readonly Format[] => {
  switch (algorithm) {
    case 'bcrypt':
      return ['bcrypt-2b', 'bcrypt-2y', 'htpasswd'];
    case 'scrypt':
      return ['scrypt-passlib', 'scrypt-7', 'scrypt-django'];
    case 'pbkdf2-sha256':
      return ['pbkdf2-passlib', 'pbkdf2-django'];
    case 'pbkdf2-sha512':
    case 'pbkdf2-sha1':
      return ['pbkdf2-passlib'];
    default:
      return ['phc'];
  }
};

/** Formats that write the salt as text into the string (Django, `$7$`): their salt is typed, not bytes (§5.4). */
export const TEXT_SALT_FORMATS: ReadonlySet<Format> = new Set(['scrypt-7', 'scrypt-django', 'pbkdf2-django']);

export const isArgon2 = (p: Params): p is Argon2Params =>
  p.algorithm === 'argon2id' || p.algorithm === 'argon2i' || p.algorithm === 'argon2d';
export const isPbkdf2 = (p: Params): p is Pbkdf2Params =>
  p.algorithm === 'pbkdf2-sha256' || p.algorithm === 'pbkdf2-sha512' || p.algorithm === 'pbkdf2-sha1';
