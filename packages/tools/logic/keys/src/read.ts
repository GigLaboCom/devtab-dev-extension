/**
 * Pasted text to keys (docs/tools/specs/keys.md §3, §5.5, §6): PEM blocks, RFC 4716 blocks, a JWK or a JWK Set,
 * OpenSSH public key lines, or bare Base64 DER. Synchronous and without Web Crypto: what needs the browser (deriving a
 * public key, checking a point) is `completeKey`. Each key found is an item — read, or refused with a sentence — up to
 * MAX_KEYS.
 */
import {
  encryptionOf,
  KeyError,
  parseKeyDer,
  readPkcs1Private,
  readPkcs1Public,
  readPkcs8,
  readSec1,
  readSpki,
  SHAPE_WORDS,
} from './asn1';
import { readJwkNode, setMembers } from './jwk';
import { findBlocks, ssh2Comment } from './pem';
import { readOpensshPrivate, readSshBlob, SshError, unsupportedType } from './ssh';
import { parseBase64 } from '@workspace/tools-shared/base64';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import type { Shape } from './asn1';
import type { PemBlock } from './pem';
import type { ReadItem, ReadKey, ReadResult, SourceForm } from './types';

/** Text larger than this is refused (§12). */
export const MAX_INPUT = 1_048_576;
/** Keys shown at most (§3). */
export const MAX_KEYS = 20;

export const TOO_LARGE = 'The text is larger than 1 MB; keys are much smaller.';
export const NO_KEY =
  'No key found. Paste a PEM block (-----BEGIN PUBLIC KEY-----), a JWK, a JWK Set or an OpenSSH public key line.';
export const CERTIFICATE =
  'This is a certificate, not a key. The X.509 Certificate tool reads certificates and shows their public key.';
export const CSR = 'This is a certificate request (CSR), not a key.';
export const NOT_DECRYPTED = 'This tool does not decrypt keys: nothing of it was read.';
export const TOO_MANY = `Only the first ${MAX_KEYS} keys are shown.`;
const DSA = 'DSA keys are not supported: the tool reads RSA, EC P-256, P-384, P-521, Ed25519 and X25519.';

const fail = (message: string): ReadItem => ({ ok: false, message });

/** What each label must hold. */
const EXPECTED: Record<string, { shape: Shape; source: SourceForm }> = {
  'PUBLIC KEY': { shape: 'spki', source: 'spki' },
  'RSA PUBLIC KEY': { shape: 'pkcs1-public', source: 'pkcs1' },
  'PRIVATE KEY': { shape: 'pkcs8', source: 'pkcs8' },
  'RSA PRIVATE KEY': { shape: 'pkcs1-private', source: 'pkcs1' },
  'EC PRIVATE KEY': { shape: 'sec1', source: 'sec1' },
};

/** A key's DER of a known shape, read. */
const readDer = (
  der: Uint8Array,
  shape: Shape,
  root: ReturnType<typeof parseKeyDer>['root'],
  source: SourceForm,
): ReadKey => {
  switch (shape) {
    case 'spki':
      return { data: readSpki(der, root), source, notes: [] };
    case 'pkcs1-public':
      return { data: readPkcs1Public(der, root), source, notes: [] };
    case 'pkcs1-private':
      return { data: readPkcs1Private(der, root), source, notes: [] };
    case 'pkcs8': {
      const r = readPkcs8(der, root);
      return { data: r.data, source, notes: r.notes, ...(r.storedPublic ? { storedPublic: r.storedPublic } : {}) };
    }
    case 'sec1': {
      const r = readSec1(der, root);
      return { data: r.data, source, notes: [], ...(r.storedPublic ? { storedPublic: r.storedPublic } : {}) };
    }
    case 'certificate':
      throw new KeyError(CERTIFICATE);
    case 'csr':
      throw new KeyError(CSR);
    case 'dsa-private':
      throw new KeyError(DSA);
    case 'encrypted-pkcs8':
      throw new KeyError(
        `This private key is encrypted with a password (PKCS#8, ${encryptionOf(der, root)}). ${NOT_DECRYPTED}`,
      );
    default:
      throw new KeyError(NO_KEY);
  }
};

const decodeBody = (block: PemBlock): Uint8Array => {
  if (block.body.trim() === '') throw new KeyError(`The ${block.label} block is empty.`);
  const parsed = parseBase64(block.body);
  if (!parsed.ok) {
    const e = parsed.error;
    throw new KeyError(
      `The ${block.label} block is not valid Base64. Line ${block.bodyLine + e.line - 1}, column ${e.column}: ${e.message}.`,
    );
  }
  return parsed.bytes;
};

