// docs/tools/specs/number-base.md: every row of §10 with its expected value, the errors of §6 word for word with their
// offsets, the detection of §7, what §5 states and §10 misses, a round-trip property at thousands of digits, and the
// limits of §12 (a long text costs one bounded pass).
import { detectNumberBase, fieldOfText } from './detect';
import {
  bitLengthOf,
  clipBytes,
  digitsToBigInt,
  doesNotFit,
  formatNumber,
  isValidRadix,
  MAX_DIGITS,
  MESSAGES,
  numberDetails,
  parseNumber,
  radixOf,
} from './logic';
import { describe, expect, it } from 'vitest';
import type { FormatOptions, NumberOptions, ParseResult, Radix, Width } from './logic';

const SIGN: NumberOptions = { negative: 'sign', width: 32 };
const twos = (width: Width): NumberOptions => ({ negative: 'twos', width });
const FORMAT: FormatOptions = { ...SIGN, uppercase: false, grouped: false, prefixes: false };

const value = (text: string, radix: Radix, options: NumberOptions = SIGN): bigint | null => {
  const r = parseNumber(text, radix, options);
  if (!r.ok) throw new Error(`${text}: ${r.error.message} at ${r.error.offset}`);
  return r.value;
};
const error = (text: string, radix: Radix, options: NumberOptions = SIGN) => {
  const r = parseNumber(text, radix, options);
  if (r.ok) throw new Error(`${text}: parsed as ${r.value}`);
  return r.error;
};

/** The five fields as §10 lists them: binary / octal / decimal / hexadecimal / base 36 (the Base field, plain). */
const fields = (v: bigint | null, options: Partial<FormatOptions> = {}, n = 36): string[] => {
  const o = { ...FORMAT, ...options };
  return [
    formatNumber(v, 2, o).shown,
    formatNumber(v, 8, o).shown,
    formatNumber(v, 10, o).shown,
    formatNumber(v, 16, o).shown,
    formatNumber(v, n, { ...o, plain: true }).shown,
  ];
};
const details = (v: bigint, options: NumberOptions = SIGN, uppercase = false) =>
  numberDetails(v, { ...options, uppercase });
const repeat = (digit: string, n: number) => digit.repeat(n);

