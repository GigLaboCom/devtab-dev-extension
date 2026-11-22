/**
 * docs/tools/specs/qr.md §5.6 and the reading rows of §10 that run without a browser: the reader on codes made by an
 * independent writer — node-qrcode 1.5.4, a development dependency only — drawn into pixels here: clean, turned and
 * noisy, light on dark, two in one picture, bytes that are not text, Kanji mode, and pictures with no code.
 */
import { buildQr, readQr } from './index';
import { besideEachOther, blank, raster } from './testing/raster';
import { create } from 'qrcode';
import toSJIS from 'qrcode/helper/to-sjis';
import { describe, expect, it } from 'vitest';
import type { QRCodeSegment } from 'qrcode';

/** A code made by node-qrcode, as a module matrix. */
const theirs = (input: string | QRCodeSegment[], level: 'L' | 'M' | 'Q' | 'H' = 'M', extra = {}): boolean[][] => {
  const { modules } = create(input as string, { errorCorrectionLevel: level, ...extra });
  return Array.from({ length: modules.size }, (_, y) =>
    Array.from({ length: modules.size }, (_, x) => Boolean(modules.get(y, x))),
  );
};

const ours = (text: string): boolean[][] => {
  const r = buildQr(text, 'M');
  if (!r.ok) throw new Error('not built');
  return r.modules;
};

/** Generous: the worst cases run the reader's full effort, with every other package's tests at once. */
const SLOW = 60_000;

describe('§10: reading', () => {
  it('a clean screenshot of https://example.com/qr-clean at 8 px a module: found, 28 characters', async () => {
    const r = await readQr(raster(theirs('https://example.com/qr-clean'), { px: 8 }));
    expect(r).toEqual({ ok: true, text: 'https://example.com/qr-clean', count: 1, bytes: null });
  });

  it(
    'a Wi-Fi "photo" turned 15° with noise: found (§2 scenario 4)',
    async () => {
      const text = 'WIFI:T:WPA;S:my\\;net;P:p@ss\\:word;;';
      const r = await readQr(raster(theirs(text), { px: 6, rotate: 15, noise: 0.25, seed: 11 }));
      expect(r).toMatchObject({ ok: true, text });
    },
    SLOW,
  );

  it('a picture with no code: not found (and nothing located)', async () => {
    expect(await readQr(blank(320, 240))).toEqual({ ok: false, located: false });
  });

  it(
    'a large picture, 4,000 × 3,000, with no code — and with a code of 3 px a module in a corner',
    async () => {
      const big = blank(4000, 3000);
      expect(await readQr(big)).toMatchObject({ ok: false });
      const code = raster(theirs('corner'), { px: 3 });
      for (let y = 0; y < code.height; y++)
        big.data.set(code.data.subarray(y * code.width * 4, (y + 1) * code.width * 4), ((2700 + y) * 4000 + 3700) * 4);
      expect(await readQr(big)).toMatchObject({ ok: true, text: 'corner' });
    },
    SLOW,
  );

  it('a version-40 code at 2 px a module: found', async () => {
    const text = 'v'.repeat(2331);
    expect(await readQr(raster(theirs(text, 'M'), { px: 2 }))).toMatchObject({ ok: true, text });
  });
});

describe('§5.6 beyond the rows', () => {
  it('light on dark is found too', async () => {
    expect(await readQr(raster(theirs('inverted'), { invert: true }))).toMatchObject({ ok: true, text: 'inverted' });
  });

  it('two codes in one picture: the first found is the result and both are counted', async () => {
    const r = await readQr(besideEachOther(raster(theirs('first')), raster(theirs('second'))));
    expect(r).toMatchObject({ ok: true, count: 2 });
    expect(['first', 'second']).toContain(r.ok && r.text);
  });

  it('UTF-8 without ECI is read as UTF-8 (what phones write and read)', async () => {
    for (const text of ['Привет, мир 🙂', '日本語のテキスト', 'café'])
      expect(await readQr(raster(theirs(text)))).toEqual({ ok: true, text, count: 1, bytes: null });
  });

  it('bytes that are not UTF-8: read as ISO-8859-1 (one character a byte) and the bytes themselves kept', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x41, 0x80]);
    const r = await readQr(raster(theirs([{ data: bytes, mode: 'byte' }])));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(String.fromCharCode(0x00, 0xff, 0xfe, 0x41, 0x80));
    expect([...r.bytes!]).toEqual([...bytes]);
  });

  it('a Kanji-mode code (node-qrcode with Shift_JIS) is located but not read: the library has no Kanji mode', async () => {
    const r = await readQr(raster(theirs([{ data: '漢字', mode: 'kanji' }], 'M', { toSJISFunc: toSJIS })));
    expect(r).toEqual({ ok: false, located: true });
  });

  it('a code the tool made is read back by the tool, at every level', async () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const r = buildQr('https://example.com/', level);
      if (!r.ok) throw new Error('not built');
      expect(await readQr(raster(r.modules, { px: 4 }))).toMatchObject({ ok: true, text: 'https://example.com/' });
    }
  });

  it('a quiet zone of 1 module is still found in a clean picture', async () => {
    expect(await readQr(raster(ours('tight'), { quiet: 1 }))).toMatchObject({ ok: true, text: 'tight' });
  });
});
