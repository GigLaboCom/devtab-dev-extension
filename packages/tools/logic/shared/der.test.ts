import {
  children,
  describeTag,
  explicit,
  MAX_DER_DEPTH,
  parseDer,
  readBitString,
  readBoolean,
  readInteger,
  readNull,
  readOctetString,
  readOid,
  readString,
  readTime,
  readTlv,
} from './der';
import { formatIsoUtc } from './time';
import { describe, expect, it } from 'vitest';
import type { StringType, Tlv } from './der';

/** DER of one element: an identifier byte (or bytes) and the content, with the length in its shortest form. */
const el = (id: number | number[], ...content: Array<number | Uint8Array | number[]>): number[] => {
  const body = content.flatMap(c => (typeof c === 'number' ? [c] : Array.from(c)));
  const n = body.length;
  const length =
    n < 0x80
      ? [n]
      : n < 0x100
        ? [0x81, n]
        : n < 0x10000
          ? [0x82, n >> 8, n & 0xff]
          : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  return [...(Array.isArray(id) ? id : [id]), ...length, ...body];
};
const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const hex = (h: string): Uint8Array =>
  new Uint8Array((h.replace(/\s/g, '').match(/../g) ?? []).map(x => parseInt(x, 16)));
const tlvOf = (der: Uint8Array): Tlv => {
  const read = readTlv(der, 0);
  if (!read.ok) throw new Error(read.error.message);
  return read.tlv;
};
const errorOf = (r: { ok: boolean; error?: { code: string; offset: number; message: string } }) =>
  r.ok ? undefined : { code: r.error!.code, offset: r.error!.offset };

describe('readTlv — the header (X.690 §8.1)', () => {
  it('reads short and long lengths, the class and the form', () => {
    expect(readTlv(bytes(0x30, 0x03, 0x02, 0x01, 0x05), 0)).toEqual({
      ok: true,
      tlv: { tag: 16, cls: 'universal', constructed: true, start: 0, header: 2, length: 3, body: 2, end: 5 },
    });
    const long = new Uint8Array(el(0x04, new Uint8Array(300)));
    expect(tlvOf(long)).toMatchObject({ tag: 4, header: 4, length: 300, end: 304 });
    expect(tlvOf(bytes(0xa3, 0x00))).toMatchObject({ tag: 3, cls: 'context', constructed: true });
    expect(tlvOf(bytes(0x81, 0x00))).toMatchObject({ tag: 1, cls: 'context', constructed: false });
    expect(tlvOf(bytes(0x41, 0x00))).toMatchObject({ cls: 'application' });
    expect(tlvOf(bytes(0xc0, 0x00))).toMatchObject({ cls: 'private' });
  });

  it('reads a high tag number (≥ 31) and refuses one not in its shortest form', () => {
    expect(tlvOf(bytes(0x9f, 0x1f, 0x00))).toMatchObject({ tag: 31, cls: 'context', header: 3 });
    expect(tlvOf(bytes(0xbf, 0x81, 0x00, 0x00))).toMatchObject({ tag: 128, constructed: true });
    expect(errorOf(readTlv(bytes(0x9f, 0x1e, 0x00), 0))).toEqual({ code: 'non-minimal-tag', offset: 0 });
    expect(errorOf(readTlv(bytes(0x9f, 0x80, 0x1f, 0x00), 0))).toEqual({ code: 'non-minimal-tag', offset: 0 });
    expect(errorOf(readTlv(bytes(0x9f, 0x81, 0x81, 0x81, 0x81, 0x01, 0x00), 0))).toEqual({
      code: 'tag-too-large',
      offset: 0,
    });
  });

  it('refuses the indefinite length (BER) at the element', () => {
    const r = readTlv(bytes(0x30, 0x80, 0x00, 0x00), 0);
    expect(r).toEqual({
      ok: false,
      error: { code: 'indefinite-length', offset: 0, message: 'indefinite length is BER, not DER' },
    });
    expect(errorOf(readTlv(bytes(0x02, 0x01, 0x00, 0x24, 0x80), 3))).toEqual({ code: 'indefinite-length', offset: 3 });
  });

  it('refuses lengths not in their shortest form, too long, or reserved', () => {
    expect(errorOf(readTlv(bytes(0x04, 0x81, 0x05, 1, 2, 3, 4, 5), 0))).toEqual({
      code: 'non-minimal-length',
      offset: 0,
    });
    expect(errorOf(readTlv(new Uint8Array([0x04, 0x82, 0x00, 0x80, ...new Array(128).fill(0)]), 0))).toEqual({
      code: 'non-minimal-length',
      offset: 0,
    });
    expect(errorOf(readTlv(bytes(0x04, 0x85, 1, 0, 0, 0, 0), 0))).toEqual({ code: 'length-too-large', offset: 0 });
    expect(errorOf(readTlv(bytes(0x04, 0xff), 0))).toEqual({ code: 'reserved-length', offset: 0 });
  });

  it('says where the data ends too early: in the header, in the content, inside a parent', () => {
    expect(readTlv(bytes(0x30), 0)).toEqual({
      ok: false,
      error: { code: 'truncated', offset: 0, message: 'the data ends inside the element’s header' },
    });
    expect(readTlv(bytes(0x30, 0x05, 0x02), 0)).toEqual({
      ok: false,
      error: { code: 'truncated', offset: 0, message: 'the element is longer than the data left' },
    });
    expect(errorOf(readTlv(bytes(0x04, 0x84, 0xff, 0xff, 0xff, 0xff), 0))).toEqual({ code: 'truncated', offset: 0 });
    expect(errorOf(readTlv(bytes(0x04, 0x82, 0x01), 0))).toEqual({ code: 'truncated', offset: 0 });
    const outer = bytes(0x30, 0x03, 0x04, 0x05, 0x00, 0x00, 0x00, 0x00);
    expect(errorOf(children(outer, tlvOf(outer)))).toEqual({ code: 'overrun', offset: 2 });
  });

  it('refuses an end-of-contents marker', () => {
    expect(errorOf(readTlv(bytes(0x00, 0x00), 0))).toEqual({ code: 'end-of-contents', offset: 0 });
  });
});