describe('§10: Minus sign', () => {
  it('255 in Decimal', () => {
    const v = value('255', 10);
    expect(fields(v)).toEqual(['11111111', '377', '255', 'ff', '73']);
    expect(details(v!)).toMatchObject({ bitLength: 8, byteLength: 1, bytesBigEndian: 'ff', bytesLittleEndian: 'ff' });
  });

  it('0xFF in Hexadecimal — as above', () => {
    const v = value('0xFF', 16);
    expect(v).toBe(255n);
    expect(fields(v)).toEqual(['11111111', '377', '255', 'ff', '73']);
    expect(details(v!)).toMatchObject({ bitLength: 8, bytesBigEndian: 'ff' });
  });

  it('ff in Hexadecimal, Uppercase — hex FF, bytes FF', () => {
    const v = value('ff', 16);
    expect(formatNumber(v, 16, { ...FORMAT, uppercase: true }).shown).toBe('FF');
    expect(details(v!, SIGN, true).bytesBigEndian).toBe('FF');
  });

  it('0b1010_1010 in Binary', () => {
    expect(fields(value('0b1010_1010', 2))).toEqual(['10101010', '252', '170', 'aa', '4q']);
  });

  it('0o777 in Octal — bits 9, bytes 01 ff, LE ff 01', () => {
    const v = value('0o777', 8);
    expect(fields(v)).toEqual(['111111111', '777', '511', '1ff', 'e7']);
    expect(details(v!)).toMatchObject({
      bitLength: 9,
      byteLength: 2,
      bytesBigEndian: '01 ff',
      bytesLittleEndian: 'ff 01',
    });
  });

  it('-255 in Decimal — the sign in every base, no bytes', () => {
    const v = value('-255', 10);
    expect(fields(v)).toEqual(['-11111111', '-377', '-255', '-ff', '-73']);
    expect(details(v!)).toEqual({ bitLength: 8, byteLength: 1, bytesBigEndian: null, bytesLittleEndian: null });
  });

  it('-0x1f in Hexadecimal', () => {
    expect(fields(value('-0x1f', 16))).toEqual(['-11111', '-37', '-31', '-1f', '-v']);
  });

  it('+7 and 0007 in Decimal — bytes 07', () => {
    for (const text of ['+7', '0007']) {
      const v = value(text, 10);
      expect(fields(v)).toEqual(['111', '7', '7', '7', '7']);
      expect(details(v!).bytesBigEndian).toBe('07');
    }
  });

  it('017 in Decimal is seventeen, in Octal fifteen', () => {
    const dec = value('017', 10);
    expect(dec).toBe(17n);
    expect(formatNumber(dec, 2, FORMAT).shown).toBe('10001');
    expect(formatNumber(dec, 16, FORMAT).shown).toBe('11');
    const oct = value('017', 8);
    expect(oct).toBe(15n);
    expect(formatNumber(oct, 2, FORMAT).shown).toBe('1111');
    expect(formatNumber(oct, 16, FORMAT).shown).toBe('f');
  });

  it('-0 in Decimal — 0 everywhere; bits 0, byte length 1, bytes 00', () => {
    const v = value('-0', 10);
    expect(v).toBe(0n);
    expect(fields(v)).toEqual(['0', '0', '0', '0', '0']);
    expect(details(v!)).toMatchObject({ bitLength: 0, byteLength: 1, bytesBigEndian: '00', bytesLittleEndian: '00' });
  });

  it('1,000,000 in Decimal, Group digits', () => {
    const v = value('1,000,000', 10);
    expect(fields(v, { grouped: true })).toEqual([
      '1111 0100 0010 0100 0000',
      '3 641 100',
      '1,000,000',
      'f 4240',
      'lfls',
    ]);
    expect(details(v!).bytesBigEndian).toBe('0f 42 40');
  });

  it("1'000'000 and 1 000 000 in Decimal", () => {
    for (const text of ["1'000'000", '1 000 000']) {
      const f = fields(value(text, 10));
      expect(f[0]).toBe('11110100001001000000');
      expect(f[3]).toBe('f4240');
    }
  });

  it('ff ff_ff in Hexadecimal — 16777215, bytes ff ff ff', () => {
    const v = value('ff ff_ff', 16);
    expect(formatNumber(v, 10, FORMAT).shown).toBe('16777215');
    expect(details(v!).bytesBigEndian).toBe('ff ff ff');
  });

  it('18446744073709551615 in Decimal — 64 ones, bits 64', () => {
    const v = value('18446744073709551615', 10);
    const f = fields(v);
    expect(f[0]).toBe(repeat('1', 64));
    expect(f[1]).toBe('1777777777777777777777');
    expect(f[3]).toBe('ffffffffffffffff');
    expect(f[4]).toBe('3w5e11264sgsf');
    expect(details(v!).bitLength).toBe(64);
  });

  it('123456789012345678901234567890 in Decimal — exact; bits 97, byte length 13', () => {
    const v = value('123456789012345678901234567890', 10);
    expect(formatNumber(v, 16, FORMAT).shown).toBe('18ee90ff6c373e0ee4e3f0ad2');
    expect(formatNumber(v, 36, { ...FORMAT, plain: true }).shown).toBe('byw97um9s91dlz68tsi');
    expect(details(v!)).toMatchObject({ bitLength: 97, byteLength: 13 });
  });

  it('zz and ZZ in Base, N = 36 — bytes 05 0f', () => {
    for (const text of ['zz', 'ZZ']) {
      const v = value(text, 36);
      expect(fields(v).slice(0, 4)).toEqual(['10100001111', '2417', '1295', '50f']);
      expect(details(v!).bytesBigEndian).toBe('05 0f');
    }
  });

  it('0x1F in Base, N = 36 — digits, not a prefix: 42819', () => {
    expect(value('0x1F', 36)).toBe(42819n);
  });

  it('1010 in Base, N = 3 — 30, hex 1e', () => {
    const v = value('1010', 3);
    expect(formatNumber(v, 10, FORMAT).shown).toBe('30');
    expect(formatNumber(v, 16, FORMAT).shown).toBe('1e');
  });

  it('  42   in Decimal, Prefixes', () => {
    expect(fields(value('  42  ', 10), { prefixes: true })).toEqual(['0b101010', '0o52', '42', '0x2a', '16']);
  });

  it('255 in Decimal, Group digits and Prefixes — Binary shows 0b1111 1111, copies 0b11111111', () => {
    expect(formatNumber(255n, 2, { ...FORMAT, grouped: true, prefixes: true })).toEqual({
      shown: '0b1111 1111',
      copy: '0b11111111',
    });
  });
});

