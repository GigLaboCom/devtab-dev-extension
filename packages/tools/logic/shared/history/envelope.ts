/**
 * The record envelope — one entry of the tool history, the same text in the store and in an export (records.jsonl).
 *
 *   {"v":1,"id":"01JD…","owner":"json","kind":"result","session":"01JD…","time":"2026-11-21T10:00:00.000Z",
 *    "schema":1,"label":"Format · 2 spaces","text":"{\"a\":1}","payload":{…},
 *    "blobs":[{"name":"input","hash":"sha256-…","size":7,"type":"application/json"}]}
 *
 * The envelope is ours; `payload` is the owner's (a tool or a section), versioned by the owner's own `schema`. An
 * encrypted record (`sealed`) keeps only what the store must see in clear — id, owner, kind, session, time, schema and
 * each blob's hash and size — and carries label, text, payload and the full blob references inside `sealed.ct`
 * (cipher.ts). A record is stored and exported as its exact JSON line: fields this version does not know survive a
 * round trip untouched, and an import gives back the same bytes. The rules are docs/tools/history-format.md.
 */
import { ID_PATTERN, utf8Length } from './bytes';

export const ENVELOPE_VERSION = 1;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A reference from a record to a blob of the blob store (content-addressed). */
export interface BlobRef {
  /** The record's own name for it ("input", "output", "image"). Inside `sealed` for an encrypted record. */
  name?: string;
  /** `sha256-<hex>` of the bytes; `hmac256-<hex>` (a keyed hash, cipher.ts) for an encrypted blob. */
  hash: string;
  /** Bytes as stored (for an encrypted blob: nonce, ciphertext and tag). */
  size: number;
  /** MIME type. Inside `sealed` for an encrypted record. */
  type?: string;
}

/** The encrypted part of a record (cipher.ts). */
export interface Sealed {
  /** `A256GCM`: AES-256-GCM under the history's data key, the record's identity as additional data. */
  alg: string;
  /** Which data key (keyring) sealed it. */
  kid: string;
  /** 96-bit nonce, Base64. */
  iv: string;
  /** Ciphertext with its 128-bit tag, Base64. */
  ct: string;
}

export interface HistoryRecord {
  v: number;
  id: string;
  owner: string;
  kind: string;
  session: string;
  /** ISO 8601, UTC, milliseconds. */
  time: string;
  schema: number;
  label?: string;
  text?: string;
  payload?: JsonValue;
  blobs?: readonly BlobRef[];
  sealed?: Sealed;
}

/** What the store indexes: the envelope's clear fields, derived from the line itself — never trusted from a caller. */
export interface RecordRow {
  id: string;
  owner: string;
  kind: string;
  session: string;
  /** ms since the epoch. */
  time: number;
  schema: number;
  /** Encrypted: the kid of its key; absent in clear. */
  kid?: string;
  /** Searchable text (clear records only), lower case. */
  search: string;
  /** Blob hashes, without repeats. */
  blobs: readonly string[];
  /** UTF-8 bytes of the line. */
  lineBytes: number;
  /** The blobs' sizes as the record states them (each blob once). */
  blobBytes: number;
  line: string;
}

export class EnvelopeError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
export const HASH_PATTERN = /^(sha256|hmac256)-[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/**
 * Reads one line of records.jsonl (or the store) into its row. Throws EnvelopeError when the line is not a record this
 * version can index: not JSON, not an object, a required field missing or of the wrong type. Unknown fields are fine.
 * A line of a newer envelope version is accepted as long as these fields read the same (format rules).
 */
export const rowOf = (line: string): RecordRow => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new EnvelopeError('not JSON');
  }
  if (!isObject(value)) throw new EnvelopeError('not an object');
  const r = value;
  if (!Number.isInteger(r.v) || (r.v as number) < 1) throw new EnvelopeError('no envelope version');
  if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) throw new EnvelopeError('bad id');
  for (const key of ['owner', 'kind', 'session'] as const)
    if (!isNonEmpty(r[key])) throw new EnvelopeError(`bad ${key}`);
  if (typeof r.time !== 'string' || !ISO.test(r.time)) throw new EnvelopeError('bad time');
  const time = Date.parse(r.time);
  if (!Number.isFinite(time)) throw new EnvelopeError('bad time');
  if (!Number.isInteger(r.schema) || (r.schema as number) < 0) throw new EnvelopeError('bad schema');
  const refs = r.blobs === undefined ? [] : r.blobs;
  if (!Array.isArray(refs)) throw new EnvelopeError('bad blobs');
  const sizes = new Map<string, number>();
  for (const ref of refs) {
    if (!isObject(ref) || typeof ref.hash !== 'string' || !HASH_PATTERN.test(ref.hash))
      throw new EnvelopeError('bad blob hash');
    if (!Number.isInteger(ref.size) || (ref.size as number) < 0) throw new EnvelopeError('bad blob size');
    sizes.set(ref.hash, ref.size as number);
  }
  let kid: string | undefined;
  if (r.sealed !== undefined) {
    const s = r.sealed;
    if (
      !isObject(s) ||
      !isNonEmpty(s.alg) ||
      !isNonEmpty(s.kid) ||
      typeof s.iv !== 'string' ||
      typeof s.ct !== 'string'
    )
      throw new EnvelopeError('bad sealed');
    kid = s.kid;
  }
  const search = kid
    ? ''
    : [r.label, r.text]
        .filter(t => typeof t === 'string')
        .join('\n')
        .toLowerCase();
  return {
    id: r.id,
    owner: r.owner as string,
    kind: r.kind as string,
    session: r.session as string,
    time,
    schema: r.schema as number,
    ...(kid ? { kid } : {}),
    search,
    blobs: [...sizes.keys()],
    lineBytes: utf8Length(line),
    blobBytes: [...sizes.values()].reduce((a, b) => a + b, 0),
    line,
  };
};

/** The line of a record we write: keys in envelope order, absent optionals left out. */
export const recordLine = (record: HistoryRecord): string =>
  JSON.stringify({
    v: record.v,
    id: record.id,
    owner: record.owner,
    kind: record.kind,
    session: record.session,
    time: record.time,
    schema: record.schema,
    ...(record.label !== undefined ? { label: record.label } : {}),
    ...(record.text !== undefined ? { text: record.text } : {}),
    ...(record.payload !== undefined ? { payload: record.payload } : {}),
    ...(record.blobs?.length ? { blobs: record.blobs } : {}),
    ...(record.sealed ? { sealed: record.sealed } : {}),
  });

export const parseRecord = (line: string): HistoryRecord => {
  rowOf(line);
  return JSON.parse(line) as HistoryRecord;
};

/** A stored blob: bytes and what the blob store keeps about them. */
export interface BlobData {
  hash: string;
  size: number;
  type: string;
  /** Encrypted blob: the kid of its key. */
  kid?: string;
  data: Blob;
}