describe('children', () => {
  it('lists the elements that fill a constructed element', () => {
    const der = new Uint8Array(el(0x30, el(0x02, 1), el(0x05), el(0xa0, el(0x02, 2))));
    const read = children(der, tlvOf(der));
    expect(read.ok && read.items.map(t => describeTag(t))).toEqual(['INTEGER', 'NULL', '[0]']);
  });

  it('refuses a primitive element', () => {
    const der = bytes(0x04, 0x01, 0x00);
    expect(children(der, tlvOf(der))).toEqual({
      ok: false,
      error: {
        code: 'not-constructed',
        offset: 0,
        message: 'expected a constructed element, found a primitive OCTET STRING',
      },
    });
  });
});

describe('parseDer — the whole tree, strictly', () => {
  it('accepts DER and counts the bytes after the element', () => {
    const der = new Uint8Array([...el(0x30, el(0x02, 1), el(0x31, el(0x0c, 0x41))), 0xaa, 0xbb]);
    expect(parseDer(der)).toMatchObject({ ok: true, root: { tag: 16, end: 10 }, trailing: 2 });
  });

  it('refuses BER: constructed strings, primitive sequences, content rules — at the element', () => {
    const strict = (b: number[]) => errorOf(parseDer(new Uint8Array(b)));
    expect(strict(el(0x30, el(0x24, el(0x04, 1))))).toEqual({ code: 'constructed-string', offset: 2 });
    expect(strict(el(0x30, el(0x10)))).toEqual({ code: 'primitive-sequence', offset: 2 });
    expect(strict(el(0x30, el(0x02, 0, 1)))).toEqual({ code: 'invalid-content', offset: 2 });
    expect(strict(el(0x30, el(0x01, 1)))).toEqual({ code: 'invalid-content', offset: 2 });
    expect(strict(el(0x30, el(0x05, 0)))).toEqual({ code: 'invalid-content', offset: 2 });
    expect(strict(el(0x30, el(0x03, 1, 1)))).toEqual({ code: 'invalid-content', offset: 2 });
    expect(strict(el(0x30, el(0x06, 0x80, 1)))).toEqual({ code: 'invalid-content', offset: 2 });
    expect(strict(el(0x30, [0x02, 0x81, 0x01, 0x00]))).toEqual({ code: 'non-minimal-length', offset: 2 });
  });

  it('does not look inside primitive context tags or OCTET STRINGs (implicit types and wrapped DER)', () => {
    const der = new Uint8Array(el(0x30, el(0x80, 0x00, 0x01), el(0x04, 0x30, 0x80)));
    expect(parseDer(der)).toMatchObject({ ok: true });
  });

  it('limits the depth without recursion: 32 levels pass, 33 do not, a million fail fast', () => {
    const nest = (levels: number): Uint8Array => {
      // Each level is 30 84 <4-byte length> ... ; the innermost is NULL. Long-form lengths of 4 bytes are not minimal
      // for small sizes, so build with the shortest lengths from the inside out.
      let inner: number[] = [0x05, 0x00];
      for (let i = 1; i < levels; i++) inner = el(0x30, inner);
      return new Uint8Array(inner);
    };
    expect(parseDer(nest(MAX_DER_DEPTH))).toMatchObject({ ok: true });
    const deep = parseDer(nest(MAX_DER_DEPTH + 1));
    expect(deep.ok ? undefined : deep.error).toEqual({
      code: 'too-deep',
      offset: 2 * MAX_DER_DEPTH,
      message: 'elements are nested deeper than 32 levels',
    });
    // A million nested SEQUENCEs, every length right and minimal (5.9 MB): refused at level 33, no stack overflow.
    const levels = 1_000_000;
    const sizes = new Array<number>(levels);
    sizes[levels - 1] = 2;
    const headerOf = (n: number) => (n < 0x80 ? 2 : n < 0x100 ? 3 : n < 0x10000 ? 4 : n < 0x1000000 ? 5 : 6);
    for (let i = levels - 2; i >= 0; i--) sizes[i] = sizes[i + 1]! + headerOf(sizes[i + 1]!);
    const huge = new Uint8Array(sizes[0]!);
    let at = 0;
    for (let i = 0; i < levels - 1; i++) {
      const n = sizes[i + 1]!;
      huge[at++] = 0x30;
      const header = headerOf(n);
      if (header === 2) huge[at++] = n;
      else {
        huge[at++] = 0x80 | (header - 2);
        for (let k = header - 3; k >= 0; k--) huge[at++] = (n >> (8 * k)) & 0xff;
      }
    }
    huge[at++] = 0x05;
    huge[at++] = 0x00;
    expect(at).toBe(huge.length);
    const r = parseDer(huge, { maxBytes: huge.length });
    expect(r.ok ? undefined : r.error.code).toBe('too-deep');
    expect(parseDer(huge, { maxBytes: huge.length, maxDepth: levels })).toMatchObject({ ok: true });
  });

  it('is linear: every byte is read a bounded number of times', () => {
    let reads = 0;
    const counted = (data: Uint8Array): Uint8Array =>
      new Proxy(data, {
        get(target, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
          return Reflect.get(target, key) as unknown;
        },
      });
    const many = (n: number) => {
      const items: number[] = [];
      for (let i = 0; i < n; i++)
        items.push(...el(0x30, el(0x02, i & 0x7f), el(0x06, 0x55, 0x04, 0x03), el(0x01, 0xff)));
      return new Uint8Array(el(0x30, items));
    };
    for (const n of [1_000, 10_000]) {
      reads = 0;
      const der = many(n);
      expect(parseDer(counted(der), { maxBytes: der.length })).toMatchObject({ ok: true });
      expect(reads / der.length).toBeLessThan(3);
    }
  });

  it('refuses empty and oversized data', () => {
    expect(errorOf(parseDer(new Uint8Array()))).toEqual({ code: 'empty', offset: 0 });
    expect(errorOf(parseDer(new Uint8Array(el(0x04, new Uint8Array(100))), { maxBytes: 50 }))).toEqual({
      code: 'too-large',
      offset: 0,
    });
  });
});

