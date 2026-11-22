import {
  detectDataUnits,
  durationText,
  errorText,
  isUnit,
  ladder,
  parseDuration,
  parseOverhead,
  parseValue,
  ratio,
  readUnit,
  showNumber,
  solveTransfer,
  SUFFIXES,
} from './logic';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Digits, LadderSection, Reading, TransferFields, Unit } from './logic';

// Every row of docs/tools/specs/data-units.md §10, the messages of §6 word for word, §7's table for detectDataUnits.

const read = (text: string, reading: Reading = 'decimal', digits: Digits = 'exact') => {
  const r = parseValue(text, reading, digits);
  if (!r || !r.ok) throw new Error(`not read: ${text} ${r && !r.ok ? errorText(r.error) : 'empty'}`);
  return r;
};

const flatten = (sections: LadderSection[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const s of sections)
    for (const row of [s.base, ...s.decimal.rows, ...s.binary.rows]) out[row.label] = row.value.text;
  return out;
};

/** The shown value of every ladder row by its label. */
const rowsOf = (text: string, reading: Reading = 'decimal', digits: Digits = 'exact'): Record<string, string> => {
  const r = read(text, reading, digits);
  const first = r.value.unit?.base === 'bit' ? 'bit' : 'byte';
  return flatten(ladder(r.value.bits, r.value.rate, first, digits));
};

const errorOf = (text: string, reading: Reading = 'decimal'): string => {
  const r = parseValue(text, reading, 'exact');
  if (!r || r.ok) throw new Error(`read: ${text}`);
  return errorText(r.error);
};

const transfer = (fields: Partial<TransferFields>, digits: Digits = 'exact') =>
  solveTransfer({ solve: 'time', size: '', rate: '', time: '', overhead: '', ...fields }, 'decimal', digits);

const rowValue = (answer: ReturnType<typeof transfer>, id: string): string | undefined =>
  answer.result?.rows.find(r => r.id === id)?.value;

describe('§10 conversions', () => {
  it('1.5 GiB', () => {
    const rows = rowsOf('1.5 GiB');
    expect(rows.bytes).toBe('1,610,612,736');
    expect(rows.GB).toBe('1.610612736');
    expect(rows.MiB).toBe('1,536');
    expect(rows.bits).toBe('12,884,901,888');
    expect(rows.Gibit).toBe('12');
    expect(rows.kB).toBe('1,610,612.736');
    expect(rows.TiB).toBe('0.00146484375');
    expect(rows.QB).toBe('0.000000000000000000001610612736');
    expect(read('1.5 GiB').reading).toBeNull();
  });

  it('250 MB, decimal and binary, with the reading line (§2 item 2)', () => {
    expect(rowsOf('250 MB').MiB).toBe('238.4185791015625');
    expect(read('250 MB').reading).toBe(
      'MB is read as decimal: 1 MB = 1,000,000 bytes (SI). As binary (JEDEC, Windows), 250 MB is 262,144,000 bytes.',
    );
    expect(rowsOf('250 MB', 'binary').MiB).toBe('250');
    expect(rowsOf('250 MB', 'binary').MB).toBe('262.144');
    expect(read('250 MB', 'binary').reading).toBe(
      'MB is read as binary (JEDEC, Windows): 1 MB = 1,048,576 bytes. As decimal (SI), 250 MB is 250,000,000 bytes.',
    );
  });

  it('1 TB in GiB and TiB; 1 GB in YiB; 1 bit', () => {
    expect(rowsOf('1 TB').GiB).toBe('931.322574615478515625');
    expect(rowsOf('1 TB').TiB).toBe('0.9094947017729282379150390625');
    expect(rowsOf('1 GB').YiB).toBe('0.00000000000000082718061255302767487140869206996285356581211090087890625');
    expect(rowsOf('1 bit').bytes).toBe('0.125');
    expect(rowsOf('1 bit').QiB.split('.')[1]).toHaveLength(103);
  });

  it('1.000000000000000001 YiB', () => {
    expect(rowsOf('1.000000000000000001 YiB').bytes).toBe('1,208,925,819,614,629,175,915,101.819614629174706176');
  });

  it('100 Mbps: bits per second first, then bytes per second (§2 item 3)', () => {
    const r = read('100 Mbps');
    const sections = ladder(r.value.bits, true, 'bit', 'exact');
    expect(sections.map(s => s.title)).toEqual(['Bits per second', 'Bytes per second']);
    const rows = flatten(sections);
    expect(rows['bit/s']).toBe('100,000,000');
    expect(rows['Mbit/s']).toBe('100');
    expect(rows['MB/s']).toBe('12.5');
    expect(rows['MiB/s']).toBe('11.920928955078125');
    expect(rows['Mibit/s']).toBe('95.367431640625');
    expect(sections[0].decimal.rows[1].alias).toBe('Mbps');
    expect(r.reading).toBe(
      'Mbps is read as decimal: 1 Mbps = 1,000,000 bits per second (SI). As binary (JEDEC, Windows), 100 Mbps is 104,857,600 bits per second.',
    );
  });

  it('Digits 6: the integer part is never shortened (§5 item 13)', () => {
    const rows = rowsOf('1.5 GiB', 'decimal', 6);
    expect(rows.kB).toBe('≈ 1,610,613');
    expect(rows.GB).toBe('≈ 1.61061');
    expect(rows.TB).toBe('≈ 0.00161061');
    expect(rows.MiB).toBe('1,536');
  });

  it('20mb: a lower-case b is a bit, said in a note (§2 item 4)', () => {
    expect(read('20mb').notes).toEqual(['"mb" is read as megabits: a lower-case b is a bit. For megabytes write MB.']);
    expect(rowsOf('20mb').bytes).toBe('2,500,000');
    expect(read('4kb').notes).toEqual(['"kb" is read as kilobits: a lower-case b is a bit. For kilobytes write kB.']);
    expect(read('1kib').notes).toEqual([
      '"kib" is read as kibibits: a lower-case b is a bit. For kibibytes write KiB.',
    ]);
    expect(read('100 mbps').notes).toEqual([]);
  });

  it('a number alone is bytes; zero; an exponent', () => {
    expect(read('4096').notes).toEqual(['No unit: read as bytes.']);
    expect(rowsOf('4096').KiB).toBe('4');
    expect(rowsOf('0 B').QiB).toBe('0');
    expect(rowsOf('1e9 B').GB).toBe('1');
  });
});

