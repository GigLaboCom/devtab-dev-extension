/**
 * docs/tools/specs/qr.md §10 (the rows a logic can check; the "browser" rows are scripts/e2e-tools/qr.mjs) and what §5
 * states that §10 misses. Codes are checked three ways: against the specification's matrix checksums (the library is
 * pinned, so the same text gives the same picture), against ISO/IEC 18004's own example symbol ("01234567", 1-M), and
 * by an independent reader — jsQR 1.4.0, a development dependency only — reading every code back from pixels.
 */
import {
  CAPACITY,
  DARK,
  DEFAULT_LEVEL,
  DEFAULT_MODULE_PX,
  DEFAULT_QUIET,
  LIGHT,
  MAX_PNG_SIDE,
  MODULE_PX,
  QUIET_ZONES,
  buildQr,
  capacityCheck,
  endsWithSpace,
  foundLine,
  infoLine,
  isLink,
  modeOf,
  pngModulePx,
  secretContent,
  svgFile,
  svgPath,
  tooLongMessage,
  unitsOf,
  utf8Length,
} from './index';
import { raster } from './testing/raster';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { BuiltQr, Level } from './index';

/** "sha": the first 16 hex digits of SHA-256 of the matrix written as rows of 0 and 1 joined by \n (§10). */
const sha = (modules: boolean[][]): string =>
  createHash('sha256')
    .update(modules.map(r => r.map(b => (b ? '1' : '0')).join('')).join('\n'))
    .digest('hex')
    .slice(0, 16);

const built = (text: string, level: Level): BuiltQr => {
  const r = buildQr(text, level);
  if (!r.ok) throw new Error(`not built: ${'message' in r ? r.message : 'empty'}`);
  return r;
};

/** jsQR, an independent reader, on the code drawn at 4 px a module with the standard quiet zone. */
const jsqrRead = (modules: boolean[][]): { text: string; bytes: number[] } | null => {
  const img = raster(modules, { px: 4, quiet: 4 });
  const found = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  return found ? { text: found.data, bytes: found.binaryData } : null;
};

describe('§10: making a code', () => {
  it.each([
    ['https://example.com/', 'L', 2, '52a42ff9d60e90e3'],
    ['https://example.com/', 'M', 2, 'b495295b351150d7'],
    ['https://example.com/', 'Q', 2, '2b030b21cdbf8703'],
    ['https://example.com/', 'H', 3, '7aa61d7be4ee982d'],
  ] as const)('%s at %s: version %i, byte mode, 20 bytes, sha %s', (text, level, version, hash) => {
    const r = built(text, level);
    expect(r).toMatchObject({ version, size: 17 + 4 * version, mode: 'byte', units: 20 });
    expect(sha(r.modules)).toBe(hash);
    expect(jsqrRead(r.modules)?.text).toBe(text);
  });

  it.each([
    ['HELLO WORLD', 'M', 1, 'alphanumeric', 11, '83d76f36239756fc'],
    ['hello world', 'M', 1, 'byte', 11, '51672c7be5800174'],
    ['01234567890', 'M', 1, 'numeric', 11, '57831c682d5248a1'],
    ['01234567890', 'H', 1, 'numeric', 11, 'afec930b81f65063'],
    ['Привет, мир 🙂', 'M', 2, 'byte', 25, '2da64caff1b9431f'],
    ['Привет, мир 🙂', 'H', 4, 'byte', 25, 'b285271700cf7dda'],
  ] as const)('%s at %s: version %i, %s mode, %i, sha %s', (text, level, version, mode, units, hash) => {
    const r = built(text, level);
    expect(r).toMatchObject({ version, mode, units });
    expect(sha(r.modules)).toBe(hash);
    expect(jsqrRead(r.modules)?.text).toBe(text);
  });

  it('A and a space at M: version 1, alphanumeric, 1 character', () => {
    for (const text of ['A', ' ']) {
      expect(built(text, 'M')).toMatchObject({ version: 1, mode: 'alphanumeric', units: 1 });
      expect(jsqrRead(built(text, 'M').modules)?.text).toBe(text);
    }
  });

  it('nothing at M: the empty state, no code', () => {
    expect(buildQr('', 'M')).toEqual({ ok: false, empty: true });
  });

  it.each([
    ['a', 2331, 'M', 'Too long for a QR code: 2,332 bytes; level M holds up to 2,331 bytes in byte mode.'],
    ['1', 7089, 'L', 'Too long for a QR code: 7,090 characters; level L holds up to 7,089 characters in numeric mode.'],
    [
      'A',
      4296,
      'L',
      'Too long for a QR code: 4,297 characters; level L holds up to 4,296 characters in alphanumeric mode.',
    ],
    [
      'A',
      1852,
      'H',
      'Too long for a QR code: 1,853 characters; level H holds up to 1,852 characters in alphanumeric mode.',
    ],
  ] as const)('%s × %i at %s: version 40; one more — the message', (c, n, level, message) => {
    const r = built(c.repeat(n), level);
    expect(r).toMatchObject({ version: 40, size: 177 });
    expect(buildQr(c.repeat(n + 1), level)).toEqual({ ok: false, message });
  });

  it('я × 1,166 at M (2,332 bytes): the message in bytes', () => {
    expect(buildQr('я'.repeat(1166), 'M')).toEqual({
      ok: false,
      message: 'Too long for a QR code: 2,332 bytes; level M holds up to 2,331 bytes in byte mode.',
    });
    expect(built('я'.repeat(1165), 'M').version).toBe(40);
  });

  it('§5.2: all twelve limits — the limit fits, one more does not (run, not reasoned)', () => {
    const sample = { numeric: '7', alphanumeric: 'Z', byte: 'b' } as const;
    for (const mode of ['numeric', 'alphanumeric', 'byte'] as const)
      for (const level of ['L', 'M', 'Q', 'H'] as const) {
        const limit = CAPACITY[mode][level];
        expect(built(sample[mode].repeat(limit), level).version, `${mode} ${level}`).toBe(40);
        expect(buildQr(sample[mode].repeat(limit + 1), level), `${mode} ${level} + 1`).toEqual({
          ok: false,
          message: tooLongMessage(limit + 1, mode, level),
        });
      }
  });

  it('a version-40 code at H is read back by jsQR', () => {
    const text = 'z'.repeat(1273);
    expect(jsqrRead(built(text, 'H').modules)?.text).toBe(text);
  });
});

