/**
 * The seam "what digests a stream" (docs/replaceable-behaviors.md, `Digester`): an incremental hash or HMAC fed chunk
 * by chunk. It digests a file (`hashBlob`, in the tool's workers) and the MD5 of a text (`hashAll`; the SHA of a text
 * stays WebCrypto, which is faster on bytes in memory). The choice is made in one place, `behaviors.ts`; every
 * implementation passes the same contract suite (`digesters.test.ts`).
 *
 * Asynchronous to create (an implementation may compile wasm on first use), synchronous to feed: `update` runs once per
 * chunk (1 MiB), never per byte.
 */
import type { Algorithm } from './algorithms';

export interface DigestStream {
  update(bytes: Uint8Array): void;
  digest(): Uint8Array;
}

export interface Digester {
  /** For reports and tests. */
  readonly name: string;
  /** A stream of `algorithm`, or of its HMAC (RFC 2104) under `key` (non-empty). */
  create(algorithm: Algorithm, key?: Uint8Array): Promise<DigestStream>;
}
