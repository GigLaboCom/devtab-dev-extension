/**
 * What the person gave (docs/tools/specs/x509.md §3): PEM blocks in text (RFC 7468, any text around them), Base64 DER
 * without PEM lines, or a file's bytes. Every block is named by its label; a private key's block is never decoded —
 * its bytes are not even turned from Base64 — and a DER structure that is not a certificate is named by its shape
 * (its outer tags only), never read further.
 */
import {
  CSR,
  extraBytes,
  TRUST_SETTINGS,
  DER_CRL,
  DER_PKCS12,
  DER_PKCS7,
  DER_PUBLIC_KEY,
  emptyBlock,
  NO_CERTIFICATE,
  noEndLine,
  notBase64,
  ONLY_FIRST,
  ONLY_FIRST_BLOCKS,
  PRIVATE_KEY_BLOCK,
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_PASTED,
  skippedBlock,
  wrongEnd,
} from './messages';
import { parseBase64 } from '@workspace/tools-shared/base64';
import { children, isContext, isUniversal, readOid, readTlv, UNIVERSAL } from '@workspace/tools-shared/der';
import type { Tlv } from '@workspace/tools-shared/der';

/** At most this many certificates are read from one input (§3). */
export const MAX_CERTIFICATES = 20;
/** The largest file or text the page reads (§3, §12): 1 MiB. */
export const MAX_INPUT_BYTES = 1_048_576;
/** At most this many PEM blocks of any kind are looked at in one text. */
export const MAX_BLOCKS = 100;

export type InputBlock =
  // trailing: bytes after the certificate's element; trust: an OpenSSL TRUSTED CERTIFICATE (its trust settings follow)
  | { kind: 'certificate'; der: Uint8Array; label: string; line: number; trailing?: number; trust?: true }
  | { kind: 'skipped'; label: string; reason: 'private-key' | 'csr' | 'other'; message: string; line: number }
  | { kind: 'error'; label: string; message: string; line: number };

export interface ReadInput {
  blocks: InputBlock[];
  /** About the input as a whole: nothing found, or only the first 20 shown. */
  message?: string;
}

const CERTIFICATE_LABELS = new Set(['CERTIFICATE', 'X509 CERTIFICATE', 'X.509 CERTIFICATE', 'TRUSTED CERTIFICATE']);
const CSR_LABELS = new Set(['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST']);
/** Any PEM label naming a private key: PRIVATE KEY, RSA / EC / DSA / ENCRYPTED / OPENSSH PRIVATE KEY, PGP PRIVATE KEY BLOCK. */
const isPrivateLabel = (label: string): boolean => label.includes('PRIVATE KEY');

const BEGIN = '-----BEGIN ';
const END = '-----END ';
const DASHES = '-----';
const MAX_LABEL = 80;

type Shape = { kind: 'certificate' } | { kind: 'skipped'; reason: 'private-key' | 'csr' | 'other'; message: string };

const items = (der: Uint8Array, tlv: Tlv | undefined): Tlv[] | null => {
  if (!tlv || !tlv.constructed) return null;
  const read = children(der, tlv);
  return read.ok ? read.items : null;
};
const is = (tlv: Tlv | undefined, tag: number): boolean => !!tlv && isUniversal(tlv, tag);
const oidIs = (der: Uint8Array, tlv: Tlv | undefined, prefix: string): boolean => {
  if (!is(tlv, UNIVERSAL.OBJECT_IDENTIFIER)) return false;
  const oid = readOid(der, tlv!);
  return oid.ok && oid.value.startsWith(prefix);
};

/**
 * What a DER structure is, by its outer tags alone (a private key's contents are never read): a certificate (or
 * something that will fail as one, with its place), a private key (PKCS#8, encrypted PKCS#8, PKCS#1, SEC 1, DSA), a
 * request, a public key, a CRL, PKCS#7 or PKCS#12.
 */
