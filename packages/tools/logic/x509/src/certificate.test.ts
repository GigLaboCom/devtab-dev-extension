// What §5 states that §10 leaves out, on certificates written by hand (der-builder.ts): the warnings, every string type,
// every GeneralName, every decoded extension's edge, keys OpenSSL did not make here, and structures that are wrong.
import { COULD_NOT_DECODE, escapeRfc4514, parseCertificate, unicodeDomain } from './index';
import {
  bits,
  bmp,
  bool,
  certificate,
  cn,
  ctx,
  extension,
  generalizedTime,
  ia5,
  int,
  intBytes,
  name,
  nul,
  octet,
  oid,
  P256_SPKI,
  prim,
  printable,
  seq,
  teletex,
  tlv,
  universal,
  utf8String,
} from './der-builder';
import { describe, expect, it } from 'vitest';
import type { Bytes, CertificateParts } from './der-builder';
import type { Certificate } from './index';

const parse = (parts: CertificateParts): Certificate => {
  const r = parseCertificate(certificate(parts));
  if (!r.ok) throw new Error(r.message);
  return r.certificate;
};
const refused = (parts: CertificateParts): string => {
  const r = parseCertificate(certificate(parts));
  if (r.ok) throw new Error('read');
  return r.message;
};
const withExtension = (id: string, value: Bytes, critical?: boolean) =>
  parse({ extensions: [extension(id, value, critical)] }).extensions[0]!;
const linesOf = (id: string, value: Bytes) => {
  const v = withExtension(id, value).value;
  if (v.kind !== 'text') throw new Error(`${v.error} ${v.detail}`);
  return v.lines;
};
const SAN = '2.5.29.17';

describe('warnings of §5.3, §5.8', () => {
  it('a negative serial; a serial longer than 20 bytes', () => {
    const negative = parse({ serial: int(-1) });
    expect(negative.serialHex).toBe('-01');
    expect(negative.serialDecimal).toBe('-1');
    expect(negative.warnings).toContain(
      'The serial number is negative (RFC 5280 §4.1.2.2 requires a positive number).',
    );
    const long = parse({ serial: intBytes([0x01, ...new Array(20).fill(0xab)]) });
    expect(long.serialHex).toBe(`01${'AB'.repeat(20)}`);
    expect(long.warnings).toEqual(['The serial number is longer than 20 bytes (RFC 5280 §4.1.2.2).']);
    expect(parse({ serial: intBytes([0x00, 0x80]) }).serialHex).toBe('80');
  });

  it('the two signature algorithm fields differ', () => {
    const c = parse({ outerSignature: seq(oid('1.2.840.10045.4.3.3')) });
    expect(c.signatureAlgorithm).toBe('ECDSA with SHA-384');
    expect(c.warnings).toEqual(['The two signature algorithm fields differ (RFC 5280 §4.1.1.2).']);
  });

  it('MD5 and SHA-1 signatures', () => {
    for (const id of ['1.2.840.113549.1.1.4', '1.2.840.113549.1.1.5', '1.2.840.10045.4.1'])
      expect(parse({ signature: seq(oid(id), nul()) }).warnings).toEqual([
        'This signature algorithm is no longer considered secure.',
      ]);
  });

  it('extensions in a v1 or v2 certificate', () => {
    expect(parse({ version: null }).warnings).toEqual([
      'This v1 certificate has extensions; only v3 may have them (RFC 5280 §4.1.2.9).',
    ]);
    expect(parse({ version: 1 }).warnings).toEqual([
      'This v2 certificate has extensions; only v3 may have them (RFC 5280 §4.1.2.9).',
    ]);
  });

  it('an extension twice; critical FALSE written out', () => {
    const c = parse({ extensions: [extension('2.5.29.19', seq()), extension('2.5.29.19', seq(), false)] });
    expect(c.warnings).toEqual([
      'The extension Basic constraints writes out "critical: false", a default value DER leaves out.',
      'The extension Basic constraints appears twice (RFC 5280 §4.2).',
    ]);
  });

  it('a name whose UTF8String is not UTF-8: U+FFFD and a warning', () => {
    const c = parse({ subject: name([['2.5.4.3', tlv(0x0c, [0x41, 0xc3, 0x28])]]) });
    expect(c.subject.display).toBe('A\ufffd(');
    expect(c.warnings).toEqual(['The subject has bytes that are not UTF-8; they are shown as they could be read.']);
  });
});

