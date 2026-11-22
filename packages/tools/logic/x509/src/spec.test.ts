// docs/tools/specs/x509.md §10 row by row (the specification's three fixtures, fixtures/spec-*.pem, copied from it
// byte for byte), then §6's rows that §10 leaves out, and §7.
import {
  chainLinks,
  chainText,
  CSR,
  detectX509,
  fingerprints,
  formatIPv6,
  NO_CERTIFICATE,
  NO_EXTENSIONS,
  parseCertificate,
  PRIVATE_KEY_BLOCK,
  readInput,
  spkiSha256,
  toPem,
  validityPeriod,
  validityStatus,
  validityText,
} from './index';
import { certificate, cn, extension, int, oid, seq, utcTime } from './der-builder';
import { readTlv } from '@workspace/tools-shared/der';
import { formatIsoUtc } from '@workspace/tools-shared/time';
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Certificate, InputBlock } from './index';

const pem = (name: string): string => readFileSync(join(__dirname, '../fixtures', `${name}.pem`), 'utf8');
const LEAF = pem('spec-leaf');
const CA = pem('spec-ca');
const ED = pem('spec-ed');

const derOf = (text: string): Uint8Array => {
  const block = readInput({ text }).blocks[0];
  if (block?.kind !== 'certificate') throw new Error('no certificate');
  return block.der;
};
const cert = (input: Parameters<typeof readInput>[0]): Certificate => {
  const block = readInput(input).blocks.find(
    (b): b is InputBlock & { kind: 'certificate' } => b.kind === 'certificate',
  );
  if (!block) throw new Error('no certificate block');
  const parsed = parseCertificate(block.der);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.certificate;
};
const iso = (d: Date | undefined): string | undefined =>
  d ? formatIsoUtc(BigInt(d.getTime()) * 1_000_000n) : undefined;
