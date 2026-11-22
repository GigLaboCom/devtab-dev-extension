/**
 * Is the result text? (docs/tools/specs/compress.md §5.6) — checked over the whole output as it streams, not only over
 * what is shown: valid UTF-8 (WHATWG Encoding, strict) and no NUL. Only the first of the two problems is reported.
 */

export interface TextVerdict {
  text: boolean;
  /** 1-based number of the first byte of the first invalid sequence (before any NUL), or null. */
  firstInvalid: number | null;
  /** 1-based number of the first NUL byte (before any invalid sequence), or null. */
  firstNul: number | null;
  bom: boolean;
}

/** The index of the first byte of the first invalid UTF-8 sequence in `bytes`, or -1 (an incomplete end is invalid). */
export const firstInvalidUtf8 = (bytes: Uint8Array): number => {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    } else return i;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || c < (k === 1 ? lo : 0x80) || c > (k === 1 ? hi : 0xbf)) return i;
    }
    i += need + 1;
  }
  return -1;
};

/**
 * Pushed the output piece by piece; `result()` after the last. A byte-by-byte state machine (ASCII runs skipped fast):
 * no strings are made — a gigabyte of output passes without a gigabyte of garbage — and checking stops at the first
 * byte that settles the answer (an invalid sequence and a NUL both make it "not text").
 */
export class TextCheck {
  private seen = 0;
  /** Continuation bytes the current sequence still needs, and the range allowed for the next one. */
  private need = 0;
  private lo = 0x80;
  private hi = 0xbf;
  /** 1-based number of the first byte of the current sequence. */
  private start = 0;
  private invalid: number | null = null;
  private nul: number | null = null;
  private head: number[] = [];

  push(chunk: Uint8Array): void {
    const n = chunk.length;
    for (let i = 0; i < n && this.head.length < 3; i++) this.head.push(chunk[i]!);
    if (this.invalid === null && this.nul === null) {
      let i = 0;
      while (i < n) {
        const b = chunk[i]!;
        if (this.need > 0) {
          if (b < this.lo || b > this.hi) {
            this.invalid = this.start;
            break;
          }
          this.need--;
          this.lo = 0x80;
          this.hi = 0xbf;
          i++;
          continue;
        }
        if (b < 0x80) {
          if (b === 0) {
            this.nul = this.seen + i + 1;
            break;
          }
          i++;
          while (i < n && chunk[i]! < 0x80 && chunk[i] !== 0) i++;
          continue;
        }
        this.start = this.seen + i + 1;
        if (b >= 0xc2 && b <= 0xdf) this.need = 1;
        else if (b >= 0xe0 && b <= 0xef) {
          this.need = 2;
          if (b === 0xe0) this.lo = 0xa0;
          if (b === 0xed) this.hi = 0x9f;
        } else if (b >= 0xf0 && b <= 0xf4) {
          this.need = 3;
          if (b === 0xf0) this.lo = 0x90;
          if (b === 0xf4) this.hi = 0x8f;
        } else {
          this.invalid = this.start;
          break;
        }
        i++;
      }
    }
    this.seen += n;
  }

  result(): TextVerdict {
    // An unfinished sequence at the very end: its first byte.
    const invalid = this.invalid ?? (this.nul === null && this.need > 0 ? this.start : null);
    const h = this.head;
    const bom = h.length === 3 && h[0] === 0xef && h[1] === 0xbb && h[2] === 0xbf;
    return { text: invalid === null && this.nul === null, firstInvalid: invalid, firstNul: this.nul, bom };
  }
}

/** Control Pictures for C0 (except TAB and LF) and DEL — for showing only (hex-ascii §5); Copy takes the real text. */
export const showControls = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, c =>
    c === '\x7f' ? '\u{2421}' : String.fromCharCode(0x2400 + c.charCodeAt(0)),
  );

/** How many characters showControls replaces. */
// eslint-disable-next-line no-control-regex
export const countControls = (text: string): number => text.match(/[\x00-\x08\x0b-\x1f\x7f]/g)?.length ?? 0;
