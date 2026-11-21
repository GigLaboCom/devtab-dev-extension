import { detectUuid } from './detect';
import {
  CLOCK_RANGE,
  COUNT_ERROR,
  createTimeOrderedGenerator,
  encodeUlid,
  formatUuid,
  generateBatch,
  gregorianToMs,
  isoFromMs,
  MAX,
  NAMESPACES,
  namespaceBytes,
  nameBased,
  NIL,
  ONE_ID,
  parseCount,
  parseId,
  ULID_OVERFLOW,
  UlidOverflowError,
  v4,
} from './logic';
import { cryptoRandom } from '@workspace/tools-shared/random';
import { formatIsoUtc } from '@workspace/tools-shared/time';
import { describe, expect, it } from 'vitest';
import type { Parsed, ParseResult } from './logic';
import type { RandomSource } from '@workspace/tools-shared/random';

// docs/tools/specs/uuid.md §10. The `counter` source: bytes 0, 1, 2, … modulo 256, continuing between calls.
const counterSource = (): RandomSource => {
  let next = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = next++ % 256;
  };
};
const ffSource: RandomSource = bytes => bytes.fill(0xff);
/** A source that hands out these bytes, then zeros. */
const bytesSource = (...chunks: Uint8Array[]): RandomSource => {
  const all = chunks.flatMap(c => Array.from(c));
  let at = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = all[at++] ?? 0;
  };
};

const ok = (r: ParseResult): Parsed => {
  if (!r.ok) throw new Error(`not parsed: ${r.message}`);
  return r.value;
};
const bytesOf = (text: string): Uint8Array => ok(parseId(text)).bytes;
const std = (bytes: Uint8Array): string => formatUuid(bytes, 'standard', false);
const NS = {
  dns: bytesOf(NAMESPACES.dns),
  url: bytesOf(NAMESPACES.url),
};
const T = 1645557742000; // 2022-02-22T19:22:22Z, RFC 9562 A.6
const A6 = '017F22E2-79B0-7CC3-98C4-DC0C0C07398F';