const readBlock = (block: PemBlock): ReadItem | null => {
  const label = block.label;
  if (label === 'EC PARAMETERS') return null;
  try {
    if (/CERTIFICATE REQUEST$/.test(label)) throw new KeyError(CSR);
    if (/CERTIFICATE$/.test(label)) throw new KeyError(CERTIFICATE);
    if (block.problem === 'no-end') throw new KeyError(`The ${label} block has no END line.`);
    if (block.problem === 'end-mismatch')
      throw new KeyError(`The ${label} block ends with an END line for "${block.endLabel}".`);
    const procType = block.headers.find(h => h.name.toLowerCase() === 'proc-type');
    if (procType && /ENCRYPTED/i.test(procType.value)) {
      const dek = block.headers
        .find(h => h.name.toLowerCase() === 'dek-info')
        ?.value.split(',')[0]
        ?.trim();
      throw new KeyError(
        `This ${label} is encrypted with a password${dek ? ` (DEK-Info: ${dek})` : ''}. ${NOT_DECRYPTED}`,
      );
    }
    if (block.kind === 'ssh2') {
      const data = readSshBlob(decodeBody(block));
      const comment = ssh2Comment(block);
      return { ok: true, key: { data, source: 'rfc4716', notes: [], ...(comment ? { comment } : {}) } };
    }
    if (label === 'ENCRYPTED PRIVATE KEY') {
      const der = decodeBody(block);
      const { root } = parseKeyDer(der, ` in the ${label} block`);
      throw new KeyError(
        `This private key is encrypted with a password (PKCS#8, ${encryptionOf(der, root)}). ${NOT_DECRYPTED}`,
      );
    }
    if (label === 'OPENSSH PRIVATE KEY') {
      const file = readOpensshPrivate(decodeBody(block));
      if (file.encrypted)
        throw new KeyError(
          `This OpenSSH private key is encrypted with a passphrase (${file.cipher}, ${file.kdf}). ${NOT_DECRYPTED}`,
        );
      const storedPublic = file.data.type === 'rsa' ? undefined : file.data.x;
      return {
        ok: true,
        key: {
          data: file.data,
          source: 'openssh',
          notes: [],
          ...(file.comment ? { comment: file.comment } : {}),
          ...(storedPublic ? { storedPublic } : {}),
        },
      };
    }
    if (label === 'DSA PRIVATE KEY' || label === 'DSA PUBLIC KEY') throw new KeyError(DSA);
    if (label.includes('PGP')) throw new KeyError('PGP keys are not supported.');
    const expected = EXPECTED[label];
    if (!expected) throw new KeyError(`A "${label}" block is not a key this tool reads.`);
    const der = decodeBody(block);
    const { root, shape } = parseKeyDer(der, ` in the ${label} block`);
    if (shape === 'certificate') throw new KeyError(CERTIFICATE);
    if (shape === 'csr') throw new KeyError(CSR);
    if (shape === 'encrypted-pkcs8') return { ok: true, key: readDer(der, shape, root, expected.source) };
    if (shape !== expected.shape)
      throw new KeyError(`The ${label} block holds ${SHAPE_WORDS[shape]}, not ${SHAPE_WORDS[expected.shape]}.`);
    return { ok: true, key: readDer(der, shape, root, expected.source) };
  } catch (error) {
    if (error instanceof KeyError || error instanceof SshError) return fail(error.message);
    throw error;
  }
};

const TYPE_TOKEN =
  /^(?:ssh-[a-z0-9-]+(?:@openssh\.com)?|ecdsa-sha2-[a-z0-9]+(?:-cert-v01@openssh\.com)?|sk-[a-z0-9-]+@openssh\.com)$/;
const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/;

const readSshLine = (line: string): ReadItem => {
  const parts = line.trim().split(/[ \t]+/);
  const [type, data] = parts;
  const comment = line
    .trim()
    .slice(line.trim().indexOf(data ?? '') + (data?.length ?? 0))
    .trim();
  try {
    const refused = unsupportedType(type!);
    if (refused) throw new SshError(refused);
    if (data === undefined) throw new SshError('The line has a key type but no key data.');
    if (!BASE64_CHARS.test(data)) {
      let at = 0;
      while (at < data.length && /[A-Za-z0-9+/]/.test(data[at]!)) at++;
      throw new SshError(
        `The key data is not valid Base64: position ${at + 1}, "${String.fromCodePoint(data.codePointAt(at)!)}".`,
      );
    }
    const decoded = parseBase64(data);
    if (!decoded.ok) throw new SshError('The key data is not valid Base64.');
    const key = readSshBlob(decoded.bytes, type);
    return { ok: true, key: { data: key, source: 'openssh', notes: [], ...(comment ? { comment } : {}) } };
  } catch (error) {
    if (error instanceof SshError) return fail(error.message);
    throw error;
  }
};

