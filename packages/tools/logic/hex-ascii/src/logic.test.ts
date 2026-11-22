import { detectHex } from './detect';
import { bytesToText, firstInvalidUtf8, formatBytes, hexDump, showControls, textToBytes } from './logic';
import {
  BOM_NOTE,
  HEX_TOO_LARGE,
  SURROGATES_NOTE,
  TEXT_TOO_LARGE,
  bytesLabel,
  controlsNote,
  invalidNote,
} from './messages';
import { DUMP_MESSAGE, parseHex } from './parse';
import { bytesToHex } from '@workspace/tools-shared/hex';
import { describe, expect, it } from 'vitest';
import type { HexFormat, HexOptions, TextEncodingId } from './logic';

const enc = (text: string, encoding: TextEncodingId = 'utf-8'): Uint8Array => {
  const r = textToBytes(text, encoding);
  if (!r.ok) throw new Error(r.error.message);
  return r.bytes;
};
const hex = (text: string, options: Partial<HexOptions> = {}, encoding: TextEncodingId = 'utf-8'): string =>
  bytesToHex(enc(text, encoding), options);
const bytes = (input: string): Uint8Array => {
  const r = parseHex(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.bytes;
};
const decode = (input: string, encoding: TextEncodingId = 'utf-8') => bytesToText(bytes(input), encoding);
const parseError = (input: string) => {
  const r = parseHex(input);
  if (r.ok) throw new Error(`no error for ${JSON.stringify(input)}`);
  return r.error;
};
/** The specification's rows as the tests run them: a `2` for «Bytes per line 2», which the interface does not offer. */
const perLine = (n: number) => n as HexOptions['bytesPerLine'];

describe('§10, Text to hex', () => {
  it('row 1: Hello, UTF-8, Plain', () => {
    expect(hex('Hello')).toBe('48656c6c6f');
    expect(hex('Hello')).toBe(Buffer.from('Hello', 'utf8').toString('hex'));
  });
  it('row 2: Spaced, Uppercase', () =>
    expect(hex('Hello', { format: 'spaced', uppercase: true })).toBe('48 65 6C 6C 6F'));
  it('row 3: Colons / Commas', () => {
    expect(hex('Hello', { format: 'colons' })).toBe('48:65:6c:6c:6f');
    expect(hex('Hello', { format: 'commas' })).toBe('48, 65, 6c, 6c, 6f');
  });
  it('row 4: C array / Escaped', () => {
    expect(hex('Hello', { format: 'c' })).toBe('0x48, 0x65, 0x6c, 0x6c, 0x6f');
    expect(hex('Hello', { format: 'escaped' })).toBe('\\x48\\x65\\x6c\\x6c\\x6f');
  });
  it('row 5: Spaced, Bytes per line 2', () =>
    expect(hex('Hello', { format: 'spaced', bytesPerLine: perLine(2) })).toBe('48 65\n6c 6c\n6f'));
  it('row 6: C array, Bytes per line 2', () =>
    expect(hex('Hello', { format: 'c', bytesPerLine: perLine(2) })).toBe('0x48, 0x65,\n0x6c, 0x6c,\n0x6f'));
  it('row 7: é€😀, UTF-8, Plain', () => {
    expect(hex('é€😀')).toBe('c3a9e282acf09f9880');
    expect(hex('é€😀')).toBe(Buffer.from('é€😀', 'utf8').toString('hex'));
  });
  it('row 8: é€😀, UTF-16 LE, Spaced', () => {
    expect(hex('é€😀', { format: 'spaced' }, 'utf-16le')).toBe('e9 00 ac 20 3d d8 00 de');
    expect(hex('é€😀', {}, 'utf-16le')).toBe(Buffer.from('é€😀', 'utf16le').toString('hex'));
  });
  it('row 9: é€😀, UTF-16 BE, Spaced', () => {
    expect(hex('é€😀', { format: 'spaced' }, 'utf-16be')).toBe('00 e9 20 ac d8 3d de 00');
    expect(hex('é€😀', {}, 'utf-16be')).toBe(Buffer.from('é€😀', 'utf16le').swap16().toString('hex'));
  });
  it('row 10: é, ISO-8859-1', () => {
    expect(hex('é', {}, 'iso-8859-1')).toBe('e9');
    expect(hex('é', {}, 'iso-8859-1')).toBe(Buffer.from('é', 'latin1').toString('hex'));
  });
  it('row 11: € / a😀 in ISO-8859-1 — an error at offset 0 / 1', () => {
    expect(textToBytes('€', 'iso-8859-1')).toEqual({
      ok: false,
      error: { message: '"€" is not in ISO-8859-1', offset: 0, line: 1, column: 1 },
    });
    expect(textToBytes('a😀', 'iso-8859-1')).toEqual({
      ok: false,
      error: { message: '"😀" is not in ISO-8859-1', offset: 1, line: 1, column: 2 },
    });
  });
  it('row 12: a lone surrogate — UTF-8 efbfbd with replacedSurrogates / UTF-16 LE 00d8', () => {
    const r = textToBytes('\uD800', 'utf-8');
    expect(r.ok && bytesToHex(r.bytes)).toBe('efbfbd');
    expect(r.ok && r.replacedSurrogates).toBe(true);
    expect(Buffer.from('\uD800', 'utf8').toString('hex')).toBe('efbfbd');
    expect(hex('\uD800', {}, 'utf-16le')).toBe('00d8');
    expect(Buffer.from('\uD800', 'utf16le').toString('hex')).toBe('00d8');
  });
  it('row 13: a⏎b, UTF-8, Spaced', () => expect(hex('a\nb', { format: 'spaced' })).toBe('61 0a 62'));
  it('row 14: two spaces, Plain', () => expect(hex('  ')).toBe('2020'));
  it('row 15: TextDecoder("latin1") is windows-1252 — why ISO-8859-1 is not it', () => {
    const d = new TextDecoder('latin1');
    expect(d.encoding).toBe('windows-1252');
    // Chrome decodes 0x80 as "€" (the e2e module checks it); Node 22.20 gives U+0080 under the same label (§15). Either
    // way the label promises windows-1252, so the tool decodes ISO-8859-1 itself.
    expect(['€', '\u0080']).toContain(d.decode(new Uint8Array([0x80])));
    expect(bytesToText(new Uint8Array([0x80]), 'iso-8859-1').text).toBe('\u0080');
    expect(bytesToText(new Uint8Array([0x92]), 'iso-8859-1').text).toBe('\u0092');
  });
  it('row 16: Dump of four lines', () => {
    const dump = formatBytes(enc('Hello, World!\nПривет 😀\u0000\u007f end of the line'), {
      format: 'dump',
      uppercase: false,
      bytesPerLine: 0,
    });
    const lines = dump.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 0a d0 9f  |Hello, World!...|');
    expect(lines[3]).toBe(`00000030  65${' '.repeat(48)}|e|`);
    // The whole dump as `hexdump -C` (macOS) printed it for the same bytes, run once (§15).
    expect(dump).toBe(
      [
        '00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 0a d0 9f  |Hello, World!...|',
        '00000010  d1 80 d0 b8 d0 b2 d0 b5  d1 82 20 f0 9f 98 80 00  |.......... .....|',
        '00000020  7f 20 65 6e 64 20 6f 66  20 74 68 65 20 6c 69 6e  |. end of the lin|',
        `00000030  65${' '.repeat(48)}|e|`,
      ].join('\n'),
    );
  });
  it('row 17: Hi⏎, Dump, Uppercase', () =>
    expect(hexDump(enc('Hi\n'), { uppercase: true })).toBe(`00000000  48 69 0A${' '.repeat(42)}|Hi.|`));
});

describe('§10, Hex to text', () => {
  it('row 18: 48656c6c6f — Hello, 5 bytes', () => {
    expect(bytes('48656c6c6f')).toHaveLength(5);
    expect(decode('48656c6c6f').text).toBe('Hello');
  });
  it.each(['48 65 6C 6C 6F', '48:65:6c:6c:6f', '0x48, 0x65, 0x6c, 0x6c, 0x6f'])('row 19: %s — Hello', input =>
    expect(decode(input).text).toBe('Hello'),
  );
  it.each(['{0x48, 0x65, 0x6c, 0x6c, 0x6f}', '\\x48\\x65\\x6c\\x6c\\x6f', '0x48656c6c6f'])(
    'row 20: %s — Hello',
    input => expect(decode(input).text).toBe('Hello'),
  );
  it.each(['48-65\n6c 6c\t6f', '4865 6c6c 6f', '48 0x65 \\x6c\\x6c 6F'])('row 21: %j — Hello', input =>
    expect(decode(input).text).toBe('Hello'),
  );
  it('row 22: U+00A0 is a separator', () => expect(decode('48 65\u00a0').text).toBe('He'));
  it('row 23: c3a9e282acf09f9880 — é€😀', () => {
    expect(decode('c3a9e282acf09f9880').text).toBe('é€😀');
    expect(decode('c3a9e282acf09f9880').firstInvalidByte).toBeNull();
  });
  it.each([
    ['e9', '\uFFFD', 1],
    ['48e941', 'H\uFFFDA', 2],
    ['f09f98', '\uFFFD', 1],
  ])('row 24: %s — %j, firstInvalidByte %i', (input, text, first) => {
    expect(decode(input)).toMatchObject({ text, firstInvalidByte: first });
    expect(decode(input).text).toBe(new TextDecoder().decode(bytes(input)));
  });
  it.each([
    ['c080', '\uFFFD\uFFFD'],
    ['eda080', '\uFFFD\uFFFD\uFFFD'],
  ])('row 25: %s — %j, firstInvalidByte 1', (input, text) => {
    expect(decode(input)).toMatchObject({ text, firstInvalidByte: 1 });
    expect(decode(input).text).toBe(new TextDecoder().decode(bytes(input)));
  });
  it('row 26: efbbbf61 — U+FEFF a, bom', () =>
    expect(decode('efbbbf61')).toMatchObject({ text: '\uFEFFa', bom: true, firstInvalidByte: null }));
  it('row 27: e9 in ISO-8859-1 — é', () => expect(decode('e9', 'iso-8859-1').text).toBe('é'));
  it('row 28: 80 9f ff in ISO-8859-1 — U+0080 U+009F ÿ, two control characters', () =>
    expect(decode('80 9f ff', 'iso-8859-1')).toMatchObject({
      text: '\u0080\u009fÿ',
      controlCount: 2,
      c1Count: 2,
      firstInvalidByte: null,
    }));
  it('row 29: UTF-16 LE — é€😀', () => {
    expect(decode('e900ac203dd8 00de', 'utf-16le')).toMatchObject({ text: 'é€😀', firstInvalidByte: null });
  });
  it('row 30: UTF-16 BE — é€😀', () =>
    expect(decode('00e9 20ac d83d de00', 'utf-16be')).toMatchObject({ text: 'é€😀', firstInvalidByte: null }));
  it('row 31: 00d8 4100 in UTF-16 LE — �A, firstInvalidByte 1', () =>
    expect(decode('00d8 4100', 'utf-16le')).toMatchObject({ text: '\uFFFDA', firstInvalidByte: 1 }));
  it('row 32: 410042 in UTF-16 LE — A�, firstInvalidByte 3', () =>
    expect(decode('410042', 'utf-16le')).toMatchObject({ text: 'A\uFFFD', firstInvalidByte: 3 }));
  it('row 33: fffe4100 in UTF-16 LE — U+FEFF A, bom', () =>
    expect(decode('fffe4100', 'utf-16le')).toMatchObject({ text: '\uFEFFA', bom: true }));
  it('row 34: 00 07 0d 0a 09 7f 85 — symbols, 4 control characters, invalid from byte 7', () => {
    const r = decode('00 07 0d 0a 09 7f 85');
    expect(r).toMatchObject({ text: '\u0000\u0007\r\n\t\u007f\uFFFD', controlCount: 4, firstInvalidByte: 7 });
    expect(showControls(r.text)).toBe('␀␇␍\n\t␡\uFFFD');
  });
  it('row 35: 0d0a — shown ␍⏎, the text \\r\\n', () => {
    const r = decode('0d0a');
    expect(r.text).toBe('\r\n');
    expect(showControls(r.text)).toBe('␍\n');
  });
  it('row 36: 48 6 / 486 — an odd number of digits at the start of the chunk', () => {
    expect(parseError('48 6')).toEqual({ message: 'odd number of hex digits in "6"', offset: 3, line: 1, column: 4 });
    expect(parseError('486')).toEqual({ message: 'odd number of hex digits in "486"', offset: 0, line: 1, column: 1 });
  });
  it('row 37: 48 zz', () =>
    expect(parseError('48 zz')).toEqual({ message: '"z" is not a hex digit', offset: 3, line: 1, column: 4 }));
  it('row 38: 0x / \\x / \\x4', () => {
    expect(parseError('0x')).toMatchObject({ message: '0x without hex digits', offset: 0 });
    expect(parseError('\\x')).toMatchObject({ message: '\\x without hex digits', offset: 0 });
    expect(parseError('\\x4')).toMatchObject({ message: 'odd number of hex digits in "\\x4"', offset: 0 });
  });
  it('row 39: a\\x41 / %48', () => {
    expect(parseError('a\\x41')).toMatchObject({ message: '"a" is not a hex digit', offset: 0 });
    expect(parseError('%48')).toMatchObject({ message: '"%" is not a hex digit', offset: 0 });
  });
  it('row 40: the output of hexdump -C is refused', () =>
    expect(parseError('00000000  48 65 6c 6c 6f 0a                                 |Hello.|')).toEqual({
      message: DUMP_MESSAGE,
      offset: 0,
      line: 1,
      column: 1,
    }));
  it('row 41: the output of xxd is refused', () =>
    expect(parseError('00000000: 4865 6c6c 6f0a                           Hello.')).toMatchObject({
      message: DUMP_MESSAGE,
    }));
  it('row 42: deadbeef  cafe is not a dump — 6 bytes, invalid from byte 3', () => {
    expect(bytes('deadbeef  cafe')).toHaveLength(6);
    expect(decode('deadbeef  cafe').firstInvalidByte).toBe(3);
    expect(decode('deadbeef  cafe').text).toBe(new TextDecoder().decode(bytes('deadbeef  cafe')));
  });
  it.each(['', ' \n '])('row 43: %j — empty text, 0 bytes', input => {
    expect(bytes(input)).toHaveLength(0);
    expect(decode(input)).toEqual({ text: '', firstInvalidByte: null, bom: false, controlCount: 0, c1Count: 0 });
  });
});

describe('§2 scenarios and §6 texts, word for word', () => {
  it('§2.1: a log line — Hello, world, 12 bytes', () => {
    const b = bytes('48656c6c6f2c20776f726c64');
    expect(bytesToText(b, 'utf-8').text).toBe('Hello, world');
    expect(bytesLabel(b.length)).toBe('12 bytes');
  });
  it('§2.3: é€😀 in UTF-8 is 9 bytes', () => expect(bytesLabel(enc('é€😀').length)).toBe('9 bytes'));
  it('§2.4: e9 in UTF-8 is U+FFFD and the note; ISO-8859-1 reads é', () => {
    const r = decode('e9');
    expect(invalidNote('utf-8', r.firstInvalidByte!)).toBe(
      'Not valid UTF-8 from byte 1: invalid bytes are shown as U+FFFD. ISO-8859-1 shows every byte as one character.',
    );
  });
  it('§2.6: a typo — Line 1, column 5', () =>
    expect(parseError('48 6g')).toEqual({ message: '"g" is not a hex digit', offset: 4, line: 1, column: 5 }));
  it('§2.7, §6: control characters — the note', () => {
    const r = decode('00 07 0d 0a 41');
    expect(showControls(r.text)).toBe('␀␇␍\nA');
    expect(r.controlCount).toBe(3);
    expect(controlsNote(r.controlCount, r.c1Count)).toBe(
      'Contains 3 control characters, shown as symbols. Copy copies the real characters.',
    );
  });
  it('§6: the byte count', () => {
    expect(bytesLabel(0)).toBe('0 bytes');
    expect(bytesLabel(1)).toBe('1 byte');
    expect(bytesLabel(1_269_328)).toBe('1,269,328 bytes');
  });
  it('§6: spaces only — 20 a space in Text to hex, nothing in Hex to text', () => {
    expect(hex('   ')).toBe('202020');
    expect(bytes('  \n\t \n')).toHaveLength(0);
  });
  it('§6: the notes and refusals', () => {
    expect(SURROGATES_NOTE).toBe('Unpaired surrogates were replaced with U+FFFD (ef bf bd).');
    expect(BOM_NOTE).toBe('Starts with a byte order mark (U+FEFF).');
    expect(invalidNote('utf-16le', 3)).toBe(
      'Not valid UTF-16 from byte 3 (an unpaired surrogate or an odd last byte): shown as U+FFFD.',
    );
    expect(TEXT_TOO_LARGE).toBe('Text is larger than 1 MB. Text to hex works with up to 1 MB.');
    expect(HEX_TOO_LARGE).toBe('Input is larger than 5 MB. Hex to text works with up to 5 MB.');
  });
  it('§6: C1 control characters stay invisible, and the note says so (§15)', () => {
    const r = decode('80 9f', 'iso-8859-1');
    expect(showControls(r.text)).toBe('\u0080\u009f');
    expect(controlsNote(r.controlCount, r.c1Count)).toBe(
      'Contains 2 control characters (C1, U+0080–U+009F): they have no symbols and stay invisible. Copy copies the real characters.',
    );
    expect(controlsNote(1)).toBe('Contains 1 control character, shown as a symbol. Copy copies the real characters.');
    expect(controlsNote(3, 1)).toBe(
      'Contains 3 control characters, shown as symbols; C1 (U+0080–U+009F) has no symbols and stays invisible. Copy copies the real characters.',
    );
  });
  it('§6: errors on later lines are placed by line and column', () => {
    expect(parseError('48 65\n6c 6x')).toMatchObject({ message: '"x" is not a hex digit', line: 2, column: 5 });
    expect(textToBytes('ok\n€', 'iso-8859-1')).toMatchObject({ ok: false, error: { line: 2, column: 1 } });
  });
});

describe('§5 rules §10 does not hold', () => {
  it('§5 «Hex → байты» 5: an invisible character is named by its code point; others by themselves', () => {
    expect(parseError('48\u200b65').message).toBe('U+200B is not a hex digit');
    expect(parseError('48\u0000').message).toBe('U+0000 is not a hex digit');
    expect(parseError('48\u0085').message).toBe('U+0085 is not a hex digit');
    expect(parseError('48😀').message).toBe('"😀" is not a hex digit');
    expect(parseError('48 0x6g').message).toBe('"g" is not a hex digit');
    expect(parseError('48h').message).toBe('"h" is not a hex digit');
    expect(parseError('0o17').message).toBe('"o" is not a hex digit');
  });
  it('§5 2: every separator divides; brackets of any kind are skipped', () => {
    expect(bytesToHex(bytes('[48;65](6c){6c}-6f'))).toBe('48656c6c6f');
    expect(bytesToHex(bytes('\u2028 48\u3000 65\ufeff'))).toBe('4865');
  });
  it('§5 3–4: 0X, \\X, mixed case, \\x with more pairs, an odd 0x chunk', () => {
    expect(bytesToHex(bytes('0X4F \\X4f\\x4F4f'))).toBe('4f4f4f4f');
    expect(parseError('48 0x486').message).toBe('odd number of hex digits in "0x486"');
    expect(parseError('\\x48\\x6').message).toBe('odd number of hex digits in "\\x6"');
    expect(parseError('\\x48\\x6').offset).toBe(4);
    expect(parseError('\\x48\\').message).toBe('"\\" is not a hex digit');
    expect(parseError('\\x48\\y').message).toBe('"\\" is not a hex digit');
  });
  it('§5 4: a character error inside a chunk wins over its odd count (scenario §2.6)', () =>
    expect(parseError('486g').message).toBe('"g" is not a hex digit'));
  it('§5 1: a dump is recognised on the first non-empty line, after blank lines and indentation', () => {
    expect(parseError('\n  \n  00000010: 4865  He')).toMatchObject({ message: DUMP_MESSAGE, line: 3, column: 3 });
    // hexdump -C needs its `|` on the same line; a later line does not make the first one a dump.
    expect(bytes('00000000  48\n65|'.slice(0, -1))).toHaveLength(6);
    expect(parseError('00000000  48\n|').message).toBe('"|" is not a hex digit');
  });
  it('§5 «Байты → текст»: UTF-16 BOM and odd bytes, BE', () => {
    expect(decode('feff0041', 'utf-16be')).toMatchObject({ text: '\uFEFFA', bom: true });
    expect(decode('0041dc00', 'utf-16be')).toMatchObject({ text: 'A\uFFFD', firstInvalidByte: 3 });
    expect(decode('d83d0041', 'utf-16be')).toMatchObject({ text: '\uFFFDA', firstInvalidByte: 1 });
    expect(decode('d83d', 'utf-16be')).toMatchObject({ text: '\uFFFD', firstInvalidByte: 1 });
  });
  it('§5 «Байты → текст»: ISO-8859-1 has no BOM — ef bb bf is three characters', () =>
    expect(decode('efbbbf', 'iso-8859-1')).toMatchObject({ text: 'ï»¿', bom: false }));
  it('§5 «Текст → байты»: UTF-16 writes no BOM and keeps a lone surrogate', () => {
    expect(hex('A', {}, 'utf-16be')).toBe('0041');
    expect(hex('\uDC00x', {}, 'utf-16be')).toBe('dc000078');
  });
  it('§5 «Байты → hex»: the prefix stays lowercase under Uppercase; wrapping', () => {
    expect(hex('O', { format: 'c', uppercase: true })).toBe('0x4F');
    expect(hex('O', { format: 'escaped', uppercase: true })).toBe('\\x4F');
    expect(hex('a'.repeat(9), { format: 'colons', bytesPerLine: 8 })).toBe('61:61:61:61:61:61:61:61\n61');
    expect(hex('a'.repeat(9), { format: 'commas', bytesPerLine: 8 })).toBe('61, 61, 61, 61, 61, 61, 61, 61,\n61');
    expect(hex('a'.repeat(9), { format: 'escaped', bytesPerLine: 8 })).toBe(`${'\\x61'.repeat(8)}\n\\x61`);
    expect(hex('a'.repeat(9), { format: 'plain', bytesPerLine: 8 })).toBe(`${'61'.repeat(8)}\n61`);
  });
  it('§5 Dump: one full line, the text column shows bytes, not characters; nothing for no bytes', () => {
    expect(hexDump(enc('0123456789abcdef'))).toBe(
      '00000000  30 31 32 33 34 35 36 37  38 39 61 62 63 64 65 66  |0123456789abcdef|',
    );
    expect(hexDump(enc('é'))).toBe(`00000000  c3 a9${' '.repeat(45)}|..|`);
    expect(hexDump(new Uint8Array(0))).toBe('');
    expect(hexDump(new Uint8Array(17).fill(0xab), { uppercase: true }).split('\n')[1]).toBe(
      `00000010  AB${' '.repeat(48)}|.|`,
    );
  });
  it('§5 Dump is output only: Hex to text refuses the tool’s own dump', () =>
    expect(parseError(hexDump(enc('Hello, World!'))).message).toBe(DUMP_MESSAGE));
  it('§5: the WHATWG UTF-8 table — boundaries of every lead byte', () => {
    const cases: Array<[number[], number | null]> = [
      [[0x7f], null],
      [[0xc2, 0x80], null],
      [[0xc1, 0xbf], 1],
      [[0xe0, 0xa0, 0x80], null],
      [[0xe0, 0x9f, 0x80], 1],
      [[0xed, 0x9f, 0xbf], null],
      [[0xf0, 0x90, 0x80, 0x80], null],
      [[0xf0, 0x8f, 0x80, 0x80], 1],
      [[0xf4, 0x8f, 0xbf, 0xbf], null],
      [[0xf4, 0x90, 0x80, 0x80], 1],
      [[0xf5, 0x80], 1],
      [[0x41, 0x80], 2],
      [[0x41, 0xe2, 0x82], 2],
    ];
    for (const [b, first] of cases) expect(firstInvalidUtf8(new Uint8Array(b)), b.join(' ')).toBe(first);
  });
});

describe('§7 detectHex', () => {
  it.each(['48656c6c6f', '48656c6c', '48 65 6c 6c 6f 20 57', '4a534f4e', '7b2261223a317d'])('%s — yes', t =>
    expect(detectHex(t)).toBe(true),
  );
  it.each([
    'deadbeef',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'ff',
    'cafe',
    '1234',
    '12345678',
    '0x1F',
    'SGVsbG8=',
  ])('%s — no', t => expect(detectHex(t)).toBe(false));
  it('the other forms of rule 2: 0x on each pair or on the whole run, colons, \\x entries; edges trimmed', () => {
    expect(detectHex('0x48, 0x65, 0x6c, 0x6c, 0x6f')).toBe(true);
    expect(detectHex('0x48656c6c6f')).toBe(true);
    expect(detectHex('48:65:6c:6c:6f')).toBe(true);
    expect(detectHex('\\x48\\x65\\x6c\\x6c\\x6f')).toBe(true);
    expect(detectHex('  48656c6c6f\n')).toBe(true);
    expect(detectHex('48-65;6c\n6c\t6f')).toBe(true);
  });
  it('strict: no brackets, no separator at the ends, no split pair, no other character, no dump', () => {
    expect(detectHex('{0x48, 0x65, 0x6c, 0x6c, 0x6f}')).toBe(false);
    expect(detectHex('48, 65, 6c, 6c, 6f,')).toBe(false);
    expect(detectHex('4 865 6c6c6f')).toBe(false);
    expect(detectHex('48656c6c6g')).toBe(false);
    expect(detectHex('00000000: 4865 6c6c 6f0a  Hello.')).toBe(false);
    expect(detectHex('550e8400e29b41d4a716446655440000')).toBe(false); // a UUID without hyphens
    expect(detectHex('48656c6c6f00')).toBe(false); // NUL
    expect(detectHex('3132333435')).toBe(false); // digits only: no letter
  });
  it('rule 1: up to 65,536 characters after trimming', () => {
    expect(detectHex('41'.repeat(32_768))).toBe(true);
    expect(detectHex(`${'41'.repeat(32_768)}41`)).toBe(false);
    expect(detectHex(`  ${'41'.repeat(32_768)}  `)).toBe(true);
  });
});

/** A small deterministic generator for the property tests (a tool takes randomness only from tools-shared). */
const lcg = (seed: number) => () => {
  seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
  return seed / 2 ** 32;
};

describe('round trips (properties)', () => {
  const FORMATS: HexFormat[] = ['plain', 'spaced', 'colons', 'commas', 'c', 'escaped'];
  const WIDTHS: Array<HexOptions['bytesPerLine']> = [0, 8, 16, 32];

  it('any bytes → hex in every format, case and width → the same bytes', () => {
    const random = lcg(19);
    for (let run = 0; run < 60; run++) {
      const b = new Uint8Array(Math.floor(random() * 80));
      for (let i = 0; i < b.length; i++) b[i] = Math.floor(random() * 256);
      for (const format of FORMATS)
        for (const uppercase of [false, true])
          for (const bytesPerLine of WIDTHS) {
            const text = bytesToHex(b, { format, uppercase, bytesPerLine });
            expect(bytes(text), `${format} ${uppercase} ${bytesPerLine}: ${text}`).toEqual(b);
          }
    }
  });

  it('every byte value, in every format', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const format of FORMATS) expect(bytes(bytesToHex(all, { format, uppercase: true }))).toEqual(all);
  });

  const randomText = (random: () => number, maxCodePoint: number, length: number): string => {
    const cps: number[] = [];
    while (cps.length < length) {
      const pick = random();
      const cp =
        pick < 0.4
          ? 0x20 + Math.floor(random() * 0x5f)
          : pick < 0.5
            ? Math.floor(random() * 0x20)
            : Math.floor(random() * (maxCodePoint + 1));
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // well-formed text only
      cps.push(cp);
    }
    return String.fromCodePoint(...cps);
  };

  it('any text → hex (every format) → text is the same, in each encoding that can hold it', () => {
    const random = lcg(42);
    const encodings: Array<[TextEncodingId, number]> = [
      ['utf-8', 0x10ffff],
      ['utf-16le', 0x10ffff],
      ['utf-16be', 0x10ffff],
      ['iso-8859-1', 0xff],
    ];
    for (let run = 0; run < 40; run++)
      for (const [encoding, max] of encodings) {
        const text = randomText(random, max, Math.floor(random() * 60));
        for (const format of FORMATS) {
          const shown = bytesToHex(enc(text, encoding), { format, bytesPerLine: 16 });
          const back = bytesToText(bytes(shown), encoding);
          expect(back.text, `${encoding} ${format}`).toBe(text);
          expect(back.firstInvalidByte).toBeNull();
        }
      }
  });

  it('a byte order mark survives the round trip in UTF-8 and UTF-16', () => {
    for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const)
      expect(bytesToText(enc('\uFEFFhi', encoding), encoding).text).toBe('\uFEFFhi');
  });
});

