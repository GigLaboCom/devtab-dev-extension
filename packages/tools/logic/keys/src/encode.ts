/**
 * Every form of a key, written from its numbers (docs/tools/specs/keys.md §5.4, §5.9): SPKI, PKCS#1, PKCS#8, SEC1 —
 * DER through the small writer, PEM by RFC 7468 (64 characters a line) —, the OpenSSH public line and private file, and
 * JWK. A form a key has not (OpenSSH for X25519, PKCS#1 for EC) is not offered: `publicForms` / `privateForms`.
 */
import { base64url, concat, padTo } from './bytes';
import { bitString, explicitTag, nullValue, octetString, oid, sequence, smallInteger, unsigned } from './der-write';
import { CURVE_OIDS, FIELD_BYTES, OID } from './oids';
import { opensshPrivateBytes, sshBlob, sshType } from './ssh';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import type { JwkMeta, KeyData, PrivateForm, PublicForm, ReadKey } from './types';

const okpOid = (curve: 'Ed25519' | 'X25519'): string => (curve === 'Ed25519' ? OID.ed25519 : OID.x25519);

const ecPoint = (data: Extract<KeyData, { type: 'ec' }>): Uint8Array =>
  concat(Uint8Array.of(4), padTo(data.x!, FIELD_BYTES[data.curve])!, padTo(data.y!, FIELD_BYTES[data.curve])!);

export const pkcs1Public = (data: Extract<KeyData, { type: 'rsa' }>): Uint8Array =>
  sequence(unsigned(data.n), unsigned(data.e));

/** SubjectPublicKeyInfo (RFC 5280 §4.1.2.7; RFC 3279, RFC 5480, RFC 8410). Needs the public part. */
export const spki = (data: KeyData): Uint8Array => {
  if (data.type === 'rsa') return sequence(sequence(oid(OID.rsaEncryption), nullValue()), bitString(pkcs1Public(data)));
  if (data.type === 'ec')
    return sequence(sequence(oid(OID.ecPublicKey), oid(CURVE_OIDS[data.curve])), bitString(ecPoint(data)));
  if (!data.x) throw new Error('the public key is not known yet');
  return sequence(sequence(oid(okpOid(data.curve))), bitString(data.x));
};

/** RSAPrivateKey (RFC 8017 A.1.2). */
const pkcs1Private = (data: Extract<KeyData, { type: 'rsa' }>): Uint8Array => {
  const p = data.priv!;
  return sequence(
    smallInteger(0),
    unsigned(data.n),
    unsigned(data.e),
    unsigned(p.d),
    unsigned(p.p),
    unsigned(p.q),
    unsigned(p.dp),
    unsigned(p.dq),
    unsigned(p.qi),
  );
};

/** ECPrivateKey (RFC 5915 §3): with `[0]` parameters for SEC1's own file, without them inside PKCS#8 (as Chrome). */
const ecPrivate = (data: Extract<KeyData, { type: 'ec' }>, withParameters: boolean): Uint8Array =>
  sequence(
    smallInteger(1),
    octetString(padTo(data.d!, FIELD_BYTES[data.curve])!),
    ...(withParameters ? [explicitTag(0, oid(CURVE_OIDS[data.curve]))] : []),
    explicitTag(1, bitString(ecPoint(data))),
  );

/** PrivateKeyInfo v1 (RFC 5208; RFC 8410 §7 for Ed25519 and X25519 — the 32 bytes in an OCTET STRING, no public key). */
export const pkcs8 = (data: KeyData): Uint8Array => {
  if (data.type === 'rsa')
    return sequence(smallInteger(0), sequence(oid(OID.rsaEncryption), nullValue()), octetString(pkcs1Private(data)));
  if (data.type === 'ec')
    return sequence(
      smallInteger(0),
      sequence(oid(OID.ecPublicKey), oid(CURVE_OIDS[data.curve])),
      octetString(ecPrivate(data, false)),
    );
  return sequence(smallInteger(0), sequence(oid(okpOid(data.curve))), octetString(octetString(data.d!)));
};

/** PKCS#1 RSAPrivateKey or SEC1 ECPrivateKey; null for Ed25519 and X25519 (they have no traditional form). */
export const traditional = (data: KeyData): Uint8Array | null =>
  data.type === 'rsa' ? pkcs1Private(data) : data.type === 'ec' ? ecPrivate(data, true) : null;

export const traditionalLabel = (data: KeyData): string => (data.type === 'rsa' ? 'RSA PRIVATE KEY' : 'EC PRIVATE KEY');

const wrap = (text: string, width: number): string => {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n');
};

/** RFC 7468 §2 (strict): 64 characters a line, `\n`, a line break after the END line. */
export const toPem = (der: Uint8Array, label: string): string =>
  `-----BEGIN ${label}-----\n${wrap(bytesToBase64(der), 64)}\n-----END ${label}-----\n`;

/** `type Base64 comment` (no comment: two fields, as ssh-keygen writes without one). Null for X25519. */
export const sshLine = (data: KeyData, comment?: string): string | null => {
  const blob = sshBlob(data);
  if (!blob) return null;
  const type = sshType(data)!;
  const c = comment?.replace(/[\r\n]+/g, ' ').trim();
  return `${type} ${bytesToBase64(blob)}${c ? ` ${c}` : ''}`;
};

export const opensshPrivate = (data: KeyData, comment: string, checkint: number): string | null => {
  const bytes = opensshPrivateBytes(data, comment.replace(/[\r\n]+/g, ' ').trim(), checkint);
  return bytes
    ? `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrap(bytesToBase64(bytes), 70)}\n-----END OPENSSH PRIVATE KEY-----\n`
    : null;
};

