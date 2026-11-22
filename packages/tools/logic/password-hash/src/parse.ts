/**
 * Reading an encoded password hash (docs/tools/specs/password-hash.md §5.6, §5.7, §6): which algorithm, format,
 * parameters, salt and digest it carries — or, in plain words, why it cannot be read or what it is instead. Linear: the
 * string is split on `$` and each part is checked by its character class; nothing here computes a hash.
 */
import { decodeAb64, decodeB64, decodeBcrypt64, decodeH64, decodeH64Int, decodePadded, H64 } from './encoding';
import type { Format, Params } from './types';

export const MAX_HASH_CHARS = 1024;

export interface ParsedHash {
  params: Params;
  format: Format;
  /** The salt's bytes as the hash function takes them (a text salt: its UTF-8). */
  salt: Uint8Array;
  /** Django and `$7$` keep the salt as text. */
  saltIsText: boolean;
  digest: Uint8Array;
  /** bcrypt: the 60-character modular crypt string (without a `user:` or Django prefix); others: the whole string. */
  encoded: string;
  /** The `user` of an htpasswd line. */
  user?: string;
  /** bcrypt's prefix as written. */
  prefix?: '$2a$' | '$2b$' | '$2y$';
}

export type Parsed = { ok: true; hash: ParsedHash } | { ok: false; message: string; empty?: true };

export const EMPTY_HASH = 'Paste a hash and type the password to check it.';
export const UNKNOWN = 'Not a password hash this tool knows. It reads bcrypt, Argon2, scrypt and PBKDF2 strings.';

const unsupported = (name: string): Parsed => ({
  ok: false,
  message: OUTDATED_MD5.has(name)
    ? `${name} hashes are not supported: it is an outdated MD5 scheme. The tool reads bcrypt, Argon2, scrypt and PBKDF2.`
    : `${name} hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.`,
});
/** MD5 schemes: recognised and named, never computed — outdated (§13). */
const OUTDATED_MD5: ReadonlySet<string> = new Set(['MD5-crypt ($1$)', 'Apache MD5 ($apr1$)']);
const unreadable = (article: string, reason: string): Parsed => ({
  ok: false,
  message: `This looks like ${article} hash, but it cannot be read: ${reason}.`,
});

/** Formats the tool names but does not compute (§5.6), by prefix. */
const NAMED: ReadonlyArray<readonly [string, string]> = [
  ['$1$', 'MD5-crypt ($1$)'],
  ['$apr1$', 'Apache MD5 ($apr1$)'],
  ['$5$', 'SHA-256-crypt ($5$)'],
  ['$6$', 'SHA-512-crypt ($6$)'],
  ['$y$', 'yescrypt ($y$)'],
  ['$gy$', 'yescrypt ($gy$)'],
  ['$2$', 'Original bcrypt ($2$)'],
  ['{SHA}', 'LDAP SHA ({SHA})'],
  ['{SSHA}', 'LDAP salted SHA ({SSHA})'],
  ['bcrypt_sha256$', 'Django bcrypt_sha256'],
];
const DIGEST_NAMES: Readonly<Record<number, string>> = {
  32: 'MD5',
  40: 'SHA-1',
  64: 'SHA-256',
  96: 'SHA-384',
  128: 'SHA-512',
};

/** A decimal parameter: 1 to 10 digits, no leading zero (C2SP "Decimal Encoding"). */
const decimal = (text: string | undefined): number | null =>
  text !== undefined && /^(?:0|[1-9]\d{0,9})$/.test(text) ? Number(text) : null;

const BCRYPT_BODY = /^[./A-Za-z0-9]{53}$/;

const parseBcrypt = (text: string, format: Format, user?: string): Parsed => {
  const article = 'a bcrypt';
  if (text.length !== 60) return unreadable(article, 'it should be 60 characters long');
  if (text[6] !== '$' || !/^\d\d$/.test(text.slice(4, 6))) return unreadable(article, 'the cost should be two digits');
  const cost = Number(text.slice(4, 6));
  if (cost < 4 || cost > 31) return unreadable(article, 'the cost must be from 4 to 31');
  const body = text.slice(7);
  if (!BCRYPT_BODY.test(body)) return unreadable(article, 'it has characters outside bcrypt’s alphabet');
  const salt = decodeBcrypt64(body.slice(0, 22))!;
  const digest = decodeBcrypt64(body.slice(22))!;
  const prefix = text.slice(0, 4) as '$2a$' | '$2b$' | '$2y$';
  const own: Format =
    format === 'htpasswd' || format === 'django-bcrypt'
      ? format
      : prefix === '$2a$'
        ? 'bcrypt-2a'
        : prefix === '$2y$'
          ? 'bcrypt-2y'
          : 'bcrypt-2b';
  return {
    ok: true,
    hash: {
      params: { algorithm: 'bcrypt', cost },
      format: own,
      salt,
      saltIsText: false,
      digest,
      encoded: text,
      prefix,
      ...(user !== undefined ? { user } : {}),
    },
  };
};

