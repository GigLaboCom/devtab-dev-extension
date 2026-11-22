/**
 * The names the tool gives object identifiers (docs/tools/specs/x509.md §5.5, §5.6, §5.8). Data only, loaded with the
 * tool's page — never with `detect` or the definition.
 */

/** Name attributes (§5.5): the short name RFC 4514 writes (absent: the OID) and the table's label. */
export const ATTRIBUTES: Record<string, { short?: string; label: string }> = {
  '2.5.4.3': { short: 'CN', label: 'Common name' },
  '2.5.4.6': { short: 'C', label: 'Country' },
  '2.5.4.8': { short: 'ST', label: 'State or province' },
  '2.5.4.7': { short: 'L', label: 'Locality' },
  '2.5.4.10': { short: 'O', label: 'Organization' },
  '2.5.4.11': { short: 'OU', label: 'Organizational unit' },
  '2.5.4.9': { short: 'STREET', label: 'Street' },
  '0.9.2342.19200300.100.1.25': { short: 'DC', label: 'Domain component' },
  '0.9.2342.19200300.100.1.1': { short: 'UID', label: 'User ID' },
  '2.5.4.5': { label: 'Serial number' },
  '2.5.4.4': { label: 'Surname' },
  '2.5.4.42': { label: 'Given name' },
  '2.5.4.12': { label: 'Title' },
  '2.5.4.15': { label: 'Business category' },
  '2.5.4.17': { label: 'Postal code' },
  '2.5.4.97': { label: 'Organization identifier' },
  '1.2.840.113549.1.9.1': { label: 'Email' },
  '1.3.6.1.4.1.311.60.2.1.1': { label: 'Jurisdiction locality' },
  '1.3.6.1.4.1.311.60.2.1.2': { label: 'Jurisdiction state' },
  '1.3.6.1.4.1.311.60.2.1.3': { label: 'Jurisdiction country' },
};

/** Signature algorithms (§5.6). RSASSA-PSS gets its hash from the parameters (certificate.ts). */
export const SIGNATURE_ALGORITHMS: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'RSA PKCS#1 v1.5 with MD5',
  '1.2.840.113549.1.1.5': 'RSA PKCS#1 v1.5 with SHA-1',
  '1.2.840.113549.1.1.14': 'RSA PKCS#1 v1.5 with SHA-224',
  '1.2.840.113549.1.1.11': 'RSA PKCS#1 v1.5 with SHA-256',
  '1.2.840.113549.1.1.12': 'RSA PKCS#1 v1.5 with SHA-384',
  '1.2.840.113549.1.1.13': 'RSA PKCS#1 v1.5 with SHA-512',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.4.1': 'ECDSA with SHA-1',
  '1.2.840.10045.4.3.1': 'ECDSA with SHA-224',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
};

/** Signature algorithms §5.6 calls no longer secure: MD5 and SHA-1. */
export const WEAK_SIGNATURES = new Set(['1.2.840.113549.1.1.4', '1.2.840.113549.1.1.5', '1.2.840.10045.4.1']);

/** Hashes of RSASSA-PSS parameters (RFC 4055 §2.1). */
export const HASHES: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.4': 'SHA-224',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

/** Named curves of id-ecPublicKey (§5.6). */
export const CURVES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
  '1.3.36.3.3.2.8.1.1.11': 'brainpoolP384r1',
  '1.3.36.3.3.2.8.1.1.13': 'brainpoolP512r1',
};

/** Public key algorithms shown by name alone (§5.6); RSA, RSA-PSS, EC and DSA are read further. */
export const KEY_NAMES: Record<string, string> = {
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
  '2.16.840.1.101.3.4.4.1': 'ML-KEM-512',
  '2.16.840.1.101.3.4.4.2': 'ML-KEM-768',
  '2.16.840.1.101.3.4.4.3': 'ML-KEM-1024',
};

export const RSA = '1.2.840.113549.1.1.1';
export const RSA_PSS = '1.2.840.113549.1.1.10';
export const EC = '1.2.840.10045.2.1';
export const DSA = '1.2.840.10040.4.1';

/** Extensions (§5.8) by OID: their names; the decoders are in extensions.ts. */
export const EXTENSIONS: Record<string, string> = {
  '2.5.29.19': 'Basic constraints',
  '2.5.29.15': 'Key usage',
  '2.5.29.37': 'Extended key usage',
  '2.5.29.17': 'Subject alternative names',
  '2.5.29.18': 'Issuer alternative names',
  '2.5.29.14': 'Subject key identifier',
  '2.5.29.35': 'Authority key identifier',
  '2.5.29.31': 'CRL distribution points',
  '1.3.6.1.5.5.7.1.1': 'Authority information access',
  '2.5.29.32': 'Certificate policies',
  '2.5.29.30': 'Name constraints',
  '1.3.6.1.4.1.11129.2.4.2': 'Signed certificate timestamps',
  '1.3.6.1.4.1.11129.2.4.3': 'Precertificate poison',
  '1.3.6.1.5.5.7.1.24': 'TLS feature',
};

/** Key usage bits 0–8 (RFC 5280 §4.2.1.3). */
export const KEY_USAGE = [
  'Digital signature',
  'Content commitment',
  'Key encipherment',
  'Data encipherment',
  'Key agreement',
  'Certificate signing',
  'CRL signing',
  'Encipher only',
  'Decipher only',
];

/** Extended key usage purposes (RFC 5280 §4.2.1.12). */
export const KEY_PURPOSES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS server',
  '1.3.6.1.5.5.7.3.2': 'TLS client',
  '1.3.6.1.5.5.7.3.3': 'Code signing',
  '1.3.6.1.5.5.7.3.4': 'Email protection',
  '1.3.6.1.5.5.7.3.8': 'Time stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP signing',
  '2.5.29.37.0': 'Any',
};

/** Certificate policies with a name (§5.8). */
export const POLICIES: Record<string, string> = {
  '2.23.140.1.2.1': 'Domain validated',
  '2.23.140.1.2.2': 'Organization validated',
  '2.23.140.1.2.3': 'Individual validated',
  '2.23.140.1.1': 'Extended validation',
  '2.5.29.32.0': 'Any policy',
};

export const CPS = '1.3.6.1.5.5.7.2.1';
export const USER_NOTICE = '1.3.6.1.5.5.7.2.2';

/** Access methods of authority information access (RFC 5280 §4.2.2.1). */
export const ACCESS_METHODS: Record<string, string> = {
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA issuers',
};

/** CRL reason flags, bits 0–8 (RFC 5280 §4.2.1.13); bit 0 is unused. */
export const REASONS = [
  'Unused',
  'Key compromise',
  'CA compromise',
  'Affiliation changed',
  'Superseded',
  'Cessation of operation',
  'Certificate hold',
  'Privilege withdrawn',
  'AA compromise',
];

/** TLS feature extension values (RFC 7633, IANA TLS ExtensionType). */
export const TLS_FEATURES: Record<string, string> = {
  '5': 'status_request (OCSP Must-Staple)',
  '17': 'status_request_v2',
};