describe('INTEGER: any size, exact, shortest form', () => {
  it.each<[string, bigint]>([
    ['020100', 0n],
    ['02017f', 127n],
    ['02020080', 128n],
    ['0201ff', -1n],
    ['020180', -128n],
    ['0202ff7f', -129n],
    ['0208123456789abcdef0', 0x123456789abcdef0n],
    ['021400ffffffffffffffffffffffffffffffffffffff', (1n << 152n) - 1n],
  ])('%s → %s', (h, value) => {
    const der = hex(h);
    expect(readInteger(der, tlvOf(der))).toEqual({ ok: true, value });
  });

  it('refuses no content and redundant sign bytes', () => {
    for (const h of ['0200', '02020001', '0202ff80']) {
      const der = hex(h);
      expect(errorOf(readInteger(der, tlvOf(der)))).toEqual({ code: 'invalid-content', offset: 0 });
    }
    const der = hex('02020001');
    const r = readInteger(der, tlvOf(der));
    expect(r.ok ? '' : r.error.message).toBe('an INTEGER is not in its shortest form (BER, not DER)');
  });

  it('reads an implicitly tagged INTEGER only when asked', () => {
    const der = hex('820105');
    expect(errorOf(readInteger(der, tlvOf(der)))).toEqual({ code: 'wrong-type', offset: 0 });
    expect(readInteger(der, tlvOf(der), true)).toEqual({ ok: true, value: 5n });
  });
});

