/**
 * The payload of the tool's history records (docs/tools/specs/password-hash.md §11) and the list labels; the password
 * is never part of either. Records are secret kinds: the host writes them only encrypted.
 */
import { ALGORITHM_NAMES, formatNumber, formatsOf, HASH_ALGORITHMS } from '@workspace/tool-logic-password-hash';
import type { Algorithm, Format, Params, SaltFormat } from '@workspace/tool-logic-password-hash';

export const FIELD_NAMES = ['memory', 'iterations', 'parallelism', 'cost', 'logN', 'r', 'p', 'pbkdf2'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];
export type Fields = Record<FieldName, string>;

export type SaltPayload = { mode: 'random' } | { mode: 'custom'; text: string; format: SaltFormat };

export interface HashedPayload {
  algorithm: Algorithm;
  fields: Fields;
  format: Format;
  user?: string;
  salt: SaltPayload;
  encoded: string;
  /** Made with a secret key (the key itself is never recorded). */
  keyed: boolean;
}
export interface VerifiedPayload {
  hash: string;
  match: boolean;
  /** Checked with a secret key (the key itself is never recorded). */
  keyed: boolean;
}

const short = (p: Params): string => {
  switch (p.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return `m=${p.memory}, t=${p.iterations}, p=${p.parallelism}`;
    case 'bcrypt':
      return `cost ${p.cost}`;
    case 'scrypt':
      return `N=2^${p.logN}, r=${p.r}, p=${p.p}`;
    default:
      return `${formatNumber(p.iterations)} iterations`;
  }
};

export const hashedLabel = (params: Params): string => `${ALGORITHM_NAMES[params.algorithm]} · ${short(params)}`;
export const verifiedLabel = (params: Params, match: boolean): string =>
  `${hashedLabel(params)} · ${match ? 'matches' : 'does not match'}`;

const isString = (v: unknown): v is string => typeof v === 'string';

/** A record's hashed payload as far as it can be trusted (it may come from another version or an import). */
export const readHashed = (raw: unknown): HashedPayload | null => {
  const p = raw as Partial<HashedPayload> | null;
  if (!p || !HASH_ALGORITHMS.includes(p.algorithm as Algorithm) || !isString(p.encoded)) return null;
  const algorithm = p.algorithm as Algorithm;
  const formats = formatsOf(algorithm);
  const fields = Object.fromEntries(
    FIELD_NAMES.map(name => [name, isString(p.fields?.[name]) ? p.fields[name] : '']),
  ) as Fields;
  const salt: SaltPayload =
    p.salt?.mode === 'custom' && isString(p.salt.text) && ['text', 'hex', 'base64'].includes(p.salt.format)
      ? { mode: 'custom', text: p.salt.text, format: p.salt.format }
      : { mode: 'random' };
  return {
    algorithm,
    fields,
    format: formats.includes(p.format as Format) ? (p.format as Format) : formats[0]!,
    ...(isString(p.user) ? { user: p.user } : {}),
    salt,
    encoded: p.encoded,
    keyed: p.keyed === true,
  };
};

export const readVerified = (raw: unknown): VerifiedPayload | null => {
  const p = raw as Partial<VerifiedPayload> | null;
  return p && isString(p.hash) ? { hash: p.hash, match: p.match === true, keyed: p.keyed === true } : null;
};
