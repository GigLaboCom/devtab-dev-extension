/**
 * Seam `HistoryArchive` — the file "Download history" writes and "Restore from file" reads (docs/replaceable-behaviors.md).
 * The default is the tool-history archive, format 1 (docs/tools/history-format.md):
 *
 *   mimetype         application/x.tool-history+zip   (first, STORED: the file says what it is at byte 38)
 *   manifest.json    format, version, minReaderVersion, created, producer, the filter it was made with
 *   records.jsonl    one record per line, exactly as stored, oldest first
 *   blobs.jsonl      one line per blob: hash, size, type (and kid when encrypted)
 *   keyrings.jsonl   wrapped data keys the encrypted records need (only when there are any)
 *   blobs/<hash>     each blob's bytes as stored, once
 *   summary.json     counts, bytes, owners, kinds, the time range
 *   SHA256SUMS       `sha256sum -c` lines for every file above
 *
 * Written as a stream (nothing is held twice: records are read from the store in batches, each blob is streamed from
 * its stored Blob), read with random access from the File (the central directory first, then each entry streamed).
 * Import is verify-then-write: every checksum and every line is checked before anything is written; a failed write
 * removes what this import wrote.
 */
import { utf8 } from './bytes';
import { Sha256, sha256Hex } from './checksums';
import { parseKeyring } from './cipher';
import { HASH_PATTERN, rowOf } from './envelope';
import { normalizeFilter } from './filter';
import { openZipEntry, readZipDirectory, readZipText, ZipError, ZipWriter, zipEntryBlob } from './zip';
import type { Keyring, PasswordVault } from './cipher';
import type { BlobData, RecordRow } from './envelope';
import type { HistoryFilter } from './filter';
import type { HistoryStore } from './store';
import type { ZipEntry } from './zip';

export const ARCHIVE_FORMAT = 'tool-history';
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_MIMETYPE = 'application/x.tool-history+zip';

export interface Producer {
  /** The product's name (the host reads it from its own product description, never a literal). */
  name: string;
  version: string;
}

export interface ArchiveManifest {
  format: string;
  version: number;
  minReaderVersion: number;
  created: string;
  producer: Producer;
  /** The filter the export was made with; `{}` for everything. */
  filter: HistoryFilter;
  [key: string]: unknown;
}

export interface ArchiveSummary {
  records: number;
  blobs: number;
  recordBytes: number;
  blobBytes: number;
  encryptedRecords: number;
  owners: string[];
  kinds: string[];
  from?: string;
  to?: string;
}

export type ArchiveProblem =
  | { code: 'not-zip'; detail: string }
  | { code: 'foreign'; detail: string }
  | { code: 'newer'; version: number; minReaderVersion: number }
  | { code: 'damaged'; detail: string };

export interface ArchiveInspection {
  ok: true;
  file: Blob;
  manifest: ArchiveManifest;
  summary: ArchiveSummary;
  keyrings: Keyring[];
  /** The keyrings' exact lines, by kid (stored as they are). */
  keyringLines: Map<string, string>;
  /** The file is of a newer format this version still reads (fields and files it does not know are kept or skipped). */
  newerReadable: boolean;
  /** Files of the archive this version does not know (ignored). */
  unknownFiles: string[];
  entries: Map<string, ZipEntry>;
}

export type KeyringPlan =
  | { plan: 'none' }
  | { plan: 'same' }
  /** The history has no password: the archive's keyring becomes its master password (the archive's password). */
  | { plan: 'take'; kid: string }
  /** The history has another password: the archive's password is needed to bring its encrypted entries in. */
  | { plan: 'adopt'; kid: string };

export interface ImportReport {
  added: number;
  /** Already there, the same bytes. */
  same: number;
  /** Already there with other content: the local one was kept. */
  conflicts: number;
  /** Encrypted entries left out: their key could not be brought in (no password given, wrong password, history locked). */
  skippedEncrypted: number;
  blobsAdded: number;
  keyring: KeyringPlan['plan'];
}

export class ImportError extends Error {
  constructor(
    readonly code: 'wrong-password' | 'locked' | 'store' | 'damaged',
    message: string,
  ) {
    super(message);
  }
}