export const shapeOf = (der: Uint8Array, source: 'pasted' | 'file'): Shape => {
  const first = readTlv(der, 0);
  if (!first.ok || !is(first.tlv, UNIVERSAL.SEQUENCE)) return { kind: 'certificate' };
  const top = items(der, first.tlv);
  if (!top || top.length === 0) return { kind: 'certificate' };
  const privateKey: Shape = {
    kind: 'skipped',
    reason: 'private-key',
    message: source === 'file' ? PRIVATE_KEY_FILE : PRIVATE_KEY_PASTED,
  };
  const [a, b, c] = top;
  // PKCS#1 RSAPrivateKey (9 INTEGERs) and OpenSSL's DSA private key (6): nothing but INTEGERs.
  if (top.length >= 6 && top.every(t => is(t, UNIVERSAL.INTEGER))) return privateKey;
  // PKCS#8 PrivateKeyInfo / OneAsymmetricKey: version, algorithm, OCTET STRING.
  if (is(a, UNIVERSAL.INTEGER) && is(b, UNIVERSAL.SEQUENCE) && is(c, UNIVERSAL.OCTET_STRING)) return privateKey;
  // SEC 1 ECPrivateKey (RFC 5915): version 1, OCTET STRING, [0] parameters, [1] public key.
  if (is(a, UNIVERSAL.INTEGER) && is(b, UNIVERSAL.OCTET_STRING) && top.slice(2).every(t => t.cls === 'context'))
    return privateKey;
  // EncryptedPrivateKeyInfo (RFC 5958 §3): algorithm, OCTET STRING.
  if (top.length === 2 && is(a, UNIVERSAL.SEQUENCE) && is(b, UNIVERSAL.OCTET_STRING)) return privateKey;
  // PKCS#12 PFX (RFC 7292 §4): version 3, a ContentInfo, optional MAC data.
  if (is(a, UNIVERSAL.INTEGER) && is(b, UNIVERSAL.SEQUENCE) && oidIs(der, items(der, b)?.[0], '1.2.840.113549.1.7.'))
    return { kind: 'skipped', reason: 'other', message: DER_PKCS12 };
  // PKCS#7 / CMS ContentInfo: a content type of 1.2.840.113549.1.7 and [0] content.
  if (top.length === 2 && oidIs(der, a, '1.2.840.113549.1.7.') && b && isContext(b, 0))
    return { kind: 'skipped', reason: 'other', message: DER_PKCS7 };
  // SubjectPublicKeyInfo: algorithm, BIT STRING.
  if (top.length === 2 && is(a, UNIVERSAL.SEQUENCE) && is(b, UNIVERSAL.BIT_STRING))
    return { kind: 'skipped', reason: 'other', message: DER_PUBLIC_KEY };
  if (top.length === 3 && is(a, UNIVERSAL.SEQUENCE) && is(b, UNIVERSAL.SEQUENCE) && is(c, UNIVERSAL.BIT_STRING)) {
    const inner = items(der, a) ?? [];
    // PKCS#10 CertificationRequestInfo: version, subject, subjectPKInfo, [0] attributes.
    if (
      inner.length === 4 &&
      is(inner[0], UNIVERSAL.INTEGER) &&
      is(inner[1], UNIVERSAL.SEQUENCE) &&
      is(inner[2], UNIVERSAL.SEQUENCE) &&
      inner[3]!.cls === 'context' &&
      inner[3]!.tag === 0
    )
      return { kind: 'skipped', reason: 'csr', message: CSR };
    // TBSCertList: [version,] signature, issuer, thisUpdate (a time) — a certificate has its validity SEQUENCE there.
    const at = is(inner[0], UNIVERSAL.INTEGER) ? 1 : 0;
    const time = inner[at + 2];
    if (is(inner[at], UNIVERSAL.SEQUENCE) && (is(time, UNIVERSAL.UTCTime) || is(time, UNIVERSAL.GeneralizedTime)))
      return { kind: 'skipped', reason: 'other', message: DER_CRL };
  }
  return { kind: 'certificate' };
};