describe('BOOLEAN, NULL, BIT STRING, OCTET STRING', () => {
  it('BOOLEAN is 0x00 or 0xFF', () => {
    expect(readBoolean(hex('0101ff'), tlvOf(hex('0101ff')))).toEqual({ ok: true, value: true });
    expect(readBoolean(hex('010100'), tlvOf(hex('010100')))).toEqual({ ok: true, value: false });
    expect(errorOf(readBoolean(hex('010101'), tlvOf(hex('010101'))))).toEqual({ code: 'invalid-content', offset: 0 });
    expect(errorOf(readBoolean(hex('0102ffff'), tlvOf(hex('0102ffff'))))).toEqual({
      code: 'invalid-content',
      offset: 0,
    });
  });

  it('NULL is empty', () => {
    expect(readNull(hex('0500'), tlvOf(hex('0500')))).toEqual({ ok: true, value: null });
    expect(errorOf(readNull(hex('050100'), tlvOf(hex('050100'))))).toEqual({ code: 'invalid-content', offset: 0 });
  });

  it('BIT STRING keeps its unused bits, which must be zero', () => {
    const der = hex('03020780');
    expect(readBitString(der, tlvOf(der))).toEqual({ ok: true, value: { unusedBits: 7, bytes: hex('80') } });
    expect(readBitString(hex('030100'), tlvOf(hex('030100')))).toEqual({
      ok: true,
      value: { unusedBits: 0, bytes: hex('') },
    });
    for (const h of ['0300', '030101', '03020800', '03020181']) {
      const bad = hex(h);
      expect(errorOf(readBitString(bad, tlvOf(bad)))).toEqual({ code: 'invalid-content', offset: 0 });
    }
  });

  it('OCTET STRING gives its bytes; a constructed one is refused', () => {
    expect(readOctetString(hex('0403010203'), tlvOf(hex('0403010203')))).toEqual({ ok: true, value: hex('010203') });
    expect(errorOf(readOctetString(hex('2403040100'), tlvOf(hex('2403040100'))))).toEqual({
      code: 'constructed-string',
      offset: 0,
    });
  });

  it('explicit tags hold exactly one element', () => {
    const one = new Uint8Array(el(0xa0, el(0x02, 2)));
    expect(explicit(one, tlvOf(one))).toMatchObject({ ok: true, value: { tag: 2, start: 2 } });
    const two = new Uint8Array(el(0xa0, el(0x02, 2), el(0x02, 3)));
    expect(errorOf(explicit(two, tlvOf(two)))).toEqual({ code: 'invalid-content', offset: 0 });
  });
});

describe('OBJECT IDENTIFIER (X.690 §8.19)', () => {
  it.each<[string, string]>([
    ['0603550403', '2.5.4.3'],
    ['06092a864886f70d01010b', '1.2.840.113549.1.1.11'],
    ['06082a8648ce3d030107', '1.2.840.10045.3.1.7'],
    ['0603883703', '2.999.3'],
    ['0601 00', '0.0'],
    ['0601 27', '0.39'],
    ['0601 28', '1.0'],
    // 2.25.<a 128-bit UUID>: an arc of 19 bytes
    ['061469 83 ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff 7f', `2.25.${(1n << 128n) - 1n}`],
  ])('%s → %s', (h, oid) => {
    const der = hex(h);
    expect(readOid(der, tlvOf(der))).toEqual({ ok: true, value: oid });
  });

  it('refuses no content, a cut-off arc, a non-minimal arc and an arc over 20 bytes', () => {
    for (const h of ['0600', '06025581', '06028001', `0615${'81'.repeat(20)}01`]) {
      const der = hex(h);
      expect(errorOf(readOid(der, tlvOf(der)))).toEqual({ code: 'invalid-content', offset: 0 });
    }
  });
});

