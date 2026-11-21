/**
 * A small streaming ZIP writer and a random-access ZIP reader (APPNOTE.TXT 6.3.x), enough for the history archive:
 * STORED and DEFLATE (CompressionStream 'deflate-raw', native), UTF-8 names, data descriptors for streamed entries,
 * no ZIP64 (an archive stays under 4 GiB — the history's budget is far below), no encryption, no multi-disk. Any
 * ordinary tool reads what it writes (unzip, Python's zipfile, the system's archive utility — docs/tools/history-format.md).
 */
import { utf8 } from './bytes';
import { crc32 } from './checksums';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DESCRIPTOR = 0x08074b50;
const LIMIT = 0xffffffff;
const FLAG_DESCRIPTOR = 1 << 3;
const FLAG_UTF8 = 1 << 11;

export class ZipError extends Error {}

const dosTime = (d: Date): { time: number; date: number } => ({
  time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  date: ((Math.max(d.getUTCFullYear(), 1980) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
});

interface Written {
  name: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export type ZipSource = Uint8Array<ArrayBuffer> | Blob | ReadableStream<Uint8Array>;

/** Writes entries one after another into `sink`; `finish` writes the central directory. */
export class ZipWriter {
  private offset = 0;
  private entries: Written[] = [];

  constructor(
    private sink: (chunk: Uint8Array) => Promise<void>,
    private mtime = new Date(),
  ) {}

  private async out(chunk: Uint8Array): Promise<void> {
    this.offset += chunk.byteLength;
    if (this.offset > LIMIT) throw new ZipError('the archive would pass 4 GiB');
    await this.sink(chunk);
  }

  /**
   * Adds one file. Bytes known up front are written with their sizes in the local header; a Blob or a stream is
   * written with a data descriptor after it. `observe` sees the uncompressed bytes (the archive hashes them).
   */
  async add(
    name: string,
    source: ZipSource,
    options: { compress: boolean; observe?: (chunk: Uint8Array) => void },
  ): Promise<{ size: number }> {
    const nameBytes = utf8(name);
    const { time, date } = dosTime(this.mtime);
    const method = options.compress ? 8 : 0;
    const offset = this.offset;
    const known = source instanceof Uint8Array && !options.compress;
    const flags = FLAG_UTF8 | (known ? 0 : FLAG_DESCRIPTOR);
    const crcKnown = known ? crc32(0, source) : 0;
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, LOCAL, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, flags, true);
    head.setUint16(8, method, true);
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crcKnown, true);
    head.setUint32(18, known ? source.byteLength : 0, true);
    head.setUint32(22, known ? source.byteLength : 0, true);
    head.setUint16(26, nameBytes.byteLength, true);
    head.setUint16(28, 0, true);
    await this.out(new Uint8Array(head.buffer));
    await this.out(nameBytes);

    if (known) {
      options.observe?.(source);
      await this.out(source);
      this.entries.push({
        name: nameBytes,
        flags,
        method,
        crc: crcKnown,
        compressed: source.byteLength,
        size: source.byteLength,
        offset,
        time,
        date,
      });
      return { size: source.byteLength };
    }

    let crc = 0;
    let size = 0;
    const plain: ReadableStream<Uint8Array> =
      source instanceof Uint8Array ? new Blob([source]).stream() : source instanceof Blob ? source.stream() : source;
    const counted = plain.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          crc = crc32(crc, chunk);
          size += chunk.byteLength;
          if (size > LIMIT) throw new ZipError(`${name} would pass 4 GiB`);
          options.observe?.(chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    const body = options.compress
      ? counted.pipeThrough(new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>)
      : counted;
    let compressed = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      compressed += value.byteLength;
      await this.out(value);
    }
    const desc = new DataView(new ArrayBuffer(16));
    desc.setUint32(0, DESCRIPTOR, true);
    desc.setUint32(4, crc, true);
    desc.setUint32(8, compressed, true);
    desc.setUint32(12, size, true);
    await this.out(new Uint8Array(desc.buffer));
    this.entries.push({ name: nameBytes, flags, method, crc, compressed, size, offset, time, date });
    return { size };
  }

  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, CENTRAL, true);
      c.setUint16(4, (3 << 8) | 20, true); // made by: Unix, 2.0 — so unzip keeps ordinary file modes
      c.setUint16(6, 20, true);
      c.setUint16(8, e.flags, true);
      c.setUint16(10, e.method, true);
      c.setUint16(12, e.time, true);
      c.setUint16(14, e.date, true);
      c.setUint32(16, e.crc, true);
      c.setUint32(20, e.compressed, true);
      c.setUint32(24, e.size, true);
      c.setUint16(28, e.name.byteLength, true);
      c.setUint32(38, (0o100644 << 16) >>> 0, true); // -rw-r--r--
      c.setUint32(42, e.offset, true);
      await this.out(new Uint8Array(c.buffer));
      await this.out(e.name);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, END, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, this.offset - start, true);
    end.setUint32(16, start, true);
    await this.out(new Uint8Array(end.buffer));
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/** Reads the central directory of a ZIP held in a Blob (a File the user picked): nothing else is read. */
export const readZipDirectory = async (file: Blob): Promise<ZipEntry[]> => {
  if (file.size < 22) throw new ZipError('too short to be a ZIP archive');
  const tailSize = Math.min(file.size, 22 + 0xffff);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError('no end of central directory');
  const count = tail.getUint16(at + 10, true);
  const dirSize = tail.getUint32(at + 12, true);
  const dirStart = tail.getUint32(at + 16, true);
  if (dirStart + dirSize > file.size) throw new ZipError('the central directory is cut off');
  const dir = new DataView(await file.slice(dirStart, dirStart + dirSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.byteLength || dir.getUint32(p, true) !== CENTRAL)
      throw new ZipError('a damaged central directory');
    const nameLength = dir.getUint16(p + 28, true);
    const extra = dir.getUint16(p + 30, true);
    const comment = dir.getUint16(p + 32, true);
    entries.push({
      method: dir.getUint16(p + 10, true),
      crc: dir.getUint32(p + 16, true),
      compressed: dir.getUint32(p + 20, true),
      size: dir.getUint32(p + 24, true),
      offset: dir.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength)),
    });
    p += 46 + nameLength + extra + comment;
  }
  return entries;
};

