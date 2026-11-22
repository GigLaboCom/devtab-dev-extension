import {
  BOM_NOTE,
  BROTLI_ENCODER_BROKE,
  EMPTY_FILE,
  GZIP_CRC,
  GZIP_HEADER_CUT,
  GZIP_LENGTH,
  NOT_GZIP,
  NOT_RECOGNISED,
  NOT_ZSTD,
  TRUNCATED,
  ZLIB_ADLER,
  ZSTD_CHECKSUM,
  ZSTD_TRUNCATED,
  BROTLI_TRUNCATED,
  bytesSource,
  compressedName,
  controlsNote,
  countControls,
  createCollector,
  decompressedName,
  detectCompress,
  firstInvalidUtf8,
  formatRatio,
  formatSize,
  gzipFlags,
  gzipHeaderBytes,
  gzipMembers,
  gzipMethod,
  gzipTrailing,
  headerRows,
  hexInsteadOfBase64,
  notUtf8,
  notZlib,
  nulByte,
  parseInput,
  readGzipHeader,
  recogniseFormat,
  run,
  scanDeflateEnd,
  showControls,
  sizesLine,
  stoppedAt,
  streamTrailing,
  textBytes,
  textHints,
  TextCheck,
  zlibDictionary,
} from './logic';
import { adler32, crc32 } from './testing/checksums';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import type { Codecs, Collected, Job, RunOptions, RunOutcome, Streams } from './logic';

// ---- Chrome's streams in Node and the engine run as the tool runs it (helpers of this file only).
/**
 * Chrome's DecompressionStream, as probed in Chrome for Testing 159 (docs/tools/specs/compress.md §5.3), for the tests
 * in Node — whose own stream reads several gzip members and gives empty messages. One member or stream only; after its
 * end, any byte is "Junk found after end of compressed data."; an unfinished stream is "Compressed input was
 * truncated."; zlib's own message otherwise. Built on node:zlib's raw inflate, which says how much input it used.
 */

const fail = (message: string): TypeError => new TypeError(message);

const inflate = (body: Buffer): { out: Buffer; used: number } => {
  try {
    const r = zlib.inflateRawSync(body, { info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    return { out: r.buffer, used: r.engine.bytesWritten };
  } catch (error) {
    const e = error as { code?: string; message: string };
    if (e.code === 'Z_BUF_ERROR') throw fail('Compressed input was truncated.');
    throw fail(`The compressed data was not valid: ${e.message}.`);
  }
};

const decode = (kind: 'gzip' | 'deflate' | 'deflate-raw', all: Buffer): Buffer => {
  if (all.length === 0) throw fail('Compressed input was truncated.');
  let start = 0;
  if (kind === 'gzip') {
    if (all.length < 10) throw fail('Compressed input was truncated.');
    if (all[0] !== 0x1f || all[1] !== 0x8b) throw fail('The compressed data was not valid: incorrect header check.');
    const flg = all[3]!;
    start = 10;
    if (flg & 4) start += 2 + (all[start]! | (all[start + 1]! << 8));
    if (flg & 8) start = all.indexOf(0, start) + 1;
    if (flg & 16) start = all.indexOf(0, start) + 1;
    if (flg & 2) start += 2;
  } else if (kind === 'deflate') {
    if (all.length < 2) throw fail('Compressed input was truncated.');
    if (((all[0]! << 8) | all[1]!) % 31 !== 0) throw fail('The compressed data was not valid: incorrect header check.');
    start = 2;
  }
  const { out, used } = inflate(all.subarray(start));
  let end = start + used;
  if (kind === 'gzip') {
    if (end + 8 > all.length) throw fail('Compressed input was truncated.');
    if (all.readUInt32LE(end) !== crc32(out)) throw fail('The compressed data was not valid: incorrect data check.');
    if (all.readUInt32LE(end + 4) !== out.length % 2 ** 32)
      throw fail('The compressed data was not valid: incorrect length check.');
    end += 8;
  } else if (kind === 'deflate') {
    if (end + 4 > all.length) throw fail('Compressed input was truncated.');
    if (all.readUInt32BE(end) !== adler32(out)) throw fail('The compressed data was not valid: incorrect data check.');
    end += 4;
  }
  if (end < all.length) throw fail('Junk found after end of compressed data.');
  return out;
};

const chromeStreams: Streams = {
  decompress: kind => {
    const parts: Uint8Array[] = [];
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: chunk => void parts.push(chunk.slice()),
      flush: controller => {
        const out = decode(kind, Buffer.concat(parts));
        for (let at = 0; at < out.length; at += 65536) controller.enqueue(new Uint8Array(out.subarray(at, at + 65536)));
      },
    });
  },
  compress: kind => new CompressionStream(kind) as unknown as TransformStream<Uint8Array, Uint8Array>,
};

