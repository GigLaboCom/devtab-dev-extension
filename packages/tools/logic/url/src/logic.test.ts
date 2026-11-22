import {
  decodeUrl,
  detectedMode,
  detectUrl,
  encodeUrl,
  isBlankUrl,
  NOT_ABSOLUTE,
  NOT_VALID,
  paramsToJson,
  parseUrl,
} from './index';
import { describe, expect, it } from 'vitest';
import type { EncodeStyle, ParseResult, PartKey, UrlPart } from './index';

// docs/tools/specs/url.md §10, one test per row (the row's input in the test name), then what §5–§7 state that §10
// does not show.

const STYLES: EncodeStyle[] = ['component', 'form', 'whole'];

const parsed = (input: string) => {
  const r: ParseResult = parseUrl(input);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(input)} to parse, got: ${r.message}`);
  const part = (key: PartKey): UrlPart => r.parts.find(p => p.key === key)!;
  const value = (key: PartKey): string => part(key).value;
  const pairs = r.params.map(p => `${p.name}=${p.value}`);
  return { ...r, part, value, pairs };
};

describe('§10 encodeUrl', () => {
  it('row 1: "" — every style gives ""', () => {
    for (const style of STYLES) expect(encodeUrl('', style)).toBe('');
  });
  it('row 2: three spaces — %20%20%20 / +++', () => {
    expect(encodeUrl('   ', 'component')).toBe('%20%20%20');
    expect(encodeUrl('   ', 'form')).toBe('+++');
  });
  it('row 3: "hello world" — hello%20world / hello+world / hello%20world', () => {
    expect(encodeUrl('hello world', 'component')).toBe('hello%20world');
    expect(encodeUrl('hello world', 'form')).toBe('hello+world');
    expect(encodeUrl('hello world', 'whole')).toBe('hello%20world');
  });
  it('row 4: "a+b=c&d" — a%2Bb%3Dc%26d / a%2Bb%3Dc%26d / a+b=c&d', () => {
    expect(encodeUrl('a+b=c&d', 'component')).toBe('a%2Bb%3Dc%26d');
    expect(encodeUrl('a+b=c&d', 'form')).toBe('a%2Bb%3Dc%26d');
    expect(encodeUrl('a+b=c&d', 'whole')).toBe('a+b=c&d');
  });
  it('row 5: "!\'()*~" Component — %21%27%28%29%2A~ (stricter than encodeURIComponent)', () => {
    expect(encodeUrl("!'()*~", 'component')).toBe('%21%27%28%29%2A~');
    expect(encodeURIComponent("!'()*~")).toBe("!'()*~");
  });
  it('row 6: "!\'()*~" Form — %21%27%28%29*%7E, as URLSearchParams', () => {
    expect(encodeUrl("!'()*~", 'form')).toBe('%21%27%28%29*%7E');
    expect(new URLSearchParams({ x: "!'()*~" }).toString()).toBe('x=%21%27%28%29*%7E');
  });
  it('row 7: "~user" Component — ~user', () => {
    expect(encodeUrl('~user', 'component')).toBe('~user');
  });
  it('row 8: "Привет" — the same in every style', () => {
    for (const style of STYLES) expect(encodeUrl('Привет', style)).toBe('%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82');
  });
  it('row 9: "😀" — four bytes, one code point', () => {
    for (const style of STYLES) expect(encodeUrl('😀', style)).toBe('%F0%9F%98%80');
  });
  it('row 10: a lone surrogate — %EF%BF%BD where the built-ins throw', () => {
    for (const style of STYLES) expect(encodeUrl('\uD800', style)).toBe('%EF%BF%BD');
    expect(() => encodeURIComponent('\uD800')).toThrow(URIError);
    expect(() => encodeURI('\uD800')).toThrow(URIError);
  });
  it('row 11: "name@example.com" — name%40example.com / name@example.com', () => {
    expect(encodeUrl('name@example.com', 'component')).toBe('name%40example.com');
    expect(encodeUrl('name@example.com', 'whole')).toBe('name@example.com');
  });
  it('row 12: "100%25" — 100%2525 / 100%25 (encodeURI: 100%2525)', () => {
    expect(encodeUrl('100%25', 'component')).toBe('100%2525');
    expect(encodeUrl('100%25', 'whole')).toBe('100%25');
    expect(encodeURI('100%25')).toBe('100%2525');
  });
  it('row 13: "50%25 off 100%" Whole URL — 50%25%20off%20100%25', () => {
    expect(encodeUrl('50%25 off 100%', 'whole')).toBe('50%25%20off%20100%25');
  });
  it('row 14: "http://[::1]:3000/a b" Whole URL — brackets stay (encodeURI escapes them)', () => {
    expect(encodeUrl('http://[::1]:3000/a b', 'whole')).toBe('http://[::1]:3000/a%20b');
    expect(encodeURI('http://[::1]:3000/a b')).toBe('http://%5B::1%5D:3000/a%20b');
  });
  it('row 15: a whole URL with spaces, ü and an escape — only what must be is escaped', () => {
    expect(encodeUrl('https://example.com/a b/ü?q=1 2&x=%20y#frag ment', 'whole')).toBe(
      'https://example.com/a%20b/%C3%BC?q=1%202&x=%20y#frag%20ment',
    );
  });
  it('row 16: "a b\\nc" Form — a+b%0Ac', () => {
    expect(encodeUrl('a b\nc', 'form')).toBe('a+b%0Ac');
  });
});

// encodeUrl before the byte array, kept as the oracle: the new one must give the same text for every input.
const ORACLE_HEX = '0123456789ABCDEF';
const ORACLE_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ORACLE_KEPT: Record<EncodeStyle, string> = {
  component: `${ORACLE_ALNUM}-._~`,
  form: `${ORACLE_ALNUM}*-._`,
  whole: `${ORACLE_ALNUM}-_.!~*'();/?:@&=+$,#[]`,
};
const ORACLE_TABLES = Object.fromEntries(
  STYLES.map(style => {
    const table: string[] = [];
    for (let b = 0; b < 256; b++)
      table.push(
        ORACLE_KEPT[style].includes(String.fromCharCode(b))
          ? String.fromCharCode(b)
          : `%${ORACLE_HEX[b >> 4]}${ORACLE_HEX[b & 15]}`,
      );
    if (style === 'form') table[0x20] = '+';
    return [style, table];
  }),
) as Record<EncodeStyle, string[]>;
const oracleIsHex = (b: number | undefined): boolean =>
  b !== undefined && ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66));