describe('§10 transfer time', () => {
  it('4.7 GB at 100 Mbps', () => {
    const a = transfer({ size: '4.7 GB', rate: '100 Mbps' });
    expect(rowValue(a, 'time')).toBe('6 minutes 16 seconds');
    expect(rowValue(a, 'seconds')).toBe('376');
    expect(rowValue(a, 'clock')).toBe('0:06:16');
    expect(rowValue(a, 'exact')).toBeUndefined();
  });

  it('with 12.5 % overhead', () => {
    const a = transfer({ size: '4.7 GB', rate: '100 Mbps', overhead: '12.5' });
    expect(rowValue(a, 'time')).toBe('≈ 7 minutes 9.714 seconds');
    expect(rowValue(a, 'seconds')).toBe('≈ 429.71428571428571429');
    expect(rowValue(a, 'exact')).toBe('3008/7 seconds');
    expect(rowValue(a, 'effective')).toBe('87.5 Mbps');
    expect(rowValue(a, 'clock')).toBe('≈ 0:07:09.714');
    expect(rowValue(transfer({ size: '4.7 GB', rate: '100 Mbps', overhead: '12.5 %' }), 'exact')).toBe(
      '3008/7 seconds',
    );
  });

  it('1 GB at 3 Mbit/s', () => {
    const a = transfer({ size: '1 GB', rate: '3 Mbit/s' });
    expect(rowValue(a, 'time')).toBe('≈ 44 minutes 26.667 seconds');
    expect(rowValue(a, 'exact')).toBe('8000/3 seconds');
  });

  it('1 TB at 1 bps: centuries', () => {
    expect(rowValue(transfer({ size: '1 TB', rate: '1 bps' }), 'time')).toBe(
      '92,592,592 days 14 hours 13 minutes 20 seconds (about 253,504.7 years)',
    );
  });

  it('1 B at 1 Gbps: under a millisecond', () => {
    const a = transfer({ size: '1 B', rate: '1 Gbps' });
    expect(rowValue(a, 'time')).toBe('0.000000008 seconds (under a millisecond)');
    expect(rowValue(a, 'clock')).toBe('≈ 0:00:00');
  });

  it('solve for rate: 1 GB in 10 min', () => {
    const a = transfer({ solve: 'rate', size: '1 GB', time: '10 min' });
    expect(rowValue(a, 'exact')).toBe('40000000/3 bit/s');
    const rows = a.result?.kind === 'ladder' ? flatten(a.result.sections) : {};
    expect(rows['Mbit/s']).toBe('≈ 13.333333333333333333');
    expect(rows['MB/s']).toBe('≈ 1.6666666666666666667');
  });

  it('solve for size: 1 Gbps for 1:00:00', () => {
    const a = transfer({ solve: 'size', rate: '1 Gbps', time: '1:00:00' });
    const rows = a.result?.kind === 'ladder' ? flatten(a.result.sections) : {};
    expect(rows.GB).toBe('450');
    expect(rows.GiB).toBe('419.09515857696533203125');
  });

  it('a size of 0 takes 0 seconds; words at the edges', () => {
    expect(rowValue(transfer({ size: '0 B', rate: '1 Mbps' }), 'time')).toBe('0 seconds');
    expect(durationText(ratio(31_557_600n), 'exact').words).toBe('365 days 6 hours (about 1 year)');
    expect(durationText(ratio(3_661n), 'exact').words).toBe('1 hour 1 minute 1 second');
    expect(durationText(ratio(3n, 2n), 'exact').words).toBe('1.5 seconds');
    expect(durationText(ratio(86_400n), 'exact').words).toBe('1 day');
  });
});