/** Runs the engine in Node the way the tool runs it: Chrome-like streams, the wasm modules from their packages' files. */

const require = createRequire(import.meta.url);
const file = (spec: string) => () => readFile(require.resolve(spec));

/** Brotli compression in Node's tests: the `brotli` package, as the tool's worker uses it. */
const brotliCompress = async (bytes: Uint8Array, quality: number): Promise<Uint8Array> => {
  const { compress } = (await import('brotli/compress')) as {
    compress: (b: Uint8Array, o: { quality: number }) => Promise<Uint8Array | null>;
  };
  const out = await compress(bytes, { quality });
  if (!out) throw new Error('brotli failed');
  return out;
};

const codecs: Codecs = {
  zstd: file('@tootallnate/zstd-wasm/zstd.wasm'),
  brotliDecoder: file('@tootallnate/brotli-wasm/brotli.wasm'),
  brotliCompress,
};

const b64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const utf8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

const work = async (
  job: Job,
  input: Uint8Array,
  options: Partial<RunOptions> = {},
): Promise<{ outcome: RunOutcome; result: Collected; out: Uint8Array }> => {
  const sink = createCollector(Infinity, Infinity);
  const outcome = await run(job, bytesSource(input), sink, { codecs, streams: chromeStreams, ...options });
  const result = sink.result();
  return { outcome, result, out: result.bytes ?? new Uint8Array(0) };
};

// Every row of docs/tools/specs/compress.md §10 (its number in the test name), every text of §6, §7's examples.
const auto = { direction: 'decompress', format: 'auto' } as const;
const dec = (format: 'gzip' | 'zlib' | 'deflate-raw' | 'zstd' | 'brotli') =>
  ({ direction: 'decompress', format }) as const;
const comp = (format: 'gzip' | 'zlib' | 'deflate-raw' | 'zstd' | 'brotli', level?: number) =>
  ({ direction: 'compress', format, ...(level !== undefined ? { level } : {}) }) as const;

const failure = (outcome: Awaited<ReturnType<typeof work>>['outcome']): string =>
  outcome.ok ? '(ok)' : outcome.message;

const gz = (data: Uint8Array | string): Uint8Array => new Uint8Array(zlib.gzipSync(data));
const HELLO_GZ = b64('H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==');