const oracleEncode = (text: string, style: EncodeStyle): string => {
  const bytes = new TextEncoder().encode(text);
  const table = ORACLE_TABLES[style];
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (style === 'whole' && b === 0x25 && oracleIsHex(bytes[i + 1]) && oracleIsHex(bytes[i + 2])) out += '%';
    else out += table[b];
  }
  return out;
};

describe('encodeUrl in one byte array: the same text as before (properties)', () => {
  it('20,000 random texts — every ASCII character, escapes and broken escapes, any code point, lone surrogates', () => {
    let x = 0x1234567;
    const next = (n: number) => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) % n;
    };
    const pieces = [
      '%',
      '%2',
      '%25',
      '%zz',
      '%aF',
      '%%41',
      '+',
      ' ',
      '\n',
      '\uD800',
      '\uDC00',
      '😀',
      'é',
      'Привет',
      '#',
      '[',
      ']',
    ];
    for (let run = 0; run < 20_000; run++) {
      let text = '';
      const length = next(40);
      for (let k = 0; k < length; k++) {
        const kind = next(4);
        text +=
          kind === 0
            ? String.fromCharCode(next(128))
            : kind === 1
              ? pieces[next(pieces.length)]
              : kind === 2
                ? String.fromCharCode(next(0x10000))
                : String.fromCodePoint(next(0x110000));
      }
      for (const style of STYLES) {
        const actual = encodeUrl(text, style);
        const expected = oracleEncode(text, style);
        if (actual !== expected) expect({ text, style, actual }).toEqual({ text, style, actual: expected });
      }
    }
  });

  it('every byte value, alone and next to an escape, in every style', () => {
    for (let c = 0; c < 0x800; c++)
      for (const style of STYLES)
        for (const text of [String.fromCharCode(c), `%4${String.fromCharCode(c)}`, `${String.fromCharCode(c)}%41`])
          expect(encodeUrl(text, style)).toBe(oracleEncode(text, style));
  });
});