describe("§10: Two's complement", () => {
  it('-1 in Decimal, 32 bits', () => {
    const v = value('-1', 10, twos(32));
    expect(fields(v, twos(32))).toEqual([repeat('1', 32), '37777777777', '-1', 'ffffffff', '1z141z3']);
    expect(details(v!, twos(32))).toEqual({
      signed: '-1',
      unsigned: '4294967295',
      bitLength: 32,
      byteLength: 4,
      bytesBigEndian: 'ff ff ff ff',
      bytesLittleEndian: 'ff ff ff ff',
    });
  });

  it('ffffffff in Hexadecimal, 32 bits — as above', () => {
    const v = value('ffffffff', 16, twos(32));
    expect(v).toBe(-1n);
    expect(fields(v, twos(32))).toEqual([repeat('1', 32), '37777777777', '-1', 'ffffffff', '1z141z3']);
    expect(details(v!, twos(32))).toMatchObject({ signed: '-1', unsigned: '4294967295' });
  });

  it('80 in Hexadecimal and -128 in Decimal, 8 bits', () => {
    for (const [text, radix] of [
      ['80', 16],
      ['-128', 10],
    ] as const) {
      const v = value(text, radix, twos(8));
      expect(fields(v, twos(8)).slice(0, 4)).toEqual(['10000000', '200', '-128', '80']);
      expect(details(v!, twos(8)).unsigned).toBe('128');
    }
  });

  it('255 in Decimal and -1 in Hexadecimal, 8 bits', () => {
    for (const [text, radix] of [
      ['255', 10],
      ['-1', 16],
    ] as const) {
      const v = value(text, radix, twos(8));
      expect(fields(v, twos(8)).slice(0, 4)).toEqual(['11111111', '377', '-1', 'ff']);
      expect(details(v!, twos(8)).unsigned).toBe('255');
    }
  });

  it('9223372036854775807 in Decimal, 64 bits', () => {
    const v = value('9223372036854775807', 10, twos(64));
    expect(formatNumber(v, 2, { ...FORMAT, ...twos(64) }).shown).toBe('0' + repeat('1', 63));
    expect(formatNumber(v, 16, { ...FORMAT, ...twos(64) }).shown).toBe('7fffffffffffffff');
  });

  it('-9223372036854775808 in Decimal, 64 bits', () => {
    const v = value('-9223372036854775808', 10, twos(64));
    expect(formatNumber(v, 2, { ...FORMAT, ...twos(64) }).shown).toBe('1' + repeat('0', 63));
    expect(formatNumber(v, 16, { ...FORMAT, ...twos(64) }).shown).toBe('8000000000000000');
    expect(details(v!, twos(64)).unsigned).toBe('9223372036854775808');
  });

  it('5 in Decimal, 16 bits, Group digits — padded to the width', () => {
    const v = value('5', 10, twos(16));
    const o = { ...FORMAT, ...twos(16), grouped: true };
    expect(formatNumber(v, 2, o).shown).toBe('0000 0000 0000 0101');
    expect(formatNumber(v, 16, o).shown).toBe('0005');
    expect(details(v!, twos(16))).toMatchObject({ bytesBigEndian: '00 05', bytesLittleEndian: '05 00' });
  });

  it('-2147024891 in Decimal, 32 bits — the Windows error code of §2.2', () => {
    const v = value('-2147024891', 10, twos(32));
    expect(formatNumber(v, 16, { ...FORMAT, ...twos(32) }).shown).toBe('80070005');
    expect(details(v!, twos(32))).toMatchObject({
      unsigned: '2147942405',
      bytesBigEndian: '80 07 00 05',
      bytesLittleEndian: '05 00 07 80',
    });
  });

  it('256 / -129 in Decimal, 8 bits — does not fit, offset 0 / 1', () => {
    const message = 'does not fit in 8 bits: the range is -128 to 255';
    expect(error('256', 10, twos(8))).toEqual({ message, offset: 0 });
    expect(error('-129', 10, twos(8))).toEqual({ message, offset: 1 });
  });

  it('1ff / -81 in Hexadecimal, 8 bits — the same error, offset 0 / 1', () => {
    const message = 'does not fit in 8 bits: the range is -128 to 255';
    expect(error('1ff', 16, twos(8))).toEqual({ message, offset: 0 });
    expect(error('-81', 16, twos(8))).toEqual({ message, offset: 1 });
  });
});

