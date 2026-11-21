/**
 * The digests (docs/tools/specs/hash.md §5.1–§5.2, §9, §12). Bytes in memory (`hashAll`): SHA-1 and SHA-2 by WebCrypto
 * (fastest on bytes in memory), MD5 by the `Digester` (behaviors.ts) in chunks with a pause between them, so a page stays
 * responsive. A file (`hashBlob`): read a chunk at a time and fed to incremental `Digester` streams — WebCrypto cannot
 * hash in parts, and a whole file in WebCrypto is the file in memory twice; a host runs it in workers.
 */
import { ALGORITHMS } from './algorithms';
import { defaultDigester } from './behaviors';
import type { Algorithm, Digests } from './algorithms';
import type { Digester } from './digester';

export { ALGORITHMS, DIGEST_BYTES } from './algorithms';
export type { Algorithm, Digests } from './algorithms';

export interface HashOptions {
  /** HMAC when set (non-empty); plain hashes when undefined. */
  key?: Uint8Array;
  /** For large inputs: MD5 is fed in chunks of this size with a pause between them (default 1 MiB). */
  chunkSize?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** What digests the streams (default: behaviors.ts). */
  digester?: Digester;
}

export const DEFAULT_CHUNK = 1024 * 1024;

const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');
const check = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw abortError();
};
const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const checkKey = (key: Uint8Array | undefined): void => {
  if (key !== undefined && key.length === 0) throw new RangeError('An HMAC key must not be empty.');
};

type Buffered = Uint8Array<ArrayBuffer>;

/** SHA-1 or SHA-2 of `bytes` (or its HMAC under `key`) by WebCrypto. */
const subtle = async (algorithm: Exclude<Algorithm, 'MD5'>, bytes: Uint8Array, key?: Uint8Array) => {
  if (!key) return new Uint8Array(await crypto.subtle.digest(algorithm, bytes as Buffered));
  const imported = await crypto.subtle.importKey('raw', key as Buffered, { name: 'HMAC', hash: algorithm }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, bytes as Buffered));
};

/** All five digests of `bytes`. Rejects with an AbortError when `signal` aborts. */
export const hashAll = async (bytes: Uint8Array, options: HashOptions = {}): Promise<Digests> => {
  const { key, chunkSize = DEFAULT_CHUNK, onProgress, signal, digester = defaultDigester } = options;
  check(signal);
  checkKey(key);
  // WebCrypto runs off the page's thread; MD5 runs here meanwhile, a chunk at a time.
  const shas = Promise.all(
    (['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const).map(algorithm => subtle(algorithm, bytes, key)),
  );
  shas.catch(() => undefined);
  const state = await digester.create('MD5', key);
  for (let at = 0; at < bytes.length || at === 0; at += chunkSize) {
    state.update(bytes.subarray(at, at + chunkSize));
    if (at + chunkSize >= bytes.length) break;
    onProgress?.((at + chunkSize) / bytes.length);
    await pause();
    check(signal);
  }
  const md = state.digest();
  const [sha1d, sha256d, sha384d, sha512d] = await shas;
  check(signal);
  onProgress?.(1);
  return { MD5: md, 'SHA-1': sha1d!, 'SHA-256': sha256d!, 'SHA-384': sha384d!, 'SHA-512': sha512d! };
};

/**
 * A Blob's bytes, `chunkSize` at a time: `slice().arrayBuffer()` in a loop, each chunk detached (freed) right after use,
 * so memory stays one chunk. Measured against `Blob.stream()` (docs/research/hash-in-wasm.md): a BYOB stream reader is
 * about 20% faster, but in Chrome it stalled for good in 2 of 8 runs over a 5 GiB file with five readers, and it does not
 * notice a file changed while it is read; a slice read fails with NotReadableError then. A chunk is valid until the next
 * one is asked for.
 */
const chunksOf = async function* (blob: Blob, chunkSize: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < blob.size; at += chunkSize) {
    const buffer = await blob.slice(at, Math.min(at + chunkSize, blob.size)).arrayBuffer();
    yield new Uint8Array(buffer);
    (buffer as { transfer?: (length: number) => unknown }).transfer?.(0);
  }
};

export interface BlobHashOptions extends HashOptions {
  /** Which digests (default all five, in §5.1 order). */
  algorithms?: readonly Algorithm[];
  /** Called with the number of bytes read so far, after each chunk (as well as `onProgress` with the fraction). */
  onBytes?: (bytes: number) => void;
}

/**
 * Digests of a file (or any Blob), read `chunkSize` bytes at a time: one chunk is in memory, whatever the size (counts
 * are plain numbers — exact far past 4 GiB). Rejects with an AbortError when `signal` aborts and with the read's own
 * error when the Blob cannot be read (or changed on disk since it was chosen).
 */
export const hashBlob = async (blob: Blob, options: BlobHashOptions = {}): Promise<Partial<Digests>> => {
  const {
    key,
    chunkSize = DEFAULT_CHUNK,
    onProgress,
    onBytes,
    signal,
    algorithms = ALGORITHMS,
    digester = defaultDigester,
  } = options;
  check(signal);
  checkKey(key);
  const streams = await Promise.all(algorithms.map(a => digester.create(a, key)));
  let done = 0;
  for await (const chunk of chunksOf(blob, chunkSize)) {
    check(signal);
    for (const stream of streams) stream.update(chunk);
    done += chunk.length;
    onBytes?.(done);
    onProgress?.(blob.size ? done / blob.size : 1);
  }
  const out: Partial<Digests> = {};
  algorithms.forEach((algorithm, i) => (out[algorithm] = streams[i]!.digest()));
  if (blob.size === 0) onProgress?.(1);
  return out;
};
