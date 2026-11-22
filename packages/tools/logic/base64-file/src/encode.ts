/**
 * A file to Base64 or a data URI (docs/tools/specs/base64-file.md §5.1). Base64 is written only by the shared
 * `bytesToBase64`. A file is read in pieces of a multiple of 912 bytes: 912 bytes are 1,216 characters, a common
 * multiple of both line lengths (64 and 76), so every piece but the last ends exactly at the end of a line and has no
 * padding — pieces joined with `\n` (when wrapping) or nothing give exactly the Base64 of the whole file.
 */
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import type { Base64Alphabet, Base64Options } from '@workspace/tools-shared/base64';

export type LineLength = 0 | 64 | 76;
export type OutputForm = 'base64' | 'dataUri';

export interface EncodeOptions {
  form: OutputForm;
  alphabet: Base64Alphabet;
  padding: boolean;
  lineLength: LineLength;
  /** The data URI's type (Data URI only). */
  type: string;
}

/** 912 bytes → 1,216 characters, a multiple of 64 and of 76. */
export const PIECE_UNIT_BYTES = 912;
/** The piece a file is read in: 912 · 1,150 = 1,048,800 bytes (about 1 MiB). */
export const ENCODE_CHUNK_BYTES = PIECE_UNIT_BYTES * 1150;
/** What the page shows of a long output first: 49,152 bytes → 65,536 characters of Base64. */
export const PREVIEW_BYTES = 49_152;

export const DEFAULT_ENCODE_OPTIONS: EncodeOptions = {
  form: 'base64',
  alphabet: 'standard',
  padding: true,
  lineLength: 0,
  type: 'application/octet-stream',
};

/** Padding on for the standard alphabet, off for URL-safe (as base64 §4). */
export const defaultPadding = (alphabet: Base64Alphabet): boolean => alphabet === 'standard';

/** A data URI is standard, padded and unwrapped whatever the options: browsers read it so (§5.1 п. 3). */
export const base64Options = (options: EncodeOptions): Base64Options =>
  options.form === 'dataUri'
    ? { alphabet: 'standard', padding: true, lineLength: 0 }
    : { alphabet: options.alphabet, padding: options.padding, lineLength: options.lineLength };

/** The `data:<type>;base64,` prefix, or '' for bare Base64. */
export const outputPrefix = (options: EncodeOptions): string =>
  options.form === 'dataUri' ? `data:${options.type};base64,` : '';

/** The exact length of the output for a file of `size` bytes (§5.1 п. 6), without encoding anything. */
export const encodedLength = (size: number, options: EncodeOptions): number => {
  const { padding, lineLength } = base64Options(options);
  const chars = padding ? 4 * Math.ceil(size / 3) : Math.ceil((4 * size) / 3);
  const breaks = lineLength > 0 && chars > 0 ? Math.floor((chars - 1) / lineLength) : 0;
  return outputPrefix(options).length + chars + breaks;
};

/** The whole output of bytes in memory (small files, tests). */
export const encodeBytes = (bytes: Uint8Array, options: EncodeOptions): string =>
  outputPrefix(options) + bytesToBase64(bytes, base64Options(options));

/**
 * The first characters of the output, from the first PREVIEW_BYTES of a file of `size` (§5.6): the start of the output
 * exactly (a piece of a multiple of 3 bytes has no padding), at most `chars` characters. `head` holds the first bytes.
 */
export const previewOutput = (head: Uint8Array, size: number, options: EncodeOptions, chars: number): string => {
  const whole = head.length >= size;
  const bytes = whole ? head : head.subarray(0, head.length - (head.length % 3));
  return encodeBytes(bytes, options).slice(0, chars);
};

export interface EncodeControl {
  /** The piece size, rounded down to a multiple of 912 (at least 912); ENCODE_CHUNK_BYTES by default. */
  chunkBytes?: number;
  signal?: AbortSignal;
  /** Called after each piece with the bytes read so far. */
  onBytes?: (done: number) => void;
}

const abortError = (): Error => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/**
 * The whole file, read a piece at a time (one piece in memory, whatever the size): `sink` gets the prefix and then the
 * text of each piece, in order; together they are `encodeBytes(file, options)`. Rejects with an AbortError when
 * `signal` aborts and with the read's own error when the Blob cannot be read.
 */
export const encodeBlob = async (
  blob: Blob,
  options: EncodeOptions,
  sink: (text: string) => void,
  control: EncodeControl = {},
): Promise<void> => {
  const unit = PIECE_UNIT_BYTES;
  const chunk = Math.max(unit, Math.floor((control.chunkBytes ?? ENCODE_CHUNK_BYTES) / unit) * unit);
  const shared = base64Options(options);
  const prefix = outputPrefix(options);
  if (prefix) sink(prefix);
  let first = true;
  for (let at = 0; at < blob.size; at += chunk) {
    if (control.signal?.aborted) throw abortError();
    const bytes = new Uint8Array(await blob.slice(at, Math.min(at + chunk, blob.size)).arrayBuffer());
    const text = bytesToBase64(bytes, shared);
    sink(!first && shared.lineLength > 0 && text ? `\n${text}` : text);
    first = false;
    control.onBytes?.(Math.min(at + chunk, blob.size));
  }
  if (control.signal?.aborted) throw abortError();
};

/** RFC 9110 §5.6.2 token characters. */
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MIME = new RegExp(`^${TOKEN}/${TOKEN}(?:[\\t ]*;[\\t ]*${TOKEN}=(?:${TOKEN}|"[^"\\\\,]*"))*$`);

/** A type a person typed for the data URI (§5.1 п. 4): `type/subtype` and `;name=value` parameters, up to 255. */
export const isMimeType = (text: string): boolean => text.length <= 255 && MIME.test(text);

export const TYPE_MESSAGE = 'Type must look like type/subtype, for example application/pdf.';

/**
 * The text an entry of Decode opens as (§11): the same shape of input, made again from the bytes — bare Base64
 * (standard, padded), a data URI with the declared type (no other parameter: a name is never kept), or a PEM block.
 */
export const inputOf = (
  bytes: Uint8Array,
  shape: 'base64' | 'data-uri' | 'pem',
  declaredMime: string | null,
  pemLabel: string | null,
): string => {
  if (shape === 'data-uri') return `data:${declaredMime ?? ''};base64,${bytesToBase64(bytes)}`;
  if (shape === 'pem' && pemLabel)
    return `-----BEGIN ${pemLabel}-----\n${bytesToBase64(bytes, { lineLength: 64 })}\n-----END ${pemLabel}-----\n`;
  return bytesToBase64(bytes);
};
export type { Base64Alphabet } from '@workspace/tools-shared/base64';