describe('§10 decompression rows', () => {
  it('1: gzip hello, recognised; header fields; sizes', async () => {
    const { outcome, out } = await work(auto, HELLO_GZ);
    expect(utf8(out)).toBe('hello');
    expect(outcome).toMatchObject({
      ok: true,
      format: 'gzip',
      recognised: true,
      inputBytes: 25,
      outputBytes: 5,
      members: 1,
    });
    if (!outcome.ok) return;
    expect(headerRows(outcome.header!)).toEqual([
      { label: 'Modified', value: 'not set' },
      { label: 'Operating system', value: 'Unix (3)' },
    ]);
    expect(sizesLine(25, 5, 'decompress')).toBe('25 bytes → 5 bytes · ratio 0.20 : 1');
  });

  it('2, 3, 4: zlib (recognised), raw deflate, a stored block', async () => {
    const z = await work(auto, b64('eJzLSM3JyQcABiwCFQ=='));
    expect([utf8(z.out), z.outcome.ok && z.outcome.format]).toEqual(['hello', 'zlib']);
    expect(utf8((await work(dec('deflate-raw'), b64('y0jNyckHAA=='))).out)).toBe('hello');
    expect(utf8((await work(dec('deflate-raw'), b64('AQUA+v9oZWxsbw=='))).out)).toBe('hello');
  });

  it('5: empty streams of every deflate format', async () => {
    for (const [job, text] of [
      [dec('deflate-raw'), 'AwA='],
      [auto, 'H4sIAAAAAAAAAwMAAAAAAAAAAAA='],
      [auto, 'eJwDAAAAAAE='],
    ] as const) {
      const { outcome } = await work(job, b64(text));
      expect(outcome).toMatchObject({ ok: true, outputBytes: 0 });
    }
  });

  it('6, 7: zstd (recognised) and brotli (chosen)', async () => {
    const z = await work(auto, b64('KLUv/SAFKQAAaGVsbG8='));
    expect([utf8(z.out), z.outcome.ok && z.outcome.format]).toEqual(['hello', 'zstd']);
    expect(utf8((await work(dec('brotli'), b64('CwKAaGVsbG8D'))).out)).toBe('hello');
    expect((await work(dec('brotli'), b64('Ow=='))).outcome).toMatchObject({ ok: true, outputBytes: 0 });
  });

  it('8: every header field, shown as data', async () => {
    const input = b64('H4sIHgDxU2UAAwYAQUICAGhpaGVsbG8udHh0AG1hZGUgYnkgaGFuZAC76/NIzcnJ11EIzy/KSVHkAgCEnui0DgAAAA==');
    const { outcome, out } = await work(auto, input);
    expect(utf8(out)).toBe('Hello, World!\n');
    if (!outcome.ok) throw new Error('failed');
    expect(headerRows(outcome.header!)).toEqual([
      { label: 'Name', value: 'hello.txt' },
      { label: 'Modified', value: '2023-11-14T22:13:20Z' },
      { label: 'Comment', value: 'made by hand' },
      { label: 'Operating system', value: 'Unix (3)' },
      { label: 'Extra field', value: '6 bytes' },
      { label: 'Header CRC', value: 'present' },
    ]);
    expect(decompressedName('x.gz', outcome.header!.name, true)).toBe('hello.txt');
  });

  it('9: two members, one after another (as gunzip)', async () => {
    const input = b64('H4sIAAAAAAAAA8tIzcnJVwAA9vmB7QYAAAAfiwgAAAAAAAADK88vykkBAEMRdzoFAAAA');
    const { outcome, out } = await work(auto, input);
    expect(utf8(out)).toBe('hello world');
    expect(outcome).toMatchObject({ ok: true, members: 2 });
    expect(gzipMembers(2)).toBe('2 gzip members, decompressed one after another (as gunzip does).');
  });

  it('10, 11: bytes after the end are ignored with a note, the result stays', async () => {
    for (const [tail, bytes] of [
      ['xyz', 3],
      ['\0\0\0\0', 4],
    ] as const) {
      const input = new Uint8Array([...HELLO_GZ, ...Buffer.from(tail)]);
      const { outcome, out } = await work(auto, input);
      expect(utf8(out)).toBe('hello');
      expect(outcome).toMatchObject({ ok: true, members: 1, trailing: { at: 25, bytes } });
    }
    expect(gzipTrailing(3, 26)).toBe(
      'After the end of the gzip data: 3 bytes at byte 26 are not gzip and were ignored.',
    );
  });

  it('12–15: cut, wrong CRC, wrong length, wrong Adler-32', async () => {
    expect(failure((await work(auto, HELLO_GZ.slice(0, -5))).outcome)).toBe(TRUNCATED);
    const crc = HELLO_GZ.slice();
    crc.fill(0, 17, 21);
    expect(failure((await work(auto, crc)).outcome)).toBe(GZIP_CRC);
    const len = HELLO_GZ.slice();
    len.set([9, 0, 0, 0], 21);
    expect(failure((await work(auto, len)).outcome)).toBe(GZIP_LENGTH);
    expect(failure((await work(dec('zlib'), b64('eJzLSM3JyQcAAQIDBA=='))).outcome)).toBe(ZLIB_ADLER);
  });

  it('16–19: zlib header check, preset dictionary, not recognised, not gzip', async () => {
    expect(failure((await work(dec('zlib'), b64('eJ3LSM3JyQcABiwCFQ=='))).outcome)).toBe(notZlib(0x78, 0x9d));
    expect(notZlib(0x78, 0x9d)).toBe('This is not zlib data: the header check fails (CMF 0x78, FLG 0x9d).');
    expect(failure((await work(auto, b64('eLsECQGly0jNyckHAAYsAhU='))).outcome)).toBe(zlibDictionary(0x040901a5));
    expect(zlibDictionary(0x040901a5)).toBe(
      'This zlib stream needs a preset dictionary (id 0x040901a5), which is not part of the data.',
    );
    expect(failure((await work(auto, b64('aGVsbG8='))).outcome)).toBe(NOT_RECOGNISED);
    expect(failure((await work(dec('gzip'), b64('aGVsbG8='))).outcome)).toBe(NOT_GZIP);
  });

  it('20–24: text, not UTF-8, a byte order mark, NUL, CR LF', async () => {
    const text = (await work(auto, gz('Привет, мир 😀'))).result;
    expect([utf8(text.bytes!), text.verdict.text]).toEqual(['Привет, мир 😀', true]);
    const bad = (await work(auto, gz(new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x41])))).result;
    expect(bad.verdict).toMatchObject({ text: false, firstInvalid: 1, firstNul: null });
    expect(notUtf8(1)).toBe('Not text: not valid UTF-8 from byte 1.');
    const bom = (await work(auto, gz(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])))).result;
    expect(bom.verdict).toMatchObject({ text: true, bom: true });
    expect(BOM_NOTE).toBe('Starts with a byte order mark (U+FEFF).');
    const nul = (await work(auto, gz(new Uint8Array([0x61, 0, 0x62])))).result;
    expect(nul.verdict).toMatchObject({ text: false, firstInvalid: null, firstNul: 2 });
    expect(nulByte(2)).toBe('Not text: a NUL byte at byte 2.');
    const crlf = (await work(auto, gz('a\r\nb'))).result;
    expect(crlf.verdict.text).toBe(true);
    expect(showControls('a\r\nb')).toBe('a\u{240d}\nb');
    expect(countControls('a\r\nb')).toBe(1);
    expect(controlsNote(1)).toBe('1 control character, shown as a symbol. Copy copies the real characters.');
  });
});

