/**
 * What the page gets of a result (docs/tools/specs/compress.md §3, §5.6, §5.8): the whole result while it is at most
 * HOLD_BYTES, its first SHOW_BYTES always (for showing or the preview), and the text verdict over all of it. Past
 * HOLD_BYTES nothing more is kept — the bytes only pass through the text check and are counted.
 */
import { HOLD_BYTES, SHOW_BYTES } from './limits';
import { TextCheck } from './textCheck';
import type { Sink } from './engine';
import type { TextVerdict } from './textCheck';

export interface Collected {
  size: number;
  /** The whole result, or null when it was larger than the hold. */
  bytes: Uint8Array | null;
  /** The first min(size, SHOW_BYTES) bytes. */
  head: Uint8Array;
  verdict: TextVerdict;
}

export interface Collector extends Sink {
  result(): Collected;
}

const concat = (parts: Uint8Array[], size: number): Uint8Array => {
  if (parts.length === 1 && parts[0]!.length === size) return parts[0]!;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const createCollector = (hold = HOLD_BYTES, show = SHOW_BYTES): Collector => {
  let parts: Uint8Array[] | null = [];
  let headParts: Uint8Array[] = [];
  let headSize = 0;
  let size = 0;
  let check = new TextCheck();
  return {
    write(chunk) {
      check.push(chunk);
      if (headSize < show) {
        const take = chunk.subarray(0, show - headSize);
        headParts.push(take.slice());
        headSize += take.length;
      }
      size += chunk.length;
      if (parts) {
        if (size > hold) parts = null;
        else parts.push(chunk.slice());
      }
    },
    reset() {
      parts = [];
      headParts = [];
      headSize = 0;
      size = 0;
      check = new TextCheck();
    },
    result() {
      return {
        size,
        bytes: parts ? concat(parts, size) : null,
        head: concat(headParts, headSize),
        verdict: check.result(),
      };
    },
  };
};