const ext = (c: Certificate, name: string) => c.extensions.find(e => e.name === name);
const lines = (c: Certificate, name: string): string[] => {
  const v = ext(c, name)?.value;
  return v?.kind === 'text' ? v.lines : [];
};
/** A throwaway private key, made for this test run and never stored. */
const throwawayKey = (): string =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('§10, the LEAF certificate', () => {
  const leaf = cert({ text: LEAF });

  it('1: v3; serial 1234567890ABCDEF / 1311768467294899695; ECDSA with SHA-256; 703 bytes of DER', () => {
    expect(leaf.version).toBe(3);
    expect(leaf.serialHex).toBe('1234567890ABCDEF');
    expect(leaf.serialDecimal).toBe('1311768467294899695');
    expect(leaf.signatureAlgorithm).toBe('ECDSA with SHA-256');
    expect(leaf.der.length).toBe(703);
  });

  it('2: subject = issuer, RFC 4514 string and table; self-issued', () => {
    expect(leaf.subject.rfc4514).toBe('CN=test.example.com,OU=Certificates,O=Example Tools Test,C=DE');
    expect(leaf.issuer.rfc4514).toBe(leaf.subject.rfc4514);
    expect(leaf.subject.rdns.flat().map(a => [a.label, a.value])).toEqual([
      ['Country', 'DE'],
      ['Organization', 'Example Tools Test'],
      ['Organizational unit', 'Certificates'],
      ['Common name', 'test.example.com'],
    ]);
    expect(leaf.selfIssued).toBe(true);
  });

  it('3: notBefore UTCTime, notAfter GeneralizedTime, period 8808 days', () => {
    expect(leaf.notBefore).toMatchObject({ raw: '251119120000Z', type: 'UTCTime', valid: true });
    expect(iso(leaf.notBefore.date)).toBe('2025-11-19T12:00:00Z');
    expect(leaf.notAfter).toMatchObject({ raw: '20500101000000Z', type: 'GeneralizedTime', valid: true });
    expect(iso(leaf.notAfter.date)).toBe('2050-01-01T00:00:00Z');
    expect(validityPeriod(leaf.notBefore, leaf.notAfter)).toBe('8808 days');
  });

  it('4: key EC P-256; SPKI SHA-256', async () => {
    expect(leaf.publicKey.description).toBe('EC P-256');
    expect(await spkiSha256(leaf.publicKey.spkiDer)).toBe('ekG9wAgKm6o/dtNzloLwQN6mo9ZPoSq0OaYuAsXBpaM=');
  });

  it('5: SHA-1 and SHA-256 fingerprints', async () => {
    expect(await fingerprints(leaf.der)).toEqual({
      sha1: '6D:87:26:42:9B:92:EA:71:43:79:F5:71:B6:22:41:18:9C:B0:33:5A',
      sha256: '9A:0F:75:02:BB:18:B0:85:BB:8F:7C:81:F8:9A:05:CB:44:22:5A:D9:B7:48:50:01:7F:E2:C4:80:07:35:D9:BD',
    });
  });

  it('6: the extensions in order', () => {
    expect(
      leaf.extensions.map(e => [e.name, e.critical, e.value.kind === 'text' ? e.value.lines.join(' / ') : e.value.hex]),
    ).toEqual([
      ['Basic constraints', true, 'CA: no'],
      ['Key usage', true, 'Digital signature'],
      ['Extended key usage', false, 'TLS server, TLS client'],
      ['Subject alternative names', false, expect.any(String)],
      ['Subject key identifier', false, 'D8:0B:52:45:56:DA:3C:BD:D3:A4:0F:0C:C5:13:D0:F3:4D:28:1B:4F'],
      ['Authority key identifier', false, 'Key ID D8:0B:52:45:56:DA:3C:BD:D3:A4:0F:0C:C5:13:D0:F3:4D:28:1B:4F'],
      ['Certificate policies', false, '2.23.140.1.2.1 Domain validated'],
    ]);
    expect(leaf.extensions.map(e => e.oid)).toEqual([
      '2.5.29.19',
      '2.5.29.15',
      '2.5.29.37',
      '2.5.29.17',
      '2.5.29.14',
      '2.5.29.35',
      '2.5.29.32',
    ]);
  });

  it('7: subject alternative names, IPv6 by RFC 5952', () => {
    expect(lines(leaf, 'Subject alternative names')).toEqual([
      'DNS test.example.com',
      'DNS *.test.example.com',
      'IP 192.0.2.10',
      'IP 2001:db8::1',
      'Email admin@example.com',
      'URI https://example.com/',
    ]);
  });
});

describe('§10, the CA certificate', () => {
  const ca = cert({ text: CA });

  it('8: escaped RFC 4514 subject; RSA 2048-bit, exponent 65537; RSA PKCS#1 v1.5 with SHA-256; serial 01 / 1', () => {
    expect(ca.subject.rfc4514).toBe('O=Example\\+Tools,CN=Test Root CA\\, \\"Quoted\\"');
    expect(ca.publicKey.description).toBe('RSA 2048-bit, exponent 65537');
    expect(ca.signatureAlgorithm).toBe('RSA PKCS#1 v1.5 with SHA-256');
    expect([ca.serialHex, ca.serialDecimal]).toEqual(['01', '1']);
  });

  it('9: basic constraints, key usage, subject key identifier', () => {
    expect(ext(ca, 'Basic constraints')).toMatchObject({
      critical: true,
      value: { lines: ['CA: yes, path length 0'] },
    });
    expect(ext(ca, 'Key usage')).toMatchObject({
      critical: true,
      value: { lines: ['Certificate signing, CRL signing'] },
    });
    expect(lines(ca, 'Subject key identifier')).toEqual([
      '3E:3E:D5:7E:20:16:B9:86:1B:FE:45:FC:92:D0:E5:D0:08:20:F1:BF',
    ]);
    expect(ca.ca).toBe(true);
  });

  it('10: fingerprints and SPKI SHA-256', async () => {
    expect(await fingerprints(ca.der)).toEqual({
      sha1: '03:EE:EC:B9:71:2E:0E:B2:2E:C4:61:EF:70:29:59:C2:27:2E:8D:9D',
      sha256: 'D7:58:D0:07:2A:77:75:C6:08:73:E2:0B:09:EA:F6:E4:2A:D5:7F:D4:6C:67:34:14:7F:2E:88:14:CE:E3:44:CA',
    });
    expect(await spkiSha256(ca.publicKey.spkiDer)).toBe('rZ2D/ShL9FVDXw8R71+dbQrav3K4aRVsQPTmow1S8Ck=');
  });

  it('11: at 2025-11-19T00:00:00Z — expired 10 months ago; period 366 days', () => {
    const now = Date.UTC(2025, 10, 19);
    const status = validityStatus(ca.notBefore, ca.notAfter, now);
    expect(status).toEqual({ kind: 'expired', at: Date.UTC(2025, 0, 1) });
    expect(validityText(status, now)).toBe('Expired 10 months ago');
    expect(validityPeriod(ca.notBefore, ca.notAfter)).toBe('366 days');
  });
});