describe('§6 errors, word for word', () => {
  const cases: [string, string][] = [
    ['-5 MB', 'Column 1: A size or a rate is never negative.'],
    ['−5 MB', 'Column 1: A size or a rate is never negative.'],
    ['+5 MB', 'Column 1: Write the number without a sign.'],
    ['MB', 'Column 1: Enter a number before the unit, as in 1 MB.'],
    ['GiB', 'Column 1: Enter a number before the unit, as in 1 MB.'],
    ['$5', 'Column 1: Unexpected "$": start with a number, as in 1.5 GiB.'],
    ['  ~5 MB', 'Column 3: Unexpected "~": start with a number, as in 1.5 GiB.'],
    ['.5 GB', 'Column 1: Write a digit before the decimal mark: 0.5.'],
    [',5 GB', 'Column 1: Write a digit before the decimal mark: 0.5.'],
    ['5. GB', 'Column 2: Write a digit after the decimal mark, or remove it.'],
    ['5, GB', 'Column 2: Write a digit after the decimal mark, or remove it.'],
    ['1,50,000 B', 'Column 3: A digit group has 3 digits, as in 1,000,000.'],
    ['1.2.3 B', 'Column 3: A digit group has 3 digits, as in 1.000.000.'],
    ['1 5 MB', 'Column 3: A digit group has 3 digits, as in 1 000 000.'],
    ['1,000.5.5 B', 'Column 8: A number has one decimal mark.'],
    ['1 000.000,5 B', 'Column 2: Use one kind of digit-group separator.'],
    ['1,5 000 B', 'Column 4: Digit groups go before the decimal mark.'],
    ['1__0 B', 'Column 2: "_" goes between two digits.'],
    ['_1 B', 'Column 1: Unexpected "_": start with a number, as in 1.5 GiB.'],
    ['1_ B', 'Column 2: "_" goes between two digits.'],
    ['1e101 B', 'Column 2: The exponent is -100 to 100; this is 101.'],
    ['1e-101 B', 'Column 2: The exponent is -100 to 100; this is -101.'],
    ['5 XB', 'Column 3: Unknown unit "XB". Sizes: B, kB, KiB, MB, MiB … QB, bit, Mbit; rates: Mbps, MB/s, MiB/s.'],
    ['5 MB/h', 'Column 3: Rates are per second: write MB/s.'],
    ['5 Mbit/min', 'Column 3: Rates are per second: write Mbit/s.'],
    [
      '512m',
      'Column 4: "m" alone is a prefix, not a unit: write 512 MB, 512 MiB or 512 Mbit. Config suffixes shows how programs read it.',
    ],
    [
      '256Mi',
      'Column 4: "Mi" alone is a prefix, not a unit: write 256 MiB, 256 MB or 256 Mibit. Config suffixes shows how programs read it.',
    ],
    [
      '4K',
      'Column 2: "K" alone is a prefix, not a unit: write 4 kB, 4 KiB or 4 kbit. Config suffixes shows how programs read it.',
    ],
    ['5 MB x', 'Column 6: Unexpected "x" after the unit.'],
    ['5 MB５', 'Column 5: Unexpected "５" in the unit.'],
    ['5\u{200b}MB', 'Column 2: Unexpected U+200B (an invisible character) in the unit.'],
    ['１ MB', 'Column 1: Unexpected "１": start with a number, as in 1.5 GiB.'],
    [`${'1'.repeat(199)} MB`, 'The value is longer than 200 characters.'],
  ];
  it.each(cases)('%s', (text, message) => expect(errorOf(text)).toBe(message));

  it('an empty field and spaces are nothing', () => {
    expect(parseValue('', 'decimal', 'exact')).toBeNull();
    expect(parseValue('  \t ', 'decimal', 'exact')).toBeNull();
  });

  it('200 characters are read', () => {
    expect(read(`${'1'.repeat(198)} B`).value.number.num).toBe(BigInt('1'.repeat(198)));
  });

  it('the transfer fields', () => {
    expect(transfer({ size: '100 Mbps', rate: '1 Mbps' }).fields.size?.error).toBe(
      'Column 5: This is a rate: Size takes a size, as in 4.7 GB.',
    );
    expect(transfer({ size: '1 GB', rate: '100 MB' }).fields.rate?.error).toBe(
      'Column 5: This is a size: Rate takes a rate, as in 100 Mbps or 12.5 MB/s.',
    );
    expect(transfer({ size: '1 GB', rate: '100' }).fields.rate?.error).toBe(
      'Column 4: Write the rate with its unit, as in 100 Mbps or 12.5 MB/s.',
    );
    const zero = transfer({ size: '1 GB', rate: '0 Mbps' });
    expect(zero.fields.rate?.error).toBe('A rate of 0 never finishes the transfer: enter a rate above 0.');
    expect(zero.result).toBeNull();
    const noTime = transfer({ solve: 'rate', size: '1 GB', time: '0 s' });
    expect(noTime.fields.time?.error).toBe('No rate moves data in 0 seconds: enter a time above 0.');
    expect(transfer({ solve: 'size', rate: '0 bps', time: '1 h' }).result?.kind).toBe('ladder');
  });

  it('times', () => {
    const t = (text: string) => {
      const r = parseDuration(text);
      if (!r || r.ok) throw new Error(text);
      return errorText(r.error);
    };
    expect(t('1 x')).toBe('Column 3: Unknown time unit "x": use d, h, min, s or ms (1 h 30 min), or h:mm:ss.');
    expect(t('1 min 2 min')).toBe('Column 9: "min" appears twice.');
    expect(t('1 m 2 min')).toBe('Column 7: "min" appears twice.');
    expect(t('1:30')).toBe('Column 1: Write h:mm:ss (0:01:30), or 1 min 30 s.');
    expect(t('1:60:00')).toBe('Column 1: Minutes and seconds in h:mm:ss are 00 to 59.');
    expect(t('-5 s')).toBe('Column 1: A time is never negative.');
    expect(t('h')).toBe('Column 1: Enter a number before the unit, as in 1 h 30 min.');
    expect(t('1 h 30')).toBe('Column 5: Write a unit after each number: 1 h 30 min.');
    expect(t('1 h $')).toBe('Column 5: Unexpected "$": write a duration such as 1 h 30 min.');
    expect(t(`${'1'.repeat(199)} s`)).toBe('The time is longer than 200 characters.');
    for (const bad of ['100', '-1', 'abc', '100 %'])
      expect(parseOverhead(bad)).toEqual({
        ok: false,
        error: { message: 'Overhead is a percentage from 0 to below 100.', start: 0 },
      });
  });

  it('times that read', () => {
    const seconds = (text: string) => {
      const r = parseDuration(text);
      if (!r || !r.ok) throw new Error(text);
      return r.seconds;
    };
    expect(seconds('1 h 30 min')).toEqual(ratio(5_400n));
    expect(seconds('1h30m')).toEqual(ratio(5_400n));
    expect(seconds('1.5 h')).toEqual(ratio(5_400n));
    expect(seconds('0,5 min')).toEqual(ratio(30n));
    expect(seconds('1:30:00')).toEqual(ratio(5_400n));
    expect(seconds('0:00:01.5')).toEqual(ratio(3n, 2n));
    expect(seconds('2 days 250 ms')).toEqual(ratio(691_201n, 4n));
    expect(seconds('250 MS')).toEqual(ratio(1n, 4n));
    expect(parseDuration('5400')).toEqual({ ok: true, seconds: ratio(5_400n), notes: ['No unit: read as seconds.'] });
    expect(parseOverhead('')).toEqual({ ok: true, percent: ratio(0n) });
    expect(parseOverhead(' 12,5% ')).toEqual({ ok: true, percent: ratio(25n, 2n) });
  });
});

