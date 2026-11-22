/**
 * The Key Pairs tool's logic (docs/tools/specs/keys.md §9). Pure: no React, no DOM, no chrome. Keys are made only by
 * Web Crypto (`generate.ts`); this package writes and reads their forms (`encode.ts`, `read.ts`, `asn1.ts`, `ssh.ts`,
 * `jwk.ts`, `pem.ts`), checks and completes them (`complete.ts`), and fingerprints them (`fingerprint.ts`, `md5.ts`).
 * Shared pure code comes from @workspace/tools-shared (der, base64, hex, json-scan, random); a tool never imports
 * another tool.
 */
export * from './types';
export { readKeys, MAX_INPUT, MAX_KEYS, NO_KEY, TOO_LARGE, TOO_MANY, CERTIFICATE, CSR } from './read';
export { completeKey, checkRsa, WEAK_RSA, MISMATCH, MAX_RSA_BITS } from './complete';
export {
  spki,
  pkcs8,
  traditional,
  toPem,
  sshLine,
  opensshPrivate,
  jwkOf,
  publicForms,
  privateForms,
  publicText,
  privateText,
  privateFormLabel,
  fileName,
  fileType,
  FORM_LABELS,
} from './encode';
export { sshBlob } from './ssh';
export { fingerprints, thumbprint } from './fingerprint';
export type { Fingerprints } from './fingerprint';
export { md5 } from './md5';
export {
  generatePair,
  supported,
  generationOf,
  ALGORITHMS,
  ALGORITHM_LABELS,
  RSA_SIZES,
  RSA_JWK_ALGS,
  UNSUPPORTED,
  newCheckint,
} from './generate';
export type { Algorithm, RsaSize, RsaJwkAlg, GenerateOptions } from './generate';
export { describe, kindWords, publicOnly } from './describe';
export { detectKeys, DETECT_MAX } from './detect';