export interface HistoryArchive {
  readonly id: string;
  readonly fileExtension: string;
  readonly mimeType: string;
  write(
    store: HistoryStore,
    filter: HistoryFilter,
    options: { producer: Producer; now: number },
  ): ReadableStream<Uint8Array>;
  inspect(file: Blob): Promise<ArchiveInspection | { ok: false; problem: ArchiveProblem }>;
  plan(inspection: ArchiveInspection, vault: PasswordVault | undefined): KeyringPlan;
  restore(
    store: HistoryStore,
    inspection: ArchiveInspection,
    options: { vault?: PasswordVault; password?: string },
  ): Promise<ImportReport>;
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-ndjson)|image\/svg\+xml)|\+(json|xml)$/;
const KNOWN_FILES = new Set([
  'mimetype',
  'manifest.json',
  'records.jsonl',
  'blobs.jsonl',
  'keyrings.jsonl',
  'summary.json',
  'SHA256SUMS',
]);
/**
 * Files up to this size are hashed whole with WebCrypto (native, ~1 GB/s) — one at a time, so at most this much is in
 * memory; larger ones (records.jsonl of a long history) stream through the incremental SHA-256 (~60 MB/s).
 */
const WHOLE_HASH_MAX = 64 * 1024 * 1024;
/** Records per write batch, and blob bytes per batch before it is written. */
const BATCH = 200;
const BATCH_BLOB_BYTES = 16 * 1024 * 1024;

const lines = async function* (stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream
    .pipeThrough(new TextDecoderStream('utf-8', { fatal: true }) as unknown as TransformStream<Uint8Array, string>)
    .getReader();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += value;
    let nl: number;
    while ((nl = rest.indexOf('\n')) >= 0) {
      yield rest.slice(0, nl);
      rest = rest.slice(nl + 1);
    }
  }
  if (rest) yield rest;
};

const isoOf = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

/** The keyrings `kids` need, following `wrap.by` to the password keyring. */
const keyringsFor = (kids: Set<string>, all: Map<string, string>): string[] => {
  const out = new Map<string, string>();
  const queue = [...kids];
  while (queue.length) {
    const kid = queue.pop()!;
    const line = all.get(kid);
    if (!line || out.has(kid)) continue;
    out.set(kid, line);
    try {
      const by = parseKeyring(line).wrap.by;
      if (by !== 'password') queue.push(by);
    } catch {
      // exported as is
    }
  }
  return [...out.values()];
};