describe('§6 notes', () => {
  it('the comma and point shapes', () => {
    expect(read('1,500 MB').notes).toEqual([
      '"1,500" is read as 1500 (comma as thousands separator). If you meant 1.5, write 1.5.',
    ]);
    expect(read('1,500 MB').value.number).toEqual(ratio(1_500n));
    expect(read('1.500 MB').notes).toEqual([
      '"1.500" is read as 1.5 (point as decimal mark). If you meant 1500, write 1500.',
    ]);
    expect(read('1.500 MB').value.number).toEqual(ratio(3n, 2n));
    expect(read('2.048 GB').notes[0]).toBe(
      '"2.048" is read as 2.048 (point as decimal mark). If you meant 2048, write 2048.',
    );
    expect(read('0.125 MB').notes).toEqual([]);
    expect(read('1.500e3 B').notes).toEqual([]);
  });
});

/** §10 «Разбор»: every accepted spelling and what it is read as. */
describe('§10 parsing table', () => {
  const unitOf = (text: string): Unit => {
    const u = readUnit(text);
    if (!isUnit(u)) throw new Error(text);
    return u;
  };
  const table: [string, Partial<Unit>][] = [
    ['kb', { base: 'bit', step: 1, system: 'decimal', rate: false }],
    ['KB', { base: 'byte', step: 1, system: 'ambiguous', rate: false }],
    ['kB', { base: 'byte', step: 1, system: 'decimal', rate: false }],
    ['Kb', { base: 'bit', step: 1, system: 'ambiguous', rate: false }],
    ['Kib', { base: 'bit', step: 1, system: 'binary', rate: false }],
    ['KiB', { base: 'byte', step: 1, system: 'binary', rate: false }],
    ['KIB', { base: 'byte', step: 1, system: 'binary', rate: false }],
    ['kbit', { base: 'bit', step: 1, system: 'decimal', rate: false, word: true }],
    ['kbps', { base: 'bit', step: 1, system: 'decimal', rate: true }],
    ['MB/s', { base: 'byte', step: 2, system: 'ambiguous', rate: true }],
    ['Mbps', { base: 'bit', step: 2, system: 'ambiguous', rate: true }],
    ['MBps', { base: 'byte', step: 2, system: 'ambiguous', rate: true }],
    ['MiBps', { base: 'byte', step: 2, system: 'binary', rate: true }],
    ['Mbit/s', { base: 'bit', step: 2, system: 'ambiguous', rate: true }],
    ['Gbit/s', { base: 'bit', step: 3, system: 'ambiguous', rate: true }],
    ['bytes/sec', { base: 'byte', step: 0, system: 'none', rate: true }],
    ['bps', { base: 'bit', step: 0, system: 'none', rate: true }],
    ['Bps', { base: 'byte', step: 0, system: 'none', rate: true }],
    ['B', { base: 'byte', step: 0, system: 'none' }],
    ['b', { base: 'bit', step: 0, system: 'none' }],
    ['bits', { base: 'bit', step: 0, word: true }],
    ['Bytes', { base: 'byte', step: 0, word: true }],
    ['megabytes', { base: 'byte', step: 2, system: 'ambiguous', word: true }],
    ['kibibit', { base: 'bit', step: 1, system: 'binary', word: true }],
    ['quettabytes', { base: 'byte', step: 10, system: 'decimal' }],
    ['RB', { base: 'byte', step: 9, system: 'decimal' }],
    ['QiB', { base: 'byte', step: 10, system: 'binary' }],
    ['mB', { base: 'byte', step: 2, system: 'ambiguous' }],
    ['eB', { base: 'byte', step: 6, system: 'ambiguous' }],
    ['Mbyte', { base: 'byte', step: 2, word: true }],
  ];
  it.each(table)('%s', (text, expected) => expect(unitOf(text)).toMatchObject(expected));

  it('numbers', () => {
    expect(read('1 000,5 MB').value.number).toEqual(ratio(2_001n, 2n));
    expect(read('1\u{202f}000 MB').value.number).toEqual(ratio(1_000n));
    expect(read('1\u{a0}MB').value.unit?.written).toBe('MB');
    expect(read('1,234.5 MB').value.number).toEqual(ratio(2_469n, 2n));
    expect(read('1.234,5 MB').value.number).toEqual(ratio(2_469n, 2n));
    expect(read('1.000.000 B').value.number).toEqual(ratio(1_000_000n));
    expect(read('1_000 B').value.number).toEqual(ratio(1_000n));
    expect(read('1,5 GB').value.number).toEqual(ratio(3n, 2n));
    expect(read('2e+6 B').value.number).toEqual(ratio(2_000_000n));
    expect(read('1.5E-3 MB').value.number).toEqual(ratio(3n, 2_000n));
    expect(read('1eB').value.unit).toMatchObject({ step: 6, base: 'byte' });
    expect(read('250MB').value.unit?.written).toBe('MB');
  });

  it('every unknown or partial unit is refused', () => {
    for (const text of ['XB', 'ib', 'Mbitps', 'KiKiB', 'MBPS', '/s', 'kB/', 'Mbit/s/s'])
      expect(isUnit(readUnit(text)), text).toBe(false);
  });
});

