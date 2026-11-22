/**
 * The promises of docs/tools/specs/qr.md that examples cannot cover, on generated inputs (seeded: a failure names its
 * seed and repeats):
 *   - any text within the capacity of a level → a code → read back from its pixels gives the same text and the same
 *     UTF-8 bytes, at every level and in every mode — read by the tool's own reader and by jsQR (independent);
 *   - one byte or character beyond the capacity is refused with the message, never a code;
 *   - the Wi-Fi string of any network name and password parses back to the same fields.
 */
import { CAPACITY, buildQr, modeOf, parseWifi, readQr, unitsOf, wifiString } from './index';
import { random, raster } from './testing/raster';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import type { Level, WifiDetails, WifiSecurity } from './index';

const SLOW = 120_000;
const LEVELS: Level[] = ['L', 'M', 'Q', 'H'];

/** Characters of every kind a person may type or paste: ASCII, the alphanumeric set, Cyrillic, CJK, emoji, controls. */
const POOLS = [
  '0123456789',
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:',
  'abcdefghijklmnopqrstuvwxyz!"#&\'()*,;<=>?@[\\]^_`{|}~\t\n',
  'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  'éüßøñçæœ€£¥©®',
  '日本語中文한국어',
  '🙂🚀👍🏽🇺🇦',
  '\u0000\u0007\u001b\u00a0\u200b\u2028',
];

const text = (rnd: () => number, length: number): string => {
  const pool = [...POOLS[Math.floor(rnd() * POOLS.length)]!];
  // Mostly one pool (so numeric and alphanumeric texts occur), sometimes mixed.
  const mixed = rnd() < 0.3;
  let out = '';
  for (let i = 0; i < length; i++) {
    const from = mixed ? [...POOLS[Math.floor(rnd() * POOLS.length)]!] : pool;
    out += from[Math.floor(rnd() * from.length)];
  }
  return out;
};

/** A text of `mode` whose length is exactly the level's capacity (one more must be refused). */
const atCapacity = (mode: 'numeric' | 'alphanumeric' | 'byte', level: Level, rnd: () => number): string => {
  const n = CAPACITY[mode][level];
  if (mode === 'numeric') return Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
  if (mode === 'alphanumeric') return Array.from({ length: n }, () => POOLS[1]![Math.floor(rnd() * 45)]).join('');
  // Bytes: two-byte Cyrillic letters, then ASCII to land exactly on the limit.
  const two = Math.floor((n - 1) / 2);
  return 'ж'.repeat(two) + 'x'.repeat(n - 2 * two);
};

describe('round trip: text → code → pixels → text', () => {
  it(
    'random texts at every level read back to the same text and bytes (the tool’s reader and jsQR)',
    async () => {
      const seed = 20261122;
      const rnd = random(seed);
      for (let k = 0; k < 120; k++) {
        const level = LEVELS[k % 4]!;
        const t = text(rnd, 1 + Math.floor(rnd() * (k % 10 === 0 ? 400 : 60)));
        const built = buildQr(t, level);
        if (!built.ok) throw new Error(`seed ${seed}, case ${k}: not built`);
        expect(built.mode, `seed ${seed}, case ${k}`).toBe(modeOf(t));
        const img = raster(built.modules, { px: 3 });
        const ours = await readQr(img);
        // A lone surrogate cannot be UTF-8: TextEncoder writes U+FFFD, and that is what comes back.
        const expected = new TextDecoder().decode(new TextEncoder().encode(t));
        expect(ours, `seed ${seed}, case ${k}: ${JSON.stringify(t)}`).toMatchObject({ ok: true, text: expected });
        const theirs = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
        expect(theirs?.binaryData, `seed ${seed}, case ${k}, jsQR`).toEqual(
          built.mode === 'byte' ? [...new TextEncoder().encode(t)] : [...t].map(c => c.charCodeAt(0)),
        );
      }
    },
    SLOW,
  );

  it(
    'texts exactly at the capacity of every level and mode read back; one more is refused',
    async () => {
      const seed = 7;
      const rnd = random(seed);
      for (const mode of ['numeric', 'alphanumeric', 'byte'] as const)
        for (const level of LEVELS) {
          const t = atCapacity(mode, level, rnd);
          expect(unitsOf(t), `${mode} ${level}`).toBe(CAPACITY[mode][level]);
          const built = buildQr(t, level);
          if (!built.ok) throw new Error(`seed ${seed}: ${mode} ${level} not built`);
          expect(built).toMatchObject({ version: 40, mode });
          expect(await readQr(raster(built.modules, { px: 2 })), `${mode} ${level}`).toMatchObject({
            ok: true,
            text: t,
          });
          const over = mode === 'byte' ? `${t}x` : `${t}${t[0]}`;
          expect(buildQr(over, level)).toMatchObject({ ok: false, message: expect.stringMatching(/^Too long/) });
        }
    },
    SLOW,
  );
});

describe('round trip: Wi-Fi details → string → fields', () => {
  const SPECIAL = '\\;,:"\'= \t';
  const field = (rnd: () => number, min: number): string => {
    const n = min + Math.floor(rnd() * 24);
    let out = '';
    for (let i = 0; i < n; i++) {
      const r = rnd();
      out +=
        r < 0.35
          ? SPECIAL[Math.floor(rnd() * SPECIAL.length)]
          : r < 0.5
            ? '"'
            : r < 0.6
              ? ['я', '日', '🙂', 'é'][Math.floor(rnd() * 4)]
              : String.fromCharCode(33 + Math.floor(rnd() * 94));
    }
    return out;
  };

  it('any network name and password parse back to the same fields', () => {
    const seed = 99;
    const rnd = random(seed);
    const types: Record<WifiSecurity, string> = { wpa: 'WPA', wep: 'WEP', none: 'nopass' };
    for (let k = 0; k < 2000; k++) {
      const security = (['wpa', 'wep', 'none'] as const)[k % 3]!;
      const details: WifiDetails = { ssid: field(rnd, 1), password: field(rnd, 0), security, hidden: rnd() < 0.5 };
      const parsed = parseWifi(wifiString(details));
      expect(parsed, `seed ${seed}, case ${k}: ${JSON.stringify(details)}`).toEqual({
        ssid: details.ssid,
        security: types[security],
        password: security === 'none' ? '' : details.password,
        hidden: details.hidden,
      });
    }
  });

  it(
    'and through a code: made, read from pixels, parsed',
    async () => {
      const rnd = random(5);
      for (let k = 0; k < 12; k++) {
        const details: WifiDetails = {
          ssid: field(rnd, 1),
          password: field(rnd, 8),
          security: 'wpa',
          hidden: k % 2 === 0,
        };
        const built = buildQr(wifiString(details), 'M');
        if (!built.ok) throw new Error('not built');
        const read = await readQr(raster(built.modules, { px: 3 }));
        expect(read.ok && parseWifi(read.text)).toEqual({ ...details, security: 'WPA' });
      }
    },
    SLOW,
  );
});