describe('names (§5.5)', () => {
  it('an empty subject is (empty)', () => {
    const c = parse({ subject: seq() });
    expect(c.subject.rfc4514).toBe('(empty)');
    expect(c.subject.display).toBe('(empty)');
    expect(c.selfIssued).toBe(false);
  });

  it('a multi-valued RDN joins with +; RDNs reversed; CN shown, else the whole string', () => {
    const c = parse({
      subject: name(
        [['2.5.4.6', printable('DE')]],
        [
          ['2.5.4.10', utf8String('Example')],
          ['2.5.4.11', utf8String('Unit')],
        ],
      ),
    });
    expect(c.subject.rfc4514).toBe('O=Example+OU=Unit,C=DE');
    expect(c.subject.display).toBe('O=Example+OU=Unit,C=DE');
  });

  it('UniversalString, BMPString, TeletexString, an unknown attribute, a value that is not a string', () => {
    const c = parse({
      subject: name(
        [['2.5.4.3', universal('Smile 😀')]],
        [['2.5.4.11', bmp('Отдел')]],
        [['2.5.4.10', teletex('Ex Ämple')]],
        [['1.2.3.4', utf8String('x')]],
        [['2.5.4.7', int(5)]],
      ),
    });
    expect(c.subject.rdns.flat().map(a => [a.label, a.type, a.value])).toEqual([
      ['Common name', 'UniversalString', 'Smile 😀'],
      ['Organizational unit', 'BMPString', 'Отдел'],
      ['Organization', 'TeletexString', 'Ex Ämple'],
      ['1.2.3.4', 'UTF8String', 'x'],
      ['Locality', 'INTEGER', '#020105'],
    ]);
    expect(c.subject.rfc4514).toBe('L=#020105,1.2.3.4=#0C0178,O=Ex Ämple,OU=Отдел,CN=Smile 😀');
  });

  it('RFC 4514 §2.4 escaping', () => {
    expect(escapeRfc4514('#start')).toBe('\\#start');
    expect(escapeRfc4514(' both ')).toBe('\\ both\\ ');
    expect(escapeRfc4514('a#b c')).toBe('a#b c');
    expect(escapeRfc4514('x"+,;<>\\y')).toBe('x\\"\\+\\,\\;\\<\\>\\\\y');
    expect(escapeRfc4514('nul\u0000')).toBe('nul\\00');
    expect(escapeRfc4514('Пример 😀')).toBe('Пример 😀');
  });
});

describe('GeneralName, every type (§5.8)', () => {
  it('reads all nine; IPv4-mapped IPv6; an address of another length is said to be one', () => {
    const v6 = [0x20, 0x01, 0x0d, 0xb8, ...new Array(11).fill(0), 0x01];
    const mapped = [...new Array(10).fill(0), 0xff, 0xff, 192, 0, 2, 1];
    expect(
      linesOf(
        SAN,
        seq(
          ctx(0, oid('1.3.6.1.4.1.311.20.2.3'), ctx(0, utf8String('user@example.com'))),
          ctx(0, oid('1.2.3.4'), ctx(0, int(7))),
          prim(1, [...new TextEncoder().encode('a@example.com')]),
          prim(2, [...new TextEncoder().encode('xn--bcher-kva.example')]),
          ctx(3, seq()),
          ctx(4, cn('Dir')),
          ctx(5, seq()),
          prim(6, [...new TextEncoder().encode('https://example.com/')]),
          prim(7, [192, 0, 2, 10]),
          prim(7, v6),
          prim(7, mapped),
          prim(7, [1, 2, 3]),
          prim(8, oid('1.2.3.4').slice(2)),
        ),
      ),
    ).toEqual([
      'Other name 1.3.6.1.4.1.311.20.2.3: user@example.com',
      'Other name 1.2.3.4: 02:01:07',
      'Email a@example.com',
      'DNS xn--bcher-kva.example (bücher.example)',
      'X.400 address 30:00',
      'Directory CN=Dir',
      'EDI party name 30:00',
      'URI https://example.com/',
      'IP 192.0.2.10',
      'IP 2001:db8::1',
      'IP ::ffff:192.0.2.1',
      'IP 01:02:03 (3 bytes, not an address)',
      'Registered ID 1.2.3.4',
    ]);
  });

  it('IDN: only labels that decode get a Unicode form', () => {
    expect(unicodeDomain('xn--e1afmkfd.example')).toBe('пример.example');
    expect(unicodeDomain('www.xn--mnchen-3ya.example')).toBe('www.münchen.example');
    expect(unicodeDomain('example.com')).toBeNull();
    expect(unicodeDomain('xn--!!!.example')).toBeNull();
    expect(unicodeDomain(`xn--${'a'.repeat(80)}`)).toBeNull();
  });
});