describe('§10 compression rows', () => {
  it('25, 29: gzip of hello — no name, no time, OS 255 — in Base64 and hex', async () => {
    const { out } = await work(comp('gzip'), textBytes('hello'));
    expect(base64(out)).toBe('H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA==');
    expect(hex(out)).toBe('1f8b08000000000000ffcb48cdc9c9070086a6103605000000');
    expect(utf8(zlib.gunzipSync(out))).toBe('hello');
  });

  it('26: zlib and raw deflate are zlib level 6', async () => {
    expect(base64((await work(comp('zlib'), textBytes('hello'))).out)).toBe('eJzLSM3JyQcABiwCFQ==');
    expect(base64((await work(comp('deflate-raw'), textBytes('hello'))).out)).toBe('y0jNyckHAA==');
  });

  it('27, 28: zstd level 3 and brotli quality 11', async () => {
    expect(base64((await work(comp('zstd', 3), textBytes('hello'))).out)).toBe('KLUv/QBYKQAAaGVsbG8=');
    expect(base64((await work(comp('brotli', 11), textBytes('hello'))).out)).toBe('CwKAaGVsbG8D');
  });

  it('brotli: the empty input is the stream brotli writes for it; a broken encoder output is refused (§15)', async () => {
    expect(hex((await work(comp('brotli', 11), new Uint8Array(0))).out)).toBe('3b');
    expect(utf8((await work(dec('brotli'), new Uint8Array([0x3b]))).out)).toBe('');
    // The library writes a stream that does not decompress to its input here (quality 2, 2 MiB of these bytes).
    const n = 2 * 1024 * 1024;
    const input = new Uint8Array(n).map((_, i) => (Math.imul(i, 2654435761) >>> 24) & 255);
    const { outcome } = await work(comp('brotli', 2), input);
    expect(failure(outcome)).toBe(BROTLI_ENCODER_BROKE);
    const fine = await work(comp('brotli', 5), input);
    expect(fine.outcome.ok && Buffer.compare(zlib.brotliDecompressSync(fine.out), Buffer.from(input))).toBe(0);
  });

  it('30: Keep the file’s name and time writes FNAME and MTIME', async () => {
    expect(hex(gzipHeaderBytes({ name: 'a.txt', mtime: 1700000000 }))).toBe(
      '1f8b080800f15365' + '00ff' + '612e74787400',
    );
    const { out } = await work({ ...comp('gzip'), keep: { name: 'a.txt', mtime: 1700000000 } }, textBytes('hello'));
    expect(readGzipHeader(out)).toMatchObject({ ok: true, header: { name: 'a.txt', mtime: 1700000000, os: 255 } });
    expect(utf8(zlib.gunzipSync(out))).toBe('hello');
  });

  it('31: past the limit the work stops and says how much and what ratio', async () => {
    const bomb = new Uint8Array(zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024), { level: 9 }));
    const { outcome } = await work(auto, bomb, { limit: 1024 * 1024, piece: 4096 });
    expect(outcome).toMatchObject({ ok: false, reason: 'limit' });
    expect(failure(outcome)).toBe(stoppedAt(1024 * 1024, bomb.length));
    expect(stoppedAt(1024 ** 3, 1042617)).toBe(
      'Stopped at 1 GiB of output from 1,042,617 bytes of input (ratio over 1,029 : 1): the tool decompresses at most 1 GiB. This may be a decompression bomb.',
    );
  });

  it('31 with a real stream (Node’s): the limit stops the feeding too — nothing waits for a reader that has stopped', async () => {
    const bomb = new Uint8Array(zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024), { level: 9 }));
    const sink = createCollector(Infinity, 16);
    const outcome = await run(auto, bytesSource(bomb), sink, { codecs, limit: 1024 * 1024 });
    expect(outcome).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('empty input compresses to a valid stream (an empty file)', async () => {
    expect(hex((await work(comp('gzip'), new Uint8Array(0))).out)).toBe('1f8b08000000000000ff03000000000000000000');
  });
});

