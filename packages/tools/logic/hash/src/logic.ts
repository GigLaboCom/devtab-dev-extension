/**
 * The Hash tool's logic (docs/tools/specs/hash.md §9): reading the input, the digests, how they are written, the
 * comparison with an expected hash, the hints under the text. Pure: no React, no DOM, no chrome. The tool has no `detect`
 * (§7): any text can be hashed, so no paste is "hash input".
 */
import { decodeBase64, decodeHex } from './parse';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { Algorithm, Digests } from './digest';
import type { Decoded } from './parse';

export type InputFormat = 'text' | 'hex' | 'base64';
export type OutputFormat = 'hex' | 'HEX' | 'base64';

/** Up to this many input bytes the digests follow every edit; above, 300 ms after the last one (§12). */
export const LIVE_BYTES = 1024 * 1024;
/** Text, Hex and Base64 above this many bytes are refused (§6, §12). */
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
/** The pause before hashing an input between LIVE_BYTES and MAX_INPUT_BYTES (ms). */
export const DEBOUNCE_MS = 300;

/** The bytes the field means: UTF-8 as typed (no normalisation, no BOM, no trimming), or hex, or Base64 (§3, §5.4). */
export const decodeInput = (text: string, format: InputFormat): Decoded =>
  format === 'hex'
    ? decodeHex(text)
    : format === 'base64'
      ? decodeBase64(text)
      : { ok: true, bytes: new TextEncoder().encode(text) };

/** `hex` lowercase, `HEX` uppercase, both without separators; `base64` RFC 4648 §4 with padding (§5.3). */
export const formatDigest = (digest: Uint8Array, format: OutputFormat): string =>
  format === 'base64' ? bytesToBase64(digest) : bytesToHex(digest, { uppercase: format === 'HEX' });

export type Comparison =
  { kind: 'empty' } | { kind: 'unparsed' } | { kind: 'match'; algorithm: Algorithm } | { kind: 'no-match' };

const HEX_LENGTHS = new Set([32, 40, 64, 96, 128]);
const BYTE_LENGTHS = new Set([16, 20, 32, 48, 64]);

/** What the expected hash is: hex digits (lowercase) or bytes; undefined when it is neither (§5.5, steps 1–3). */
export const parseExpected = (expected: string): { hex: string } | { bytes: Uint8Array } | undefined => {
  const words = expected
    .split(/\s+/)
    .map(w => w.replaceAll(':', ''))
    .filter(Boolean);
  const hex = words.find(w => HEX_LENGTHS.has(w.length) && /^[0-9a-fA-F]+$/.test(w));
  if (hex) return { hex: hex.toLowerCase() };
  const decoded = decodeBase64(expected.replace(/\s+/g, ''));
  return decoded.ok && BYTE_LENGTHS.has(decoded.bytes.length) ? { bytes: decoded.bytes } : undefined;
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Compares an expected hash — `4f9c…`, `4F:9C:…`, `sha256sum` output (`<hex>  <file>`), BSD output
 * (`SHA256 (file) = <hex>`) or Base64 — with each digest (§5.5). It shows, it does not protect: timing does not matter.
 */
export const compareExpected = (expected: string, digests: Partial<Digests>): Comparison => {
  if (expected.trim() === '') return { kind: 'empty' };
  const parsed = parseExpected(expected);
  if (!parsed) return { kind: 'unparsed' };
  for (const [algorithm, digest] of Object.entries(digests) as Array<[Algorithm, Uint8Array]>) {
    if ('hex' in parsed ? bytesToHex(digest) === parsed.hex : sameBytes(digest, parsed.bytes))
      return { kind: 'match', algorithm };
  }
  return { kind: 'no-match' };
};

export type TextHint = 'trailing-newline' | 'edge-space';

/** Hints under the Text field (§5.6): the bytes include what is easy to miss. */
export const textHints = (text: string): TextHint[] => {
  const hints: TextHint[] = [];
  if (text.endsWith('\n')) hints.push('trailing-newline');
  if (/^[ \t]|[ \t]$/.test(text)) hints.push('edge-space');
  return hints;
};

const SIZE = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** A file's size for people (§8): base 1 024, `bytes`, `KB`, `MB`. */
export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${SIZE.format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`
    : bytes < 1024 * 1024
      ? `${SIZE.format(bytes / 1024)} KB`
      : `${SIZE.format(bytes / (1024 * 1024))} MB`;

/** Throughput while a file is hashed (§8): `312 MB/s`, base 1 024 like the sizes. */
export const formatRate = (bytesPerSecond: number): string =>
  `${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(bytesPerSecond / (1024 * 1024))} MB/s`;

/** Time left while a file is hashed (§8): `about 12 s left`, `about 3 min left`. */
export const formatRemaining = (seconds: number): string =>
  seconds < 60 ? `about ${Math.max(1, Math.round(seconds))} s left` : `about ${Math.round(seconds / 60)} min left`;
