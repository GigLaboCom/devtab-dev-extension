/**
 * Two or more certificates (docs/tools/specs/x509.md §5.9): whether each one's issuer is the next one's subject, byte
 * for byte. Names only — no signature is checked and nothing is trusted; the order is kept as pasted.
 */
import type { Certificate } from './certificate';

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** For every certificate but the last: issuer(i) == subject(i + 1). */
export const chainLinks = (certificates: Certificate[]): boolean[] =>
  certificates.slice(0, -1).map((c, i) => same(c.issuer.der, certificates[i + 1]!.subject.der));

/** The chain line of certificate `index` (0-based) in a list of `count`; none for the last. */
export const chainText = (links: boolean[], index: number): string | undefined =>
  index >= links.length
    ? undefined
    : links[index]
      ? `Issued by certificate ${index + 2} (names match; signature not checked)`
      : 'The next certificate did not issue this one (names differ).';