describe('§10, the ED certificate', () => {
  const ed = cert({ text: ED });

  it('12: Ed25519 key and signature; CN=ed25519.example; SKI; basic constraints', () => {
    expect(ed.publicKey.description).toBe('Ed25519');
    expect(ed.signatureAlgorithm).toBe('Ed25519');
    expect(ed.subject.rfc4514).toBe('CN=ed25519.example');
    expect(lines(ed, 'Subject key identifier')).toEqual([
      '04:0E:81:35:41:E9:48:C2:74:0E:CD:68:86:81:79:62:EC:AA:DF:B4',
    ]);
    expect(ext(ed, 'Basic constraints')).toMatchObject({ critical: true, value: { lines: ['CA: yes'] } });
  });

  it('13: SHA-256 and SPKI SHA-256', async () => {
    expect((await fingerprints(ed.der)).sha256).toBe(
      'AC:82:4A:23:02:44:AC:2F:A4:E3:5F:65:2D:E7:74:4A:DB:96:B5:D1:19:27:18:98:96:48:F3:5B:F3:50:7D:0C',
    );
    expect(await spkiSha256(ed.publicKey.spkiDer)).toBe('91gQryI5AOd4b2tvKk9uj5KXCuu8ptpEdIQKUDsQAH4=');
  });

  it('14: at 2026-11-19T00:00:00Z — not valid yet, starts in 3 years', () => {
    const now = Date.UTC(2026, 10, 19);
    const status = validityStatus(ed.notBefore, ed.notAfter, now);
    expect(status).toEqual({ kind: 'not-yet', at: Date.UTC(2030, 0, 1) });
    expect(validityText(status, now)).toBe('Not valid yet: starts in 3 years');
  });
});