describe('§10 and §6: errors, word for word, with their offsets', () => {
  it('12.5 in Decimal — fractions, offset 2 (Column 3)', () => {
    expect(error('12.5', 10)).toEqual({ message: 'only whole numbers: fractions are not supported', offset: 2 });
  });

  it('1e3 in Decimal — exponent, offset 1; in Hexadecimal — the number 483', () => {
    expect(error('1e3', 10)).toEqual({
      message: 'only whole numbers: exponent notation (1e3) is not supported',
      offset: 1,
    });
    expect(value('1e3', 16)).toBe(483n);
  });

  it('12a in Decimal / 102 in Binary — a digit, offset 2', () => {
    expect(error('12a', 10)).toEqual({ message: '"a" is not a base-10 digit', offset: 2 });
    expect(error('102', 2)).toEqual({ message: '"2" is not a base-2 digit', offset: 2 });
  });

  it('0x in Hexadecimal / - in Decimal — no digits, offset 2 / 1', () => {
    expect(error('0x', 16)).toEqual({ message: 'enter digits after the sign or prefix', offset: 2 });
    expect(error('-', 10)).toEqual({ message: 'enter digits after the sign or prefix', offset: 1 });
  });

  it('0xff in Decimal / 0b101 in Octal — a hint which field, offset 1', () => {
    expect(error('0xff', 10)).toEqual({
      message: '"x" is not a base-10 digit; 0x… numbers go in the Hexadecimal field',
      offset: 1,
    });
    expect(error('0b101', 8)).toEqual({
      message: '"b" is not a base-8 digit; 0b… numbers go in the Binary field',
      offset: 1,
    });
  });

  it('1,5 / 10,00 / 1000,000 in Decimal — commas, offset 2 / 4 / 4', () => {
    const message = 'commas must separate groups of three digits, as in 1,000,000';
    expect(error('1,5', 10)).toEqual({ message, offset: 2 });
    expect(error('10,00', 10)).toEqual({ message, offset: 4 });
    expect(error('1000,000', 10)).toEqual({ message, offset: 4 });
  });

  it('ff,ff in Hexadecimal — a comma, offset 2', () => {
    expect(error('ff,ff', 16)).toEqual({
      message: '"," is not allowed here; use _ or a space to group digits',
      offset: 2,
    });
  });

  it('١٢ in Decimal — digits of another script are not digits, offset 0', () => {
    expect(error('١٢', 10)).toEqual({ message: '"١" is not a base-10 digit', offset: 0 });
  });

  it('an empty field and spaces only — empty, no error', () => {
    expect(parseNumber('', 10, SIGN)).toEqual({ ok: true, value: null });
    expect(parseNumber('   ', 10, SIGN)).toEqual({ ok: true, value: null });
    expect(fields(null)).toEqual(['', '', '', '', '']);
  });

  it('10,001 ones in Binary — too long at offset 10000; 10,000 ones are read', () => {
    expect(error(repeat('1', 10_001), 2)).toEqual({ message: 'too long: up to 10,000 digits', offset: 10_000 });
    expect(value(repeat('1', 10_000), 2)).toBe((1n << 10_000n) - 1n);
  });
});