describe('§10 decodeUrl', () => {
  const plain = { plusAsSpace: false };
  it('row 17: "hello%20world" — hello world', () => {
    expect(decodeUrl('hello%20world', plain)).toEqual({ text: 'hello world', malformed: 0, invalidUtf8: false });
    expect(decodeURIComponent('hello%20world')).toBe('hello world');
  });
  it('row 18: "a+b%2Bc" — a+b+c / with + as space a b+c', () => {
    expect(decodeUrl('a+b%2Bc', plain).text).toBe('a+b+c');
    expect(decodeUrl('a+b%2Bc', { plusAsSpace: true }).text).toBe('a b+c');
  });
  it('row 19: Cyrillic escapes — Привет', () => {
    expect(decodeUrl('%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82', plain).text).toBe('Привет');
  });
  it('row 20: "%c3%A9" — é, the case of hex does not matter', () => {
    expect(decodeUrl('%c3%A9', plain).text).toBe('é');
  });
  it('row 21: "%2541" — %41, one pass', () => {
    expect(decodeUrl('%2541', plain).text).toBe('%41');
  });
  it('row 22: "100%" — 100%, malformed 1 (decodeURIComponent throws)', () => {
    expect(decodeUrl('100%', plain)).toEqual({ text: '100%', malformed: 1, invalidUtf8: false });
    expect(() => decodeURIComponent('100%')).toThrow(URIError);
  });
  it('row 23: "%zz%4" — %zz%4, malformed 2', () => {
    expect(decodeUrl('%zz%4', plain)).toEqual({ text: '%zz%4', malformed: 2, invalidUtf8: false });
  });
  it('row 24: "%E9t%E9" (Latin-1) — \\uFFFDt\\uFFFD, invalid UTF-8', () => {
    expect(decodeUrl('%E9t%E9', plain)).toEqual({ text: '\uFFFDt\uFFFD', malformed: 0, invalidUtf8: true });
  });
  it('row 25: "%EF%BB%BFa" — the BOM is kept, as URLSearchParams keeps it', () => {
    expect(decodeUrl('%EF%BB%BFa', plain).text).toBe('\uFEFFa');
    expect(new URLSearchParams('x=%EF%BB%BFa').get('x')).toBe('\uFEFFa');
  });
});