/** JWK members in the order of §5.4: kty and the key, then alg, use, key_ops, kid. */
export const jwkMembers = (
  data: KeyData,
  withPrivate: boolean,
  meta: JwkMeta = {},
): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  if (data.type === 'rsa') {
    out.kty = 'RSA';
    out.n = base64url(strip(data.n));
    out.e = base64url(strip(data.e));
    if (withPrivate && data.priv) {
      const p = data.priv;
      out.d = base64url(strip(p.d));
      out.p = base64url(strip(p.p));
      out.q = base64url(strip(p.q));
      out.dp = base64url(strip(p.dp));
      out.dq = base64url(strip(p.dq));
      out.qi = base64url(strip(p.qi));
    }
  } else if (data.type === 'ec') {
    const size = FIELD_BYTES[data.curve];
    out.kty = 'EC';
    out.crv = data.curve;
    if (data.x && data.y) {
      out.x = base64url(padTo(data.x, size)!);
      out.y = base64url(padTo(data.y, size)!);
    }
    if (withPrivate && data.d) out.d = base64url(padTo(data.d, size)!);
  } else {
    out.kty = 'OKP';
    out.crv = data.curve;
    if (data.x) out.x = base64url(data.x);
    if (withPrivate && data.d) out.d = base64url(data.d);
  }
  if (meta.alg !== undefined) out.alg = meta.alg;
  if (meta.use !== undefined) out.use = meta.use;
  if (meta.key_ops !== undefined) out.key_ops = meta.key_ops;
  if (meta.kid !== undefined) out.kid = meta.kid;
  return out;
};

/** RFC 7518 §6.3.1.1: an RSA number's Base64url has no leading zero octets (zero itself is one octet). */
const strip = (bytes: Uint8Array): Uint8Array => {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return bytes.subarray(i);
};

export const jwkOf = (data: KeyData, withPrivate: boolean, meta?: JwkMeta): string =>
  JSON.stringify(jwkMembers(data, withPrivate, meta), null, 2);

export const publicForms = (data: KeyData): PublicForm[] => [
  'pem',
  ...(data.type === 'rsa' ? (['pkcs1'] as const) : []),
  ...(data.type === 'okp' && data.curve === 'X25519' ? [] : (['openssh'] as const)),
  'jwk',
];

export const privateForms = (data: KeyData): PrivateForm[] => [
  'pkcs8',
  ...(data.type !== 'okp' ? (['traditional'] as const) : []),
  ...(data.type === 'okp' && data.curve === 'X25519' ? [] : (['openssh'] as const)),
  'jwk',
];

/** The JWK metadata a form carries: the source JWK's own, with `kid` added when asked and the key has none. */
export const metaOf = (key: ReadKey, kid?: string): JwkMeta => ({
  ...key.jwk,
  ...(key.jwk?.kid === undefined && kid !== undefined ? { kid } : {}),
});

export const publicText = (key: ReadKey, form: PublicForm, kid?: string): string => {
  const data = key.data;
  switch (form) {
    case 'pem':
      return toPem(spki(data), 'PUBLIC KEY');
    case 'pkcs1':
      return data.type === 'rsa' ? toPem(pkcs1Public(data), 'RSA PUBLIC KEY') : '';
    case 'openssh':
      return `${sshLine(data, key.comment) ?? ''}\n`;
    case 'jwk':
      return jwkOf(data, false, metaOf(key, kid));
  }
};

export const privateText = (key: ReadKey, form: PrivateForm, extra: { kid?: string; checkint: number }): string => {
  const data = key.data;
  switch (form) {
    case 'pkcs8':
      return toPem(pkcs8(data), 'PRIVATE KEY');
    case 'traditional': {
      const der = traditional(data);
      return der ? toPem(der, traditionalLabel(data)) : '';
    }
    case 'openssh':
      return opensshPrivate(data, key.comment ?? '', extra.checkint) ?? '';
    case 'jwk':
      return jwkOf(data, true, metaOf(key, extra.kid));
  }
};

export const FORM_LABELS: Record<PublicForm | PrivateForm, string> = {
  pem: 'PEM',
  pkcs1: 'PKCS#1',
  openssh: 'OpenSSH',
  jwk: 'JWK',
  pkcs8: 'PKCS#8',
  traditional: 'PKCS#1',
};

/** The traditional private form's label for this key: PKCS#1 (RSA) or SEC1 (EC). */
export const privateFormLabel = (data: KeyData, form: PrivateForm): string =>
  form === 'traditional' ? (data.type === 'ec' ? 'SEC1' : 'PKCS#1') : FORM_LABELS[form];

/** §5.9: the conventional file names. */
export const fileName = (data: KeyData, side: 'public' | 'private', form: PublicForm | PrivateForm): string => {
  const ssh = data.type === 'rsa' ? 'id_rsa' : data.type === 'ec' ? 'id_ecdsa' : 'id_ed25519';
  if (form === 'openssh') return side === 'public' ? `${ssh}.pub` : ssh;
  if (form === 'jwk') return side === 'public' ? 'public.jwk.json' : 'private.jwk.json';
  if (side === 'public') return form === 'pkcs1' ? 'public-rsa.pem' : 'public.pem';
  if (form === 'traditional') return data.type === 'ec' ? 'private-ec.pem' : 'private-rsa.pem';
  return 'private.pem';
};

export const fileType = (form: PublicForm | PrivateForm): string =>
  form === 'jwk' ? 'application/json' : 'text/plain';
