/**
 * Hashes a file off the page's thread (docs/tools/specs/hash.md §12): the file arrives as a File (a handle, not its
 * bytes), is read a chunk at a time and fed to the asked digests (wasm streams of the logic's `Digester`); memory
 * stays flat whatever the size. Loaded from this file by `fileHash.ts` — never from
 * `blob:` or `data:`. Cancelling is the page terminating the worker.
 */
import { hashBlob } from '@workspace/tool-logic-hash';
import type { Algorithm, Digests } from '@workspace/tool-logic-hash';

export interface HashRequest {
  file: Blob;
  algorithms: readonly Algorithm[];
  key?: Uint8Array;
}

export type HashReply =
  | { type: 'progress'; bytes: number }
  | { type: 'done'; digests: Partial<Digests> }
  | { type: 'error'; message: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HashRequest>) => void) | null;
  postMessage: (reply: HashReply) => void;
};

const PROGRESS_EVERY = 16 * 1024 * 1024;

scope.onmessage = ({ data }) => {
  let posted = 0;
  hashBlob(data.file, {
    algorithms: data.algorithms,
    ...(data.key ? { key: data.key } : {}),
    // Every 16 MiB, not every chunk: a 5 GiB file is 320 messages per worker, not 5 120.
    onBytes: bytes => {
      if (bytes - posted >= PROGRESS_EVERY || bytes === data.file.size) {
        posted = bytes;
        scope.postMessage({ type: 'progress', bytes });
      }
    },
  }).then(
    digests => scope.postMessage({ type: 'done', digests }),
    error => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};
