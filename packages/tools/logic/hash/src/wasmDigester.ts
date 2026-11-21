/**
 * `Digester` on hash-wasm 4.12.0: MD5, SHA-1 and SHA-2 compiled from C to WebAssembly, the module embedded in the
 * JavaScript as Base64 and compiled on first use (`WebAssembly.compile` — the extension's CSP allows it with
 * `'wasm-unsafe-eval'`; nothing is fetched, no `eval`, no worker of its own). Each stream has its own small, fixed wasm
 * memory: a file of any size passes through it chunk by chunk. 64-bit length counters (checked on a 5 GiB file).
 */
import { createHMAC, createMD5, createSHA1, createSHA256, createSHA384, createSHA512 } from 'hash-wasm';
import type { Algorithm } from './algorithms';
import type { Digester } from './digester';

const CREATE = {
  MD5: createMD5,
  'SHA-1': createSHA1,
  'SHA-256': createSHA256,
  'SHA-384': createSHA384,
  'SHA-512': createSHA512,
} as const;

export const wasmDigester: Digester = {
  name: 'hash-wasm',
  create: async (algorithm: Algorithm, key?: Uint8Array) => {
    const hasher = key ? await createHMAC(CREATE[algorithm](), key) : await CREATE[algorithm]();
    hasher.init();
    return { update: bytes => void hasher.update(bytes), digest: () => hasher.digest('binary') };
  },
};