describe('§10 rows 1–6: name-based UUIDs', () => {
  it('1: v5, DNS, www.example.com — RFC 9562 A.4', async () => {
    expect(std(await nameBased(5, NS.dns, 'www.example.com'))).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('2: v3, DNS, www.example.com — RFC 9562 A.2', async () => {
    expect(std(await nameBased(3, NS.dns, 'www.example.com'))).toBe('5df41881-3aed-3515-88a7-2f4a814cf09e');
  });
  it('3: v5, URL, https://example.com/', async () => {
    expect(std(await nameBased(5, NS.url, 'https://example.com/'))).toBe('dd2c1780-811a-5296-81c5-178a0ef488bc');
  });
  it('4: v3, URL, https://example.com/', async () => {
    expect(std(await nameBased(3, NS.url, 'https://example.com/'))).toBe('b9dcdff8-af4a-365d-8043-0f8361942709');
  });
  it('5: v5, DNS, the empty name', async () => {
    expect(std(await nameBased(5, NS.dns, ''))).toBe('4ebd0208-8328-5d69-8c44-ec50939c0967');
  });
  it('6: v5, DNS, a name outside ASCII is UTF-8', async () => {
    expect(std(await nameBased(5, NS.dns, 'привет'))).toBe('43eec7ca-0ff7-5d77-9faa-6955bd8e6dc9');
  });
  it('§3: the name is taken as is — spaces are not trimmed', async () => {
    expect(std(await nameBased(5, NS.dns, ' www.example.com'))).not.toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('§5.2: the namespaces of RFC 9562 §6.6', () => {
    expect(NAMESPACES).toEqual({
      dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
      x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
    });
  });
  it('§6: a custom namespace in any notation, or "Namespace must be a UUID."', () => {
    expect(namespaceBytes(`{${NAMESPACES.dns.toUpperCase()}}`)).toEqual(NS.dns);
    expect(namespaceBytes(`urn:uuid:${NAMESPACES.dns}`)).toEqual(NS.dns);
    expect(namespaceBytes('')).toBeNull();
    expect(namespaceBytes('6ba7b810')).toBeNull();
    expect(namespaceBytes('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeNull(); // a ULID is not a UUID
  });
});

describe('§10 row 7: v4', () => {
  it('7: v4(counter) — version 4 in byte 6, variant 10 in byte 8', () => {
    expect(std(v4(counterSource()))).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});

describe('§10 rows 8–11: the time-ordered generator', () => {
  it('8: v7 three times in one ms, then the next ms, then a clock 5 ms back', () => {
    const g = createTimeOrderedGenerator(counterSource());
    expect([g.v7(T), g.v7(T), g.v7(T), g.v7(T + 1), g.v7(T - 5)].map(std)).toEqual([
      '017f22e2-79b0-7001-8203-040506070809',
      '017f22e2-79b0-7002-8a0b-0c0d0e0f1011',
      '017f22e2-79b0-7003-9213-141516171819',
      '017f22e2-79b1-721b-9c1d-1e1f20212223',
      '017f22e2-79b1-721c-a425-262728292a2b',
    ]);
  });

  it('9: ULID with the same clocks', () => {
    const g = createTimeOrderedGenerator(counterSource());
    expect([g.ulid(T), g.ulid(T), g.ulid(T), g.ulid(T + 1), g.ulid(T - 5)].map(encodeUlid)).toEqual([
      '01FWHE4YDG000G40R40M30E209',
      '01FWHE4YDG000G40R40M30E20A',
      '01FWHE4YDG000G40R40M30E20B',
      '01FWHE4YDH185GR38E1W8124GK',
      '01FWHE4YDH185GR38E1W8124GM',
    ]);
  });

  it('10: a ULID random part of all ones overflows on the next one in the same ms', () => {
    const g = createTimeOrderedGenerator(ffSource);
    expect(encodeUlid(g.ulid(T))).toBe('01FWHE4YDGZZZZZZZZZZZZZZZZ');
    expect(() => g.ulid(T)).toThrow(UlidOverflowError);
    expect(() => g.ulid(T)).toThrow(ULID_OVERFLOW);
    // A new millisecond starts over.
    expect(encodeUlid(g.ulid(T + 1))).toBe('01FWHE4YDHZZZZZZZZZZZZZZZZ');
  });

  it('11: v7 2,050 times in one ms from a source of all ones: the counter rolls over into the next ms', () => {
    const g = createTimeOrderedGenerator(ffSource);
    const all = Array.from({ length: 2050 }, () => std(g.v7(T)));
    expect(all[0]).toBe('017f22e2-79b0-77ff-bfff-ffffffffffff');
    expect(all[2048]).toBe('017f22e2-79b0-7fff-bfff-ffffffffffff');
    expect(all[2049]).toBe('017f22e2-79b1-77ff-bfff-ffffffffffff');
  });

  it('ULID specification «Monotonicity»: …MVRY + 1 is …MVRZ; …ZZZZ + 1 carries within the random part', () => {
    // 01BX5ZZKBK and the random part ACTAV9WEVGEMMVRY of the specification's example, as the source's ten bytes.
    const example = bytesOf('01BX5ZZKBKACTAV9WEVGEMMVRY');
    const parsed = ok(parseId('01BX5ZZKBKACTAV9WEVGEMMVRY'));
    const ms = parsed.kind === 'ulid' ? parsed.timeMs : NaN;
    const g = createTimeOrderedGenerator(bytesSource(example.subarray(6)));
    expect(encodeUlid(g.ulid(ms))).toBe('01BX5ZZKBKACTAV9WEVGEMMVRY');
    expect(encodeUlid(g.ulid(ms))).toBe('01BX5ZZKBKACTAV9WEVGEMMVRZ');
    expect(encodeUlid(g.ulid(ms))).toBe('01BX5ZZKBKACTAV9WEVGEMMVS0');
  });

  it('keeps its state between batches: a later batch in the same ms still sorts after the earlier one', () => {
    const g = createTimeOrderedGenerator(cryptoRandom);
    const first = generateBatch('v7', 3, g, T).map(std);
    const second = generateBatch('v7', 3, g, T).map(std);
    const all = [...first, ...second];
    expect([...all].sort()).toEqual(all);
    expect(new Set(all).size).toBe(6);
  });
});

describe('§10 rows 12–15: parsing (ISO by formatIsoUtc, README decision of 2026-11-21)', () => {
  it('12: v7 — RFC 9562 A.6', () => {
    const p = ok(parseId(A6));
    expect(p).toMatchObject({ kind: 'uuid', variant: 'rfc9562', version: 7 });
    if (p.kind !== 'uuid' || p.fields.type !== 'unix') throw new Error('not v7');
    expect(p.fields.timeMs).toBe(1645557742000);
    expect(p.fields.randA).toBe('cc3');
    expect(p.fields.randB).toBe('18c4dc0c0c07398f');
    expect(isoFromMs(p.fields.timeMs)).toBe('2022-02-22T19:22:22Z');
  });

  it('13: v1 — RFC 9562 A.1', () => {
    const p = ok(parseId('C232AB00-9414-11EC-B3C8-9F6BDECED846'));
    expect(p).toMatchObject({ kind: 'uuid', variant: 'rfc9562', version: 1 });
    expect(p.kind === 'uuid' && p.fields).toEqual({
      type: 'gregorian',
      time100ns: 0x1ec9414c232ab00n,
      iso: '2022-02-22T19:22:22Z',
      clockSeq: 13256,
      node: '9f:6b:de:ce:d8:46',
      multicast: true,
    });
    expect((13256).toString(16)).toBe('33c8');
    if (p.kind === 'uuid' && p.fields.type === 'gregorian') expect(gregorianToMs(p.fields.time100ns)).toBe(T);
  });

  it('14: v6 — RFC 9562 A.5: the same time and fields as row 13', () => {
    const v6 = ok(parseId('1EC9414C-232A-6B00-B3C8-9F6BDECED846'));
    const v1 = ok(parseId('C232AB00-9414-11EC-B3C8-9F6BDECED846'));
    expect(v6).toMatchObject({ kind: 'uuid', variant: 'rfc9562', version: 6 });
    expect(v6.kind === 'uuid' && v6.fields).toEqual(v1.kind === 'uuid' && v1.fields);
  });

  it('15: ULID', () => {
    const p = ok(parseId('01ARZ3NDEKTSV4RRFFQ69G5FAV'));
    expect(p).toMatchObject({ kind: 'ulid', timeMs: 1469922850259 });
    expect(isoFromMs(1469922850259)).toBe('2016-07-30T23:54:10.259Z');
    expect(std(p.bytes)).toBe('01563e3a-b5d3-d676-4c61-efb99302bd5b');
    expect(p.kind === 'ulid' && p.random).toBe('d6764c61efb99302bd5b');
  });

  it('the fraction is the shortest exact one: a v1 time with 100-ns precision shows 9 digits', () => {
    // C232AB01: one tick (100 ns) after row 13.
    const p = ok(parseId('C232AB01-9414-11EC-B3C8-9F6BDECED846'));
    expect(p.kind === 'uuid' && p.fields.type === 'gregorian' && p.fields.iso).toBe('2022-02-22T19:22:22.000000100Z');
    expect(formatIsoUtc(0n)).toBe('1970-01-01T00:00:00Z');
  });

  it('a v1 time before 1970 and the start of the Gregorian calendar', () => {
    const p = ok(parseId('00000000-0000-1000-8000-000000000000'));
    expect(p.kind === 'uuid' && p.fields.type === 'gregorian' && p.fields.iso).toBe('1582-10-15T00:00:00Z');
    expect(gregorianToMs(0n)).toBe(-12219292800000);
  });
});

describe('§10 rows 16–18: ULID notation', () => {
  it('16: the bytes of the A.6 UUID as a ULID', () => {
    expect(encodeUlid(bytesOf(A6))).toBe('01FWHE4YDGFK1SHH6W1G60EECF');
  });
  it('17: nil and max', () => {
    expect(encodeUlid(NIL)).toBe('00000000000000000000000000');
    expect(encodeUlid(MAX)).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
  });
  it('18: the ULID specification’s time 1469918176385 is 01ARYZ6S41', () => {
    const g = createTimeOrderedGenerator(counterSource());
    expect(encodeUlid(g.ulid(1469918176385)).slice(0, 10)).toBe('01ARYZ6S41');
  });
});

describe('§10 row 19: parseId with the inputs of §6, messages word for word', () => {
  const message = (text: string) => {
    const r = parseId(text);
    return r.ok ? 'parsed' : r.message;
  };
  const lengthText = (n: string) =>
    `Not a UUID or ULID: ${n}; a UUID has 36 with hyphens or 32 without, a ULID has 26.`;

  it('empty or blank: nothing, no message', () => {
    expect(parseId('')).toEqual({ ok: false, message: '' });
    expect(parseId('  \t ')).toEqual({ ok: false, message: '' });
  });
  it('35 characters', () => {
    expect(message('017F22E2-79B0-7CC3-98C4-DC0C0C07398')).toBe(lengthText('35 characters'));
  });
  it('a character that is not hex, with its position from 1', () => {
    expect(parseId('017F22E2-79B0-7CC3-98C4-DC0C0C07398G')).toEqual({
      ok: false,
      message: 'Not a UUID: "G" at position 36 is not a hex digit.',
      position: 36,
    });
  });
  it('the position counts in the text as given: edges and braces included', () => {
    expect(message('  {017F22E2-79B0-7CC3-98C4-DC0C0C07398G}')).toBe(
      'Not a UUID: "G" at position 39 is not a hex digit.',
    );
    expect(message('urn:uuid:017F22E2-79B0-7CC3-98C4-DC0C0C07398G')).toBe(
      'Not a UUID: "G" at position 45 is not a hex digit.',
    );
    expect(message('017F22E279B07CC398C4DC0C0C07398Z')).toBe('Not a UUID: "Z" at position 32 is not a hex digit.');
  });
  it('a missing hyphen', () => {
    expect(message('017F22E2_79B0-7CC3-98C4-DC0C0C07398F')).toBe('Not a UUID: expected "-" at position 9.');
  });
  it('U in a ULID', () => {
    expect(message('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(
      'Not a ULID: "U" at position 26 is not used in ULIDs (I, L, O and U are excluded).',
    );
    expect(message('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toMatch(/"I" at position 26 is not used/);
    expect(message('01arz3ndektsv4rrffq69g5fal')).toMatch(/"l" at position 26 is not used/);
    expect(message('01ARZ3NDEKTSV4RRFFQ69G5FAO')).toMatch(/"O" at position 26 is not used/);
  });
  it('a first character above 7', () => {
    expect(message('81ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      "Not a ULID: the first character must be 0–7; larger values don't fit in 128 bits.",
    );
  });
  it('a ULID in lowercase: accepted, the same time', () => {
    const lower = ok(parseId('01arz3ndektsv4rrffq69g5fav'));
    expect(lower).toEqual(ok(parseId('01ARZ3NDEKTSV4RRFFQ69G5FAV')));
  });
  it('one brace only: the length text', () => {
    expect(message('{017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toBe(lengthText('37 characters'));
  });
  it('urn:uuid: — the v7 of A.6', () => {
    expect(ok(parseId('urn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f'))).toEqual(ok(parseId(A6)));
    expect(ok(parseId('URN:UUID:017f22e2-79b0-7cc3-98c4-dc0c0c07398f'))).toEqual(ok(parseId(A6)));
  });
  it('§2.7: braces and uppercase from the Windows registry', () => {
    expect(std(bytesOf('{3B2F8C1E-9D4A-4F6B-8A2E-5C7D9E0F1A2B}'))).toBe('3b2f8c1e-9d4a-4f6b-8a2e-5c7d9e0f1a2b');
  });
  it('nil and max are recognised first, without version', () => {
    const nil = ok(parseId('00000000-0000-0000-0000-000000000000'));
    const max = ok(parseId('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'));
    expect(nil).toMatchObject({ special: 'nil' });
    expect(max).toMatchObject({ special: 'max' });
    expect(nil.kind === 'uuid' && nil.version).toBeUndefined();
    expect(max.kind === 'uuid' && max.version).toBeUndefined();
  });
  it('the largest ULID: year 10889, ISO with the extended year', () => {
    const p = ok(parseId('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'));
    expect(p.kind === 'ulid' && isoFromMs(p.timeMs)).toBe('+010889-08-02T05:31:50.655Z');
  });
  it('version 0: unknown', () => {
    expect(ok(parseId('017f22e2-79b0-0cc3-98c4-dc0c0c07398f'))).toMatchObject({ variant: 'rfc9562', version: 0 });
  });
  it('variant 0xxx: NCS, no version', () => {
    const p = ok(parseId('017f22e2-79b0-7cc3-08c4-dc0c0c07398f'));
    expect(p).toMatchObject({ variant: 'ncs', fields: { type: 'none' } });
    expect(p.kind === 'uuid' && p.version).toBeUndefined();
  });
  it('all four variants of RFC 9562 §4.1', () => {
    const variant = (b8: string) => {
      const p = ok(parseId(`017f22e2-79b0-7cc3-${b8}c4-dc0c0c07398f`));
      return p.kind === 'uuid' ? p.variant : null;
    };
    expect(['00', '7f', '80', 'bf', 'c0', 'df', 'e0', 'ff'].map(variant)).toEqual([
      'ncs',
      'ncs',
      'rfc9562',
      'rfc9562',
      'microsoft',
      'microsoft',
      'future',
      'future',
    ]);
  });
  it('emoji, Cyrillic, 10 KB of text: the length in UTF-16 units; over 100 — "more than 100 characters"', () => {
    expect(message('😀')).toBe(lengthText('2 characters'));
    expect(message('привет')).toBe(lengthText('6 characters'));
    expect(message('x')).toBe(lengthText('1 character'));
    expect(message('a'.repeat(100))).toBe(lengthText('100 characters'));
    expect(message('a'.repeat(10_240))).toBe(lengthText('more than 100 characters'));
  });
  it('a character outside the alphabets is named whole, an emoji too', () => {
    expect(message('017F22E2-79B0-7CC3-98C4-DC0C0C0739😀')).toBe('Not a UUID: "😀" at position 35 is not a hex digit.');
    expect(message('01ARZ3NDEKTSV4RRFFQ69G5FA!')).toBe(
      'Not a ULID: "!" at position 26 is not a Crockford Base32 character.',
    );
  });
  it('two lines: "Paste one UUID or ULID."', () => {
    expect(message(`${A6}\n${A6}`)).toBe(ONE_ID);
    expect(message(`${A6}\r\n01ARZ3NDEKTSV4RRFFQ69G5FAV`)).toBe(ONE_ID);
    expect(message(`\n${A6}\n`)).toBe('parsed');
  });
  it('§5.6: spaces inside and 0x are not accepted', () => {
    expect(message('0x017F22E279B07CC398C4DC0C0C07398F')).toBe(lengthText('34 characters'));
    expect(message('017F22E2 79B0 7CC3 98C4 DC0C0C07398F')).toBe('Not a UUID: expected "-" at position 9.');
  });
});

describe('§10 row 20: formatUuid, every Format × Uppercase', () => {
  const b = bytesOf(A6);
  it.each([
    ['standard', false, '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'],
    ['standard', true, '017F22E2-79B0-7CC3-98C4-DC0C0C07398F'],
    ['no-hyphens', false, '017f22e279b07cc398c4dc0c0c07398f'],
    ['no-hyphens', true, '017F22E279B07CC398C4DC0C0C07398F'],
    ['braces', false, '{017f22e2-79b0-7cc3-98c4-dc0c0c07398f}'],
    ['braces', true, '{017F22E2-79B0-7CC3-98C4-DC0C0C07398F}'],
    ['urn', false, 'urn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f'],
    ['urn', true, 'urn:uuid:017F22E2-79B0-7CC3-98C4-DC0C0C07398F'],
  ] as const)('%s, uppercase %s', (format, uppercase, expected) => {
    const text = formatUuid(b, format, uppercase);
    expect(text).toBe(expected);
    expect(text.length).toBe({ standard: 36, 'no-hyphens': 32, braces: 38, urn: 45 }[format]);
    expect(bytesOf(text)).toEqual(b); // every notation parses back to the same bytes
  });
});

describe('§10 row 21: detectUuid on the examples of §7', () => {
  it.each([
    '017F22E2-79B0-7CC3-98C4-DC0C0C07398F',
    '{3b2f8c1e-9d4a-4f6b-8a2e-5c7d9e0f1a2b}',
    'urn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
    '3b2f8c1e9d4a4f6b8a2e5c7d9e0f1a2b',
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    '  01arz3ndektsv4rrffq69g5fav\n',
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'd41d8cd98f00b204e9800998ecf8427e', // an MD5: accepted on purpose
  ])('recognises %s', text => expect(detectUuid(text)).toBe(true));

  it.each([
    '',
    '12345678901234567890123456', // 26 digits
    'ABCDEFGHJKMNPQRSTVWXYZABCD', // no digit
    '81ARZ3NDEKTSV4RRFFQ69G5FAV', // first character above 7
    '01ARZ3NDEKTSV4RRFFQ69G5FAU', // U
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', // JWT
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // SHA-256
    '{"id": "017f22e2-79b0-7cc3-98c4-dc0c0c07398f"}', // JSON
    '0J/RgNC40LLQtdGC', // Base64
    'hello world',
    '017F22E2-79B0-7CC3-98C4-DC0C0C07398', // 35
    `${A6}\n${A6}`,
  ])('does not recognise %s', text => expect(detectUuid(text)).toBe(false));
});

describe('§10 rows 22–25: properties with crypto.getRandomValues', () => {
  it('22: 10,000 × v4 — version 4, variant 10, all different', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const b = v4(cryptoRandom);
      expect(b[6]! >> 4).toBe(4);
      expect(b[8]! >> 6).toBe(2);
      seen.add(std(b));
    }
    expect(seen.size).toBe(10_000);
  });

  it('23: 1,000 × v7 with one now — strictly ascending, all at now', () => {
    const g = createTimeOrderedGenerator(cryptoRandom);
    const all = generateBatch('v7', 1000, g, T);
    const texts = all.map(std);
    for (let i = 1; i < texts.length; i++) expect(texts[i]! > texts[i - 1]!).toBe(true);
    for (const b of all) {
      const p = ok(parseId(std(b)));
      expect(p.kind === 'uuid' && p.fields.type === 'unix' && p.fields.timeMs).toBe(T);
      expect(p).toMatchObject({ version: 7, variant: 'rfc9562' });
    }
  });

  it('24: 1,000 × ULID with one now — strictly ascending, the same first 10 characters', () => {
    const g = createTimeOrderedGenerator(cryptoRandom);
    const texts = generateBatch('ulid', 1000, g, T).map(encodeUlid);
    for (let i = 1; i < texts.length; i++) expect(texts[i]! > texts[i - 1]!).toBe(true);
    expect(new Set(texts.map(t => t.slice(0, 10)))).toEqual(new Set(['01FWHE4YDG']));
  });

  it('25: v7 and ULID refuse a clock beyond 2^48 − 1 ms', () => {
    const g = createTimeOrderedGenerator(cryptoRandom);
    expect(() => g.v7(2 ** 48)).toThrow(CLOCK_RANGE);
    expect(() => g.ulid(2 ** 48)).toThrow(CLOCK_RANGE);
    expect(encodeUlid(g.ulid(2 ** 48 - 1)).slice(0, 10)).toBe('7ZZZZZZZZZ');
    expect(std(g.v7(2 ** 48 - 1)).slice(0, 13)).toBe('ffffffff-ffff');
  });

  it('§5.4: a v7 counter rolling over at the last millisecond is refused too', () => {
    const g = createTimeOrderedGenerator(ffSource);
    for (let i = 0; i < 2049; i++) g.v7(2 ** 48 - 1);
    expect(() => g.v7(2 ** 48 - 1)).toThrow(CLOCK_RANGE);
  });
});

describe('§4, §6: How many', () => {
  it.each([
    ['1', 1],
    ['1000', 1000],
    [' 5 ', 5],
    ['0', null],
    ['1001', null],
    ['', null],
    ['2.5', null],
    ['-3', null],
    ['abc', null],
  ])('%j → %j', (text, expected) => expect(parseCount(text)).toBe(expected));

  it('says so in the words of §6', () => {
    expect(COUNT_ERROR).toBe('How many must be a whole number from 1 to 1,000.');
  });

  it('§6: 1,000 v7 in one ms — ascending, one time, no shift (counter ≤ 2,047 + 1,000 < 4,096)', () => {
    const g = createTimeOrderedGenerator(ffSource); // the highest seed, 0x7ff
    const all = generateBatch('v7', 1000, g, T).map(std);
    expect(new Set(all.map(t => t.slice(0, 13)))).toEqual(new Set(['017f22e2-79b0']));
  });
});
