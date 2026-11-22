/**
 * The work itself (docs/tools/specs/compress.md §5): input read a piece at a time from a source (a file is never read
 * whole), through the browser's CompressionStream / DecompressionStream or the zstd and brotli drivers, into a sink —
 * with the output limit held between pieces, progress, and cancelling. The same function runs in the tool's worker
 * and, where there are no workers, on the page.
 *
 * gzip has several members and data after the end handled as gunzip does (§5.3): the browser fails on both and drops
 * output it had not handed over, so the stream is first given to it whole (one member — the usual case — costs nothing
 * more); on "junk" its output is dropped (the sink is reset), the end of each member is found by the deflate scanner,
 * and each member is inflated again with exactly its own bytes.
 */
import {
  BROTLI_ERROR,
  BROTLI_NEEDS_INPUT,
  BROTLI_SUCCESS,
  LibraryError,
  STREAM_INPUT,
  createBrotliDecoder,
  createZstdDecoder,
  createZstdEncoder,
} from './codecs';
import { scanDeflateEnd } from './deflateScan';
import { isZlibHeader, recogniseFormat } from './formats';
import { gzipHeaderBytes, readGzipHeader } from './gzipHeader';
import { BROTLI_COMPRESS_MAX, CHUNK_BYTES, MAX_OUTPUT } from './limits';
import {
  BROTLI_ENCODER_BROKE,
  BROTLI_TOO_LARGE,
  BROTLI_TRUNCATED,
  CANCELLED,
  EMPTY_FILE,
  GZIP_CRC,
  GZIP_LENGTH,
  NOT_GZIP,
  NOT_RECOGNISED,
  NOT_ZSTD,
  READ_FAILED,
  TRUNCATED,
  ZLIB_ADLER,
  ZSTD_CHECKSUM,
  ZSTD_TRUNCATED,
  ZSTD_WINDOW,
  damaged,
  libraryFailed,
  notBrotli,
  notZlib,
  stoppedAt,
  zlibDictionary,
  zstdDamaged,
} from './messages';
import type { BrotliCompress, WasmSource } from './codecs';
import type { Direction, Format, FormatChoice } from './formats';
import type { GzipHeader } from './gzipHeader';

/** Where the input comes from: a file (a Blob, read by slices) or bytes in memory. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const bytesSource = (bytes: Uint8Array): ByteSource => ({
  size: bytes.length,
  read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
});

/** A Blob read a slice at a time (the hash tool's lesson: slice().arrayBuffer() notices a file changed on disk). */
export const blobSource = (blob: Blob): ByteSource => ({
  size: blob.size,
  read: async (offset, length) => {
    try {
      return new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + length)).arrayBuffer());
    } catch {
      throw new ReadFailed();
    }
  },
});

/** Where the output goes; `reset` drops everything written so far (the gzip path starts again, §5.3). */
export interface Sink {
  write(chunk: Uint8Array): void | Promise<void>;
  reset(): void | Promise<void>;
}

export interface Codecs {
  zstd?: WasmSource;
  brotliDecoder?: WasmSource;
  brotliCompress?: BrotliCompress;
}

export interface Job {
  direction: Direction;
  format: FormatChoice;
  /** zstd level or brotli quality (Compress). */
  level?: number;
  /** gzip Compress: write this name and time into the header (§5.4). */
  keep?: { name: string; mtime: number };
}

/** The browser's streams (a seam: Node's own differ from Chrome's — they read several gzip members and say little). */
export interface Streams {
  decompress(kind: 'gzip' | 'deflate' | 'deflate-raw'): TransformStream<Uint8Array, Uint8Array>;
  compress(kind: 'gzip' | 'deflate' | 'deflate-raw'): TransformStream<Uint8Array, Uint8Array>;
}

export const browserStreams: Streams = {
  decompress: kind => new DecompressionStream(kind) as unknown as TransformStream<Uint8Array, Uint8Array>,
  compress: kind => new CompressionStream(kind) as unknown as TransformStream<Uint8Array, Uint8Array>,
};

