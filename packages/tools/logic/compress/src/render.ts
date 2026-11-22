/** The result written out (docs/tools/specs/compress.md §3): by the shared hex and Base64 writers. */
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { OutputEncoding } from './formats';

/** Decompress's Hex view: pairs through a space, 16 bytes a line. */
export const hexView = (bytes: Uint8Array): string => bytesToHex(bytes, { format: 'spaced', bytesPerLine: 16 });
/** Decompress's Base64 view: RFC 4648 §4 with padding, one line. */
export const base64View = (bytes: Uint8Array): string => bytesToBase64(bytes);
/** Compress's output: Base64, Base64 URL-safe without padding, or plain lowercase hex. */
export const encodeOutput = (bytes: Uint8Array, encoding: OutputEncoding): string =>
  encoding === 'hex'
    ? bytesToHex(bytes)
    : bytesToBase64(bytes, encoding === 'base64url' ? { alphabet: 'url', padding: false } : {});