/** Where an entry's data starts and what it is (a STORED entry's data is a slice of the file, read lazily). */
const dataOf = async (file: Blob, entry: ZipEntry): Promise<Blob> => {
  const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (head.byteLength < 30 || head.getUint32(0, true) !== LOCAL) throw new ZipError(`${entry.name}: no local header`);
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  if (start + entry.compressed > file.size) throw new ZipError(`${entry.name}: cut off`);
  return file.slice(start, start + entry.compressed);
};

/** The entry's uncompressed bytes as a stream; the CRC and size are checked at its end (a ZipError when wrong). */
export const openZipEntry = async (file: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> => {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`${entry.name}: compression method ${entry.method}`);
  const raw = (await dataOf(file, entry)).stream();
  const plain =
    entry.method === 8
      ? raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>)
      : raw;
  let crc = 0;
  let size = 0;
  return plain.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        crc = crc32(crc, chunk);
        size += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        if (size !== entry.size || crc !== entry.crc) throw new ZipError(`${entry.name}: the checksum does not match`);
      },
    }),
  );
};

/**
 * A STORED entry as a lazy slice of the file (no copy); a DEFLATE one decompressed into a Blob. The CRC is checked,
 * unless the caller has already read and checked this entry (`verified`).
 */
export const zipEntryBlob = async (file: Blob, entry: ZipEntry, type: string, verified = false): Promise<Blob> => {
  if (entry.method === 0) {
    const slice = await dataOf(file, entry);
    if (verified) return slice.slice(0, slice.size, type);
    let crc = 0;
    const reader = slice.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32(crc, value);
    }
    if (crc !== entry.crc || slice.size !== entry.size)
      throw new ZipError(`${entry.name}: the checksum does not match`);
    return slice.slice(0, slice.size, type);
  }
  return new Response(await openZipEntry(file, entry)).blob().then(b => b.slice(0, b.size, type));
};

export const readZipText = async (file: Blob, entry: ZipEntry): Promise<string> =>
  new Response(await openZipEntry(file, entry)).text();