describe('§10, input and helpers', () => {
  it('15: LEAF + CA + ED in one text with garbage between: 3 certificates, no links', () => {
    const text = `depth=0 CN = test\nverify error:num=18\n---\n${LEAF}Server certificate\nsubject=…\n${CA}\n\n  noise ${ED}---\nDone\n`;
    const read = readInput({ text });
    expect(read.blocks.map(b => b.kind)).toEqual(['certificate', 'certificate', 'certificate']);
    expect(read.message).toBeUndefined();
    const all = read.blocks.map(b => (b.kind === 'certificate' ? parseCertificate(b.der) : null));
    const certificates = all.map(r => (r?.ok ? r.certificate : null)).filter((c): c is Certificate => c !== null);
    expect(certificates).toHaveLength(3);
    expect(chainLinks(certificates)).toEqual([false, false]);
  });

  it('16: LEAF as Base64 without BEGIN / END lines: as row 1 (with or without line breaks)', () => {
    const body = LEAF.replace(/-----[^-]+-----/g, '').trim();
    for (const text of [body, body.replace(/\s/g, ''), `  ${body.replace(/\n/g, '\r\n')}\r\n`]) {
      const c = cert({ text });
      expect([c.version, c.serialHex, c.signatureAlgorithm, c.der.length]).toEqual([
        3,
        '1234567890ABCDEF',
        'ECDSA with SHA-256',
        703,
      ]);
    }
  });

  it('17: the DER bytes of LEAF as a file: as row 1', () => {
    const c = cert({ bytes: derOf(LEAF) });
    expect([c.version, c.serialHex, c.signatureAlgorithm, c.der.length]).toEqual([
      3,
      '1234567890ABCDEF',
      'ECDSA with SHA-256',
      703,
    ]);
  });

  it('18: LEAF cut to 400 bytes: Byte 0, the element is longer than the data left', () => {
    const cut = derOf(LEAF).slice(0, 400);
    const read = readInput({ bytes: cut });
    expect(read.blocks[0]?.kind).toBe('certificate');
    expect(parseCertificate(cut)).toEqual({
      ok: false,
      message: 'Byte 0: the element is longer than the data left (truncated certificate?).',
      offset: 0,
    });
  });

  it('19: a PRIVATE KEY block and LEAF: [skipped private-key, certificate]', () => {
    const read = readInput({ text: `${throwawayKey()}\n${LEAF}` });
    expect(read.blocks.map(b => [b.kind, b.kind === 'skipped' ? b.reason : b.label])).toEqual([
      ['skipped', 'private-key'],
      ['certificate', 'CERTIFICATE'],
    ]);
    expect(read.blocks[0]).toMatchObject({ message: PRIVATE_KEY_BLOCK });
  });

  it('20: a CERTIFICATE REQUEST block: skipped csr', () => {
    const read = readInput({ text: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----\n' });
    expect(read.blocks).toEqual([
      { kind: 'skipped', label: 'CERTIFICATE REQUEST', reason: 'csr', message: CSR, line: 1 },
    ]);
  });

  it('21: hello: no certificate found', () => {
    expect(readInput({ text: 'hello' })).toEqual({ blocks: [], message: NO_CERTIFICATE });
  });

  it('22: formatIPv6 by RFC 5952 §4.2', () => {
    const v6 = (hex: string) =>
      formatIPv6(
        new Uint8Array(
          hex
            .replace(/:/g, '')
            .match(/../g)!
            .map(h => parseInt(h, 16)),
        ),
      );
    expect(v6('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(v6('0000:0000:0000:0000:0000:0000:0000:0000')).toBe('::');
    expect(v6('2001:0db8:0000:0001:0001:0001:0001:0001')).toBe('2001:db8:0:1:1:1:1:1');
    expect(v6('2001:0000:0000:0001:0000:0000:0000:0001')).toBe('2001:0:0:1::1');
  });

  it('23: toPem(DER LEAF) is the LEAF block byte for byte', () => {
    expect(toPem(derOf(LEAF))).toBe(LEAF);
  });

  it('24: detectX509 on §7’s examples', () => {
    for (const yes of [
      LEAF,
      CA,
      ED,
      `depth=2\n---\n${LEAF}${CA}`,
      LEAF.replace('CERTIFICATE', 'X509 CERTIFICATE'),
      LEAF.replace('CERTIFICATE', 'TRUSTED CERTIFICATE'),
    ])
      expect(detectX509(yes)).toBe(true);
    const base64 = LEAF.replace(/-----[^-]+-----/g, '').trim();
    for (const no of [
      '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----',
      throwawayKey(),
      '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
      base64,
      '{"x5c": ["MIIC"]}',
      '',
    ])
      expect(detectX509(no)).toBe(false);
  });

  it('25: readTlv on 30 80 …: indefinite length at byte 0', () => {
    const der = new Uint8Array([0x30, 0x80, 0x02, 0x01, 0x01, 0x00, 0x00]);
    expect(readTlv(der, 0)).toEqual({
      ok: false,
      error: { code: 'indefinite-length', offset: 0, message: 'indefinite length is BER, not DER' },
    });
    expect(parseCertificate(der)).toEqual({
      ok: false,
      message: 'Byte 0: indefinite length is BER, not DER.',
      offset: 0,
    });
  });
});

describe('§6, the rows §10 leaves out', () => {
  it('PEM without END', () => {
    const read = readInput({ text: LEAF.replace('-----END CERTIFICATE-----', '') });
    expect(read.blocks).toEqual([
      { kind: 'error', label: 'CERTIFICATE', message: 'The CERTIFICATE block has no END line.', line: 1 },
    ]);
  });

  it('PEM with broken Base64: the sentence of §6, then the place', () => {
    const read = readInput({ text: LEAF.replace('REUxGzAZ', 'REUx!zAZ') });
    expect(read.blocks[0]).toEqual({
      kind: 'error',
      label: 'CERTIFICATE',
      message: 'The CERTIFICATE block is not valid Base64. Line 3, column 5: invalid character "!".',
      line: 1,
    });
  });

  it('DER that is not a certificate: Byte 0 (a public key is named instead, see input.test.ts)', () => {
    const notCert = new Uint8Array(seq(int(1), int(2), int(3)));
    expect(parseCertificate(notCert)).toEqual({
      ok: false,
      message: 'Byte 0: this is not a certificate (expected a SEQUENCE of three elements).',
      offset: 0,
    });
  });

  it('only a private key: the warning and "No certificate found…"', () => {
    const read = readInput({ text: throwawayKey() });
    expect(read.blocks).toEqual([
      { kind: 'skipped', label: 'PRIVATE KEY', reason: 'private-key', message: PRIVATE_KEY_BLOCK, line: 1 },
    ]);
    expect(read.message).toBe(NO_CERTIFICATE);
  });

  it('21 certificates: the first 20 and a note', () => {
    const read = readInput({ text: LEAF.repeat(21) });
    expect(read.blocks).toHaveLength(20);
    expect(read.message).toBe('Only the first 20 certificates are shown.');
  });

  it('v1 without extensions; notAfter 99991231235959Z: no expiration date', () => {
    const v1 = cert({ text: pem('weak-v1') });
    expect(v1.version).toBe(1);
    expect(v1.extensions).toEqual([]);
    expect(NO_EXTENSIONS).toBe('No extensions');
    expect(v1.notAfter).toMatchObject({ raw: '99991231235959Z', noExpiry: true, valid: true });
    const status = validityStatus(v1.notBefore, v1.notAfter, Date.UTC(2026, 10, 22));
    expect(status).toEqual({ kind: 'valid', until: null });
    expect(validityText(status, Date.UTC(2026, 10, 22))).toBe('Valid: no expiration date');
  });

  it('UTCTime 5001010000Z (no seconds): shown as written, not RFC 5280, no status', () => {
    const parsed = parseCertificate(certificate({ notBefore: utcTime('5001010000Z') }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const c = parsed.certificate;
    expect(c.notBefore).toEqual({
      raw: '5001010000Z',
      type: 'UTCTime',
      valid: false,
      problem: 'a UTCTime must be YYMMDDHHMMSSZ (RFC 5280 §4.1.2.5.1)',
    });
    expect(validityStatus(c.notBefore, c.notAfter, Date.now())).toEqual({ kind: 'unknown' });
    expect(validityText({ kind: 'unknown' }, 0)).toBeUndefined();
    expect(validityPeriod(c.notBefore, c.notAfter)).toBeUndefined();
  });

  it('an unknown extension: its OID, Critical, hex', () => {
    const parsed = parseCertificate(certificate({ extensions: [extension('1.2.3.4', [0xde, 0xad], true)] }));
    expect(parsed.ok && parsed.certificate.extensions).toEqual([
      {
        oid: '1.2.3.4',
        name: '1.2.3.4',
        critical: true,
        value: { kind: 'hex', hex: 'DE:AD' },
        offset: expect.any(Number),
      },
    ]);
  });

  it('the chain line (§5.9)', () => {
    expect(chainText([true, false], 0)).toBe('Issued by certificate 2 (names match; signature not checked)');
    expect(chainText([true, false], 1)).toBe('The next certificate did not issue this one (names differ).');
    expect(chainText([true, false], 2)).toBeUndefined();
    const a = parseCertificate(certificate({ issuer: cn('B'), subject: cn('A') }));
    const b = parseCertificate(certificate({ issuer: cn('C'), subject: cn('B') }));
    if (a.ok && b.ok) expect(chainLinks([a.certificate, b.certificate])).toEqual([true]);
    expect(oid('2.5.4.3')).toEqual([0x06, 0x03, 0x55, 0x04, 0x03]);
  });
});