export interface RunOptions {
  codecs: Codecs;
  streams?: Streams;
  /** Decompressed output past this stops the work (§5.8). */
  limit?: number;
  /** Bytes of input read so far. */
  onProgress?: (read: number, total: number) => void;
  signal?: AbortSignal;
  /** Piece size (tests make it small). */
  piece?: number;
}

export type RunOutcome =
  | {
      ok: true;
      format: Format;
      recognised: boolean;
      inputBytes: number;
      outputBytes: number;
      header?: GzipHeader;
      members?: number;
      trailing?: { at: number; bytes: number };
    }
  | {
      ok: false;
      reason: 'error' | 'limit' | 'cancelled';
      message: string;
      inputBytes: number;
      outputBytes: number;
      format?: Format;
    };

/** Bytes written to a browser stream at a time (see `browser`). */
const FEED = 16 * 1024;

class ReadFailed extends Error {}
class Failure extends Error {}
class LimitReached extends Error {}
class Cancelled extends Error {}
class Junk extends Error {}

const BROWSER_PREFIX = /^The compressed data was not valid:\s*/;

/** The browser's message (Chrome's zlib wording) as the tool's sentence (§6). */
const browserError = (error: unknown, format: Format): Error => {
  if (!(error instanceof Error) || error instanceof Failure || error instanceof LimitReached) return error as Error;
  if (error instanceof Cancelled || error instanceof ReadFailed || error instanceof LibraryError) return error;
  const m = error.message;
  if (/junk found/i.test(m)) return new Junk();
  if (/truncated/i.test(m)) return new Failure(TRUNCATED);
  if (/incorrect data check/i.test(m)) return new Failure(format === 'gzip' ? GZIP_CRC : ZLIB_ADLER);
  if (/incorrect length check/i.test(m)) return new Failure(GZIP_LENGTH);
  if (/incorrect header check/i.test(m) && format === 'gzip') return new Failure(NOT_GZIP);
  return new Failure(damaged(m.replace(BROWSER_PREFIX, '') || 'unknown error'));
};

/** Does `compressed` decompress, by the reference brotli decoder, to exactly `original`? */
const brotliRoundTrips = async (source: WasmSource, compressed: Uint8Array, original: Uint8Array): Promise<boolean> => {
  const dec = await createBrotliDecoder(source);
  try {
    let at = 0;
    for (let i = 0; i < compressed.length; i += STREAM_INPUT) {
      dec.setInput(compressed.subarray(i, i + STREAM_INPUT));
      for (;;) {
        const step = dec.step();
        if (step.ret === BROTLI_ERROR) return false;
        for (let k = 0; k < step.out.length; k++) if (step.out[k] !== original[at + k]) return false;
        at += step.out.length;
        if (step.ret === BROTLI_SUCCESS) return at === original.length && i + step.consumed === compressed.length;
        if (step.ret === BROTLI_NEEDS_INPUT) break;
      }
    }
    return false;
  } finally {
    dec.dispose();
  }
};