describe('§5 beyond §10', () => {
  it('offsets count from the start of the field, before trimming', () => {
    expect(error('  12.5', 10).offset).toBe(4);
    expect(error('\t0xff', 10).offset).toBe(2);
    expect(error(' 0x ', 16).offset).toBe(3);
  });

  it('the prefix in any case, a sign before it; never in Decimal or the Base field', () => {
    expect(value('0XfF', 16)).toBe(255n);
    expect(value('-0B11', 2)).toBe(-3n);
    expect(value('+0O17', 8)).toBe(15n);
    expect(value('0b101', 16)).toBe(0xb101n); // b is a hex digit
    expect(error('0o17', 16)).toEqual({
      message: '"o" is not a base-16 digit; 0o… numbers go in the Octal field',
      offset: 1,
    });
    expect(error('0x1', 2).message).toBe('"x" is not a base-2 digit; 0x… numbers go in the Hexadecimal field');
    expect(error('0X1', 10).message).toBe('"X" is not a base-10 digit; 0x… numbers go in the Hexadecimal field');
    expect(error('0x1', 12).message).toBe('"x" is not a base-12 digit; 0x… numbers go in the Hexadecimal field');
    expect(value('0b1', 36)).toBe(BigInt(parseInt('0b1', 36)));
  });

  it('separators anywhere after the sign and the prefix; no-break spaces of a locale too', () => {
    expect(value('0x_ff', 16)).toBe(255n);
    expect(value("- 1_000'000", 10)).toBe(-1_000_000n);
    expect(value('1 000 000', 10)).toBe(1_000_000n);
    expect(error('_', 10)).toEqual({ message: MESSAGES.noDigits, offset: 1 });
    expect(error('0x__', 16)).toEqual({ message: MESSAGES.noDigits, offset: 4 });
  });

  it('commas: 1–3 digits first, then exactly 3; with a sign; never in another field', () => {
    expect(value('-12,345', 10)).toBe(-12_345n);
    expect(value('999,999,999', 10)).toBe(999_999_999n);
    expect(error(',000', 10)).toEqual({ message: MESSAGES.commas, offset: 0 });
    expect(error('1,0000', 10)).toEqual({ message: MESSAGES.commas, offset: 5 });
    expect(error('1,000,', 10)).toEqual({ message: MESSAGES.commas, offset: 5 });
    expect(error('1,00,000', 10)).toEqual({ message: MESSAGES.commas, offset: 4 });
    expect(error('1,000', 36).message).toBe(MESSAGES.comma);
  });

  it('e after digits is an exponent only where e is not a digit (bases up to 14)', () => {
    expect(error('2E10', 8).message).toBe(MESSAGES.exponent);
    expect(error('1e3', 14).message).toBe(MESSAGES.exponent);
    expect(value('1e3', 15)).toBe(1n * 225n + 14n * 15n + 3n);
    expect(error('e3', 10)).toEqual({ message: '"e" is not a base-10 digit', offset: 0 });
  });

  it('a character outside the BMP is quoted whole, at its UTF-16 offset', () => {
    expect(error('1😀', 10)).toEqual({ message: '"😀" is not a base-10 digit', offset: 1 });
    expect(error('5-3', 10)).toEqual({ message: '"-" is not a base-10 digit', offset: 1 });
  });

  it("two's complement: the whole range, signed and unsigned readings of one pattern", () => {
    for (const width of [8, 16, 32, 64] as const) {
      const max = (1n << BigInt(width)) - 1n;
      const min = -(1n << BigInt(width - 1));
      expect(value(max.toString(), 10, twos(width))).toBe(-1n);
      expect(value(min.toString(), 10, twos(width))).toBe(min);
      expect(error((max + 1n).toString(), 10, twos(width)).message).toBe(doesNotFit(width));
      expect(error((min - 1n).toString(), 10, twos(width)).message).toBe(doesNotFit(width));
    }
    expect(doesNotFit(32)).toBe('does not fit in 32 bits: the range is -2147483648 to 4294967295');
    expect(error('-0x81', 16, twos(8)).offset).toBe(3);
  });

  it("two's complement: Octal and Base show the pattern without padding; Prefixes and Uppercase", () => {
    const o: FormatOptions = { ...FORMAT, ...twos(16), prefixes: true, uppercase: true };
    expect(formatNumber(5n, 8, o).shown).toBe('0o5');
    expect(formatNumber(-1n, 8, o).shown).toBe('0o177777');
    expect(formatNumber(-1n, 36, { ...o, plain: true }).shown).toBe('1EKF');
    expect(formatNumber(-1n, 16, o).shown).toBe('0xFFFF');
    expect(formatNumber(-1n, 10, o).shown).toBe('-1');
    expect(formatNumber(-1n, 10, { ...o, plain: true }).shown).toBe('65535');
    expect(formatNumber(-1n, 16, { ...o, grouped: true, width: 64 }).shown).toBe('0xFFFF FFFF FFFF FFFF');
  });

  it('Group digits: Decimal by three with commas and a sign before the groups; the Base field never groups', () => {
    expect(formatNumber(-1234567n, 10, { ...FORMAT, grouped: true })).toEqual({
      shown: '-1,234,567',
      copy: '-1234567',
    });
    expect(formatNumber(-255n, 2, { ...FORMAT, grouped: true, prefixes: true }).shown).toBe('-0b1111 1111');
    expect(formatNumber(123n, 10, { ...FORMAT, grouped: true }).shown).toBe('123');
    expect(formatNumber(10n ** 9n, 16, { ...FORMAT, grouped: true, plain: true, prefixes: true }).shown).toBe(
      '3b9aca00',
    );
  });

  it('the Base field at N = 16 takes the 0x prefix (the radix alone decides, §9) but never writes one', () => {
    expect(value('0xff', 16)).toBe(255n);
    expect(formatNumber(255n, 16, { ...FORMAT, prefixes: true, plain: true }).copy).toBe('ff');
  });

  it('isValidRadix: a whole number from 2 to 36, spaces around allowed', () => {
    for (const ok of ['2', '36', ' 16 ', '036']) expect(isValidRadix(ok)).toBe(true);
    for (const bad of ['', ' ', '1', '37', '0', '-2', '2.5', '1e1', 'x', '0x10', '10000'])
      expect(isValidRadix(bad)).toBe(false);
    expect(radixOf(' 7')).toBe(7);
    expect(radixOf('99')).toBeNull();
  });

  it('bit length is int.bit_length(); bytes rows show 64 bytes, then the count', () => {
    expect([0n, 1n, 2n, 255n, 256n, 2n ** 1000n].map(bitLengthOf)).toEqual([0, 1, 2, 8, 9, 1001]);
    const big = details((1n << 1000n) - 1n);
    expect(big.byteLength).toBe(125);
    expect(clipBytes(big.bytesBigEndian!)).toBe(`${Array(64).fill('ff').join(' ')} … (125 bytes)`);
    expect(clipBytes('01 02')).toBe('01 02');
    expect(big.bytesBigEndian!.split(' ')).toHaveLength(125);
  });
});