describe('§7 detect', () => {
  const yes = ['1.5 GiB', '250 MB', '10 MB', '250 Mbps', '100 MB/s', '8 Mbit', '1,5 GB', '1 000 MB', '9600 bps'];
  const yes2 = ['100 bytes', '20mb', '2 TB', '  12.5 MB/s  '];
  const no = ['4096', '1e9', '5B', '5 b', '512m', '256Mi', '4K', '1080p', 'MB', '-5 MB', '5 MB x', '10 MB\n20 MB'];
  const neighbours = ['0xFF', '1700000000', '10.0.0.0/8', 'P3D', '#ff8800', '1h30m', '2024-01-01', ''];
  it.each([...yes, ...yes2])('yes: %s', text => expect(detectDataUnits(text)).toBe(true));
  it.each([...no, ...neighbours])('no: %s', text => expect(detectDataUnits(text)).toBe(false));
  it('longer than 64 characters: no', () => expect(detectDataUnits(`${'1'.repeat(62)} MB`)).toBe(false));
});

describe('showNumber', () => {
  it('rounds half up, drops trailing zeros, never writes an exponent', () => {
    expect(showNumber(ratio(25n, 10n), 3).text).toBe('2.5');
    expect(showNumber(ratio(12345n, 10_000n), 3)).toEqual({ text: '≈ 1.23', copy: '1.23', rounded: true });
    expect(showNumber(ratio(1235n, 1_000n), 3)).toEqual({ text: '≈ 1.24', copy: '1.24', rounded: true });
    expect(showNumber(ratio(9995n, 10_000n), 3).text).toBe('≈ 1');
    expect(showNumber(ratio(1n, 3n), 'exact').text).toBe('≈ 0.33333333333333333333');
    expect(showNumber(ratio(1n, 10_000_000_000n * 10_000_000_000n), 'exact').copy).toBe(`0.${'0'.repeat(19)}1`);
    expect(showNumber(ratio(123_456_789n), 3).text).toBe('123,456,789');
  });
});

describe('the config suffixes table', () => {
  it('has the nine programs of §5 item 19 and no address', () => {
    expect(SUFFIXES).toHaveLength(9);
    expect(JSON.stringify(SUFFIXES)).not.toMatch(/https?:|www\./);
  });
});

describe('sources', () => {
  it('pass no value through floating point (§5 item 1)', () => {
    const dir = import.meta.dirname;
    const banned = [
      /parseFloat/,
      /parseInt/,
      /\bNumber\(/,
      /Math\.pow/,
      /\*\*/,
      /toFixed/,
      /toPrecision/,
      /Math\.random/,
      /console\./,
    ];
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      // Comments may name what is banned; the code may not.
      const code = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const pattern of banned) expect(code, `${file}: ${pattern}`).not.toMatch(pattern);
    }
  });
});
