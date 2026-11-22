/** What Verify shows of a read hash before checking it (docs/tools/specs/password-hash.md §5.7). */
import { formatNumber, paramsText } from './recommendations';
import { ALGORITHM_NAMES } from './types';
import type { ParsedHash } from './parse';
import type { Format } from './types';

const FORMAT_WORDS: Readonly<Record<Format, string>> = {
  'bcrypt-2a': 'Modular crypt',
  'bcrypt-2b': 'Modular crypt',
  'bcrypt-2y': 'Modular crypt',
  htpasswd: 'htpasswd line',
  'django-bcrypt': 'Django',
  phc: 'PHC string',
  'django-argon2': 'Django',
  'scrypt-passlib': 'passlib',
  'scrypt-7': 'libsodium ($7$)',
  'scrypt-django': 'Django',
  'pbkdf2-passlib': 'passlib',
  'pbkdf2-django': 'Django',
};
const PBKDF2_WORDS = {
  'pbkdf2-sha256': 'PBKDF2-HMAC-SHA256',
  'pbkdf2-sha512': 'PBKDF2-HMAC-SHA512',
  'pbkdf2-sha1': 'PBKDF2-HMAC-SHA1',
} as const;

const count = (n: number, one: string, many: string): string => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** What Verify shows of a read hash before checking it (§5.7). */
export const describe = (hash: ParsedHash): Array<{ name: string; value: string }> => {
  const p = hash.params;
  const algorithm =
    p.algorithm === 'bcrypt'
      ? `bcrypt (${hash.prefix ?? '$2b$'})`
      : p.algorithm === 'scrypt'
        ? 'scrypt'
        : p.algorithm.startsWith('pbkdf2')
          ? PBKDF2_WORDS[p.algorithm as keyof typeof PBKDF2_WORDS]
          : `${ALGORITHM_NAMES[p.algorithm]} (version 19)`;
  return [
    { name: 'Algorithm', value: algorithm },
    { name: 'Format', value: FORMAT_WORDS[hash.format] },
    ...(hash.user !== undefined ? [{ name: 'User', value: hash.user }] : []),
    { name: 'Parameters', value: paramsText(p) },
    {
      name: 'Salt',
      value: hash.saltIsText
        ? `${count(hash.salt.length, 'character', 'characters')} (text)`
        : count(hash.salt.length, 'byte', 'bytes'),
    },
    { name: 'Hash', value: count(hash.digest.length, 'byte', 'bytes') },
  ];
};
