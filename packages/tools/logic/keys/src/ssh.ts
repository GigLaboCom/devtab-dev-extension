/**
 * The SSH wire format (RFC 4251 §5: uint32, string, mpint) and the key blobs and files built on it
 * (docs/tools/specs/keys.md §5.4, §5.5): public key blobs (RFC 4253 §6.6 ssh-rsa, RFC 5656 §3.1 ecdsa-sha2-*, RFC 8709
 * §4 ssh-ed25519) and OpenSSH's private key file `openssh-key-v1` (PROTOCOL.key), unencrypted. Reading is strict: a
 * field never runs past the data, nothing follows the last field, an mpint is in its shortest form and not negative.
 */
import { concat, equal, fromBigInt, padTo, stripZeros, toBigInt, utf8 } from './bytes';
import { FIELD_BYTES, SSH_CURVE } from './oids';
import type { Curve, KeyData } from './types';

export class SshReader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get left(): number {
    return this.bytes.length - this.at;
  }

  uint32(field: string): number {
    if (this.left < 4) throw new SshError(`The key data ends inside its "${field}" field (truncated?).`);
    const b = this.bytes;
    const v = ((b[this.at]! << 24) >>> 0) + (b[this.at + 1]! << 16) + (b[this.at + 2]! << 8) + b[this.at + 3]!;
    this.at += 4;
    return v;
  }

  string(field: string): Uint8Array {
    const n = this.uint32(field);
    if (n > this.left) throw new SshError(`The key data ends inside its "${field}" field (truncated?).`);
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  text(field: string): string {
    return new TextDecoder().decode(this.string(field));
  }

  /** An mpint (RFC 4251 §5) that must be positive or zero, in its shortest form; returned without its sign byte. */
  mpint(field: string): Uint8Array {
    const v = this.string(field);
    if (v.length > 0 && v[0]! >= 0x80) throw new SshError(`The key data's "${field}" is negative.`);
    if (v.length > 1 && v[0] === 0 && v[1]! < 0x80)
      throw new SshError(`The key data's "${field}" has a needless leading zero.`);
    return v.length === 0 ? Uint8Array.of(0) : stripZeros(v);
  }

  raw(n: number, field: string): Uint8Array {
    if (n > this.left) throw new SshError(`The key data ends inside its "${field}" field (truncated?).`);
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
}

export class SshError extends Error {}

const u32 = (n: number): Uint8Array => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
export const sshString = (bytes: Uint8Array | string): Uint8Array => {
  const b = typeof bytes === 'string' ? utf8(bytes) : bytes;
  return concat(u32(b.length), b);
};
export const sshMpint = (bytes: Uint8Array): Uint8Array => {
  const v = stripZeros(bytes);
  if (v.length === 1 && v[0] === 0) return u32(0);
  return sshString(v[0]! >= 0x80 ? concat(Uint8Array.of(0), v) : v);
};

export const sshType = (data: KeyData): string | null =>
  data.type === 'rsa'
    ? 'ssh-rsa'
    : data.type === 'ec'
      ? `ecdsa-sha2-${SSH_CURVE[data.curve]}`
      : data.curve === 'Ed25519'
        ? 'ssh-ed25519'
        : null;

const point = (curve: Curve, x: Uint8Array, y: Uint8Array): Uint8Array =>
  concat(Uint8Array.of(4), padTo(x, FIELD_BYTES[curve])!, padTo(y, FIELD_BYTES[curve])!);

/** The public key blob; null for X25519 (SSH has no X25519 keys). Needs the public part (OKP `x`). */
export const sshBlob = (data: KeyData): Uint8Array | null => {
  const type = sshType(data);
  if (!type) return null;
  if (data.type === 'rsa') return concat(sshString(type), sshMpint(data.e), sshMpint(data.n));
  if (data.type === 'ec')
    return data.x && data.y
      ? concat(sshString(type), sshString(SSH_CURVE[data.curve]), sshString(point(data.curve, data.x, data.y)))
      : null;
  return data.x ? concat(sshString(type), sshString(data.x)) : null;
};

/** What a blob's type string names, for the refusals of §6. */
const unsupportedType = (type: string): string | null => {
  if (type === 'ssh-dss')
    return 'DSA keys are not supported: the tool reads RSA, EC P-256, P-384, P-521, Ed25519 and X25519.';
  if (type.startsWith('sk-'))
    return 'Security-key (FIDO) keys are not supported: their private part lives on the device.';
  if (type.includes('-cert-v01@openssh.com')) return 'This is an OpenSSH certificate, not a public key line.';
  if (type === 'ssh-ed448') return "Ed448 keys are not supported: the browser's Web Crypto has no Ed448.";
  return null;
};

export const KNOWN_TYPES = [
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
];

const curveOfSsh = (name: string): Curve | undefined =>
  (Object.keys(SSH_CURVE) as Curve[]).find(c => SSH_CURVE[c] === name);

/** The public fields of a key of `type` from the reader (after the type string). */
const readPublicFields = (type: string, r: SshReader): KeyData => {
  if (type === 'ssh-ed25519') {
    const x = r.string('public key');
    if (x.length !== 32) throw new SshError(`The key data's Ed25519 public key is ${x.length} bytes; it needs 32.`);
    return { type: 'okp', curve: 'Ed25519', x };
  }
  if (type === 'ssh-rsa') {
    const e = r.mpint('e');
    const n = r.mpint('n');
    return { type: 'rsa', n, e };
  }
  const curve = curveOfSsh(type.slice('ecdsa-sha2-'.length));
  if (!curve) throw new SshError(`Unknown key type "${type}".`);
  const name = r.text('curve');
  if (name !== SSH_CURVE[curve]) throw new SshError(`The key data names the curve "${name}", but the type is ${type}.`);
  const q = r.string('point');
  const size = FIELD_BYTES[curve];
  if (q.length === size + 1 && (q[0] === 2 || q[0] === 3))
    throw new SshError("The key's point is compressed; only uncompressed points (04…) are read.");
  if (q.length !== 2 * size + 1 || q[0] !== 4)
    throw new SshError(`The key data's point is not an uncompressed ${curve} point.`);
  return { type: 'ec', curve, x: q.slice(1, 1 + size), y: q.slice(1 + size) };
};

/** A public key blob, its type checked against `expected` (the line's own type) when given. */
export const readSshBlob = (blob: Uint8Array, expected?: string): KeyData => {
  const r = new SshReader(blob);
  const type = r.text('type');
  const refused = unsupportedType(type);
  if (refused) throw new SshError(refused);
  if (!KNOWN_TYPES.includes(type)) throw new SshError(`Unknown key type "${type}".`);
  if (expected !== undefined && expected !== type)
    throw new SshError(`The line says ${expected}, but the key inside is ${type}.`);
  const data = readPublicFields(type, r);
  if (r.left > 0)
    throw new SshError(`The key data has ${r.left} ${r.left === 1 ? 'byte' : 'bytes'} after its last field.`);
  return data;
};

export { unsupportedType };

const MAGIC = utf8('openssh-key-v1\0');

/**
 * openssh-key-v1, unencrypted (cipher and KDF `none`), one key: the public blob, then the private section — the same
 * `checkint` twice, the key's type and fields, the comment, padding 1, 2, 3, … to a multiple of 8. Lines of 70
 * characters, as ssh-keygen writes. Null for X25519.
 */
export const opensshPrivateBytes = (data: KeyData, comment: string, checkint: number): Uint8Array | null => {
  const blob = sshBlob(data);
  const type = sshType(data);
  if (!blob || !type) return null;
  let fields: Uint8Array;
  if (data.type === 'rsa') {
    const p = data.priv;
    if (!p) return null;
    fields = concat(sshMpint(data.n), sshMpint(data.e), sshMpint(p.d), sshMpint(p.qi), sshMpint(p.p), sshMpint(p.q));
  } else if (data.type === 'ec') {
    if (!data.d || !data.x || !data.y) return null;
    fields = concat(sshString(SSH_CURVE[data.curve]), sshString(point(data.curve, data.x, data.y)), sshMpint(data.d));
  } else {
    if (!data.d || !data.x) return null;
    fields = concat(sshString(data.x), sshString(concat(data.d, data.x)));
  }
  const body = concat(u32(checkint), u32(checkint), sshString(type), fields, sshString(comment));
  const pad = (8 - (body.length % 8)) % 8;
  const padding = Uint8Array.from({ length: pad }, (_, i) => i + 1);
  const section = concat(body, padding);
  return concat(
    MAGIC,
    sshString('none'),
    sshString('none'),
    sshString(new Uint8Array(0)),
    u32(1),
    sshString(blob),
    sshString(section),
  );
};

export type OpensshFile =
  | { encrypted: false; data: KeyData; comment: string; storedPublic?: Uint8Array }
  | { encrypted: true; cipher: string; kdf: string };

/** openssh-key-v1 (§5.5): encrypted files are named, not opened; unencrypted ones checked field by field. */
export const readOpensshPrivate = (bytes: Uint8Array): OpensshFile => {
  if (bytes.length < MAGIC.length || !equal(bytes.subarray(0, MAGIC.length), MAGIC))
    throw new SshError('The OPENSSH PRIVATE KEY block does not start with "openssh-key-v1".');
  const r = new SshReader(bytes.subarray(MAGIC.length));
  const cipher = r.text('cipher');
  const kdf = r.text('kdf');
  r.string('kdf options');
  if (cipher !== 'none' || kdf !== 'none') return { encrypted: true, cipher, kdf };
  const count = r.uint32('number of keys');
  if (count !== 1) throw new SshError(`The OpenSSH file holds ${count} keys; the tool reads files with one.`);
  const blob = r.string('public key');
  const section = r.string('private section');
  if (r.left > 0) throw new SshError(`The OpenSSH file has ${r.left} bytes after its private section.`);
  const pub = readSshBlob(blob);
  const s = new SshReader(section);
  const check1 = s.uint32('checkint');
  const check2 = s.uint32('checkint');
  if (check1 !== check2)
    throw new SshError("The OpenSSH file's two check numbers differ (a damaged or wrongly decrypted file).");
  const type = s.text('type');
  if (type !== new SshReader(blob).text('type'))
    throw new SshError(`The OpenSSH file's private part is ${type}, its public part is not.`);
  let data: KeyData;
  if (type === 'ssh-ed25519') {
    const x = s.string('public key');
    const both = s.string('private key');
    if (x.length !== 32 || both.length !== 64)
      throw new SshError("The OpenSSH file's Ed25519 key has the wrong length.");
    if (!equal(both.subarray(32), x))
      throw new SshError('The public key stored with this private key does not belong to it.');
    data = { type: 'okp', curve: 'Ed25519', x, d: both.slice(0, 32) };
  } else if (type === 'ssh-rsa') {
    const n = s.mpint('n');
    const e = s.mpint('e');
    const d = s.mpint('d');
    const qi = s.mpint('iqmp');
    const p = s.mpint('p');
    const q = s.mpint('q');
    data = { type: 'rsa', n, e, priv: { d, p, q, qi, ...crtExponents(d, p, q) } };
  } else {
    const pubFields = readPublicFields(type, s) as Extract<KeyData, { type: 'ec' }>;
    const d = padTo(s.mpint('d'), FIELD_BYTES[pubFields.curve]);
    if (!d) throw new SshError(`The OpenSSH file's private scalar is longer than a ${pubFields.curve} scalar.`);
    data = { ...pubFields, d };
  }
  const comment = s.text('comment');
  const pad = s.left;
  if (pad >= 8) throw new SshError("The OpenSSH file's private section has more padding than one block.");
  const tail = s.raw(pad, 'padding');
  for (let i = 0; i < pad; i++)
    if (tail[i] !== i + 1) throw new SshError("The OpenSSH file's padding is not 1, 2, 3, ….");
  // The public blob must be the public part of the private section.
  const own = sshBlob(data);
  if (!own || !equal(own, sshBlob(pub)!))
    throw new SshError('The public key stored with this private key does not belong to it.');
  return { encrypted: false, data, comment };
};

/** dp = d mod (p − 1), dq = d mod (q − 1): OpenSSH stores neither, PKCS#1 and JWK need both. */
export const crtExponents = (d: Uint8Array, p: Uint8Array, q: Uint8Array): { dp: Uint8Array; dq: Uint8Array } => {
  const D = toBigInt(d);
  const P = toBigInt(p);
  const Q = toBigInt(q);
  if (P < 2n || Q < 2n) return { dp: Uint8Array.of(0), dq: Uint8Array.of(0) };
  return { dp: fromBigInt(D % (P - 1n)), dq: fromBigInt(D % (Q - 1n)) };
};
