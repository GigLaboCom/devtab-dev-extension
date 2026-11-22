/**
 * Words about a key (docs/tools/specs/keys.md §5.6) and what the history keeps of what was read (§11): the public key
 * in the same family of forms — OpenSSH lines stay lines, a JWK or a JWK Set stays JWK without its private members, PEM
 * and DER become SPKI PEM (an RSA PUBLIC KEY stays one), a private key becomes its public key.
 */
import { bitLength, toBigInt } from './bytes';
import { jwkMembers, metaOf, pkcs1Public, sshLine, spki, toPem } from './encode';
import { ALGORITHM_LABELS } from './generate';
import { isPrivate } from './types';
import type { KeyData, ReadKey, SourceForm } from './types';

const SOURCE_WORDS: Record<SourceForm, string> = {
  spki: 'SPKI',
  pkcs1: 'PKCS#1',
  pkcs8: 'PKCS#8',
  sec1: 'SEC1',
  openssh: 'OpenSSH',
  rfc4716: 'RFC 4716',
  jwk: 'JWK',
  jwks: 'JWK Set',
  der: 'Base64 DER',
  generated: 'generated',
};

/** `RSA 2048-bit`, `EC P-256`, `Ed25519`. */
export const kindWords = (data: KeyData): string =>
  data.type === 'rsa' ? `RSA ${bitLength(data.n)}-bit` : data.type === 'ec' ? `EC ${data.curve}` : data.curve;

export const describe = (key: ReadKey): string => {
  const data = key.data;
  if (key.source === 'generated') {
    const label =
      data.type === 'rsa'
        ? `RSA ${bitLength(data.n)}-bit`
        : data.type === 'ec'
          ? ALGORITHM_LABELS[data.curve]
          : data.curve;
    return `${label} key pair`;
  }
  const side = isPrivate(data) ? 'private' : 'public';
  const source = key.source === 'der' ? `${isPrivate(data) ? 'PKCS#8' : 'SPKI'}, Base64 DER` : SOURCE_WORDS[key.source];
  const parts = [`${kindWords(data)} ${side} key (${source})`];
  if (data.type === 'rsa') parts.push(`exponent ${toBigInt(data.e)}`);
  if (key.jwk?.kid !== undefined) parts.push(`kid ${JSON.stringify(key.jwk.kid)}`);
  if (key.comment) parts.push(`comment ${JSON.stringify(key.comment)}`);
  return parts.join(', ');
};

/** The public-only text of the keys read, as the history keeps it (§11); the keys must be complete. */
export const publicOnly = (keys: readonly ReadKey[]): string => {
  if (keys.length === 0) return '';
  const jwks = keys.every(k => k.source === 'jwks');
  if (jwks || (keys.length === 1 && keys[0]!.source === 'jwk')) {
    const members = keys.map(k => jwkMembers(k.data, false, metaOf(k)));
    return JSON.stringify(jwks ? { keys: members } : members[0], null, 2);
  }
  return keys
    .map(k => {
      if (k.source === 'openssh' || k.source === 'rfc4716' || k.source === 'generated') {
        const line = sshLine(k.data, k.comment);
        if (line) return `${line}\n`;
      }
      if (k.source === 'pkcs1' && k.data.type === 'rsa' && !isPrivate(k.data))
        return toPem(pkcs1Public(k.data), 'RSA PUBLIC KEY');
      return toPem(spki(k.data), 'PUBLIC KEY');
    })
    .join('');
};
