/**
 * The fingerprints people compare (docs/tools/specs/keys.md §5.7): OpenSSH's `SHA256:` (Base64 without padding of the
 * SHA-256 of the public key blob) and legacy `MD5:` (lowercase hex pairs with colons), the SHA-256 of the DER SPKI in
 * hex (as `openssl dgst -sha256`) and in Base64 (an RFC 7469 pin), and the RFC 7638 JWK thumbprint. SHA-256 is
 * Web Crypto's.
 */
import { base64url, utf8 } from './bytes';
import { jwkMembers, spki } from './encode';
import { md5 } from './md5';
import { sshBlob } from './ssh';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { KeyData } from './types';

export interface Fingerprints {
  /** `SHA256:…`; null for X25519 (no OpenSSH form). */
  sha256: string | null;
  /** `MD5:aa:bb:…`; null for X25519. */
  md5: string | null;
  spkiHex: string;
  spkiBase64: string;
  thumbprint: string;
}

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));

/** RFC 7638 §3.2: the required members in lexicographic order, no whitespace; SHA-256; Base64url. */
export const thumbprintInput = (data: KeyData): string => {
  const m = jwkMembers(data, false);
  const required =
    data.type === 'rsa' ? ['e', 'kty', 'n'] : data.type === 'ec' ? ['crv', 'kty', 'x', 'y'] : ['crv', 'kty', 'x'];
  return `{${required.map(k => `${JSON.stringify(k)}:${JSON.stringify(m[k])}`).join(',')}}`;
};

export const thumbprint = async (data: KeyData): Promise<string> =>
  base64url(await sha256(utf8(thumbprintInput(data))));

export const fingerprints = async (data: KeyData): Promise<Fingerprints> => {
  const der = spki(data);
  const blob = sshBlob(data);
  const spkiHash = await sha256(der);
  return {
    sha256: blob ? `SHA256:${bytesToBase64(await sha256(blob), { padding: false })}` : null,
    md5: blob ? `MD5:${bytesToHex(md5(blob), { format: 'colons' })}` : null,
    spkiHex: bytesToHex(spkiHash),
    spkiBase64: bytesToBase64(spkiHash),
    thumbprint: await thumbprint(data),
  };
};