describe('string types, each by its own rule', () => {
  const read = (tag: number, content: number[] | Uint8Array, as?: StringType) => {
    const der = new Uint8Array(el(tag, content));
    return readString(der, tlvOf(der), as);
  };
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it('UTF8String: UTF-8, bad bytes become U+FFFD and are noted', () => {
    expect(read(0x0c, utf8('Пример 😀'))).toEqual({ ok: true, value: { text: 'Пример 😀', type: 'UTF8String' } });
    expect(read(0x0c, [0x41, 0xc3, 0x28])).toEqual({
      ok: true,
      value: { text: 'A\ufffd(', type: 'UTF8String', malformed: 'bytes that are not UTF-8' },
    });
  });

  it('PrintableString, IA5String, VisibleString, NumericString: ASCII, each checked against its alphabet', () => {
    expect(read(0x13, utf8("Example (Tools), Inc. 1+1=2?:/'"))).toEqual({
      ok: true,
      value: { text: "Example (Tools), Inc. 1+1=2?:/'", type: 'PrintableString' },
    });
    expect(read(0x13, utf8('*.example.com'))).toEqual({
      ok: true,
      value: {
        text: '*.example.com',
        type: 'PrintableString',
        malformed: 'characters outside the PrintableString alphabet',
      },
    });
    expect(read(0x16, utf8('admin@example.com'))).toEqual({
      ok: true,
      value: { text: 'admin@example.com', type: 'IA5String' },
    });
    expect(read(0x16, [0x61, 0xe9])).toEqual({
      ok: true,
      value: { text: 'a\ufffd', type: 'IA5String', malformed: 'bytes outside ASCII' },
    });
    expect(read(0x1a, [0x41, 0x09])).toMatchObject({
      ok: true,
      value: { malformed: 'characters outside the VisibleString alphabet' },
    });
    expect(read(0x12, utf8('12 34'))).toEqual({ ok: true, value: { text: '12 34', type: 'NumericString' } });
    expect(read(0x12, utf8('12a'))).toMatchObject({
      ok: true,
      value: { malformed: 'characters outside the NumericString alphabet' },
    });
  });

  it('TeletexString is read as Latin-1', () => {
    expect(read(0x14, [0x45, 0x78, 0x20, 0xc4, 0x6d])).toEqual({
      ok: true,
      value: { text: 'Ex Äm', type: 'TeletexString' },
    });
  });

  it('BMPString is UTF-16BE; an odd length is an error', () => {
    expect(read(0x1e, [0x04, 0x1f, 0x04, 0x40, 0xd8, 0x3d, 0xde, 0x00])).toEqual({
      ok: true,
      value: { text: 'Пр😀', type: 'BMPString' },
    });
    expect(errorOf(read(0x1e, [0x04, 0x1f, 0x04]))).toEqual({ code: 'invalid-content', offset: 0 });
    expect(read(0x1e, [0xff, 0xfd, 0xd8, 0x3d, 0x00, 0x41])).toEqual({
      ok: true,
      value: { text: '\ufffd\ufffdA', type: 'BMPString', malformed: 'lone surrogates' },
    });
    expect(read(0x1e, [0xff, 0xfd])).toEqual({ ok: true, value: { text: '\ufffd', type: 'BMPString' } });
  });

  it('UniversalString is UTF-32BE; a length not a multiple of 4 is an error, a non-code point becomes U+FFFD', () => {
    expect(read(0x1c, [0, 0, 0, 0x41, 0, 1, 0xf6, 0x00])).toEqual({
      ok: true,
      value: { text: 'A😀', type: 'UniversalString' },
    });
    expect(errorOf(read(0x1c, [0, 0, 0]))).toEqual({ code: 'invalid-content', offset: 0 });
    expect(read(0x1c, [0, 0x11, 0, 0, 0, 0, 0xd8, 0])).toEqual({
      ok: true,
      value: { text: '\ufffd\ufffd', type: 'UniversalString', malformed: 'values that are not code points' },
    });
  });

  it('an implicitly tagged string is read as the type it stands for; other types are refused', () => {
    expect(read(0x82, utf8('example.com'), 'IA5String')).toEqual({
      ok: true,
      value: { text: 'example.com', type: 'IA5String' },
    });
    expect(errorOf(read(0x02, [1]))).toEqual({ code: 'wrong-type', offset: 0 });
    expect(errorOf(read(0x2c, el(0x0c, 0x41)))).toEqual({ code: 'constructed-string', offset: 0 });
  });
});