const parseArgon2 = (text: string, format: Format): Parsed => {
  const article = 'an Argon2';
  const parts = text.split('$');
  const variant = parts[1] as 'argon2id' | 'argon2i' | 'argon2d';
  let at = 2;
  if (!parts[at]?.startsWith('v=') || parts[at] === 'v=16')
    return {
      ok: false,
      message: 'Argon2 version 16 (1.0) is not supported: the library computes version 19 (1.3) only.',
    };
  if (parts[at] !== 'v=19') return unreadable(article, 'the version should be v=19');
  at++;
  const fields = (parts[at] ?? '').split(',');
  if (fields.some(f => f.startsWith('keyid=') || f.startsWith('data=')))
    return { ok: false, message: 'This Argon2 hash uses a key id or associated data; the tool does not take them.' };
  if (
    fields.length !== 3 ||
    !fields[0]!.startsWith('m=') ||
    !fields[1]!.startsWith('t=') ||
    !fields[2]!.startsWith('p=')
  )
    return unreadable(article, 'the parameters should be m=…,t=…,p=… in this order');
  const memory = decimal(fields[0]!.slice(2));
  const iterations = decimal(fields[1]!.slice(2));
  const parallelism = decimal(fields[2]!.slice(2));
  if (memory === null || iterations === null || parallelism === null || !memory || !iterations || !parallelism)
    return unreadable(article, 'a parameter is not a positive whole number');
  if (parts.length !== at + 3) return unreadable(article, 'it should end with $salt$hash');
  const salt = decodeB64(parts[at + 1]!);
  if (!salt) return unreadable(article, 'the salt is not valid Base64');
  if (salt.length < 8) return unreadable(article, 'the salt is shorter than 8 bytes');
  const digest = decodeB64(parts[at + 2]!);
  if (!digest) return unreadable(article, 'the hash is not valid Base64');
  if (digest.length < 4) return unreadable(article, 'the hash is shorter than 4 bytes');
  return {
    ok: true,
    hash: {
      params: { algorithm: variant, memory, iterations, parallelism },
      format,
      salt,
      saltIsText: false,
      digest,
      encoded: text,
    },
  };
};

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const parseScryptPasslib = (text: string): Parsed => {
  const article = 'a scrypt';
  const parts = text.split('$');
  if (parts.length !== 5) return unreadable(article, 'it should be $scrypt$ln=…,r=…,p=…$salt$hash');
  const m = /^ln=(\d{1,2}),r=(\d{1,10}),p=(\d{1,10})$/.exec(parts[2]!);
  if (!m) return unreadable(article, 'the parameters should be ln=…,r=…,p=…');
  const [logN, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!logN || !r || !p) return unreadable(article, 'a parameter is not a positive whole number');
  const salt = decodeB64(parts[3]!);
  if (!salt) return unreadable(article, 'the salt is not valid Base64');
  const digest = decodeB64(parts[4]!);
  if (!digest || digest.length === 0) return unreadable(article, 'the hash is not valid Base64');
  return {
    ok: true,
    hash: {
      params: { algorithm: 'scrypt', logN, r, p },
      format: 'scrypt-passlib',
      salt,
      saltIsText: false,
      digest,
      encoded: text,
    },
  };
};

const parseScrypt7 = (text: string): Parsed => {
  const article = 'a scrypt';
  const rest = text.slice(3);
  const cut = rest.lastIndexOf('$');
  if (cut < 0) return unreadable(article, 'it should end with $hash');
  const setting = rest.slice(0, cut);
  if (setting.length < 11 || setting.includes('$')) return unreadable(article, 'the settings are too short');
  const logN = decodeH64Int(setting[0]!);
  const r = decodeH64Int(setting.slice(1, 6));
  const p = decodeH64Int(setting.slice(6, 11));
  if (logN === null || r === null || p === null || !logN || !r || !p)
    return unreadable(article, `the settings use characters outside ${H64.slice(0, 2)}0–9A–Za–z`);
  const saltText = setting.slice(11);
  const digest = decodeH64(rest.slice(cut + 1));
  if (!digest || digest.length === 0) return unreadable(article, 'the hash is not valid crypt-base64');
  return {
    ok: true,
    hash: {
      params: { algorithm: 'scrypt', logN, r, p },
      format: 'scrypt-7',
      salt: utf8(saltText),
      saltIsText: true,
      digest,
      encoded: text,
    },
  };
};

const parseScryptDjango = (text: string): Parsed => {
  const article = 'a scrypt';
  const parts = text.split('$');
  if (parts.length !== 6) return unreadable(article, 'it should be scrypt$N$salt$r$p$hash');
  const n = decimal(parts[1]);
  const r = decimal(parts[3]);
  const p = decimal(parts[4]);
  if (n === null || r === null || p === null || !r || !p)
    return unreadable(article, 'a parameter is not a positive whole number');
  const logN = Math.log2(n);
  if (!Number.isInteger(logN) || logN < 1) return unreadable(article, 'N must be a power of 2');
  const digest = decodePadded(parts[5]!);
  if (!digest || digest.length === 0) return unreadable(article, 'the hash is not valid Base64');
  return {
    ok: true,
    hash: {
      params: { algorithm: 'scrypt', logN, r, p },
      format: 'scrypt-django',
      salt: utf8(parts[2]!),
      saltIsText: true,
      digest,
      encoded: text,
    },
  };
};

