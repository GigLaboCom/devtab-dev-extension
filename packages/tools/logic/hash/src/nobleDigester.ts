/** `Digester` on @noble/hashes 2.4.0: JavaScript, audited, no wasm. The tool's first implementation (2026-11-21). */
import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import type { Algorithm } from './algorithms';
import type { Digester } from './digester';

const HASHES = { MD5: md5, 'SHA-1': sha1, 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 } as const;

export const nobleDigester: Digester = {
  name: 'noble',
  create: async (algorithm: Algorithm, key?: Uint8Array) => {
    const state = key ? hmac.create(HASHES[algorithm], key) : HASHES[algorithm].create();
    return { update: bytes => void state.update(bytes), digest: () => state.digest() };
  },
};
