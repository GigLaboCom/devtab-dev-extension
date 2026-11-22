/**
 * `detectX509` (docs/tools/specs/x509.md §7) in a module of its own: the ui package's `./detect` re-exports it, and a
 * host loads every tool's `detect` together, lazily. A substring search, nothing more: no table, no decoding. A request
 * (`-----BEGIN CERTIFICATE REQUEST-----`), a key or bare Base64 is not recognised.
 */
const MARKERS = [
  '-----BEGIN CERTIFICATE-----',
  '-----BEGIN X509 CERTIFICATE-----',
  '-----BEGIN X.509 CERTIFICATE-----',
  '-----BEGIN TRUSTED CERTIFICATE-----',
];

export const detectX509 = (text: string): boolean => MARKERS.some(m => text.includes(m));