const parsePbkdf2Passlib = (text: string): Parsed => {
  const article = 'a PBKDF2';
  const parts = text.split('$');
  const algorithm =
    parts[1] === 'pbkdf2-sha256' ? 'pbkdf2-sha256' : parts[1] === 'pbkdf2-sha512' ? 'pbkdf2-sha512' : 'pbkdf2-sha1';
  if (parts.length !== 5) return unreadable(article, 'it should be $pbkdf2-…$iterations$salt$hash');
  const iterations = decimal(parts[2]);
  if (!iterations) return unreadable(article, 'the iterations are not a positive whole number');
  const salt = decodeAb64(parts[3]!);
  if (!salt) return unreadable(article, 'the salt is not valid Base64');
  const digest = decodeAb64(parts[4]!);
  if (!digest || digest.length === 0) return unreadable(article, 'the hash is not valid Base64');
  return {
    ok: true,
    hash: {
      params: { algorithm, iterations },
      format: 'pbkdf2-passlib',
      salt,
      saltIsText: false,
      digest,
      encoded: text,
    },
  };
};

const parsePbkdf2Django = (text: string): Parsed => {
  const article = 'a PBKDF2';
  const parts = text.split('$');
  const algorithm = parts[0] === 'pbkdf2_sha256' ? 'pbkdf2-sha256' : 'pbkdf2-sha1';
  if (parts.length !== 4) return unreadable(article, 'it should be pbkdf2_…$iterations$salt$hash');
  const iterations = decimal(parts[1]);
  if (!iterations) return unreadable(article, 'the iterations are not a positive whole number');
  const digest = decodePadded(parts[3]!);
  if (!digest || digest.length === 0) return unreadable(article, 'the hash is not valid Base64');
  return {
    ok: true,
    hash: {
      params: { algorithm, iterations },
      format: 'pbkdf2-django',
      salt: utf8(parts[2]!),
      saltIsText: true,
      digest,
      encoded: text,
    },
  };
};

/** Reads a password hash (§5.6); the message says why not, in the words of §6. */
export const parseHash = (input: string): Parsed => {
  let text = input.trim();
  if (text === '') return { ok: false, message: EMPTY_HASH, empty: true };
  if (text.length > MAX_HASH_CHARS || /\s/.test(text)) return { ok: false, message: UNKNOWN };
  // An htpasswd line: user:hash (the user has no ":" — Apache's rule).
  let user: string | undefined;
  const colon = text.indexOf(':');
  if (colon > 0 && (text[colon + 1] === '$' || text[colon + 1] === '{')) {
    user = text.slice(0, colon);
    text = text.slice(colon + 1);
  }
  for (const [prefix, name] of NAMED) if (text.startsWith(prefix)) return unsupported(name);
  if (text.startsWith('$2x$'))
    return {
      ok: false,
      message: '$2x$ marks hashes made by crypt_blowfish’s bug-compatible mode; the tool does not compute it.',
    };
  if (/^\$2[aby]\$/.test(text)) return parseBcrypt(text, user !== undefined ? 'htpasswd' : 'bcrypt-2b', user);
  if (user !== undefined) return { ok: false, message: UNKNOWN };
  if (text.startsWith('bcrypt$$2')) {
    const inner = text.slice(7);
    if (inner.startsWith('$2x$')) return parseHash(inner);
    return /^\$2[aby]\$/.test(inner) ? parseBcrypt(inner, 'django-bcrypt') : { ok: false, message: UNKNOWN };
  }
  if (/^argon2\$argon2(?:id|i|d)\$/.test(text)) return parseArgon2(text.slice(6), 'django-argon2');
  if (/^\$argon2(?:id|i|d)\$/.test(text)) return parseArgon2(text, 'phc');
  if (text.startsWith('$scrypt$')) return parseScryptPasslib(text);
  if (text.startsWith('$7$')) return parseScrypt7(text);
  if (text.startsWith('scrypt$')) return parseScryptDjango(text);
  if (/^\$pbkdf2(?:-sha256|-sha512)?\$/.test(text)) return parsePbkdf2Passlib(text);
  if (/^pbkdf2_sha(?:256|1)\$/.test(text)) return parsePbkdf2Django(text);
  if (/^[0-9a-fA-F]+$/.test(text) && DIGEST_NAMES[text.length])
    return {
      ok: false,
      message: `This looks like a plain ${DIGEST_NAMES[text.length]} digest, not a password hash. Plain digests are compared in the Hash tool.`,
    };
  return { ok: false, message: UNKNOWN };
};

/** Does pasted text look like a hash Verify reads (§7)? The same reader, on one line of at most 1,024 characters. */
export const detectPasswordHash = (text: string): boolean => {
  if (text.length > MAX_HASH_CHARS + 64) return false;
  const t = text.trim();
  if (t.length < 20 || t.length > MAX_HASH_CHARS) return false;
  return parseHash(t).ok;
};