describe('§6 errors and edge cases', () => {
  it('reads Base64 by the shared parser and hex by hex-ascii’s rules, with places and hints', () => {
    expect(parseInput('H4sI!', 'base64')).toMatchObject({
      ok: false,
      error: { message: 'Line 1, column 5: invalid character "!"' },
    });
    expect(parseInput('1f 8g', 'hex')).toMatchObject({
      ok: false,
      error: { message: 'Line 1, column 5: "g" is not a hex digit' },
    });
    expect(parseInput('1f8', 'hex')).toMatchObject({
      ok: false,
      error: { message: 'Line 1, column 1: odd number of hex digits in "1f8"' },
    });
    expect(parseInput('H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==', 'hex')).toMatchObject({
      ok: false,
      hint: 'This looks like Base64: choose Base64.',
    });
    expect(parseInput('0x1f, 0x8b\n\\x08', 'hex')).toEqual({ ok: true, bytes: new Uint8Array([0x1f, 0x8b, 8]) });
    expect(hexInsteadOfBase64('1f8b0800000000000003cb48cdc9c9070086a6103605000000')).toBe(true);
    expect(hexInsteadOfBase64('deadbeef')).toBe(false);
  });

  it('empty file, header texts, zstd and brotli errors', async () => {
    expect(failure((await work(auto, new Uint8Array(0))).outcome)).toBe(EMPTY_FILE);
    expect(readGzipHeader(new Uint8Array([0x1f, 0x8b, 9, 0, 0, 0, 0, 0, 0, 3]))).toEqual({
      ok: false,
      message: gzipMethod(9),
    });
    expect(gzipMethod(9)).toBe('This gzip member uses compression method 9; only deflate (8) exists.');
    expect(readGzipHeader(new Uint8Array([0x1f, 0x8b, 8, 0x20, 0, 0, 0, 0, 0, 3]))).toEqual({
      ok: false,
      message: gzipFlags(0x20),
    });
    expect(gzipFlags(0x20)).toBe('The gzip header has reserved flag bits set (FLG 0x20): the data is damaged.');
    expect(failure((await work(auto, HELLO_GZ.slice(0, 5))).outcome)).toBe(GZIP_HEADER_CUT);
    expect(failure((await work(dec('zstd'), b64('aGVsbG8gd29ybGQ='))).outcome)).toBe(NOT_ZSTD);
    const zst = b64('KLUv/SAFKQAAaGVsbG8=');
    expect(failure((await work(dec('zstd'), zst.slice(0, -2))).outcome)).toBe(ZSTD_TRUNCATED);
    expect(failure((await work(dec('brotli'), b64('CwKAaGVsbG8D').slice(0, -1))).outcome)).toBe(BROTLI_TRUNCATED);
    expect(failure((await work(dec('brotli'), b64('aGVsbG8gd29ybGQ='))).outcome)).toMatch(
      /^This is not valid brotli data \(ERROR_/,
    );
  });

  it('a zstd frame with a wrong checksum, a window over 128 MiB, frames and data after the end', async () => {
    const withSum = new Uint8Array(
      zlib.zstdCompressSync(Buffer.from('hello hello hello'), { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }),
    );
    const broken = withSum.slice();
    broken[broken.length - 1]! ^= 0xff;
    expect(failure((await work(dec('zstd'), broken)).outcome)).toBe(ZSTD_CHECKSUM);
    // A frame header that declares a 256 MiB window (Window_Descriptor 0x90) and no content size.
    const declared = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x90, 0x01, 0x00, 0x00]);
    expect(failure((await work(dec('zstd'), declared)).outcome)).toBe(
      'This zstd frame needs a window over 128 MiB; the tool, like zstd without --memory, refuses it.',
    );
    const two = new Uint8Array([...b64('KLUv/SAFKQAAaGVsbG8='), ...b64('KLUv/SAFKQAAaGVsbG8='), 0x78, 0x79]);
    const { outcome, out } = await work(auto, two);
    expect(utf8(out)).toBe('hellohello');
    expect(outcome).toMatchObject({ ok: true, trailing: { at: 28, bytes: 2 } });
    expect(streamTrailing(2, 29)).toBe('After the end of the compressed stream: 2 bytes at byte 29 were ignored.');
    const br = await work(dec('brotli'), new Uint8Array([...b64('CwKAaGVsbG8D'), 1, 2, 3]));
    expect(br.outcome).toMatchObject({ ok: true, trailing: { at: 9, bytes: 3 } });
  });

  it('zlib and raw deflate with bytes after the end: scanned, inflated again, noted', async () => {
    const z = new Uint8Array([...b64('eJzLSM3JyQcABiwCFQ=='), 0x21]);
    const r = await work(auto, z);
    expect([utf8(r.out), r.outcome]).toMatchObject(['hello', { ok: true, trailing: { at: 13, bytes: 1 } }]);
    const raw = new Uint8Array([...b64('y0jNyckHAA=='), 1, 2]);
    expect((await work(dec('deflate-raw'), raw)).outcome).toMatchObject({ ok: true, trailing: { at: 7, bytes: 2 } });
  });

  it('cancelling stops the work', async () => {
    const controller = new AbortController();
    controller.abort();
    const { outcome } = await work(auto, HELLO_GZ, { signal: controller.signal });
    expect(outcome).toMatchObject({ ok: false, reason: 'cancelled', message: 'Cancelled.' });
  });

  it('hints under the Text field', () => {
    expect(textHints('abc\n')).toEqual(['trailing-newline']);
    expect(textHints(' abc')).toEqual(['edge-space']);
    expect(textHints('abc')).toEqual([]);
  });
});

