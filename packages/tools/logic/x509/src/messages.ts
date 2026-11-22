/** What the tool says (docs/tools/specs/x509.md §2, §3, §5, §6, §8), word for word where the specification gives it. */

export const NO_CERTIFICATE =
  'No certificate found. Paste a PEM block (-----BEGIN CERTIFICATE-----) or Base64 DER, or open a .crt / .der file.';
export const PRIVATE_KEY_BLOCK =
  'A private key block was ignored. This tool never reads private keys; remove it from the field.';
export const PRIVATE_KEY_PASTED =
  'This is a private key; it was not read. This tool never reads private keys; remove it from the field.';
export const PRIVATE_KEY_FILE = 'This file is a private key; it was not read. This tool never reads private keys.';
export const CSR = 'Certificate requests (CSR) are not supported.';
export const ONLY_FIRST = (n: number): string => `Only the first ${n} certificates are shown.`;
export const ONLY_FIRST_BLOCKS = (n: number): string => `Only the first ${n} PEM blocks were read.`;
export const FILE_TOO_LARGE = 'This file is larger than 1 MB; certificates are much smaller.';
export const TEXT_TOO_LARGE = 'The text is larger than 1 MB; certificates are much smaller.';
export const TRUST_SETTINGS = 'OpenSSL trust settings after the certificate are not shown.';
export const NOT_A_CERTIFICATE = 'this is not a certificate (expected a SEQUENCE of three elements)';
export const TRUNCATED_HINT = ' (truncated certificate?)';
export const COULD_NOT_DECODE = 'Could not decode this extension.';
export const NOT_RFC5280_TIME = 'Not a valid RFC 5280 time';
export const NO_EXPIRY = 'No expiration date (99991231235959Z, RFC 5280 §4.1.2.5).';
export const POISON = 'This is a precertificate for Certificate Transparency, not a usable certificate.';
export const EMPTY_NAME = '(empty)';
export const NO_EXTENSIONS = 'No extensions';
export const HINT = 'This tool reads certificates. It does not check signatures, trust or revocation.';
export const EMPTY_STATE = 'Paste a certificate or open a .pem, .crt, .cer or .der file.';
export const PLACEHOLDER = '-----BEGIN CERTIFICATE-----';

export const skippedBlock = (label: string): string => `A "${label}" block is not a certificate; it was skipped.`;
export const noEndLine = (label: string): string => `The ${label} block has no END line.`;
export const notBase64 = (label: string): string => `The ${label} block is not valid Base64.`;
export const emptyBlock = (label: string): string => `The ${label} block is empty.`;
export const wrongEnd = (label: string, end: string): string =>
  `The ${label} block ends with an END line for "${end}".`;
export const extraBytes = (n: number): string =>
  `${n} extra ${n === 1 ? 'byte' : 'bytes'} after the certificate ${n === 1 ? 'was' : 'were'} ignored.`;

/** What a DER structure that is not a certificate is (a file, or Base64 without PEM lines). */
export const DER_PUBLIC_KEY = 'This is a public key (SubjectPublicKeyInfo), not a certificate.';
export const DER_CRL = 'This is a certificate revocation list (CRL), not a certificate.';
export const DER_PKCS7 =
  'This is a PKCS#7 bundle, which this tool does not open. To list its certificates as PEM: openssl pkcs7 -print_certs';
export const DER_PKCS12 = 'This is a PKCS#12 file (.p12 / .pfx), which may hold a private key; it was not read.';

export const WARN_NEGATIVE_SERIAL = 'The serial number is negative (RFC 5280 §4.1.2.2 requires a positive number).';
export const WARN_LONG_SERIAL = 'The serial number is longer than 20 bytes (RFC 5280 §4.1.2.2).';
export const WARN_ALGORITHMS_DIFFER = 'The two signature algorithm fields differ (RFC 5280 §4.1.1.2).';
export const WARN_WEAK_SIGNATURE = 'This signature algorithm is no longer considered secure.';
export const WARN_WEAK_RSA = 'RSA keys shorter than 2048 bits are considered weak.';
export const warnExtensionsInV = (version: number): string =>
  `This v${version} certificate has extensions; only v3 may have them (RFC 5280 §4.1.2.9).`;
export const warnTwice = (name: string): string => `The extension ${name} appears twice (RFC 5280 §4.2).`;
export const warnCriticalFalse = (name: string): string =>
  `The extension ${name} writes out "critical: false", a default value DER leaves out.`;
export const warnMalformedString = (field: string, problem: string): string =>
  `The ${field} has ${problem}; they are shown as they could be read.`;