/** A certificate's element and what follows it; a block that is something else, named. */
const fromDer = (
  der: Uint8Array,
  label: string,
  line: number,
  source: 'pasted' | 'file',
  trust: boolean,
): InputBlock => {
  const shape = shapeOf(der, source);
  if (shape.kind === 'skipped') return { ...shape, label, line };
  const first = readTlv(der, 0);
  const end = first.ok ? first.tlv.end : der.length;
  const trailing = der.length - end;
  return {
    kind: 'certificate',
    der: trailing > 0 ? der.slice(0, end) : der,
    label,
    line,
    ...(trailing > 0 ? { trailing } : {}),
    ...(trust ? { trust: true as const } : {}),
  };
};

/** Base64 that is all there is (no PEM lines): JSON's, `x5c`'s, YAML's certificates. Whitespace may break it. */
const BARE_BASE64 = /^[A-Za-z0-9+/=\s]+$/;

const lineAt = (text: string, offset: number, from: { offset: number; line: number }): number => {
  let line = from.line;
  for (let i = from.offset; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  from.offset = offset;
  from.line = line;
  return line;
};

/** `-----BEGIN <label>-----` at `at`: the label and where the line's dashes end, or null. */
const beginLine = (text: string, at: number): { label: string; after: number } | null => {
  const start = at + BEGIN.length;
  const close = text.indexOf(DASHES, start);
  if (close < 0 || close - start > MAX_LABEL) return null;
  const label = text.slice(start, close);
  if (/[\r\n]/.test(label)) return null;
  return { label: label.trim(), after: close + DASHES.length };
};

/** A CERTIFICATE (or X509 / TRUSTED CERTIFICATE) block: its END line, its Base64, then what its DER is. */
const certificateBlock = (
  text: string,
  block: { label: string; line: number; after: number; end: number; closed: boolean; endLabel: string | undefined },
  position: { offset: number; line: number },
): InputBlock => {
  const { label, line, after, end, closed, endLabel } = block;
  if (!closed) return { kind: 'error', label, message: noEndLine(label), line };
  if (endLabel !== undefined && endLabel !== label)
    return { kind: 'error', label, message: wrongEnd(label, endLabel), line };
  const body = text.slice(after, end);
  let decoded = parseBase64(body);
  // A PEM copied out of JSON or a shell string keeps its line breaks as the two characters \n.
  if (!decoded.ok && body.includes('\\n')) {
    const unescaped = parseBase64(body.replace(/\\[nr]/g, ''));
    if (unescaped.ok) decoded = unescaped;
  }
  if (!decoded.ok) {
    const offset = after + decoded.error.offset;
    const place = lineAt(text, offset, { ...position });
    const column = offset - (text.lastIndexOf('\n', offset - 1) + 1) + 1;
    return {
      kind: 'error',
      label,
      message: `${notBase64(label)} Line ${place}, column ${column}: ${decoded.error.message}.`,
      line,
    };
  }
  if (decoded.bytes.length === 0) return { kind: 'error', label, message: emptyBlock(label), line };
  return fromDer(decoded.bytes, label, line, 'pasted', label === 'TRUSTED CERTIFICATE');
};

const readText = (text: string): ReadInput => {
  const blocks: InputBlock[] = [];
  const position = { offset: 0, line: 1 };
  let certificates = 0;
  let more = false;
  let tooMany = false;
  // The next END line at or after the current block: searched again only once the scan has passed it, so text with
  // thousands of BEGIN lines and no END is read once, not once per block.
  let nextEnd = -2;
  let at = text.indexOf(BEGIN);
  if (at < 0) {
    const bare = text.trim();
    if (bare !== '' && BARE_BASE64.test(bare)) {
      const decoded = parseBase64(bare);
      if (decoded.ok && decoded.bytes[0] === 0x30)
        return {
          blocks: [fromDer(decoded.bytes, 'Base64', lineAt(text, text.indexOf(bare[0]!), position), 'pasted', false)],
        };
    }
    return { blocks: [], message: NO_CERTIFICATE };
  }
  while (at >= 0) {
    if (blocks.length >= MAX_BLOCKS) {
      tooMany = true;
      break;
    }
    const line = lineAt(text, at, position);
    const begin = beginLine(text, at);
    if (!begin) {
      at = text.indexOf(BEGIN, at + BEGIN.length);
      continue;
    }
    const { label, after } = begin;
    const nextBegin = text.indexOf(BEGIN, after);
    if (nextEnd !== -1 && nextEnd < after) nextEnd = text.indexOf(END, after);
    const end = nextEnd;
    const closed = end >= 0 && (nextBegin < 0 || end < nextBegin);
    const endLine = closed ? beginLineEnd(text, end) : null;
    const resume = closed ? (endLine?.after ?? end + END.length) : nextBegin;
    if (isPrivateLabel(label)) {
      // Never decoded: not a byte of it is read past its label.
      blocks.push({ kind: 'skipped', label, reason: 'private-key', message: PRIVATE_KEY_BLOCK, line });
    } else if (CSR_LABELS.has(label)) {
      blocks.push({ kind: 'skipped', label, reason: 'csr', message: CSR, line });
    } else if (!CERTIFICATE_LABELS.has(label)) {
      blocks.push({ kind: 'skipped', label, reason: 'other', message: skippedBlock(label), line });
    } else if (certificates >= MAX_CERTIFICATES) {
      // A certificate block, read or not, counts: twenty of them at most are looked at.
      more = true;
    } else {
      certificates++;
      blocks.push(certificateBlock(text, { label, line, after, end, closed, endLabel: endLine?.label }, position));
    }
    at = resume < 0 ? -1 : text.indexOf(BEGIN, resume);
  }
  const found = blocks.some(b => b.kind !== 'skipped' || b.reason !== 'private-key');
  return {
    blocks,
    ...(tooMany
      ? { message: ONLY_FIRST_BLOCKS(MAX_BLOCKS) }
      : more
        ? { message: ONLY_FIRST(MAX_CERTIFICATES) }
        : !found
          ? { message: NO_CERTIFICATE }
          : {}),
  };
};

/** `-----END <label>-----` at `at`. */
const beginLineEnd = (text: string, at: number): { label: string; after: number } | null => {
  const start = at + END.length;
  const close = text.indexOf(DASHES, start);
  if (close < 0 || close - start > MAX_LABEL) return null;
  const label = text.slice(start, close);
  if (/[\r\n]/.test(label)) return null;
  return { label: label.trim(), after: close + DASHES.length };
};

/** PEM blocks or bare Base64 from text; DER from a file's bytes (a file that does not start with 0x30 is text). */
export const readInput = (input: { text: string } | { bytes: Uint8Array }): ReadInput => {
  if ('text' in input) return readText(input.text);
  const { bytes } = input;
  if (bytes[0] === 0x30) return { blocks: [fromDer(bytes, 'DER', 1, 'file', false)] };
  const text = new TextDecoder('utf-8').decode(bytes);
  const read = readText(text);
  // A private key in a text file is still a private key in a file: say so in the file's words.
  return {
    ...read,
    blocks: read.blocks.map(b =>
      b.kind === 'skipped' && b.reason === 'private-key' && b.message === PRIVATE_KEY_PASTED
        ? { ...b, message: PRIVATE_KEY_FILE }
        : b,
    ),
  };
};

/** Notes about a certificate block's bytes after the certificate: OpenSSL trust settings, or extra bytes (§3, §5.2). */
export const blockNotes = (block: InputBlock): string[] =>
  block.kind !== 'certificate' || !block.trailing ? [] : [block.trust ? TRUST_SETTINGS : extraBytes(block.trailing)];