describe('§7 detectCompress', () => {
  it.each([
    ['H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==', true],
    ['eJzLSM3JyQcABiwCFQ==', true],
    ['KLUv/SAFKQAAaGVsbG8=', true],
    ['1f8b0800000000000003cb48cdc9c9070086a6103605000000', true],
    ['  H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==\n', true],
    ['y0jNyckHAA==', false],
    ['CwKAaGVsbG8D', false],
    ['SGVsbG8sIFdvcmxkIQ==', false],
    ['aGVsbG8gd29ybGQ', false],
    ['H4sI', false],
    ['H4sIAAAA', false],
    ['48656c6c6f2c20776f726c64', false],
    ['eJyrVkrLz1eyUkpKLFKqBQAdeQRW', true],
    ['eJ0rrVkrLz1eyUkpKLFKqBQAdeQRW', false],
    ['H4sI AAAAAAAAA8tIzcnJBwCGphA2BQAAAA==', false],
  ])('%s → %s', (text, expected) => expect(detectCompress(text)).toBe(expected));

  it('stops at the length limit before looking', () => {
    expect(detectCompress(`H4sIAAAA${'A'.repeat(2 * 1024 * 1024)}`)).toBe(false);
  });
});

describe('the pieces', () => {
  it('recognises formats by their first bytes (§5.2)', () => {
    expect(recogniseFormat(new Uint8Array([0x1f, 0x8b]))).toBe('gzip');
    expect(recogniseFormat(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).toBe('zstd');
    expect(recogniseFormat(new Uint8Array([0x50, 0x2a, 0x4d, 0x18]))).toBe('zstd');
    for (const flg of [0x01, 0x5e, 0x9c, 0xda]) expect(recogniseFormat(new Uint8Array([0x78, flg]))).toBe('zlib');
    expect(recogniseFormat(new Uint8Array([0x78, 0x9d]))).toBeNull();
    expect(recogniseFormat(new Uint8Array([0x0b, 0x02]))).toBeNull();
  });

  it('scans deflate streams of every block type to their exact end', async () => {
    const rnd = new Uint8Array(200_000).map((_, i) => (Math.imul(i, 2654435761) >>> 13) & 255);
    for (const [data, level] of [
      [Buffer.from('hello'), 6],
      [Buffer.alloc(300_000, 'abcabcabd'), 9],
      [Buffer.from(rnd), 6],
      [Buffer.from(rnd), 0],
      [Buffer.alloc(0), 6],
    ] as const) {
      const stream = new Uint8Array(zlib.deflateRawSync(data, { level }));
      const withTail = new Uint8Array([...stream, 0xde, 0xad]);
      const src = bytesSource(withTail);
      const scan = await scanDeflateEnd((o, l) => src.read(o, l), 0, withTail.length, 4096);
      expect(scan).toEqual({ ok: true, end: stream.length });
    }
    const cut = new Uint8Array(zlib.deflateRawSync(Buffer.alloc(100_000, 'xyz'))).slice(0, 20);
    const src = bytesSource(cut);
    expect(await scanDeflateEnd((o, l) => src.read(o, l), 0, cut.length)).toEqual({ ok: false, reason: 'truncated' });
    const bad = new Uint8Array([0x07]);
    expect(await scanDeflateEnd(async () => bad, 0, 1)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('checks text over pieces and finds the first bad byte across a boundary', () => {
    const bytes = new TextEncoder().encode('ab€cd😀ef');
    for (let cut = 0; cut <= bytes.length; cut++) {
      const check = new TextCheck();
      check.push(bytes.subarray(0, cut));
      check.push(bytes.subarray(cut));
      expect(check.result()).toEqual({ text: true, firstInvalid: null, firstNul: null, bom: false });
    }
    const broken = new Uint8Array([0x61, 0xe2, 0x82, 0x41, 0x42]);
    for (let cut = 0; cut <= broken.length; cut++) {
      const check = new TextCheck();
      check.push(broken.subarray(0, cut));
      check.push(broken.subarray(cut));
      expect(check.result().firstInvalid).toBe(2);
    }
    const unfinished = new TextCheck();
    unfinished.push(new Uint8Array([0x61, 0xf0, 0x9f]));
    expect(unfinished.result().firstInvalid).toBe(2);
    expect(firstInvalidUtf8(new Uint8Array([0xc0, 0x80]))).toBe(0);
    expect(firstInvalidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBe(0);
  });

  it('collects up to the hold, keeps the head beyond it', () => {
    const c = createCollector(10, 4);
    c.write(new Uint8Array([1, 2, 3]));
    c.write(new Uint8Array([4, 5, 6]));
    expect(c.result()).toMatchObject({
      size: 6,
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
      head: new Uint8Array([1, 2, 3, 4]),
    });
    c.write(new Uint8Array(10));
    expect(c.result()).toMatchObject({ size: 16, bytes: null, head: new Uint8Array([1, 2, 3, 4]) });
  });

  it('writes sizes, ratios and names (§5.7, §5.10)', () => {
    expect(formatSize(1)).toBe('1 byte');
    expect(formatSize(852_040_121)).toBe('812.6 MB (852,040,121 bytes)');
    expect(formatRatio(23, 5)).toBe('4.60 : 1');
    expect(formatRatio(1029.9, 1)).toBe('1,029 : 1');
    expect(sizesLine(5, 25, 'compress')).toBe('5 bytes → 25 bytes · ratio 0.20 : 1');
    expect(decompressedName('access.log.gz', undefined, true)).toBe('access.log');
    expect(decompressedName('x.tgz', undefined, false)).toBe('x.tar');
    expect(decompressedName(null, undefined, false)).toBe('decompressed.bin');
    expect(compressedName('dump.sql', 'zstd', 'file')).toBe('dump.sql.zst');
    expect(compressedName(null, 'gzip', 'text')).toBe('text.gz');
  });

  it('runs on a Blob read by slices as on bytes', async () => {
    const data = new Uint8Array(3_000_000).map((_, i) => (i * 7 + (i >> 9)) & 0x7f);
    const sink = createCollector(Infinity, Infinity);
    const outcome = await run({ direction: 'decompress', format: 'auto' }, bytesSource(gz(data)), sink, {
      codecs,
      piece: 65536,
    });
    expect(outcome).toMatchObject({ ok: true, outputBytes: data.length });
    expect(Buffer.compare(Buffer.from(sink.result().bytes!), Buffer.from(data))).toBe(0);
  });
});
