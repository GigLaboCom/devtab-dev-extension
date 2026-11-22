/**
 * Reading codes in pixels (docs/tools/specs/qr.md §5.6 steps 5–7) with `qr/decode.js` 0.7.2 — the reading half of the
 * library. Only the tool's reading worker imports this module, so the page never loads it. Every code of the image is
 * looked for (the library's batch scanner, all attempts at every scale, extra ones for at most `timeLimit` ms); the first one found
 * is the result, and the count is said.
 *
 * Text: a byte segment is decoded by its ECI, with none as UTF-8 (what phones do; strictly ISO-8859-1 — the library
 * reports "no ECI" as ECI 26, UTF-8, so the two cannot be told apart). Bytes that are not valid text in their encoding
 * are read as ISO-8859-1 — the standard's default, one character a byte, nothing lost — and kept: the result says so
 * and carries them, so the tool can show them as hex.
 * Kanji mode is not read by the library: such a code is reported as found but unreadable.
 */
import { _QRScanner } from 'qr/decode.js';
import type { DecodeResult } from 'qr/decode.js';

/** RGBA pixels, row by row: an ImageData, or anything shaped like one. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type ReadResult =
  | {
      ok: true;
      text: string;
      /** Codes found in the image; the first is `text`. */
      count: number;
      /** The code's byte-mode bytes when some of them are not text in their encoding (shown with U+FFFD); else null. */
      bytes: Uint8Array | null;
    }
  /** `located`: a symbol was found but its contents could not be read (damaged, or a mode the reader lacks). */
  | { ok: false; located: boolean };

/** The longest side the reader takes (§5.6 step 4); the page scales an image down to it. */
export const MAX_SIDE = 4096;
/** Extra attempts stop after this long (§5.6 step 5). */
export const TIME_LIMIT_MS = 2000;

/** ECI assignment numbers (ISO/IEC 18004 §7.4.3, AIM ECI) → WHATWG encoding labels. */
const ECI_LABELS: Readonly<Record<number, string>> = {
  1: 'iso-8859-1',
  3: 'iso-8859-1',
  4: 'iso-8859-2',
  5: 'iso-8859-3',
  6: 'iso-8859-4',
  7: 'iso-8859-5',
  8: 'iso-8859-6',
  9: 'iso-8859-7',
  10: 'iso-8859-8',
  11: 'windows-1254',
  13: 'windows-874',
  15: 'iso-8859-13',
  16: 'iso-8859-14',
  17: 'iso-8859-15',
  18: 'iso-8859-16',
  20: 'shift_jis',
  21: 'windows-1250',
  22: 'windows-1251',
  23: 'windows-1252',
  24: 'windows-1256',
  25: 'utf-16be',
  26: 'utf-8',
  27: 'windows-1252',
  28: 'big5',
  29: 'gb18030',
  30: 'euc-kr',
};

interface Segment {
  bytes: Uint8Array;
  text: boolean;
}

const decodeSegment = (bytes: Uint8Array, eci: number | undefined): { text: string; ok: boolean } => {
  const label = ECI_LABELS[eci ?? 26];
  if (label) {
    try {
      return { text: new TextDecoder(label, { fatal: true }).decode(bytes), ok: true };
    } catch {
      // not text in that encoding: below
    }
  }
  // ISO-8859-1 maps every byte to one character: the standard's default when there is no ECI, and lossless.
  // (By hand: the WHATWG label "iso-8859-1" means windows-1252.)
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x2000) text += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return { text, ok: false };
};

/**
 * The library's scanner with one more thing to tell: whether a symbol was located and corrected but its data could not
 * be read (`decodePayload` failed after Reed–Solomon — damaged data or a mode it lacks, Kanji). It also groups the byte
 * segments the text decoder saw by the code they belong to. `decodeQRBatch` is this scanner, run the same way.
 */
class Scanner extends _QRScanner {
  segments: Segment[] = [];
  readonly found: Segment[][] = [];
  unreadable = false;

  protected override decodePayload(data: Uint8Array, dataLen: number, version: number): DecodeResult {
    this.segments = [];
    const result = super.decodePayload(data, dataLen, version);
    if (typeof result === 'string') this.found.push(this.segments);
    else if (result.message === 'data') this.unreadable = true;
    return result;
  }
}

export const readQr = async (pixels: Pixels, { timeLimit = TIME_LIMIT_MS } = {}): Promise<ReadResult> => {
  const scanner: Scanner = new Scanner({
    effort: Infinity,
    timeLimit,
    maxSize: { width: Math.max(1, pixels.width), height: Math.max(1, pixels.height) },
    textDecoder: (bytes, eci) => {
      const { text, ok } = decodeSegment(bytes, eci);
      scanner.segments.push({ bytes: bytes.slice(), text: ok });
      return text;
    },
  });
  let results: DecodeResult[];
  try {
    scanner.addImage(pixels);
    results = await scanner.decodeAsync(true);
  } finally {
    scanner.clean();
  }
  const texts = results.filter((r): r is string => typeof r === 'string');
  if (texts.length === 0) return { ok: false, located: scanner.unreadable };
  const segments = scanner.found[0] ?? [];
  let bytes: Uint8Array | null = null;
  if (segments.some(s => !s.text)) {
    bytes = new Uint8Array(segments.reduce((n, s) => n + s.bytes.length, 0));
    let at = 0;
    for (const s of segments) {
      bytes.set(s.bytes, at);
      at += s.bytes.length;
    }
  }
  return { ok: true, text: texts[0]!, count: texts.length, bytes };
};