const readSshLines = (lines: string[]): ReadItem[] =>
  lines.map(line => {
    const first = line.trim().split(/[ \t]+/)[0]!;
    if (TYPE_TOKEN.test(first)) return readSshLine(line);
    return fail('authorized_keys options before the key type are not read; paste the line from the key type on.');
  });

const looksSsh = (line: string): boolean => {
  const first = line.trim().split(/[ \t]+/)[0]!;
  return TYPE_TOKEN.test(first) || /[ \t,"](?:ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-nistp\d+) AAAA/.test(line);
};

const limit = (items: ReadItem[], notes: string[]): ReadResult => {
  if (items.length > MAX_KEYS) return { items: items.slice(0, MAX_KEYS), notes: [...notes, TOO_MANY] };
  return { items, notes };
};

export const readKeys = (input: string): ReadResult => {
  if (input.length > MAX_INPUT) return { items: [], message: TOO_LARGE, notes: [] };
  const text = input.trim();
  if (text === '') return { items: [], notes: [] };

  if (text.includes('-----BEGIN ') || text.includes('---- BEGIN SSH2 PUBLIC KEY ----')) {
    const { blocks, more } = findBlocks(text);
    if (blocks.length > 0) {
      const notes: string[] = [];
      const items: ReadItem[] = [];
      for (const block of blocks) {
        const item = readBlock(block);
        if (item) items.push(item);
        else notes.push('The EC PARAMETERS block was skipped: the key names its curve itself.');
      }
      if (more) notes.push(TOO_MANY);
      if (items.length === 0) return { items, message: NO_KEY, notes };
      return limit(items, notes);
    }
  }

  if (text.startsWith('{')) {
    const tree = parseJsonTree(text);
    if (!tree.ok)
      return {
        items: [],
        message: `The JSON is not valid. Line ${tree.error.line}, column ${tree.error.column}: ${tree.error.message}.`,
        notes: [],
      };
    const members = setMembers(tree.tree);
    if (members) {
      if (members.length === 0) return { items: [], message: 'The set has no keys.', notes: [] };
      const notes: string[] = [];
      const items: ReadItem[] = [];
      members.forEach((member, i) => {
        const kty = member.type === 'object' ? member.entries.find(e => e.key === 'kty')?.value : undefined;
        if (kty?.type === 'string' && kty.value === 'oct') {
          notes.push(`Key ${i + 1} of the set is a shared secret (kty "oct") and was skipped.`);
          return;
        }
        const item = readJwkNode(member);
        items.push(item.ok ? { ok: true, key: { ...item.key, source: 'jwks' } } : item);
      });
      if (items.length === 0) return { items, message: 'The set has no key pairs.', notes };
      return limit(items, notes);
    }
    if (tree.tree.type === 'object' && tree.tree.entries.some(e => e.key === 'kty'))
      return { items: [readJwkNode(tree.tree)], notes: [] };
    return { items: [], message: NO_KEY, notes: [] };
  }

  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '' && !l.trim().startsWith('#'));
  if (lines.length > 0 && lines.every(looksSsh)) return limit(readSshLines(lines), []);

  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s/g, '').length >= 32) {
    const decoded = parseBase64(text);
    if (decoded.ok) {
      let parsed: ReturnType<typeof parseKeyDer> | null = null;
      try {
        parsed = parseKeyDer(decoded.bytes, '');
      } catch {
        parsed = null;
      }
      const shapes: Shape[] = ['spki', 'pkcs8', 'certificate', 'csr', 'encrypted-pkcs8'];
      if (parsed && shapes.includes(parsed.shape)) {
        try {
          return { items: [{ ok: true, key: readDer(decoded.bytes, parsed.shape, parsed.root, 'der') }], notes: [] };
        } catch (error) {
          if (error instanceof KeyError) return { items: [fail(error.message)], notes: [] };
          throw error;
        }
      }
    }
  }
  return { items: [], message: NO_KEY, notes: [] };
};
