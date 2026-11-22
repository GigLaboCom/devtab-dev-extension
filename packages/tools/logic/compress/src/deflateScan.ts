/**
 * Where a deflate stream ends (RFC 1951 §3.2), without inflating it: block headers are read and every Huffman code is
 * decoded, but nothing is copied (docs/tools/specs/compress.md §5.3). The browser's DecompressionStream says only
 * "Junk found after end of compressed data" — and drops the output it had not handed over yet — when a second gzip
 * member or other bytes follow the stream; this finds the end so the stream can be inflated again with exactly its
 * own bytes. Linear, one pass, reading the source a piece at a time.
 */

export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;
export type ScanResult = { ok: true; end: number } | { ok: false; reason: 'truncated' | 'invalid' };

const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Table {
  /** Indexed by the next `bits` bits (LSB first): symbol << 4 | code length, 0 for no code. */
  entries: Int32Array;
  bits: number;
}

class Invalid extends Error {}
class Truncated extends Error {}

/** A canonical Huffman table from code lengths (RFC 1951 §3.2.2); over-subscribed lengths are invalid. */
const buildTable = (lengths: ArrayLike<number>): Table => {
  let max = 0;
  const count = new Array<number>(16).fill(0);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    count[l]!++;
    if (l > max) max = l;
  }
  count[0] = 0;
  let left = 1;
  for (let l = 1; l <= 15; l++) {
    left = (left << 1) - count[l]!;
    if (left < 0) throw new Invalid();
  }
  const bits = Math.max(1, max);
  const entries = new Int32Array(1 << bits);
  const next = new Array<number>(16).fill(0);
  for (let l = 1, code = 0; l <= 15; l++) {
    code = (code + count[l - 1]!) << 1;
    next[l] = code;
  }
  for (let sym = 0; sym < lengths.length; sym++) {
    const l = lengths[sym]!;
    if (l === 0) continue;
    const code = next[l]!++;
    let rev = 0;
    for (let k = 0; k < l; k++) rev |= ((code >> k) & 1) << (l - 1 - k);
    for (let j = rev; j < entries.length; j += 1 << l) entries[j] = (sym << 4) | l;
  }
  return { entries, bits };
};

const FIXED_LIT = buildTable(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DIST = buildTable(new Array<number>(30).fill(5));

/** The end (absolute offset, past the final block's last byte) of the deflate stream at `start`, reading up to `limit`. */
export const scanDeflateEnd = async (
  read: ReadRange,
  start: number,
  limit: number,
  piece = 1 << 20,
): Promise<ScanResult> => {
  let data = new Uint8Array(0);
  let base = start; // absolute offset of data[0]
  let pos = 0;
  let next = start; // absolute offset of the next byte to read from the source
  let bitbuf = 0;
  let bitcnt = 0;

  /** Keeps at least `want` unread bytes in `data`, unless the source is done. */
  const fill = async (want: number): Promise<void> => {
    if (data.length - pos >= want || next >= limit) return;
    const more = await read(next, Math.min(piece, limit - next));
    if (more.length === 0) {
      next = limit;
      return;
    }
    const joined = new Uint8Array(data.length - pos + more.length);
    joined.set(data.subarray(pos));
    joined.set(more, data.length - pos);
    base += pos;
    data = joined;
    pos = 0;
    next += more.length;
  };
  const need = (n: number): void => {
    while (bitcnt < n) {
      if (pos >= data.length) throw new Truncated();
      bitbuf |= data[pos++]! << bitcnt;
      bitcnt += 8;
    }
  };
  const bitsOf = (n: number): number => {
    need(n);
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n;
    bitcnt -= n;
    return v;
  };
  const decode = (t: Table): number => {
    // Near the end of the data a short code may not need all `bits` bits: read what there is.
    while (bitcnt < t.bits && pos < data.length) {
      bitbuf |= data[pos++]! << bitcnt;
      bitcnt += 8;
    }
    const e = t.entries[bitbuf & ((1 << t.bits) - 1)]!;
    const l = e & 15;
    if (l === 0) throw new Invalid();
    if (l > bitcnt) throw new Truncated();
    bitbuf >>>= l;
    bitcnt -= l;
    return e >> 4;
  };

  try {
    for (;;) {
      await fill(1024);
      const final = bitsOf(1);
      const type = bitsOf(2);
      if (type === 0) {
        // Stored: to the byte boundary, LEN, NLEN, LEN bytes (RFC 1951 §3.2.4).
        bitbuf = 0;
        pos -= bitcnt >> 3;
        bitcnt = 0;
        await fill(4);
        if (data.length - pos < 4) throw new Truncated();
        const len = data[pos]! | (data[pos + 1]! << 8);
        const nlen = data[pos + 2]! | (data[pos + 3]! << 8);
        if ((len ^ 0xffff) !== nlen) throw new Invalid();
        pos += 4;
        const after = base + pos + len;
        if (after > limit) throw new Truncated();
        if (pos + len <= data.length) pos += len;
        else {
          data = new Uint8Array(0);
          pos = 0;
          base = after;
          next = after;
        }
      } else if (type === 3) throw new Invalid();
      else {
        let lit = FIXED_LIT;
        let dist = FIXED_DIST;
        if (type === 2) {
          const hlit = bitsOf(5) + 257;
          const hdist = bitsOf(5) + 1;
          const hclen = bitsOf(4) + 4;
          if (hlit > 286 || hdist > 30) throw new Invalid();
          const cl = new Array<number>(19).fill(0);
          for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]!] = bitsOf(3);
          const clTable = buildTable(cl);
          const lengths = new Array<number>(hlit + hdist).fill(0);
          for (let i = 0; i < hlit + hdist;) {
            if (data.length - pos < 64) await fill(1024);
            const sym = decode(clTable);
            if (sym < 16) lengths[i++] = sym;
            else {
              let value = 0;
              let repeat: number;
              if (sym === 16) {
                if (i === 0) throw new Invalid();
                value = lengths[i - 1]!;
                repeat = 3 + bitsOf(2);
              } else repeat = sym === 17 ? 3 + bitsOf(3) : 11 + bitsOf(7);
              if (i + repeat > hlit + hdist) throw new Invalid();
              while (repeat--) lengths[i++] = value;
            }
          }
          if (lengths[256] === 0) throw new Invalid();
          lit = buildTable(lengths.slice(0, hlit));
          dist = buildTable(lengths.slice(hlit));
        }
        for (;;) {
          if (data.length - pos < 64) await fill(1 << 16);
          const sym = decode(lit);
          if (sym < 256) continue;
          if (sym === 256) break;
          if (sym > 285) throw new Invalid();
          const extra = LENGTH_EXTRA[sym - 257]!;
          if (extra) bitsOf(extra);
          const d = decode(dist);
          if (d > 29) throw new Invalid();
          const dextra = DIST_EXTRA[d]!;
          if (dextra) bitsOf(dextra);
        }
      }
      if (final) return { ok: true, end: base + pos - (bitcnt >> 3) };
    }
  } catch (error) {
    if (error instanceof Truncated) return { ok: false, reason: 'truncated' };
    if (error instanceof Invalid) return { ok: false, reason: 'invalid' };
    throw error;
  }
};