describe('ISO/IEC 18004: the standard’s example symbol "01234567" (1-M)', () => {
  // The code words of the standard's encoding example (Annex I): 16 data, 10 error correction.
  const DATA = '10 20 0c 56 61 80 ec 11 ec 11 ec 11 ec 11 ec 11';
  const ECC = 'a5 24 d4 c1 ed 36 c7 87 2c 55';
  const MASKS: Array<(i: number, j: number) => boolean> = [
    (i, j) => (i + j) % 2 === 0,
    i => i % 2 === 0,
    (_, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
  ];
  /** The code words of a version 1 symbol, read in the placement order of §7.7.3 and unmasked with `mask`. */
  const codewords = (m: boolean[][], mask: number): string => {
    const reserved = (i: number, j: number) =>
      (i < 9 && (j < 9 || j >= 13)) || (i >= 13 && j < 9) || i === 6 || j === 6;
    const bits: number[] = [];
    let up = true;
    for (let j = 20; j > 0; j -= 2) {
      if (j === 6) j--;
      for (let k = 0; k < 21; k++) {
        const i = up ? 20 - k : k;
        for (const c of [j, j - 1]) if (!reserved(i, c)) bits.push(Number(m[i]![c]! !== MASKS[mask]!(i, c)));
      }
      up = !up;
    }
    const out: string[] = [];
    for (let k = 0; k + 8 <= bits.length; k += 8)
      out.push(
        parseInt(bits.slice(k, k + 8).join(''), 2)
          .toString(16)
          .padStart(2, '0'),
      );
    return out.join(' ');
  };

  it('our symbol holds exactly the standard’s 26 code words under its mask, and reads back', () => {
    const r = built('01234567', 'M');
    expect(r).toMatchObject({ version: 1, mode: 'numeric', units: 8 });
    const unmasked = MASKS.map((_, k) => codewords(r.modules, k));
    expect(unmasked).toContain(`${DATA} ${ECC}`);
    expect(jsqrRead(r.modules)?.text).toBe('01234567');
  });
});

describe('§10: the SVG', () => {
  it('svgPath of https://example.com/ at M, quiet zone 4', () => {
    expect(svgPath(built('https://example.com/', 'M').modules, 4)).toMatch(
      /^M4 4h7v1h-7zM12 4h1v1h-1zM15 4h2v1h-2zM18 4h3v1h-3z/,
    );
  });

  it('svgFile of the same, quiet zone 4, 8 px: 2,396 bytes, its SHA-256 and its start', () => {
    const file = svgFile(built('https://example.com/', 'M').modules, 4, 8);
    expect(Buffer.byteLength(file, 'utf8')).toBe(2396);
    expect(createHash('sha256').update(file).digest('hex')).toMatch(/^db0699cbd9048ef0/);
    expect(file).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="264" height="264" viewBox="0 0 33 33" shape-rendering="crispEdges"><rect width="33" height="33" fill="#ffffff"\/>/,
    );
    expect(file.endsWith('fill="#000000"/></svg>\n')).toBe(true);
    expect(file.startsWith('<?xml')).toBe(false);
  });

  it('the path draws exactly the dark modules (every quiet zone of §4)', () => {
    const { modules } = built('HELLO WORLD', 'Q');
    for (const quiet of QUIET_ZONES) {
      const n = modules.length + 2 * quiet;
      const grid = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
      for (const m of svgPath(modules, quiet).matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g))
        for (let k = 0; k < Number(m[3]); k++) grid[Number(m[2])]![Number(m[1]) + k] = true;
      const back = grid.slice(quiet, n - quiet).map(r => r.slice(quiet, n - quiet));
      expect(back).toEqual(modules);
      expect(grid.flat().filter(Boolean).length).toBe(modules.flat().filter(Boolean).length);
    }
  });
});