describe('extensions (§5.8)', () => {
  it('basic constraints, key usage, extended key usage', () => {
    expect(linesOf('2.5.29.19', seq())).toEqual(['CA: no']);
    expect(linesOf('2.5.29.19', seq(bool(true), int(3)))).toEqual(['CA: yes, path length 3']);
    expect(linesOf('2.5.29.15', bits([0x00]))).toEqual(['(none)']);
    expect(linesOf('2.5.29.15', bits([0xff, 0x80], 7))).toEqual([
      'Digital signature, Content commitment, Key encipherment, Data encipherment, Key agreement, Certificate signing, CRL signing, Encipher only, Decipher only',
    ]);
    expect(
      linesOf(
        '2.5.29.37',
        seq(
          ...[
            '1.3.6.1.5.5.7.3.3',
            '1.3.6.1.5.5.7.3.4',
            '1.3.6.1.5.5.7.3.8',
            '1.3.6.1.5.5.7.3.9',
            '2.5.29.37.0',
            '1.2.3',
          ].map(oid),
        ),
      ),
    ).toEqual(['Code signing, Email protection, Time stamping, OCSP signing, Any, 1.2.3']);
  });

  it('certificate policies: names, CPS, user notice, an unknown qualifier', () => {
    expect(
      linesOf(
        '2.5.29.32',
        seq(
          seq(oid('2.23.140.1.1')),
          seq(oid('2.23.140.1.2.2')),
          seq(oid('2.23.140.1.2.3'), seq(seq(oid('1.3.6.1.5.5.7.2.2'), seq(bmp('Notice'))), seq(oid('1.2.3'), int(1)))),
          seq(oid('1.2.3.4')),
        ),
      ),
    ).toEqual([
      '2.23.140.1.1 Extended validation',
      '2.23.140.1.2.2 Organization validated',
      '2.23.140.1.2.3 Individual validated',
      'User notice: Notice',
      '1.2.3: 02:01:01',
      '1.2.3.4',
    ]);
  });

  it('authority information access with a location that is not a URI; name constraints with a range', () => {
    expect(
      linesOf(
        '1.3.6.1.5.5.7.1.1',
        seq(seq(oid('1.3.6.1.5.5.7.48.1'), ctx(4, cn('OCSP'))), seq(oid('1.2.3'), prim(6, [0x61]))),
      ),
    ).toEqual(['OCSP Directory CN=OCSP', '1.2.3 a']);
    expect(linesOf('2.5.29.30', seq(ctx(1, seq(prim(2, [0x78]), prim(0, [1]), prim(1, [5])))))).toEqual([
      'Excluded DNS x (minimum 1, maximum 5)',
    ]);
  });

  it('TLS feature names its values; the poison must be NULL', () => {
    expect(linesOf('1.3.6.1.5.5.7.1.24', seq(int(5), int(17), int(99)))).toEqual([
      'status_request (OCSP Must-Staple), status_request_v2, 99',
    ]);
    expect(withExtension('1.3.6.1.4.1.11129.2.4.3', int(0), true).value).toMatchObject({
      kind: 'hex',
      error: COULD_NOT_DECODE,
    });
  });

  it('signed certificate timestamps whose list lies about its length cannot be decoded', () => {
    expect(withExtension('1.3.6.1.4.1.11129.2.4.2', octet([0x00, 0x09, 0x00])).value).toMatchObject({
      kind: 'hex',
      error: COULD_NOT_DECODE,
      detail: expect.stringMatching(/^Byte \d+: the timestamp list declares 9 bytes, 1 are there\.$/),
    });
  });

  it('a known extension that does not decode keeps its hex and the place; the rest is read', () => {
    const c = parse({
      extensions: [extension(SAN, [0x30, 0x03, 0x82, 0x05, 0x61]), extension('2.5.29.19', seq(bool(true)), true)],
    });
    expect(c.extensions[0]!.value).toEqual({
      kind: 'hex',
      hex: '30:03:82:05:61',
      error: 'Could not decode this extension.',
      detail: expect.stringMatching(/^Byte \d+: the element runs past the end of the element that contains it\.$/),
    });
    expect(c.extensions[1]!.value).toEqual({ kind: 'text', lines: ['CA: yes'] });
    expect(c.ca).toBe(true);
    // A value with bytes after its element is not decoded either.
    expect(withExtension('2.5.29.19', [...seq(), 0x00]).value).toMatchObject({ error: COULD_NOT_DECODE });
  });
});

