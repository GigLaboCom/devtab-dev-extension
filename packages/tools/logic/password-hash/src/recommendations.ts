/**
 * The parameters a page opens with — the recommendations for new hashes — and the warning under the minimum
 * (docs/tools/specs/password-hash.md §5.2: one minimum table for Hash and Verify alike), and the limits of the parameter
 * fields (§12). Decided 2026-11-22 on the owner's word «by best practices». Sources, read 2026-11-22: Argon2 — RFC 9106
 * §4 and §7.4 (the SECOND RECOMMENDED option: t=3, p=4, 64 MiB); bcrypt cost 12 — the default of PHP (since 8.4), Laravel,
 * pyca/bcrypt and bcrypt-ruby; scrypt, PBKDF2 and every minimum — the OWASP Password Storage Cheat Sheet
 * (OWASP/CheatSheetSeries, commit 87a1faf18a of 2026-10-30).
 */
import type { Algorithm, Argon2Params, Params, ScryptParams } from './types';

const en = new Intl.NumberFormat('en');
export const formatNumber = (n: number): string => en.format(n);
const oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** Bytes as KiB, MiB or GiB (base 1,024), at most one decimal (§5.7). */
export const formatMemory = (bytes: number): string => {
  if (bytes >= 2 ** 30) return `${oneDecimal.format(bytes / 2 ** 30)} GiB`;
  if (bytes >= 2 ** 20) return `${oneDecimal.format(bytes / 2 ** 20)} MiB`;
  return `${oneDecimal.format(bytes / 1024)} KiB`;
};

/** The parameters each algorithm opens with in Hash: the recommendation for new hashes (§5.2). */
export const RECOMMENDED: Readonly<Record<Algorithm, Params>> = {
  argon2id: { algorithm: 'argon2id', memory: 65_536, iterations: 3, parallelism: 4 },
  argon2i: { algorithm: 'argon2i', memory: 65_536, iterations: 3, parallelism: 4 },
  argon2d: { algorithm: 'argon2d', memory: 65_536, iterations: 3, parallelism: 4 },
  bcrypt: { algorithm: 'bcrypt', cost: 12 },
  scrypt: { algorithm: 'scrypt', logN: 17, r: 8, p: 1 },
  'pbkdf2-sha256': { algorithm: 'pbkdf2-sha256', iterations: 600_000 },
  'pbkdf2-sha512': { algorithm: 'pbkdf2-sha512', iterations: 220_000 },
  'pbkdf2-sha1': { algorithm: 'pbkdf2-sha1', iterations: 1_400_000 },
};

/** The limits of §12: the worst allowed case takes about ten seconds on the measuring machine, wasm memory ≤ 1 GiB. */
export const LIMITS = {
  argon2: {
    memory: { min: 8, max: 1_048_576 },
    iterations: { min: 1, max: 1024 },
    parallelism: { min: 1, max: 255 },
    work: 16_777_216,
  },
  bcrypt: { cost: { min: 4, max: 18 } },
  scrypt: { logN: { min: 1, max: 20 }, r: { min: 1, max: 64 }, p: { min: 1, max: 64 }, memory: 2 ** 30, work: 2 ** 26 },
  pbkdf2: { iterations: { min: 1, max: 10_000_000 } },
} as const;

export type ParamField = 'memory' | 'iterations' | 'parallelism' | 'cost' | 'logN' | 'r' | 'p';
export interface FieldError {
  field: ParamField;
  message: string;
}

const whole = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;
const range = (name: string, min: number, max: number, unit = ''): string =>
  `${name} must be a whole number from ${formatNumber(min)} to ${formatNumber(max)}${unit}.`;

