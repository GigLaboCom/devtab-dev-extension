/**
 * What the Password Hash tool remembers between uses (D21; docs/tools/settings.md): only what any hash string writes in
 * the open — the mode, the algorithm, its cost (each family's own fields: Argon2's memory, iterations and parallelism,
 * bcrypt's cost, scrypt's log2 N, r and p, PBKDF2-SHA256's and PBKDF2-SHA512's iterations), the format and the custom
 * salt's format. Never the password, the secret key (pepper), the user of an htpasswd line, the salt source or a salt
 * typed by a person, a hash to verify or a result: they are secrets or this hash's data (the history keeps the hashes
 * only encrypted, D17; the saved parameters lie in the open).
 *
 * Every cost field is checked against the logic's own limits (LIMITS), the defaults are the logic's recommendations
 * (RECOMMENDED). A cost is saved only as a set the tool takes whole (checkParams); a saved value outside today's limits,
 * or a set the tool would refuse, opens as the recommended cost of its algorithm — never below what a person could
 * choose on the page. A cost within the limits but below today's recommendations opens with the page's warning.
 */
import { checkParams, formatsOf, HASH_ALGORITHMS, LIMITS, RECOMMENDED } from '@workspace/tool-logic-password-hash';
import { declareSettings, setting } from '@workspace/tools-host';
import type {
  Algorithm,
  Argon2Params,
  BcryptParams,
  Format,
  Params,
  Pbkdf2Params,
  ScryptParams,
} from '@workspace/tool-logic-password-hash';
import type { SettingsValues } from '@workspace/tools-host';

const ARGON2 = RECOMMENDED.argon2id as Argon2Params;
const BCRYPT = RECOMMENDED.bcrypt as BcryptParams;
const SCRYPT = RECOMMENDED.scrypt as ScryptParams;
const PBKDF2_SHA256 = RECOMMENDED['pbkdf2-sha256'] as Pbkdf2Params;
const PBKDF2_SHA512 = RECOMMENDED['pbkdf2-sha512'] as Pbkdf2Params;

export const passwordHashSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['hash', 'verify'], 'hash'),
    algorithm: setting.oneOf(HASH_ALGORITHMS, 'argon2id'),
    argon2Memory: setting.integer(LIMITS.argon2.memory, ARGON2.memory),
    argon2Iterations: setting.integer(LIMITS.argon2.iterations, ARGON2.iterations),
    argon2Parallelism: setting.integer(LIMITS.argon2.parallelism, ARGON2.parallelism),
    bcryptCost: setting.integer(LIMITS.bcrypt.cost, BCRYPT.cost),
    scryptLogN: setting.integer(LIMITS.scrypt.logN, SCRYPT.logN),
    scryptR: setting.integer(LIMITS.scrypt.r, SCRYPT.r),
    scryptP: setting.integer(LIMITS.scrypt.p, SCRYPT.p),
    pbkdf2Sha256Iterations: setting.integer(LIMITS.pbkdf2.iterations, PBKDF2_SHA256.iterations),
    pbkdf2Sha512Iterations: setting.integer(LIMITS.pbkdf2.iterations, PBKDF2_SHA512.iterations),
    format: setting.oneOf<Format>([...new Set(HASH_ALGORITHMS.flatMap(formatsOf))], 'phc'),
    saltFormat: setting.oneOf(['text', 'hex', 'base64'], 'hex'),
  },
});

type Values = SettingsValues<typeof passwordHashSettings>;

/** The saved keys of an algorithm's cost, from a set of its parameters. */
export const costKeys = (params: Params): Partial<Values> => {
  switch (params.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return {
        argon2Memory: params.memory,
        argon2Iterations: params.iterations,
        argon2Parallelism: params.parallelism,
      };
    case 'bcrypt':
      return { bcryptCost: params.cost };
    case 'scrypt':
      return { scryptLogN: params.logN, scryptR: params.r, scryptP: params.p };
    case 'pbkdf2-sha512':
      return { pbkdf2Sha512Iterations: params.iterations };
    default:
      return { pbkdf2Sha256Iterations: params.iterations };
  }
};

/**
 * The cost an algorithm opens with: the saved one when the tool takes the set whole, its recommended cost otherwise
 * (each field already passed its own limits; a set can still be refused — 8 KiB per lane, memory × iterations).
 */
export const savedCost = (values: Values, algorithm: Algorithm): Params => {
  const params: Params =
    algorithm === 'argon2id' || algorithm === 'argon2i' || algorithm === 'argon2d'
      ? {
          algorithm,
          memory: values.argon2Memory,
          iterations: values.argon2Iterations,
          parallelism: values.argon2Parallelism,
        }
      : algorithm === 'bcrypt'
        ? { algorithm, cost: values.bcryptCost }
        : algorithm === 'scrypt'
          ? { algorithm, logN: values.scryptLogN, r: values.scryptR, p: values.scryptP }
          : {
              algorithm,
              iterations: algorithm === 'pbkdf2-sha512' ? values.pbkdf2Sha512Iterations : values.pbkdf2Sha256Iterations,
            };
  return checkParams(params).length === 0 ? params : RECOMMENDED[algorithm];
};

/** The format an algorithm opens with: the saved one when the algorithm writes it, its first format otherwise. */
export const savedFormat = (format: Format, algorithm: Algorithm): Format =>
  formatsOf(algorithm).includes(format) ? format : formatsOf(algorithm)[0]!;