describe('§10 parseUrl', () => {
  it('row 26: credentials, an international domain, dot segments, repeated, empty and bare parameters', () => {
    const r = parsed('https://user:p%40ss@例え.jp:8080/a/../b/./c%20d?q=1&q=2&x=a+b&empty=&flag#top');
    expect(r.href).toBe('https://user:p%40ss@xn--r8jz45g.jp:8080/b/c%20d?q=1&q=2&x=a+b&empty=&flag#top');
    expect(r.value('hostname')).toBe('xn--r8jz45g.jp');
    expect(r.part('port')).toEqual({ key: 'port', value: '8080' });
    expect(r.part('password')).toEqual({ key: 'password', value: 'p%40ss', decoded: 'p@ss' });
    expect(r.part('username')).toEqual({ key: 'username', value: 'user' });
    expect(r.part('pathname')).toEqual({ key: 'pathname', value: '/b/c%20d', decoded: '/b/c d' });
    expect(r.part('hash')).toEqual({ key: 'hash', value: '#top' });
    expect(r.pairs).toEqual(['q=1', 'q=2', 'x=a b', 'empty=', 'flag=']);
    expect(r.removedWhitespace).toBe(false);
  });
  it('row 27: "HTTPS://EXAMPLE.COM:443/Path?A=1" — lower-cased, the default port dropped and shown as default', () => {
    const r = parsed('HTTPS://EXAMPLE.COM:443/Path?A=1');
    expect(r.href).toBe('https://example.com/Path?A=1');
    expect(r.part('port')).toEqual({ key: 'port', value: '443', isDefault: true });
  });
  it('row 28: "https://example.com" — path /, no parameters', () => {
    const r = parsed('https://example.com');
    expect(r.href).toBe('https://example.com/');
    expect(r.value('pathname')).toBe('/');
    expect(r.params).toEqual([]);
  });
  it('row 29: a postgres connection string — origin null, the port not a default', () => {
    const r = parsed('postgres://admin:secret@db.internal:5432/app?sslmode=require');
    expect(r.value('origin')).toBe('null');
    expect(r.value('hostname')).toBe('db.internal');
    expect(r.part('port')).toEqual({ key: 'port', value: '5432' });
    expect(r.pairs).toEqual(['sslmode=require']);
    // §2 scenario 5 as well.
    expect([r.value('username'), r.value('password'), r.value('pathname')]).toEqual(['admin', 'secret', '/app']);
  });
  it('row 30: "mailto:dev@example.com?subject=Hi%20there" — no host, the address is the path', () => {
    const r = parsed('mailto:dev@example.com?subject=Hi%20there');
    expect(r.value('hostname')).toBe('');
    expect(r.value('pathname')).toBe('dev@example.com');
    expect(r.pairs).toEqual(['subject=Hi there']);
    expect(r.part('port')).toEqual({ key: 'port', value: '' });
  });
  it('row 31: "http://[::1]:3000/" — the IPv6 host in brackets', () => {
    const r = parsed('http://[::1]:3000/');
    expect(r.value('hostname')).toBe('[::1]');
    expect(r.value('port')).toBe('3000');
    expect(r.value('origin')).toBe('http://[::1]:3000');
  });
  it('row 32: "http://münchen.de/" — Punycode, port 80 by default', () => {
    const r = parsed('http://münchen.de/');
    expect(r.value('hostname')).toBe('xn--mnchen-3ya.de');
    expect(r.part('port')).toEqual({ key: 'port', value: '80', isDefault: true });
  });
  it('row 33: spaces at the edges, a newline and a tab inside — removed, and said so', () => {
    const r = parsed(' https://example.com/a\n/b?x=\t1 ');
    expect(r.href).toBe('https://example.com/a/b?x=1');
    expect(r.removedWhitespace).toBe(true);
  });
  it('row 34: "https:\\\\example.com\\a\\b" — backslashes become slashes', () => {
    expect(parsed('https:\\\\example.com\\a\\b').href).toBe('https://example.com/a/b');
  });
  it('row 35: "https://example.com/%7e%2f" — the parser keeps the case of escapes', () => {
    expect(parsed('https://example.com/%7e%2f').part('pathname')).toEqual({
      key: 'pathname',
      value: '/%7e%2f',
      decoded: '/~/',
    });
  });
  it('row 36: "?a=1&a=2&b" — JSON: an array for a repeated name, "" for a bare one', () => {
    expect(paramsToJson(parsed('https://example.com/?a=1&a=2&b').params)).toBe(
      '{\n  "a": [\n    "1",\n    "2"\n  ],\n  "b": ""\n}',
    );
  });
  it('row 37: "?__proto__=x&constructor=y" — JSON: ordinary keys', () => {
    expect(paramsToJson(parsed('https://example.com/?__proto__=x&constructor=y').params)).toBe(
      '{\n  "__proto__": "x",\n  "constructor": "y"\n}',
    );
  });
  it('row 38: "+", an escaped euro, a malformed escape, an empty name, an empty value', () => {
    expect(parsed('https://example.com/?q=a+b%2Bc&e=%E2%82%AC&bad=%zz&=v&k=').pairs).toEqual([
      'q=a b+c',
      'e=€',
      'bad=%zz',
      '=v',
      'k=',
    ]);
  });
  it('row 39: "?&&a=1&" — empty pieces are skipped: one pair', () => {
    expect(parsed('https://example.com/?&&a=1&').pairs).toEqual(['a=1']);
  });
  it('row 40: "example.com/path", "/relative/path" — not absolute', () => {
    for (const input of ['example.com/path', '/relative/path'])
      expect(parseUrl(input)).toEqual({ ok: false, message: NOT_ABSOLUTE });
    expect(NOT_ABSOLUTE).toBe('Not an absolute URL: add a scheme such as https://');
  });
  it('row 41: a space in the host, no host, an empty host with a port, a port too big, an unclosed IPv6 — not valid', () => {
    for (const input of [
      'https://exa mple.com/',
      'https://',
      'http://:80/',
      'https://example.com:99999/',
      'https://[::1/',
    ])
      expect(parseUrl(input), input).toEqual({ ok: false, message: NOT_VALID });
    expect(NOT_VALID).toBe('Not a valid URL.');
  });
  it('row 42: "javascript:alert(1)" — parsed, nothing runs', () => {
    const r = parsed('javascript:alert(1)');
    expect([r.value('protocol'), r.value('pathname'), r.value('origin')]).toEqual(['javascript:', 'alert(1)', 'null']);
  });
});