/** Every field that is out of its limits, at once (§6). Fields that are not whole numbers come in as NaN. */
export const checkParams = (params: Params): FieldError[] => {
  const errors: FieldError[] = [];
  switch (params.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d': {
      const { memory, iterations, parallelism } = params;
      const L = LIMITS.argon2;
      const pOk = whole(parallelism, L.parallelism.min, L.parallelism.max);
      if (!whole(memory, L.memory.min, L.memory.max))
        errors.push({ field: 'memory', message: range('Memory', L.memory.min, L.memory.max, ' KiB') });
      else if (pOk && memory < 8 * parallelism)
        errors.push({ field: 'memory', message: 'Memory must be at least 8 KiB per lane (8 × parallelism).' });
      if (!whole(iterations, L.iterations.min, L.iterations.max))
        errors.push({ field: 'iterations', message: range('Iterations', L.iterations.min, L.iterations.max) });
      if (!pOk)
        errors.push({ field: 'parallelism', message: range('Parallelism', L.parallelism.min, L.parallelism.max) });
      if (errors.length === 0 && memory * iterations > L.work)
        errors.push({
          field: 'iterations',
          message: `This would take too long: memory × iterations must be at most ${formatNumber(L.work)} KiB.`,
        });
      break;
    }
    case 'bcrypt': {
      const L = LIMITS.bcrypt.cost;
      if (!whole(params.cost, L.min, L.max)) errors.push({ field: 'cost', message: range('Cost', L.min, L.max) });
      break;
    }
    case 'scrypt': {
      const L = LIMITS.scrypt;
      if (!whole(params.logN, L.logN.min, L.logN.max))
        errors.push({ field: 'logN', message: range('Cost (log2 N)', L.logN.min, L.logN.max) });
      if (!whole(params.r, L.r.min, L.r.max))
        errors.push({ field: 'r', message: range('Block size', L.r.min, L.r.max) });
      if (!whole(params.p, L.p.min, L.p.max))
        errors.push({ field: 'p', message: range('Parallelism', L.p.min, L.p.max) });
      if (errors.length === 0) {
        const memory = scryptMemory(params);
        if (memory > L.memory)
          errors.push({
            field: 'r',
            message: `This needs ${formatMemory(memory)} of memory (128 × N × r); the tool allows up to ${formatMemory(L.memory)}.`,
          });
        else if (2 ** params.logN * params.r * params.p > L.work)
          errors.push({
            field: 'p',
            message: `This would take too long: N × r × p must be at most ${formatNumber(L.work)}.`,
          });
      }
      break;
    }
    default: {
      const L = LIMITS.pbkdf2.iterations;
      if (!whole(params.iterations, L.min, L.max))
        errors.push({ field: 'iterations', message: range('Iterations', L.min, L.max) });
    }
  }
  return errors;
};

/** scrypt's memory, 128·N·r bytes (RFC 7914 §6: V is N blocks of 128·r bytes). */
export const scryptMemory = (p: ScryptParams): number => 128 * 2 ** p.logN * p.r;

export type Weakness = {
  kind: 'below' | 'not-for-passwords' | 'supplementary' | 'legacy' | 'short-salt';
  message: string;
};

/** RFC 9106 §1: Argon2id is the primary variant, Argon2i and Argon2d supplementary (OWASP: Argon2i needs t ≥ 3). */
export const ARGON2I_NOTE =
  'Argon2i is a supplementary variant (RFC 9106): Argon2id is the primary one. Use Argon2i only to match an existing system.';
export const ARGON2D_NOTE =
  'Argon2d is not meant for password hashing: its memory access depends on the password (side channels). Use Argon2id.';

/** What a page says about each algorithm's numbers: the recommendation it opens with, and the minimum it warns under. */
export const RECOMMENDATION_LINES: Readonly<Record<Algorithm, string>> = {
  argon2id:
    'Recommended: m=65536 KiB, t=3, p=4 (RFC 9106, second recommended option). Warned below the minimum: m=19456 KiB with t=2 or an equal OWASP row.',
  argon2i:
    'Recommended: m=65536 KiB, t=3, p=4 (RFC 9106). Warned below the minimum: m=12288 KiB with t=3 or an equal OWASP row.',
  argon2d: 'Recommended for passwords: none — use Argon2id. Kept for existing systems.',
  bcrypt:
    'Recommended: cost 12 (the default of PHP, Laravel, Python bcrypt and Ruby bcrypt). Warned below the minimum: cost 10 (OWASP).',
  scrypt: 'Recommended and minimum: N=2^17, r=8, p=1 (OWASP).',
  'pbkdf2-sha256': 'Recommended and minimum: 600,000 iterations (OWASP).',
  'pbkdf2-sha512': 'Recommended and minimum: 220,000 iterations (OWASP).',
  'pbkdf2-sha1': 'For old systems only: 1,400,000 iterations (OWASP).',
};

export const SHORT_SALT = 'Salts shorter than 16 bytes are below the usual recommendation (128 bits).';

/** OWASP's Argon2id rows (m KiB, t); Argon2i may not use the first two ("do not use with Argon2i"). */
const ARGON2_ROWS: ReadonlyArray<readonly [number, number]> = [
  [47_104, 1],
  [19_456, 2],
  [12_288, 3],
  [9_216, 4],
  [7_168, 5],
];
/** OWASP's scrypt rows (N, p), all with r = 8: another r is compared by memory, 128·N·r. */
const SCRYPT_ROWS: ReadonlyArray<readonly [number, number]> = [
  [2 ** 17, 1],
  [2 ** 16, 2],
  [2 ** 15, 3],
  [2 ** 14, 5],
  [2 ** 13, 10],
];