describe('§5 beyond the rows of §10', () => {
  it('modeOf: numeric, alphanumeric, byte (§10 row)', () => {
    expect(['', '0123', 'ABC 12', 'abc', 'A-B.C/D:E', 'é'].map(modeOf)).toEqual([
      'numeric',
      'numeric',
      'alphanumeric',
      'byte',
      'alphanumeric',
      'byte',
    ]);
    // The whole alphanumeric set of ISO/IEC 18004 table 5, and nothing else of ASCII.
    expect(modeOf('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:')).toBe('alphanumeric');
    for (const c of '!"#&\'(),;<=>?@[\\]^_`{|}~a') expect(modeOf(`A${c}`), c).toBe('byte');
    // Every text is checked against the library's own choice: the information line says what it did.
    for (const t of ['0', 'Z9', 'a', 'HTTPS://EXAMPLE.COM/', 'https://example.com/', '12 34'])
      expect(built(t, 'M').mode).toBe(modeOf(t));
  });

  it('byte mode is UTF-8 without an ECI header: the symbol’s bytes are the text’s UTF-8', () => {
    for (const text of ['hello world', 'Привет, мир 🙂', 'café', '日本語']) {
      const back = jsqrRead(built(text, 'M').modules)!;
      expect(back.bytes).toEqual([...new TextEncoder().encode(text)]);
    }
  });

  it('units: UTF-8 bytes in byte mode (as TextEncoder counts them), characters otherwise', () => {
    expect(unitsOf('Привет, мир 🙂')).toBe(25);
    expect(unitsOf('HELLO WORLD')).toBe(11);
    for (const t of ['a', 'é', '€', '🙂', '\ud800', 'a\udc00b', 'x\ud83d'])
      expect(utf8Length(t), JSON.stringify(t)).toBe(new TextEncoder().encode(t).length);
  });

  it('the information line', () => {
    expect(infoLine(built('https://example.com/', 'M'), 'M')).toBe(
      'Version 2 · 25 × 25 modules · level M · 20 bytes (byte mode)',
    );
    expect(infoLine(built('HELLO WORLD', 'M'), 'M')).toBe(
      'Version 1 · 21 × 21 modules · level M · 11 characters (alphanumeric mode)',
    );
    expect(infoLine(built('A', 'L'), 'L')).toBe(
      'Version 1 · 21 × 21 modules · level L · 1 character (alphanumeric mode)',
    );
    expect(infoLine(built('a'.repeat(2331), 'M'), 'M')).toBe(
      'Version 40 · 177 × 177 modules · level M · 2,331 bytes (byte mode)',
    );
  });

  it('a higher level never takes a smaller version (§4)', () => {
    for (const text of ['https://example.com/', 'x'.repeat(100), '1'.repeat(500)]) {
      const versions = (['L', 'M', 'Q', 'H'] as const).map(l => built(text, l).version);
      expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    }
  });

  it('the smallest version that fits: one byte more than a version holds takes the next', () => {
    // Version 1 at L holds 17 bytes, version 2 holds 32 (table 7).
    expect(built('a'.repeat(17), 'L').version).toBe(1);
    expect(built('a'.repeat(18), 'L').version).toBe(2);
    expect(built('a'.repeat(32), 'L').version).toBe(2);
    expect(built('a'.repeat(33), 'L').version).toBe(3);
  });

  it('a space or a line break at the end is encoded and noted; only spaces make a code', () => {
    expect(endsWithSpace('text ')).toBe(true);
    expect(endsWithSpace('text\n')).toBe(true);
    expect(endsWithSpace('text')).toBe(false);
    expect(endsWithSpace(' text')).toBe(false);
    expect(jsqrRead(built('text\n', 'M').modules)?.text).toBe('text\n');
    expect(built('   ', 'M')).toMatchObject({ mode: 'alphanumeric', units: 3 });
  });

  it('defaults and lists of §4', () => {
    expect(DEFAULT_LEVEL).toBe('M');
    expect(DEFAULT_QUIET).toBe(4);
    expect(DEFAULT_MODULE_PX).toBe(8);
    expect([...QUIET_ZONES]).toEqual([0, 1, 2, 3, 4, 6, 8]);
    expect([...MODULE_PX]).toEqual([4, 8, 16, 32]);
    expect([DARK, LIGHT]).toEqual(['#000000', '#ffffff']);
  });

  it('PNG size: 264 px for version 2 at 8 px with a quiet zone of 4; never above 8,192 px', () => {
    expect(pngModulePx(25, 4, 8)).toEqual({ px: 8, reduced: false });
    // Version 40, quiet zone 8, 32 px: 6,176 px — within the limit, so the limit is never reached in practice.
    expect(pngModulePx(177, 8, 32)).toEqual({ px: 32, reduced: false });
    expect((177 + 16) * 32).toBe(6176);
    expect(pngModulePx(300, 8, 32)).toEqual({ px: 16, reduced: true });
    expect((300 + 16) * 16).toBeLessThanOrEqual(MAX_PNG_SIDE);
  });

  it('links are recognised to say they are never opened', () => {
    expect(isLink('https://example.com/qr-clean')).toBe(true);
    expect(isLink('HTTP://EXAMPLE.COM')).toBe(true);
    expect(isLink('ftp://example.com')).toBe(false);
    expect(isLink('see https://example.com')).toBe(false);
  });

  it('what the history keeps only encrypted: Wi-Fi details and one-time password keys', () => {
    expect(secretContent('WIFI:T:WPA;S:Home;P:secret123;;')).toBe('wifi');
    expect(secretContent('wifi:S:x;;')).toBe('wifi');
    expect(secretContent('otpauth://totp/Example:me?secret=JBSWY3DPEHPK3PXP')).toBe('one-time-key');
    expect(secretContent('otpauth-migration://offline?data=AAAA')).toBe('one-time-key');
    expect(secretContent('https://example.com/')).toBeNull();
    expect(secretContent('my WIFI: is down')).toBeNull();
  });

  it('the found line counts characters as a person does', () => {
    expect(foundLine('https://example.com/qr-clean')).toBe('Found a QR code: 28 characters.');
    expect(foundLine('🙂')).toBe('Found a QR code: 1 character.');
  });

  it('capacityCheck says the same as buildQr without building', () => {
    expect(capacityCheck('a'.repeat(2332), 'M')).toMatchObject({ fits: false, mode: 'byte', units: 2332 });
    expect(capacityCheck('a'.repeat(2331), 'M')).toMatchObject({ fits: true });
  });

  it('a code of version 40 builds and draws in a bounded number of path commands (its shape, not a time)', () => {
    const r = built('a'.repeat(2331), 'M');
    const path = svgPath(r.modules, 4);
    const runs = path.split('M').length - 1;
    expect(runs).toBeLessThan(177 * 89);
    expect(runs).toBeGreaterThan(177);
  });
});
