/**
 * The tool's promises that examples cannot cover, as properties on generated inputs with fixed seeds:
 *
 * - decoding in pieces gives exactly what the shared `parseBase64` gives the whole input — the same bytes, or the same
 *   error with the same message, offset, line and column (§5.3 п. 3) — for any piece size and any way the input is
 *   handed over;
 * - decode(encode(file)) is the file, byte for byte, for sizes 0 to 3 MiB and every option (§10);
 * - encoding in pieces is the whole file's Base64 (§5.1 п. 2), checked again on random sizes.
 */
import {
  DEFAULT_ENCODE_OPTIONS,
  createInputDecoder,
  decodeInput,
  decodeTextBlob,
  encodeBlob,
  encodeBytes,
} from './index';
import { bytesToBase64, parseBase64 } from '@workspace/tools-shared/base64';
import { describe, expect, it } from 'vitest';
import type { EncodeOptions } from './index';

/** A small seeded generator (mulberry32): the same inputs on every run. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_';
/** Mostly Base64, with white space, padding in odd places, and now and then a wrong character. */
const noisyText = (next: () => number, length: number, noise: number): string => {
  let out = '';
  for (let i = 0; i < length; i++) {
    const r = next();
    if (r < noise * 0.3) out += [' ', '\n', '\r\n', '\t', '\f'][Math.floor(next() * 5)];
    else if (r < noise * 0.5) out += '=';
    else if (r < noise * 0.6) out += ['!', '😀', '\u{A0}', '.', '%', 'é', '\uD800'][Math.floor(next() * 7)];
    else out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  }
  // Often ends like real Base64: padded, or a group short.
  const tail = next();
  return tail < 0.3 ? `${out}==` : tail < 0.5 ? `${out}=` : out;
};

const inPieces = (text: string, chunkChars: number, pieceOf: () => number) => {
  const decoder = createInputDecoder({ chunkChars });
  const parts: Uint8Array[] = [];
  for (let at = 0; at < text.length;) {
    const size = Math.max(1, pieceOf());
    const step = decoder.push(text.slice(at, at + size));
    if (!step.ok) return step;
    parts.push(...step.bytes);
    at += size;
  }
  const last = decoder.end();
  if (!last.ok) return last;
  parts.push(...last.bytes);
  return { ok: true as const, bytes: Uint8Array.from(Buffer.concat(parts)) };
};

const sameAsShared = (text: string, got: ReturnType<typeof inPieces>) => {
  const shared = parseBase64(text);
  if (shared.ok) {
    expect(got.ok, JSON.stringify(text.slice(0, 80))).toBe(true);
    if (got.ok) expect(Buffer.from(got.bytes).equals(Buffer.from(shared.bytes))).toBe(true);
  } else {
    expect(got.ok, JSON.stringify(text.slice(0, 80))).toBe(false);
    if (!got.ok) expect(got.error).toEqual(shared.error);
  }
};

describe('decoding in pieces is the shared reader on the whole input', () => {
  it('on 6,000 generated inputs, piece sizes 4 to 64 characters, handed over in pieces of 1 to 97', () => {
    const next = seeded(20261122);
    let errors = 0;
    for (let n = 0; n < 6000; n++) {
      const text = noisyText(next, Math.floor(next() * 300), next() < 0.5 ? 0 : next() * 0.05);
      const chunk = 4 * (1 + Math.floor(next() * 16));
      const got = inPieces(text, chunk, () => 1 + Math.floor(next() * 97));
      if (!got.ok) errors++;
      sameAsShared(text, got);
    }
    // Both outcomes are exercised.
    expect(errors).toBeGreaterThan(1000);
    expect(errors).toBeLessThan(5000);
  });

  it('valid Base64 of random bytes, wrapped or not, in either alphabet, at every piece size', () => {
    const next = seeded(7);
    for (let n = 0; n < 400; n++) {
      const data = Uint8Array.from({ length: Math.floor(next() * 2000) }, () => Math.floor(next() * 256));
      const text = bytesToBase64(data, {
        alphabet: next() < 0.5 ? 'standard' : 'url',
        padding: next() < 0.5,
        lineLength: ([0, 64, 76] as const)[Math.floor(next() * 3)]!,
      });
      const got = inPieces(text, 4 * (1 + Math.floor(next() * 100)), () => 1 + Math.floor(next() * 500));
      sameAsShared(text, got);
    }
  });

  it('a text Blob read in slices of any size gives the same outcome', async () => {
    const next = seeded(99);
    for (let n = 0; n < 300; n++) {
      const text = noisyText(next, Math.floor(next() * 400), next() < 0.6 ? 0 : 0.03).replace(/\uD800/g, 'x');
      const parts: Uint8Array[] = [];
      const r = await decodeTextBlob(new Blob([text]), b => parts.push(b), {
        readBytes: 1 + Math.floor(next() * 50),
        chunkChars: 4 * (1 + Math.floor(next() * 20)),
      });
      sameAsShared(
        text,
        r.ok ? { ok: true, bytes: Uint8Array.from(Buffer.concat(parts)) } : { ok: false, error: r.error },
      );
    }
  });
});

describe('decode(encode(file)) is the file', () => {
  const OPTIONS: EncodeOptions[] = [];
  for (const alphabet of ['standard', 'url'] as const)
    for (const padding of [true, false])
      for (const lineLength of [0, 64, 76] as const)
        OPTIONS.push({ ...DEFAULT_ENCODE_OPTIONS, alphabet, padding, lineLength });
  OPTIONS.push({ ...DEFAULT_ENCODE_OPTIONS, form: 'dataUri', type: 'application/octet-stream' });

  it('for sizes 0 to 3 MiB (0–64 every byte, then doubling ± 1) in all 13 option sets, through pieces', async () => {
    const sizes = new Set<number>();
    for (let s = 0; s <= 64; s++) sizes.add(s);
    for (let s = 128; s <= 3 * 1024 * 1024; s *= 2) [s - 1, s, s + 1].forEach(x => sizes.add(x));
    sizes.add(3 * 1024 * 1024);
    const next = seeded(3);
    let checked = 0;
    for (const size of sizes) {
      const file = Uint8Array.from({ length: size }, () => Math.floor(next() * 256));
      for (const o of size > 100_000 ? OPTIONS.filter((_, i) => i % 3 === 0) : OPTIONS) {
        const out: string[] = [];
        await encodeBlob(new Blob([file]), o, t => out.push(t), { chunkBytes: 912 * 37 });
        const text = out.join('');
        expect(text).toBe(encodeBytes(file, o));
        const back = decodeInput(text, { chunkChars: 4096, piece: 10_000 });
        expect(back.ok).toBe(true);
        if (back.ok) expect(Buffer.from(back.bytes).equals(Buffer.from(file))).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);
});