describe('§7: detectNumberBase', () => {
  it.each(['0xFF', '-0x1f', '0b1010', '0o755', '0x1F_FF', '0xff8800', ' +0B1 '])('recognises %s', text =>
    expect(detectNumberBase(text)).toBe(true),
  );

  it.each([
    '255',
    '1700000000',
    '1e3',
    'deadbeef',
    '48656c6c6f',
    '#ff8800',
    '0x',
    '0b102',
    '',
    '0x_1',
    '0o8',
    '0xff 0xee',
    // what the other tools take: unix-time, hex-ascii, color, uuid, base64, jwt, json, url, cron
    '1700000000000',
    '2023-11-14T22:13:20Z',
    '48 65 6c 6c 6f',
    '#F80',
    'rgb(255 136 0)',
    '550e8400-e29b-41d4-a716-446655440000',
    'SGVsbG8=',
    'eyJhbGciOiJIUzI1NiJ9.e30.x',
    '{"a":1}',
    'https://example.com/?a=0x1',
    '0 9 * * 1-5',
    '\\x48\\x65',
    '0xff,0xee',
  ])('does not recognise %j', text => expect(detectNumberBase(text)).toBe(false));

  it('takes up to 10,004 characters: 10,000 digits with a sign and a prefix', () => {
    expect(detectNumberBase(`-0x${'f'.repeat(10_001)}`)).toBe(true);
    expect(detectNumberBase(`-0x${'f'.repeat(10_002)}`)).toBe(false);
  });

  it('is one linear pass on a long paste', () => {
    const long = `0x${'f'.repeat(1_000_000)}g`;
    const started = performance.now();
    for (let i = 0; i < 10; i++) detectNumberBase(long);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('a handed text opens in the field of its prefix, else Decimal', () => {
    expect(['0xFF', '-0b1', ' +0O7', '255', '0', 'zz'].map(fieldOfText)).toEqual([16, 2, 8, 10, 10, 10]);
  });
});

/** A small deterministic generator (xorshift32): the same digits on every run. */
const generator = (seed: number) => {
  let s = seed >>> 0 || 1;
  return (n: number): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
};

describe('round trip: any value → any base → back is the same value', () => {
  const next = generator(20261121);
  const randomValue = (decimalDigits: number): bigint => {
    let text = String(1 + next(9));
    while (text.length < decimalDigits) text += String(next(10));
    return BigInt(text) * (next(2) === 0 ? -1n : 1n);
  };

  it('every radix 2–36, values of 1 to 3,000 decimal digits, every format option', () => {
    for (let round = 0; round < 120; round++) {
      const v = randomValue(round < 40 ? 1 + next(40) : 500 + next(2_500));
      const radix = 2 + (round % 35);
      const options: FormatOptions = {
        ...SIGN,
        uppercase: next(2) === 0,
        grouped: next(2) === 0,
        prefixes: next(2) === 0,
        plain: ![2, 8, 10, 16].includes(radix),
      };
      const f = formatNumber(v, radix, options);
      expect(parseNumber(f.shown, radix, SIGN), `${radix}: shown`).toEqual({ ok: true, value: v });
      expect(parseNumber(f.copy, radix, SIGN), `${radix}: copy`).toEqual({ ok: true, value: v });
    }
  });

  it('the largest values a field takes: 10,000 digits in every base', () => {
    for (let radix = 2; radix <= 36; radix++) {
      let digits = '';
      for (let i = 0; i < MAX_DIGITS; i++) digits += (i === 0 ? 1 + next(radix - 1) : next(radix)).toString(radix);
      const r = parseNumber(digits, radix, SIGN);
      expect(r.ok).toBe(true);
      const v = (r as Extract<ParseResult, { ok: true }>).value!;
      expect(v.toString(radix)).toBe(digits);
      expect(formatNumber(v, radix, { ...FORMAT, plain: true }).copy).toBe(digits);
    }
  });

  it("two's complement: every pattern of a width reads back from every field", () => {
    for (const width of [8, 16, 32, 64] as const) {
      for (let round = 0; round < 50; round++) {
        let v = 0n;
        for (let b = 0; b < width; b++) v = (v << 1n) | BigInt(next(2));
        const o: FormatOptions = { ...FORMAT, ...twos(width), grouped: round % 2 === 0, prefixes: round % 3 === 0 };
        const signed = BigInt.asIntN(width, v);
        for (const radix of [2, 8, 10, 16])
          expect(parseNumber(formatNumber(signed, radix, o).shown, radix, twos(width))).toEqual({
            ok: true,
            value: signed,
          });
        expect(parseNumber(formatNumber(signed, 36, { ...o, plain: true }).shown, 36, twos(width))).toEqual({
          ok: true,
          value: signed,
        });
      }
    }
  });

  it('digitsToBigInt agrees with BigInt for every radix at chunk boundaries', () => {
    for (let radix = 2; radix <= 36; radix++)
      for (const length of [1, 9, 10, 11, 21, 64, 65, 1000]) {
        let digits = '';
        for (let i = 0; i < length; i++) digits += next(radix).toString(radix);
        let expected = 0n;
        for (const d of digits) expected = expected * BigInt(radix) + BigInt(parseInt(d, radix));
        expect(digitsToBigInt(digits, radix)).toBe(expected);
      }
  });
});

describe('§12: limits and speed', () => {
  it('a 300,000-character text is one bounded pass, whatever it holds', () => {
    const cases: Array<[string, Radix]> = [
      [repeat('9', 300_000), 10],
      [repeat('_', 300_000), 16],
      [`${repeat('1 ', 150_000)}x`, 2],
      [repeat('1,000', 60_000), 10],
      [repeat('z', 300_000), 36],
    ];
    for (const [text, radix] of cases) {
      const started = performance.now();
      const r = parseNumber(text, radix, SIGN);
      expect(performance.now() - started, `${text.slice(0, 8)}… in base ${radix}`).toBeLessThan(200);
      expect(r.ok).toBe(false);
    }
  });

  it('10,000 decimal digits: parsed and written in five bases well inside one frame budget', () => {
    const digits = `9${repeat('7', MAX_DIGITS - 1)}`;
    const started = performance.now();
    const v = value(digits, 10)!;
    for (const radix of [2, 8, 10, 16, 36]) formatNumber(v, radix, { ...FORMAT, grouped: true });
    numberDetails(v, { ...SIGN, uppercase: false });
    expect(performance.now() - started).toBeLessThan(100);
    const z = value(repeat('z', MAX_DIGITS), 36)!;
    expect(z.toString(36)).toBe(repeat('z', MAX_DIGITS));
  });
});