export const run = async (job: Job, source: ByteSource, sink: Sink, options: RunOptions): Promise<RunOutcome> => {
  const piece = options.piece ?? CHUNK_BYTES;
  const limit = options.limit ?? MAX_OUTPUT;
  const total = source.size;
  let inputRead = 0;
  let outputBytes = 0;
  let format: Format | undefined = job.format === 'auto' ? undefined : job.format;

  const check = (): void => {
    if (options.signal?.aborted) throw new Cancelled();
  };
  const progress = (read: number): void => {
    inputRead = Math.max(inputRead, read);
    options.onProgress?.(Math.min(read, total), total);
  };
  const emit = async (chunk: Uint8Array): Promise<void> => {
    if (chunk.length === 0) return;
    if (job.direction === 'decompress' && outputBytes + chunk.length > limit) {
      outputBytes += chunk.length;
      throw new LimitReached();
    }
    outputBytes += chunk.length;
    await sink.write(chunk);
  };
  const reset = async (): Promise<void> => {
    outputBytes = 0;
    await sink.reset();
  };

  /** [from, to) of the source through a browser stream into `out`. */
  const browser = async (
    kind: 'gzip' | 'deflate' | 'deflate-raw',
    from: number,
    to: number,
    out: (chunk: Uint8Array) => Promise<void>,
  ): Promise<void> => {
    const streams = options.streams ?? browserStreams;
    const stream = job.direction === 'decompress' ? streams.decompress(kind) : streams.compress(kind);
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let failure: unknown = null;
    // Settles when the reading side stops early (the sink refused: the output limit, a failed write): the feeding
    // side must not wait for a reader that is gone — a writer's `ready` would never settle.
    let stopReading: () => void = () => undefined;
    const readerStopped = new Promise<void>(resolve => (stopReading = resolve));
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          await out(value);
        }
      } catch (error) {
        failure ??= error;
        stopReading();
        reader.cancel(error).catch(() => undefined);
        writer.abort(error).catch(() => undefined);
      }
    })();
    try {
      for (let at = from; at < to && failure === null;) {
        check();
        const chunk = await source.read(at, Math.min(piece, to - at));
        if (chunk.length === 0) break;
        // The browser inflates a whole written chunk at once and queues all its output: 1 MiB of a bomb would be a
        // gigabyte in the queue before anyone reads it. Small writes, each after the reader has caught up (`ready`),
        // keep the queue under FEED × 1 032 (deflate's largest ratio) — about 16 MiB.
        for (let k = 0; k < chunk.length && failure === null; k += FEED) {
          await Promise.race([writer.ready, readerStopped]);
          if (failure !== null) break;
          await Promise.race([writer.write(chunk.subarray(k, k + FEED)), readerStopped]);
        }
        at += chunk.length;
        progress(at);
      }
      if (failure === null) await Promise.race([writer.close(), readerStopped]);
    } catch (error) {
      failure ??= error;
      reader.cancel(error).catch(() => undefined);
    }
    await pump;
    if (failure !== null) throw browserError(failure, format!);
  };

  const head = async (at: number, length: number): Promise<Uint8Array> => source.read(at, Math.min(length, total - at));

  try {
    if (job.direction === 'decompress') {
      if (total === 0) throw new Failure(EMPTY_FILE);
      let recognised = false;
      if (!format) {
        format = recogniseFormat(await head(0, 4)) ?? undefined;
        if (!format) throw new Failure(NOT_RECOGNISED);
        recognised = true;
      }
      const done = (extra: Partial<Extract<RunOutcome, { ok: true }>> = {}): RunOutcome => ({
        ok: true,
        format: format!,
        recognised,
        inputBytes: total,
        outputBytes,
        ...extra,
      });

      if (format === 'gzip') {
        const first = await head(0, 1 << 20);
        const read = readGzipHeader(first, total <= first.length);
        if (read.ok === false) throw new Failure(read.message);
        const header = read.ok === true ? read.header : undefined;
        try {
          await browser('gzip', 0, total, emit);
          return done({ ...(header ? { header } : {}), members: 1 });
        } catch (error) {
          if (!(error instanceof Junk)) throw error;
        }
        // Several members, or bytes after the end (§5.3).
        await reset();
        let at = 0;
        let members = 0;
        let trailing: { at: number; bytes: number } | undefined;
        while (at < total) {
          check();
          const bytes = await head(at, 1 << 20);
          if (members > 0 && !(bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8)) {
            trailing = { at, bytes: total - at };
            break;
          }
          const member = readGzipHeader(bytes, total - at <= bytes.length);
          if (member.ok !== true) throw new Failure(member.ok === false ? member.message : TRUNCATED);
          const scan = await scanDeflateEnd((o, l) => source.read(o, l), at + member.header.length, total, piece);
          if (!scan.ok) {
            if (scan.reason === 'truncated') throw new Failure(TRUNCATED);
            // Let the browser name the damage.
            await browser('gzip', at, total, emit);
            throw new Failure(damaged('invalid deflate data'));
          }
          const end = scan.end + 8;
          if (end > total) throw new Failure(TRUNCATED);
          await browser('gzip', at, end, emit);
          members++;
          at = end;
          progress(at);
        }
        return done({ ...(header ? { header } : {}), members, ...(trailing ? { trailing } : {}) });
      }

      if (format === 'zlib' || format === 'deflate-raw') {
        const kind = format === 'zlib' ? 'deflate' : 'deflate-raw';
        if (format === 'zlib') {
          const h = await head(0, 6);
          if (h.length >= 2 && !isZlibHeader(h[0]!, h[1]!)) throw new Failure(notZlib(h[0]!, h[1]!));
          if (h.length >= 2 && h[1]! & 0x20)
            throw new Failure(
              h.length >= 6 ? zlibDictionary(((h[2]! << 24) | (h[3]! << 16) | (h[4]! << 8) | h[5]!) >>> 0) : TRUNCATED,
            );
        }
        try {
          await browser(kind, 0, total, emit);
          return done();
        } catch (error) {
          if (!(error instanceof Junk)) throw error;
        }
        await reset();
        const start = format === 'zlib' ? 2 : 0;
        const scan = await scanDeflateEnd((o, l) => source.read(o, l), start, total, piece);
        if (!scan.ok) throw new Failure(scan.reason === 'truncated' ? TRUNCATED : damaged('invalid deflate data'));
        const end = scan.end + (format === 'zlib' ? 4 : 0);
        if (end > total) throw new Failure(TRUNCATED);
        await browser(kind, 0, end, emit);
        return done({ trailing: { at: end, bytes: total - end } });
      }

      if (format === 'zstd') {
        if (!options.codecs.zstd) throw new Failure(libraryFailed('zstd', 'decoder'));
        const dec = await createZstdDecoder(options.codecs.zstd);
        try {
          let lastRet = -1;
          let frames = 0;
          let frameEnd: number | null = null;
          const startsFrame = (b: Uint8Array): boolean => recogniseFormat(b) === 'zstd';
          for (let at = 0; at < total;) {
            check();
            const chunk = await source.read(at, Math.min(piece, STREAM_INPUT, total - at));
            dec.setInput(chunk);
            for (;;) {
              const step = dec.step();
              const error = dec.error(step.ret);
              if (error) {
                if (error === 'prefix_unknown') {
                  if (frames > 0 && frameEnd !== null)
                    return done({ trailing: { at: frameEnd, bytes: total - frameEnd } });
                  throw new Failure(NOT_ZSTD);
                }
                if (error === 'checksum_wrong') throw new Failure(ZSTD_CHECKSUM);
                if (error === 'frameParameter_windowTooLarge') throw new Failure(ZSTD_WINDOW);
                throw new Failure(zstdDamaged(error));
              }
              await emit(step.out);
              lastRet = step.ret;
              if (step.ret === 0) {
                frames++;
                frameEnd = at + step.consumed;
              }
              if (step.drained && !step.full) break;
            }
            at += chunk.length;
            progress(at);
          }
          if (lastRet !== 0) {
            if (frameEnd !== null && !startsFrame(await head(frameEnd, 4)))
              return done({ trailing: { at: frameEnd, bytes: total - frameEnd } });
            throw new Failure(frames === 0 && !startsFrame(await head(0, 4)) ? NOT_ZSTD : ZSTD_TRUNCATED);
          }
          return done();
        } finally {
          dec.dispose();
        }
      }

      // brotli
      if (!options.codecs.brotliDecoder) throw new Failure(libraryFailed('brotli', 'decoder'));
      const dec = await createBrotliDecoder(options.codecs.brotliDecoder);
      try {
        let end: number | null = null;
        for (let at = 0; at < total && end === null;) {
          check();
          const chunk = await source.read(at, Math.min(piece, STREAM_INPUT, total - at));
          dec.setInput(chunk);
          for (;;) {
            const step = dec.step();
            if (step.ret === BROTLI_ERROR) throw new Failure(notBrotli(dec.errorName()));
            await emit(step.out);
            if (step.ret === BROTLI_SUCCESS) {
              end = at + step.consumed;
              break;
            }
            if (step.ret === BROTLI_NEEDS_INPUT) break;
          }
          at += chunk.length;
          progress(at);
        }
        if (end === null) throw new Failure(BROTLI_TRUNCATED);
        return done(end < total ? { trailing: { at: end, bytes: total - end } } : {});
      } finally {
        dec.dispose();
      }
    }

    // ---- Compress
    const target = format!;
    const done = (): RunOutcome => ({ ok: true, format: target, recognised: false, inputBytes: total, outputBytes });
    if (target === 'gzip' || target === 'zlib' || target === 'deflate-raw') {
      if (target !== 'gzip') {
        await browser(target === 'zlib' ? 'deflate' : 'deflate-raw', 0, total, emit);
        return done();
      }
      // The browser's 10-byte header is replaced: OS 255, and the file's name and time when kept (§5.4).
      let skip = 10;
      await browser('gzip', 0, total, async chunk => {
        if (skip > 0) {
          if (skip === 10) await emit(gzipHeaderBytes(job.keep));
          const cut = Math.min(skip, chunk.length);
          skip -= cut;
          chunk = chunk.subarray(cut);
        }
        await emit(chunk);
      });
      return done();
    }
    if (target === 'zstd') {
      if (!options.codecs.zstd) throw new Failure(libraryFailed('zstd', 'encoder'));
      const enc = await createZstdEncoder(options.codecs.zstd, job.level ?? 3);
      try {
        const drive = async (end: boolean): Promise<void> => {
          for (;;) {
            const step = enc.step(end);
            const error = enc.error(step.ret);
            if (error) throw new Failure(zstdDamaged(error));
            await emit(step.out);
            if (end ? step.ret === 0 : step.drained && !step.full) return;
          }
        };
        for (let at = 0; at < total;) {
          check();
          const chunk = await source.read(at, Math.min(piece, STREAM_INPUT, total - at));
          enc.setInput(chunk);
          await drive(false);
          at += chunk.length;
          progress(at);
        }
        enc.setInput(new Uint8Array(0));
        await drive(true);
        return done();
      } finally {
        enc.dispose();
      }
    }
    // brotli: the encoder takes the whole input.
    if (total > BROTLI_COMPRESS_MAX) throw new Failure(BROTLI_TOO_LARGE);
    if (!options.codecs.brotliCompress) throw new Failure(libraryFailed('brotli', 'encoder'));
    const all = new Uint8Array(total);
    for (let at = 0; at < total;) {
      check();
      const chunk = await source.read(at, Math.min(piece, total - at));
      all.set(chunk, at);
      at += chunk.length;
      progress(at);
    }
    // The empty input: the stream brotli and Node write for it (the library returns no bytes at all).
    if (total === 0) {
      await emit(new Uint8Array([0x3b]));
      return done();
    }
    let compressed: Uint8Array;
    try {
      compressed = await options.codecs.brotliCompress(all, job.level ?? 11);
    } catch {
      throw new Failure(libraryFailed('brotli', 'encoder'));
    }
    // The library's output is checked by the reference decoder before anyone sees it: some inputs and qualities make
    // it write a stream that does not decompress to the input (§5.9, §15).
    if (options.codecs.brotliDecoder && !(await brotliRoundTrips(options.codecs.brotliDecoder, compressed, all)))
      throw new Failure(BROTLI_ENCODER_BROKE);
    await emit(compressed);
    return done();
  } catch (error) {
    const base = { inputBytes: inputRead, outputBytes, ...(format ? { format } : {}) };
    if (error instanceof LimitReached)
      return { ok: false, reason: 'limit', message: stoppedAt(limit, inputRead || total), ...base };
    if (error instanceof Cancelled) return { ok: false, reason: 'cancelled', message: CANCELLED, ...base };
    if (error instanceof ReadFailed) return { ok: false, reason: 'error', message: READ_FAILED, ...base };
    if (error instanceof Failure || error instanceof LibraryError)
      return { ok: false, reason: 'error', message: error.message, ...base };
    if (error instanceof Junk) return { ok: false, reason: 'error', message: damaged('junk after the end'), ...base };
    throw error;
  }
};