export const zipArchive: HistoryArchive = {
  id: 'tool-history-zip-1',
  fileExtension: '.zip',
  mimeType: 'application/zip',

  write(store, filter, { producer, now }) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const sums: string[] = [];
    const zip = new ZipWriter(async chunk => {
      await writer.ready;
      await writer.write(chunk);
    }, new Date(now));
    const add = async (name: string, source: Parameters<ZipWriter['add']>[1], compress: boolean) => {
      if (source instanceof Blob && source.size <= WHOLE_HASH_MAX) {
        const bytes = new Uint8Array(await source.arrayBuffer());
        sums.push(`${await sha256Hex(bytes)}  ${name}`);
        await zip.add(name, compress ? new Blob([bytes]) : bytes, { compress });
        return;
      }
      if (source instanceof Uint8Array) {
        sums.push(`${await sha256Hex(source)}  ${name}`);
        await zip.add(name, source, { compress });
        return;
      }
      const hash = new Sha256();
      await zip.add(name, source, { compress, observe: chunk => hash.update(chunk) });
      sums.push(`${hash.hex()}  ${name}`);
    };
    const produce = async () => {
      const clean = normalizeFilter(filter);
      await zip.add('mimetype', utf8(ARCHIVE_MIMETYPE), { compress: false });
      const manifest: ArchiveManifest = {
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_VERSION,
        minReaderVersion: 1,
        created: new Date(now).toISOString(),
        producer,
        filter: clean,
      };
      await add('manifest.json', utf8(JSON.stringify(manifest, null, 2) + '\n'), false);

      const blobHashes = new Set<string>();
      const kids = new Set<string>();
      const owners = new Set<string>();
      const kinds = new Set<string>();
      const summary: ArchiveSummary = {
        records: 0,
        blobs: 0,
        recordBytes: 0,
        blobBytes: 0,
        encryptedRecords: 0,
        owners: [],
        kinds: [],
      };
      let first: number | undefined;
      let last: number | undefined;
      const encoder = new TextEncoder();
      const records = new ReadableStream<Uint8Array>({
        async start(controller) {
          for await (const row of store.scan(clean)) {
            controller.enqueue(encoder.encode(row.line + '\n'));
            summary.records++;
            summary.recordBytes += row.lineBytes;
            if (row.kid) {
              summary.encryptedRecords++;
              kids.add(row.kid);
            }
            owners.add(row.owner);
            kinds.add(row.kind);
            first ??= row.time;
            last = row.time;
            for (const h of row.blobs) blobHashes.add(h);
          }
          controller.close();
        },
      });
      await add('records.jsonl', records, true);

      const blobLines: string[] = [];
      const stored: BlobData[] = [];
      for (const hash of blobHashes) {
        const blob = await store.blob(hash);
        if (!blob) continue; // a dangling reference: the record goes, its blob cannot
        stored.push(blob);
        blobLines.push(
          JSON.stringify({ hash: blob.hash, size: blob.size, type: blob.type, ...(blob.kid ? { kid: blob.kid } : {}) }),
        );
      }
      await add('blobs.jsonl', utf8(blobLines.map(l => l + '\n').join('')), true);
      // Everything: every keyring (a full backup brings its master password along). A filter: those its records need.
      const allRings = await store.keyrings();
      const rings = Object.keys(clean).length ? keyringsFor(kids, allRings) : [...allRings.values()];
      if (rings.length) await add('keyrings.jsonl', utf8(rings.map(l => l + '\n').join('')), false);
      for (const blob of stored) {
        await add(`blobs/${blob.hash}`, blob.data, !blob.kid && TEXT_TYPES.test(blob.type));
        summary.blobs++;
        summary.blobBytes += blob.size;
      }
      summary.owners = [...owners].sort();
      summary.kinds = [...kinds].sort();
      if (first !== undefined) summary.from = isoOf(first);
      if (last !== undefined) summary.to = isoOf(last);
      await add('summary.json', utf8(JSON.stringify(summary, null, 2) + '\n'), false);
      await zip.add('SHA256SUMS', utf8(sums.map(l => l + '\n').join('')), { compress: false });
      await zip.finish();
      await writer.close();
    };
    produce().catch(error => writer.abort(error));
    return readable;
  },

  async inspect(file) {
    let entries: ZipEntry[];
    try {
      entries = await readZipDirectory(file);
    } catch (error) {
      return { ok: false, problem: { code: 'not-zip', detail: String((error as Error).message) } };
    }
    const byName = new Map(entries.map(e => [e.name, e]));
    const damaged = (detail: string) => ({ ok: false as const, problem: { code: 'damaged' as const, detail } });
    try {
      const mime = byName.get('mimetype');
      const manifestEntry = byName.get('manifest.json');
      if (!mime || !manifestEntry)
        return { ok: false, problem: { code: 'foreign', detail: 'no mimetype or manifest.json' } };
      if ((await readZipText(file, mime)) !== ARCHIVE_MIMETYPE)
        return { ok: false, problem: { code: 'foreign', detail: 'another mimetype' } };
      let manifest: ArchiveManifest;
      try {
        manifest = JSON.parse(await readZipText(file, manifestEntry));
      } catch {
        return damaged('manifest.json is not JSON');
      }
      if (manifest.format !== ARCHIVE_FORMAT)
        return { ok: false, problem: { code: 'foreign', detail: `format ${String(manifest.format)}` } };
      if (!Number.isInteger(manifest.version) || !Number.isInteger(manifest.minReaderVersion))
        return damaged('manifest.json has no version');
      if (manifest.minReaderVersion > ARCHIVE_VERSION)
        return {
          ok: false,
          problem: { code: 'newer', version: manifest.version, minReaderVersion: manifest.minReaderVersion },
        };

      // Every file against SHA256SUMS (which also proves each ZIP entry's CRC by reading it whole).
      const sumsEntry = byName.get('SHA256SUMS');
      if (!sumsEntry) return damaged('SHA256SUMS is missing');
      const sums = new Map<string, string>();
      for (const line of (await readZipText(file, sumsEntry)).split('\n')) {
        if (!line) continue;
        const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
        if (!m) return damaged('SHA256SUMS has a line it should not');
        sums.set(m[2], m[1]);
      }
      for (const name of ['manifest.json', 'records.jsonl', 'blobs.jsonl', 'summary.json'])
        if (!byName.has(name)) return damaged(`${name} is missing`);
      for (const [name, expected] of sums) {
        const entry = byName.get(name);
        if (!entry) return damaged(`${name} is listed but missing`);
        let actual: string;
        if (entry.size <= WHOLE_HASH_MAX) {
          actual = await sha256Hex(new Uint8Array(await new Response(await openZipEntry(file, entry)).arrayBuffer()));
        } else {
          const hash = new Sha256();
          const reader = (await openZipEntry(file, entry)).getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            hash.update(value);
          }
          actual = hash.hex();
        }
        if (actual !== expected) return damaged(`${name} does not match its checksum`);
      }
      for (const name of byName.keys())
        if (
          name !== 'mimetype' &&
          name !== 'SHA256SUMS' &&
          (KNOWN_FILES.has(name) || name.startsWith('blobs/')) &&
          !sums.has(name)
        )
          return damaged(`${name} has no checksum`);

      const blobMeta = new Map<string, { size: number; type: string; kid?: string }>();
      for await (const line of lines(await openZipEntry(file, byName.get('blobs.jsonl')!))) {
        if (!line) continue;
        const b = JSON.parse(line) as { hash: string; size: number; type: string; kid?: string };
        if (!HASH_PATTERN.test(b.hash) || !Number.isInteger(b.size)) return damaged('blobs.jsonl has a bad line');
        const entry = byName.get(`blobs/${b.hash}`);
        if (!entry || entry.size !== b.size) return damaged(`blobs/${b.hash} is missing or of another size`);
        blobMeta.set(b.hash, b);
      }
      const keyrings: Keyring[] = [];
      const keyringLines = new Map<string, string>();
      const ringsEntry = byName.get('keyrings.jsonl');
      if (ringsEntry)
        for await (const line of lines(await openZipEntry(file, ringsEntry)))
          if (line) {
            const k = parseKeyring(line);
            keyrings.push(k);
            keyringLines.set(k.kid, line);
          }
      const kids = new Set(keyrings.map(k => k.kid));

      const summary: ArchiveSummary = {
        records: 0,
        blobs: blobMeta.size,
        recordBytes: 0,
        blobBytes: 0,
        encryptedRecords: 0,
        owners: [],
        kinds: [],
      };
      const owners = new Set<string>();
      const kinds = new Set<string>();
      let n = 0;
      for await (const line of lines(await openZipEntry(file, byName.get('records.jsonl')!))) {
        n++;
        if (!line) continue;
        let row: RecordRow;
        try {
          row = rowOf(line);
        } catch (error) {
          return damaged(`record ${n} is not a record (${(error as Error).message})`);
        }
        for (const h of row.blobs) if (!blobMeta.has(h)) return damaged(`record ${n} needs a blob the file lacks`);
        if (row.kid && !kids.has(row.kid)) return damaged(`record ${n} is encrypted with a key the file lacks`);
        summary.records++;
        summary.recordBytes += row.lineBytes;
        if (row.kid) summary.encryptedRecords++;
        owners.add(row.owner);
        kinds.add(row.kind);
        summary.from ??= isoOf(row.time);
        summary.to = isoOf(row.time);
      }
      summary.blobBytes = [...blobMeta.values()].reduce((a, b) => a + b.size, 0);
      summary.owners = [...owners].sort();
      summary.kinds = [...kinds].sort();
      return {
        ok: true,
        file,
        manifest,
        summary,
        keyrings,
        keyringLines,
        newerReadable: manifest.version > ARCHIVE_VERSION,
        unknownFiles: [...byName.keys()].filter(n => !KNOWN_FILES.has(n) && !n.startsWith('blobs/')),
        entries: byName,
      };
    } catch (error) {
      if (error instanceof ZipError || error instanceof TypeError || error instanceof SyntaxError)
        return damaged(String(error.message));
      return damaged(String((error as Error)?.message ?? error));
    }
  },

  plan(inspection, vault) {
    const primary = inspection.keyrings.find(k => k.wrap.by === 'password');
    if (!primary) return { plan: 'none' };
    const ours = vault?.activeKeyring();
    if (!ours) return { plan: 'take', kid: primary.kid };
    if (inspection.keyrings.some(k => k.kid === ours.kid)) return { plan: 'same' };
    return { plan: 'adopt', kid: primary.kid };
  },

  async restore(store, inspection, { vault, password }) {
    const { file, entries } = inspection;
    const plan = this.plan(inspection, vault);
    const readable = new Set<string>();
    const local = await store.keyrings();
    const taken: string[] = [];
    for (const kid of local.keys()) readable.add(kid);
    if (plan.plan === 'take' || plan.plan === 'same') {
      for (const k of inspection.keyrings) {
        if (!local.has(k.kid)) {
          await store.putKeyring(k.kid, inspection.keyringLines.get(k.kid)!);
          taken.push(k.kid);
        }
        readable.add(k.kid);
      }
      if (plan.plan === 'take') await vault?.refresh();
    } else if (plan.plan === 'adopt' && password !== undefined) {
      if (!vault || vault.state() !== 'unlocked') throw new ImportError('locked', 'Unlock this history first.');
      const primary = inspection.keyrings.find(k => k.kid === plan.kid)!;
      try {
        await vault.adopt(
          primary,
          password,
          inspection.keyrings.filter(k => k !== primary),
        );
      } catch {
        throw new ImportError('wrong-password', 'That is not the password of this file.');
      }
      for (const k of inspection.keyrings) readable.add(k.kid);
    }

    const blobMeta = new Map<string, { size: number; type: string; kid?: string }>();
    for await (const line of lines(await openZipEntry(file, entries.get('blobs.jsonl')!)))
      if (line) {
        const b = JSON.parse(line) as { hash: string; size: number; type: string; kid?: string };
        blobMeta.set(b.hash, b);
      }

    const report: ImportReport = {
      added: 0,
      same: 0,
      conflicts: 0,
      skippedEncrypted: 0,
      blobsAdded: 0,
      keyring: plan.plan,
    };
    const added: string[] = [];
    let batch: string[] = [];
    let batchBlobs = new Map<string, BlobData>();
    let batchBytes = 0;
    const written = new Set<string>();
    const flush = async () => {
      if (!batch.length) return;
      const result = await store.add(batch, [...batchBlobs.values()]);
      added.push(...result.added);
      report.added += result.added.length;
      report.same += result.same.length;
      report.conflicts += result.conflicts.length;
      for (const h of batchBlobs.keys()) written.add(h);
      batch = [];
      batchBlobs = new Map();
      batchBytes = 0;
    };
    try {
      for await (const line of lines(await openZipEntry(file, entries.get('records.jsonl')!))) {
        if (!line) continue;
        const row = rowOf(line);
        if (row.kid && !readable.has(row.kid)) {
          report.skippedEncrypted++;
          continue;
        }
        const need = row.blobs.filter(h => !written.has(h) && !batchBlobs.has(h));
        const have = await store.hasBlobs(need);
        for (const hash of need) {
          if (have.has(hash)) {
            written.add(hash);
            continue;
          }
          const meta = blobMeta.get(hash)!;
          const data = await zipEntryBlob(file, entries.get(`blobs/${hash}`)!, meta.type, true);
          batchBlobs.set(hash, {
            hash,
            size: meta.size,
            type: meta.type,
            ...(meta.kid ? { kid: meta.kid } : {}),
            data,
          });
          batchBytes += meta.size;
          report.blobsAdded++;
        }
        batch.push(line);
        if (batch.length >= BATCH || batchBytes >= BATCH_BLOB_BYTES) await flush();
      }
      await flush();
    } catch (error) {
      if (added.length) await store.delete({ ids: added });
      for (const kid of taken) await store.deleteKeyring(kid);
      if (taken.length) await vault?.refresh();
      throw new ImportError(
        'store',
        `The browser could not store the entries (${(error as Error).message}). Nothing was imported.`,
      );
    }
    return report;
  },
};

/** Reads a whole archive stream into bytes (tests, small exports). */
export const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(stream).arrayBuffer());