// hexDump before the byte table, kept as the oracle: the new one must give the same text for every input.
const ORACLE_DIGITS = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));
const ORACLE_DIGITS_UPPER = ORACLE_DIGITS.map(d => d.toUpperCase());
const ORACLE_SHOWN = Array.from({ length: 256 }, (_, b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'));
const oracleDump = (bytes: Uint8Array, options: { uppercase?: boolean } = {}): string => {
  const digits = options.uppercase ? ORACLE_DIGITS_UPPER : ORACLE_DIGITS;
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const end = Math.min(offset + 16, bytes.length);
    let hex = '';
    let shown = '';
    for (let i = offset; i < offset + 16; i++) {
      if (i < end) {
        hex += `${digits[bytes[i]!]} `;
        shown += ORACLE_SHOWN[bytes[i]!];
      } else hex += '   ';
      if (i === offset + 7) hex += ' ';
    }
    const at = offset.toString(16).padStart(8, '0');
    lines.push(`${options.uppercase ? at.toUpperCase() : at}  ${hex} |${shown}|`);
  }
  return lines.join('\n');
};

describe('hexDump by table: the same text as before (properties)', () => {
  it('10,000 random arrays of every length up to 100 bytes, views included, both cases', () => {
    const random = lcg(7);
    for (let run = 0; run < 10_000; run++) {
      const length = run % 101;
      const whole = Uint8Array.from({ length: length + 3 }, () => Math.floor(random() * 256));
      const b = run % 2 === 0 ? whole.subarray(2, length + 2) : whole.slice(0, length);
      const uppercase = run % 3 === 0;
      const actual = hexDump(b, { uppercase });
      if (actual !== oracleDump(b, { uppercase }))
        expect({ b: [...b], uppercase, actual }).toEqual({
          b: [...b],
          uppercase,
          actual: oracleDump(b, { uppercase }),
        });
    }
  });

  it('a megabyte of every byte value: offsets with letters, both cases', () => {
    const b = Uint8Array.from({ length: (1 << 20) + 5 }, (_, i) => (i * 131) & 255);
    for (const uppercase of [false, true])
      expect(hexDump(b, { uppercase }) === oracleDump(b, { uppercase })).toBe(true);
  });
});

describe('§12 and long input: linear time, bounded expressions', () => {
  const timed = (fn: () => unknown): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  it('the dump check and the reader on 300,000 characters of the worst kinds', () => {
    // One line that starts like a hexdump -C line and has no `|`; one like xxd's that never gets its ": ".
    const almostDump = `00000000  48${' 4'.repeat(149_994)}`;
    const almostXxd = `00000000${'0'.repeat(299_992)}`;
    const oddLong = '4'.repeat(299_999);
    const separators = ' ,'.repeat(150_000);
    const escapes = '\\x41'.repeat(75_000);
    for (const input of [almostDump, almostXxd, oddLong, separators, escapes]) {
      expect(input.length).toBeGreaterThanOrEqual(299_990);
      expect(timed(() => parseHex(input))).toBeLessThan(500);
    }
    expect(parseError(almostDump).message).toBe('odd number of hex digits in "4"');
    expect(parseError(oddLong).message).toBe(`odd number of hex digits in "${oddLong}"`);
    expect(bytes(escapes)).toHaveLength(75_000);
  });

  it('detectHex on 300,000 characters answers at once (the length is checked first)', () => {
    for (const input of ['41'.repeat(150_000), `${'41 '.repeat(100_000)}`, '\\x41'.repeat(75_000)])
      expect(timed(() => expect(detectHex(input)).toBe(false))).toBeLessThan(50);
    // At the limit the shape, the reader and the decoder run once each.
    expect(timed(() => expect(detectHex(`${'41 '.repeat(21_844)}41`)).toBe(true))).toBeLessThan(500);
  });

  it('the worst megabyte of each step stays well inside the page’s budget', () => {
    const text = 'Привет, 😀 '.repeat(95_326).slice(0, 1024 * 1024);
    let shown = '';
    expect(timed(() => (shown = bytesToHex(enc(text), { format: 'spaced' })))).toBeLessThan(1500);
    expect(shown.length).toBeGreaterThan(3 * 1024 * 1024 - 1);
    expect(timed(() => formatBytes(enc(text), { format: 'dump', uppercase: false, bytesPerLine: 0 }))).toBeLessThan(
      1500,
    );
    const input = shown.slice(0, 5 * 1024 * 1024);
    let back: Uint8Array = new Uint8Array();
    expect(timed(() => (back = bytes(input)))).toBeLessThan(1500);
    expect(timed(() => bytesToText(back, 'utf-8'))).toBeLessThan(1500);
    const controls = '\u0001'.repeat(1024 * 1024);
    expect(timed(() => showControls(controls))).toBeLessThan(1500);
  });
});
