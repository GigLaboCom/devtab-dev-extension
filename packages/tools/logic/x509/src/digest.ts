/**
 * Fingerprints (docs/tools/specs/x509.md §5.6, §5.7): SHA-1 and SHA-256 of the certificate's DER as uppercase hex with
 * colons, the way browsers and `openssl x509 -fingerprint` show them; SHA-256 of subjectPublicKeyInfo in Base64, the
 * pin of RFC 7469 §2.4. WebCrypto only.
 */
import { hexColons } from './read';
import { bytesToBase64 } from '@workspace/tools-shared/base64';

const digest = async (algorithm: 'SHA-1' | 'SHA-256', bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(bytes)));

export const fingerprints = async (der: Uint8Array): Promise<{ sha1: string; sha256: string }> => {
  const [sha1, sha256] = await Promise.all([digest('SHA-1', der), digest('SHA-256', der)]);
  return { sha1: hexColons(sha1), sha256: hexColons(sha256) };
};

export const spkiSha256 = async (spkiDer: Uint8Array): Promise<string> =>
  bytesToBase64(await digest('SHA-256', spkiDer));