describe('UTCTime and GeneralizedTime by RFC 5280 §4.1.2.5', () => {
  const time = (tag: number, text: string) => {
    const der = new Uint8Array(el(tag, new TextEncoder().encode(text)));
    const r = readTime(der, tlvOf(der));
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const iso = (ms: number | undefined) => (ms === undefined ? undefined : formatIsoUtc(BigInt(ms) * 1_000_000n));

  it.each<[number, string, string]>([
    [0x17, '251119120000Z', '2025-11-19T12:00:00Z'],
    [0x17, '500101000000Z', '1950-01-01T00:00:00Z'],
    [0x17, '491231235959Z', '2049-12-31T23:59:59Z'],
    [0x17, '000229000000Z', '2000-02-29T00:00:00Z'],
    [0x18, '20500101000000Z', '2050-01-01T00:00:00Z'],
    [0x18, '99991231235959Z', '9999-12-31T23:59:59Z'],
    [0x18, '20240229120000Z', '2024-02-29T12:00:00Z'],
  ])('%#: %s', (tag, text, expected) => {
    const t = time(tag, text);
    expect(t.problem).toBeUndefined();
    expect(iso(t.epochMs)).toBe(expected);
  });

  it.each<[number, string, string]>([
    [0x17, '5001010000Z', 'a UTCTime must be YYMMDDHHMMSSZ (RFC 5280 §4.1.2.5.1)'],
    [0x17, '250101000000+0100', 'a UTCTime must be YYMMDDHHMMSSZ (RFC 5280 §4.1.2.5.1)'],
    [0x17, '20250101000000Z', 'a UTCTime must be YYMMDDHHMMSSZ (RFC 5280 §4.1.2.5.1)'],
    [0x18, '20500101000000.5Z', 'a GeneralizedTime must be YYYYMMDDHHMMSSZ (RFC 5280 §4.1.2.5.2)'],
    [0x18, '205001010000Z', 'a GeneralizedTime must be YYYYMMDDHHMMSSZ (RFC 5280 §4.1.2.5.2)'],
    [0x18, '20230229000000Z', '20230229000000Z is not a date and time of day'],
    [0x18, '21000229000000Z', '21000229000000Z is not a date and time of day'],
    [0x17, '251301000000Z', '251301000000Z is not a date and time of day'],
    [0x17, '251119235960Z', '251119235960Z is not a date and time of day'],
    [0x17, '251119240000Z', '251119240000Z is not a date and time of day'],
  ])('not RFC 5280: %s', (tag, text, problem) => {
    const t = time(tag, text);
    expect(t).toEqual({ type: tag === 0x17 ? 'UTCTime' : 'GeneralizedTime', raw: text, problem });
  });

  it('refuses other types', () => {
    expect(errorOf(readTime(hex('0500'), tlvOf(hex('0500'))))).toEqual({ code: 'wrong-type', offset: 0 });
  });
});

describe('describeTag', () => {
  it('names universal types and writes the others in brackets', () => {
    expect(describeTag({ cls: 'universal', tag: 16 })).toBe('SEQUENCE');
    expect(describeTag({ cls: 'universal', tag: 99 })).toBe('universal tag 99');
    expect(describeTag({ cls: 'context', tag: 3 })).toBe('[3]');
    expect(describeTag({ cls: 'application', tag: 1 })).toBe('[APPLICATION 1]');
    expect(describeTag({ cls: 'private', tag: 0 })).toBe('[PRIVATE 0]');
  });
});
