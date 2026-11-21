/** The five algorithms of docs/tools/specs/hash.md §5.1, in the order of the result rows. */
export type Algorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
/** The order of §5.1: the order of the result rows. */
export const ALGORITHMS: readonly Algorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
/** Digest length in bytes. */
export const DIGEST_BYTES: Readonly<Record<Algorithm, number>> = {
  MD5: 16,
  'SHA-1': 20,
  'SHA-256': 32,
  'SHA-384': 48,
  'SHA-512': 64,
};

export type Digests = Record<Algorithm, Uint8Array>;
