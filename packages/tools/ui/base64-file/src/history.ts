/**
 * What the tool history keeps of the Base64 File tool (D17, docs/tools/history.md §10, row 38; the specification's §11).
 * A file's bytes are arbitrary and may be a certificate or a key. Following Base64 Image (the bytes as a blob up to
 * 1 MiB, never the file's name) and X.509 (a private key never, not even with a master password):
 *
 * - `encode` / `decode` — open: a file of a recognised type that is not a private key, as the blob `file`, with its type,
 *   size and the output's options, or the input's shape and declared type;
 * - `encode-unknown` / `decode-unknown` — secret: bytes of no recognised type (32 random bytes are likely a key), kept
 *   only encrypted, with a master password;
 * - never: private keys and keystores, a file over 1 MiB (no entry), the file's name (and a data URI's `name`), the
 *   Base64 text (made again from the bytes).
 *
 * The declaration alone: labels and payload readers live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const base64FileHistory: HistoryDeclaration = {
  kinds: [
    { id: 'encode', title: 'Encoded' },
    { id: 'decode', title: 'Decoded' },
    { id: 'encode-unknown', title: 'Encoded, unknown type', secret: true },
    { id: 'decode-unknown', title: 'Decoded, unknown type', secret: true },
  ],
  schema: 1,
  records:
    'The file you encoded or decoded (up to 1 MiB), its type, size and the options; bytes of an unknown type only with a master password.',
  never: 'Private keys, a file over 1 MiB, the file’s name, and the Base64 text (it is made again from the file).',
  // A file over 1 MiB is not kept (entries.ts: MAX_KEPT_BYTES, no entry is written).
  maxBlobBytes: 1024 * 1024,
};