const argon2Enough = (p: Argon2Params, rows: ReadonlyArray<readonly [number, number]>): boolean =>
  rows.some(([m, t]) => p.memory >= m && p.iterations >= t);

/** What is below today's recommendations (§5.2), and a salt shorter than 16 bytes (§5.4). */
export const assess = (params: Params, saltBytes?: number): Weakness[] => {
  const out: Weakness[] = [];
  switch (params.algorithm) {
    case 'argon2id':
      if (!argon2Enough(params, ARGON2_ROWS))
        out.push({
          kind: 'below',
          message:
            'Below the OWASP minimum for Argon2id: use at least 19 MiB with 2 iterations (or 46 MiB with 1, 12 MiB with 3, 9 MiB with 4, 7 MiB with 5).',
        });
      break;
    case 'argon2i':
      out.push({ kind: 'supplementary', message: ARGON2I_NOTE });
      if (!argon2Enough(params, ARGON2_ROWS.slice(2)))
        out.push({
          kind: 'below',
          message:
            'Below the OWASP minimum for Argon2i: use at least 12 MiB with 3 iterations (or 9 MiB with 4, 7 MiB with 5).',
        });
      break;
    case 'argon2d':
      out.push({ kind: 'not-for-passwords', message: ARGON2D_NOTE });
      break;
    case 'bcrypt':
      if (params.cost < 10)
        out.push({ kind: 'below', message: 'Below the OWASP minimum for bcrypt: use cost 10 or more.' });
      break;
    case 'scrypt': {
      const n = 2 ** params.logN;
      if (!SCRYPT_ROWS.some(([rowN, rowP]) => n * params.r >= rowN * 8 && params.p >= rowP))
        out.push({
          kind: 'below',
          message:
            'Below the OWASP minimum for scrypt: use N = 2^17 with r = 8 and p = 1 (or 2^16 with p = 2, 2^15 with p = 3, 2^14 with p = 5, 2^13 with p = 10).',
        });
      break;
    }
    case 'pbkdf2-sha256':
      if (params.iterations < 600_000)
        out.push({
          kind: 'below',
          message: 'Below the OWASP minimum for PBKDF2-HMAC-SHA256: use 600,000 iterations or more.',
        });
      break;
    case 'pbkdf2-sha512':
      if (params.iterations < 220_000)
        out.push({
          kind: 'below',
          message: 'Below the OWASP minimum for PBKDF2-HMAC-SHA512: use 220,000 iterations or more.',
        });
      break;
    case 'pbkdf2-sha1':
      out.push({
        kind: 'legacy',
        message: 'PBKDF2-HMAC-SHA1 is for old systems only; OWASP asks for 1,400,000 iterations if it must be used.',
      });
  }
  if (saltBytes !== undefined && saltBytes < 16) out.push({ kind: 'short-salt', message: SHORT_SALT });
  return out;
};

/** The parameters in words, for Verify's `Parameters` and Hash's summary (§3, §5.7). */
export const paramsText = (params: Params): string => {
  switch (params.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return `m=${params.memory} KiB (${formatMemory(params.memory * 1024)}), t=${params.iterations}, p=${params.parallelism}`;
    case 'bcrypt':
      return `cost ${params.cost} (${formatNumber(2 ** params.cost)} rounds)`;
    case 'scrypt':
      return `N=2^${params.logN} (${formatNumber(2 ** params.logN)}), r=${params.r}, p=${params.p} — ${formatMemory(scryptMemory(params))}`;
    default:
      return `${formatNumber(params.iterations)} iterations`;
  }
};

/** The line under Hash's parameters: what they cost (§8). Empty when a field is not a number. */
export const costLine = (params: Params): string => {
  switch (params.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return Number.isFinite(params.memory) ? `Uses ${formatMemory(params.memory * 1024)} of memory.` : '';
    case 'bcrypt':
      return Number.isInteger(params.cost) && params.cost <= 31 ? `${formatNumber(2 ** params.cost)} rounds.` : '';
    case 'scrypt':
      return Number.isInteger(params.logN) && Number.isInteger(params.r) && params.logN <= 40
        ? `N = ${formatNumber(2 ** params.logN)} · uses ${formatMemory(scryptMemory(params))} of memory.`
        : '';
    default:
      return '';
  }
};

/** Are two parameter sets the same (the "Use recommended" button is off when they are)? */
export const sameParams = (a: Params, b: Params): boolean => JSON.stringify(a) === JSON.stringify(b);