describe('§7 detectUrl (the table, row by row)', () => {
  it.each([
    'https://example.com/path?q=1',
    'http://localhost:3000',
    'ftp://files.example.com/x',
    'postgres://u:p@db:5432/x',
    'hello%20world',
    'a%2Fb%3Fc',
  ])('yes: %s', text => expect(detectUrl(text)).toBe(true));
  it.each([
    'mailto:dev@example.com',
    '50% off',
    'example.com/path',
    'C:\\Users\\me',
    '%E9t%E9',
    'https://exa mple.com',
    'http://',
    '{"a":"%20"}',
    '["a%20b"]',
    'data:image/png;base64,iVBORw0KGgo',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    'SGVsbG8sIFdvcmxkIQ==',
  ])('no: %s', text => expect(detectUrl(text)).toBe(false));
});

describe('§7 detectUrl beyond the table', () => {
  it('trims the edges, refuses whitespace inside, empty text, more than 65,536 characters and data: in any case', () => {
    expect(detectUrl('  https://example.com/\n')).toBe(true);
    expect(detectUrl('')).toBe(false);
    expect(detectUrl('   ')).toBe(false);
    expect(detectUrl('https://example.com/a\tb')).toBe(false);
    expect(detectUrl('a%20b\u00A0c')).toBe(false);
    const long = `https://example.com/?q=${'a'.repeat(65536 - 23)}`;
    expect(long.length).toBe(65536);
    expect(detectUrl(long)).toBe(true);
    expect(detectUrl(`${long}a`)).toBe(false);
    expect(detectUrl('DATA:text/plain,a%20b')).toBe(false);
  });
  it('rule 2 applies when rule 1 does not: scheme and slashes the parser refuses, but valid escapes', () => {
    expect(detectedMode('https://exa%20mple.com')).toBe('decode');
    expect(detectedMode('https://example.com/a%20b')).toBe('parse');
    expect(detectedMode('a%2Fb')).toBe('decode');
    expect(detectedMode('plain')).toBeUndefined();
  });
  // The other tools' inputs (their specifications' §7 and §10): none of them is a URL or encoded text.
  it.each([
    ['json', '{"name": "example", "tags": ["a", "b"]}'],
    ['json', '[1,2,3]'],
    ['base64', 'SGVsbG8gd29ybGQ='],
    ['base64', 'aGVsbG8_d29ybGQ-'],
    [
      'jwt',
      // The widely published documentation sample, not a credential — the secret scanner is told so.
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', // gitleaks:allow
    ],
    ['unix-time', '1700000000'],
    ['unix-time', '2023-11-14T22:13:20Z'],
    ['uuid', '550e8400-e29b-41d4-a716-446655440000'],
    ['uuid', '01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['hash', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['regexp', '/^[a-z]+%?$/gi'],
    ['yaml-json', 'key: value'],
    ['cron', '*/5 * * * *'],
    ['color', '#ff8800'],
    ['color', 'hsl(120,50%,50%)'],
    ['color', 'rgb(10%,20%,30%)'],
    ['color', 'oklch(70%25 0.1 200)'],
    ['number-base', '0xff'],
    ['html-entities', '&lt;div&gt;&amp;&#x41;'],
    ['backslash-escape', 'a\\nb\\u0041\\x41'],
    ['hex-ascii', '48 65 6c 6c 6f'],
    ['hex-ascii', '48656c6c6f'],
    ['x509', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'],
    [
      'base64-image',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk%2BA8AAQUBAScY42YAAAAASUVORK5CYII=',
    ],
    ['curl-to-code', "curl -H 'Authorization: Bearer x' https://api.example.com/v1/items"],
    ['html-to-jsx', '<div class="a" style="width:50%">x</div>'],
    ['svg-to-css', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'],
    ['case', 'helloWorld_someValue'],
  ])('no: %s input %s', (_tool, text) => expect(detectUrl(text)).toBe(false));
});

describe('§5 rules §10 does not show', () => {
  it('encoding writes upper-case hex digits and escapes every byte outside the style’s set', () => {
    expect(encodeUrl('\u0000\u007f\u00ff', 'component')).toBe('%00%7F%C3%BF');
    expect(encodeUrl('/?#[]@', 'component')).toBe('%2F%3F%23%5B%5D%40');
    expect(encodeUrl('/?#[]@', 'form')).toBe('%2F%3F%23%5B%5D%40');
    expect(encodeUrl('"<>\\^`{|}', 'whole')).toBe('%22%3C%3E%5C%5E%60%7B%7C%7D');
  });
  it('Component keeps exactly the RFC 3986 unreserved characters', () => {
    let kept = '';
    for (let c = 0; c < 128; c++)
      if (encodeUrl(String.fromCharCode(c), 'component').length === 1) kept += String.fromCharCode(c);
    expect(kept).toBe('-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~');
  });
  it('Form gives what URLSearchParams gives, for every ASCII character and beyond', () => {
    let all = '';
    for (let c = 0; c < 128; c++) all += String.fromCharCode(c);
    all += 'é€😀';
    expect(`x=${encodeUrl(all, 'form')}`).toBe(new URLSearchParams({ x: all }).toString());
  });
  it('Whole URL gives what encodeURI gives, apart from [ ] and an existing %XX', () => {
    let all = '';
    for (let c = 0; c < 128; c++) if (c !== 0x25 && c !== 0x5b && c !== 0x5d) all += String.fromCharCode(c);
    all += 'é€😀';
    expect(encodeUrl(all, 'whole')).toBe(encodeURI(all));
  });
  it('Whole URL keeps %XX in either case and escapes a % without two hex digits', () => {
    expect(encodeUrl('%2f%2F%g1%1%', 'whole')).toBe('%2f%2F%25g1%251%25');
  });
  it('decoding: + is a space only before decoding, so an escaped plus stays a plus', () => {
    expect(decodeUrl('%2B+', { plusAsSpace: true }).text).toBe('+ ');
  });
  it('decoding: a NUL is a character, not a note (§6)', () => {
    expect(decodeUrl('a%00b', { plusAsSpace: false })).toEqual({ text: 'a\u0000b', malformed: 0, invalidUtf8: false });
  });
  it('decoding: a % at the end, before one hex digit, before non-hex — each counted once', () => {
    expect(decodeUrl('%%41%4%', { plusAsSpace: false })).toEqual({ text: '%A%4%', malformed: 3, invalidUtf8: false });
  });
  it('decoding: invalid UTF-8 and a malformed escape together', () => {
    expect(decodeUrl('%C3%28 100%', { plusAsSpace: false })).toEqual({
      text: '\uFFFD( 100%',
      malformed: 1,
      invalidUtf8: true,
    });
  });
  it('decoding: an escaped U+FFFD is valid UTF-8, not a note', () => {
    expect(decodeUrl('%EF%BF%BD', { plusAsSpace: false })).toEqual({
      text: '\uFFFD',
      malformed: 0,
      invalidUtf8: false,
    });
  });
  it('decoding: characters that are not escapes give their own UTF-8 bytes', () => {
    expect(decodeUrl('Привет %F0%9F%98%80', { plusAsSpace: false }).text).toBe('Привет 😀');
  });
  it('a round trip in every style gives the text back', () => {
    const text = "Hello, мир! a+b=c&d e/f?g#h [::1] 100% ~'()* 😀";
    for (const style of STYLES)
      expect(decodeUrl(encodeUrl(text, style), { plusAsSpace: style === 'form' }).text, style).toBe(text);
  });
  it('parsing: always nine parts, in the table’s order', () => {
    expect(parsed('https://example.com/').parts.map(p => p.key)).toEqual([
      'protocol',
      'username',
      'password',
      'hostname',
      'port',
      'origin',
      'pathname',
      'search',
      'hash',
    ]);
  });
  it('parsing: the default ports of ws, wss and ftp; file has none; an explicit default port is dropped', () => {
    expect(parsed('ws://example.com/').part('port')).toEqual({ key: 'port', value: '80', isDefault: true });
    expect(parsed('wss://example.com/').part('port')).toEqual({ key: 'port', value: '443', isDefault: true });
    expect(parsed('ftp://example.com/').part('port')).toEqual({ key: 'port', value: '21', isDefault: true });
    expect(parsed('file:///etc/hosts').part('port')).toEqual({ key: 'port', value: '' });
    expect(parsed('http://example.com:80/').href).toBe('http://example.com/');
    expect(parsed('http://example.com:443/').part('port')).toEqual({ key: 'port', value: '443' });
  });
  it('parsing: decoded only where it differs, never for the query; + stays + in the path and the fragment', () => {
    const r = parsed('https://a%20b:c+d@example.com/x+y?q=%41#f%C3%BCr+x');
    expect(r.part('username')).toEqual({ key: 'username', value: 'a%20b', decoded: 'a b' });
    expect(r.part('password')).toEqual({ key: 'password', value: 'c+d' });
    expect(r.part('pathname')).toEqual({ key: 'pathname', value: '/x+y' });
    expect(r.part('search')).toEqual({ key: 'search', value: '?q=%41' });
    expect(r.part('hash')).toEqual({ key: 'hash', value: '#f%C3%BCr+x', decoded: '#für+x' });
  });
  it('parsing: the parser escapes what may not stand in a path, query or fragment', () => {
    const r = parsed('https://example.com/a b/ü?q=1 2&r=ü#frag ment');
    expect(r.href).toBe('https://example.com/a%20b/%C3%BC?q=1%202&r=%C3%BC#frag%20ment');
    expect(r.pairs).toEqual(['q=1 2', 'r=ü']);
  });
  it('parsing: parameters inside the fragment are not parameters (§13)', () => {
    const r = parsed('https://example.com/#/route?x=1');
    expect(r.params).toEqual([]);
    expect(r.value('hash')).toBe('#/route?x=1');
  });
  it('parsing: an IPv4 host in another notation becomes dotted decimal; a host in upper case becomes lower', () => {
    expect(parsed('http://0x7f.1/').value('hostname')).toBe('127.0.0.1');
    expect(parsed('http://EXAMPLE.com./').value('hostname')).toBe('example.com.');
  });
  it('parsing: the message for a refused input — the scheme decides, after the edges and tabs are dropped', () => {
    expect(parseUrl('  https://exa mple.com/')).toEqual({ ok: false, message: NOT_VALID });
    expect(parseUrl('ht\ntps://exa mple.com/')).toEqual({ ok: false, message: NOT_VALID });
    expect(parseUrl('1http://example.com/')).toEqual({ ok: false, message: NOT_ABSOLUTE });
    expect(parseUrl('')).toEqual({ ok: false, message: NOT_ABSOLUTE });
  });
  it('parsing: an input that is only spaces, C0 controls, tabs and newlines is blank (§6: as an empty one)', () => {
    expect(isBlankUrl('')).toBe(true);
    expect(isBlankUrl(' \t\n\r\u0000 ')).toBe(true);
    expect(isBlankUrl('\u00A0')).toBe(false);
    expect(isBlankUrl(' x ')).toBe(false);
  });
  it('parsing: a tab or a newline only at the edges is not reported', () => {
    expect(parsed('\nhttps://example.com/\t').removedWhitespace).toBe(false);
  });
  it('JSON of parameters: no parameters — {}; names keep the order they first appear, an index-like one too', () => {
    expect(paramsToJson([])).toBe('{}');
    const params = parsed('https://example.com/?b=1&2=x&a=3&b=4&1=y').params;
    expect(paramsToJson(params)).toBe('{\n  "b": [\n    "1",\n    "4"\n  ],\n  "2": "x",\n  "a": "3",\n  "1": "y"\n}');
  });
  it('JSON of parameters: what JSON.parse reads back is the same, characters that need escaping included', () => {
    const params = [
      { name: 'q"\\', value: 'line\nbreak\u0001' },
      { name: 'é', value: '😀' },
    ];
    expect(JSON.parse(paramsToJson(params))).toEqual({ 'q"\\': 'line\nbreak\u0001', é: '😀' });
    expect(paramsToJson(params)).toBe(JSON.stringify({ 'q"\\': 'line\nbreak\u0001', é: '😀' }, null, 2));
  });
});

// Where Node's and Chrome's URL disagree (both run on the same inputs, 2026-11-21: Node 22.20, Chrome for Testing 159),
// the URL Standard decides; each case below gives the standard's answer on both (logic.ts, `platformParse`).
describe('§5 parsing: the URL Standard where Node and Chrome differ', () => {
  it('a space in a special host is refused (Chrome escapes it to %20), also one IDNA maps to a space', () => {
    for (const input of [
      'https://exa mple.com/',
      'http://a%20b/',
      'ws://a\u00A0b.example/',
      'ftp://a\u3000b.example/',
      'http://a%E3%80%80b.example/',
      'file://a b.example/',
      'https:a b',
    ])
      expect(parseUrl(input), input).toEqual({ ok: false, message: NOT_VALID });
    expect(detectedMode('https://exa%20mple.com')).toBe('decode');
  });
  it('a * in a special host stays (Chrome escapes it to %2A)', () => {
    const r = parsed('https://a*b.example/x');
    expect([r.href, r.value('hostname'), r.value('origin')]).toEqual([
      'https://a*b.example/x',
      'a*b.example',
      'https://a*b.example',
    ]);
    expect(parsed('http://u:p@a*b.example:8080/?q#f').href).toBe('http://u:p@a*b.example:8080/?q#f');
  });
  it('file://localhost/ has an empty host (Chrome keeps localhost)', () => {
    const r = parsed('file://localhost/etc/hosts');
    expect([r.href, r.value('hostname')]).toEqual(['file:///etc/hosts', '']);
  });
  it('the origin of file:, of a non-special scheme and of blob: with a non-http URL inside is null', () => {
    expect(parsed('file:///etc/hosts').value('origin')).toBe('null');
    expect(parsed('file://host.example/p').value('origin')).toBe('null');
    expect(parsed('chrome-extension://abcdefghijklmnop/page.html').value('origin')).toBe('null');
    expect(parsed('chrome://settings/').value('origin')).toBe('null');
    expect(parsed('blob:file:///x').value('origin')).toBe('null');
    expect(parsed('blob:ws://x/').value('origin')).toBe('null');
    expect(parsed('blob:https://example.com:8443/id').value('origin')).toBe('https://example.com:8443');
    expect(parsed('wss://example.com:443/').value('origin')).toBe('wss://example.com');
  });
  it('non-ASCII in a non-special URL is escaped as UTF-8 everywhere (Chrome refuses U+3000 in its host)', () => {
    const r = parsed('foo://a\u3000b.example/п?q=é#ф');
    expect(r.href).toBe('foo://a%E3%80%80b.example/%D0%BF?q=%C3%A9#%D1%84');
    expect(r.pairs).toEqual(['q=é']);
    expect(r.part('pathname')).toEqual({ key: 'pathname', value: '/%D0%BF', decoded: '/п' });
  });
  it('^ in a path is escaped (the path set of the standard, as Chrome; Node 22.20 keeps it)', () => {
    const r = parsed('https://example.com/a^b?q^=v^#f^');
    expect([r.href, r.value('pathname')]).toEqual(['https://example.com/a%5Eb?q^=v^#f^', '/a%5Eb']);
    expect(parsed('foo://h/a^b').href).toBe('foo://h/a%5Eb');
    expect(parsed('foo:a^b').href).toBe('foo:a^b');
  });
});

describe('§12 limits: the functions take any input', () => {
  it('encodes and decodes 5 Mi characters', () => {
    const big = 'a b/é'.repeat((5 * 1024 * 1024) / 5);
    const encoded = encodeUrl(big, 'component');
    // a, %20, b, %2F, %C3%A9: 14 characters for every 5.
    expect(encoded.length).toBe((big.length / 5) * 14);
    expect(decodeUrl(encoded, { plusAsSpace: false }).text).toBe(big);
  });
  it('stays linear on long runs: spaces inside, letters before a colon (a quadratic pattern would take minutes)', () => {
    const started = Date.now();
    const spaces = `https://example.com/${' '.repeat(1024 * 1024 - 21)}x`;
    expect(parseUrl(spaces).ok).toBe(true);
    expect(isBlankUrl(` ${'a'.repeat(1024 * 1024)} `)).toBe(false);
    expect(detectUrl(`${'a'.repeat(65535)}:`)).toBe(false);
    expect(parseUrl(`${'a'.repeat(1024 * 1024)} b`)).toEqual({ ok: false, message: NOT_ABSOLUTE });
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('parses a URL with 60,000 parameters and writes their JSON', () => {
    const query = Array.from({ length: 60000 }, (_, i) => `k${i % 100}=v${i}`).join('&');
    const r = parsed(`https://example.com/?${query}`);
    expect(r.params).toHaveLength(60000);
    expect(Object.keys(JSON.parse(paramsToJson(r.params)) as object)).toHaveLength(100);
  });
});
