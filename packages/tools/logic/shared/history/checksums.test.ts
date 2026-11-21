import { toHex, utf8 } from './bytes';
import { crc32, Sha256, sha256Hex } from './checksums';
import { describe, expect, it } from 'vitest';

describe('checksums', () => {
  it('SHA-256: FIPS 180-4 examples, and the same as WebCrypto however the input is split', async () => {
    expect(new Sha256().update(utf8('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(new Sha256().update(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).hex()).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(new Sha256().hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const data = new Uint8Array(100_003).map((_, i) => (i * 7919) & 255);
    const whole = await sha256Hex(data);
    for (const step of [1, 55, 56, 63, 64, 65, 4096]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
      expect(h.hex(), String(step)).toBe(whole);
    }
  });

  it('CRC-32: the check value of "123456789", continued over chunks', () => {
    expect(crc32(0, utf8('123456789')).toString(16)).toBe('cbf43926');
    const data = new Uint8Array(10_001).map((_, i) => i & 255);
    const parts = crc32(crc32(0, data.subarray(0, 4097)), data.subarray(4097));
    expect(parts).toBe(crc32(0, data));
    expect(toHex(new Uint8Array([crc32(0, new Uint8Array()) & 255]))).toBe('00');
  });
});