describe('keys (§5.6)', () => {
  const spki = (alg: Bytes, key: Bytes = [0]) => seq(alg, bits(key));
  it.each<[string, Bytes, string]>([
    ['X25519', spki(seq(oid('1.3.101.110'))), 'X25519'],
    ['X448', spki(seq(oid('1.3.101.111'))), 'X448'],
    ['ML-KEM-768', spki(seq(oid('2.16.840.1.101.3.4.4.2'))), 'ML-KEM-768'],
    ['secp256k1', spki(seq(oid('1.2.840.10045.2.1'), oid('1.3.132.0.10'))), 'EC secp256k1'],
    ['an unknown curve', spki(seq(oid('1.2.840.10045.2.1'), oid('1.2.3.4'))), 'EC 1.2.3.4'],
    ['explicit parameters', spki(seq(oid('1.2.840.10045.2.1'), seq(int(1)))), 'EC with explicit curve parameters'],
    ['DSA without parameters', spki(seq(oid('1.2.840.10040.4.1'))), 'DSA'],
    ['an unknown algorithm', spki(seq(oid('1.2.3.4.5'))), '1.2.3.4.5'],
  ])('%s', (_, key, description) => {
    expect(parse({ spki: key }).publicKey.description).toBe(description);
  });

  it('an RSA key that is not two INTEGERs is not a key', () => {
    const rsa = seq(seq(oid('1.2.840.113549.1.1.1'), nul()), bits(seq(int(5))));
    expect(refused({ spki: rsa })).toMatch(
      /^Byte \d+: an RSA public key is two INTEGERs: the modulus and the exponent\.$/,
    );
  });

  it('RSASSA-PSS without a hash in its parameters is SHA-1 (RFC 4055)', () => {
    expect(parse({ signature: seq(oid('1.2.840.113549.1.1.10'), seq()) }).signatureAlgorithm).toBe(
      'RSASSA-PSS with SHA-1',
    );
    expect(parse({ signature: seq(oid('1.2.840.113549.1.1.10')) }).signatureAlgorithm).toBe('RSASSA-PSS');
  });
});

describe('structures that are not a certificate’s, with the place', () => {
  it.each<[string, CertificateParts, RegExp]>([
    ['version 5', { version: 5 }, /^Byte \d+: the version must be 0, 1 or 2 \(v1–v3\), found 5\.$/],
    ['no serial', { serial: oid('1.2') }, /^Byte \d+: expected the serial number \(an INTEGER\)\.$/],
    ['a Name that is a SET', { issuer: tlv(0x31) }, /^Byte \d+: expected the issuer \(a Name\), found SET\.$/],
    ['one time', { notAfter: [] }, /^Byte \d+: the validity must hold exactly two times\.$/],
    [
      'a time that is not one',
      { notBefore: int(1) },
      /^Byte \d+: expected UTCTime or GeneralizedTime, found INTEGER\.$/,
    ],
    ['an empty extensions field', { extensions: [] }, /^Byte \d+: the extensions field is empty/],
    [
      'a key that is not a BIT STRING',
      { spki: seq(seq(oid('1.3.101.112')), octet([1])) },
      /^Byte \d+: the public key must be a BIT STRING\.$/,
    ],
  ])('%s', (_, parts, message) => {
    expect(refused(parts)).toMatch(message);
  });

  it('unique identifiers are read; fields out of order are refused', () => {
    const c = parse({ issuerUniqueId: [0, 0xab], subjectUniqueId: [0, 0xcd] });
    expect([c.issuerUniqueId, c.subjectUniqueId]).toEqual(['AB', 'CD']);
    const swapped = new Uint8Array(
      seq(
        seq(
          ctx(0, int(2)),
          int(1),
          seq(oid('1.2.840.10045.4.3.2')),
          cn('x'),
          seq(generalizedTime('20250101000000Z'), generalizedTime('20260101000000Z')),
          cn('x'),
          P256_SPKI,
          ctx(3, seq(extension('2.5.29.19', seq()))),
          prim(1, [0]),
        ),
        seq(oid('1.2.840.10045.4.3.2')),
        bits([0]),
      ),
    );
    const r = parseCertificate(swapped);
    expect(r.ok ? '' : r.message).toMatch(/^Byte \d+: unexpected \[1\] in the tbsCertificate\.$/);
  });

  it('a GeneralizedTime notBefore is fine (§4.1.2.5 prefers UTCTime before 2050, not a must here)', () => {
    expect(parse({ notBefore: generalizedTime('20250101000000Z') }).notBefore.valid).toBe(true);
    expect(ia5('x')).toEqual([0x16, 1, 0x78]);
  });
});
