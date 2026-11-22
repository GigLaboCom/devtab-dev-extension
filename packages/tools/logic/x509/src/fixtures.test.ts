// The generated certificates (fixtures/generate.mjs): every field the generator asked OpenSSL for, read back; and
// Node's own X.509 reader (node:crypto X509Certificate, OpenSSL inside Node) as a second opinion on what both read.
import {
  chainLinks,
  chainText,
  fingerprints,
  parseCertificate,
  readInput,
  spkiSha256,
  validityPeriod,
  validityStatus,
  validityText,
} from './index';
import { describe, expect, it } from 'vitest';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Certificate } from './index';

const DIR = join(__dirname, '../fixtures');
const pem = (name: string): string => readFileSync(join(DIR, `${name}.pem`), 'utf8');
const read = (text: string): Certificate[] =>
  readInput({ text }).blocks.map(b => {
    if (b.kind !== 'certificate') throw new Error(`not a certificate: ${b.kind}`);
    const parsed = parseCertificate(b.der);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.certificate;
  });
const one = (name: string): Certificate => read(pem(name))[0]!;
const lines = (c: Certificate, name: string): string[] => {
  const e = c.extensions.find(x => x.name === name);
  if (!e) throw new Error(`no ${name}`);
  return e.value.kind === 'text' ? e.value.lines : [`hex ${e.value.hex}`];
};
const critical = (c: Certificate) => c.extensions.filter(e => e.critical).map(e => e.name);

const NAMES = readdirSync(DIR)
  .filter(f => f.endsWith('.pem'))
  .map(f => f.slice(0, -4));

describe('every fixture', () => {
  it.each(NAMES)('%s: reads with no error and agrees with node:crypto', async name => {
    const text = pem(name);
    const [c] = read(text);
    const node = new X509Certificate(text);
    expect(Buffer.from(c!.der).equals(node.raw)).toBe(true);
    const prints = await fingerprints(c!.der);
    expect(prints.sha1).toBe(node.fingerprint);
    expect(prints.sha256).toBe(node.fingerprint256);
    // Node writes the serial in uppercase hex with OpenSSL's sign byte rules; ours drops a leading 00.
    expect(c!.serialHex).toBe(node.serialNumber.replace(/^00(?=[89A-F])/, ''));
    expect(c!.notBefore.date?.getTime()).toBe(new Date(node.validFrom).getTime());
    if (!c!.notAfter.noExpiry) expect(c!.notAfter.date?.getTime()).toBe(new Date(node.validTo).getTime());
    // Same names (checkIssued would also want keyCertSign in the key usage).
    expect(c!.selfIssued).toBe(node.subject === node.issuer);
    expect(await spkiSha256(c!.publicKey.spkiDer)).toBe(
      createHash('sha256')
        .update(node.publicKey.export({ type: 'spki', format: 'der' }))
        .digest('base64'),
    );
  });
});

describe('a chain of three: leaf (EC P-256) → issuing CA (RSA 4096) → root (RSA 2048)', () => {
  const chain = read(`${pem('leaf-p256')}${pem('issuing-rsa4096')}${pem('root-rsa2048')}`);
  const [leaf, issuing, root] = chain as [Certificate, Certificate, Certificate];

  it('links every certificate to the next by names, and says the names are all it checked', () => {
    expect(chainLinks(chain)).toEqual([true, true]);
    expect(chainText(chainLinks(chain), 0)).toBe('Issued by certificate 2 (names match; signature not checked)');
    expect(chainLinks([root, leaf])).toEqual([false]);
    expect([leaf.ca, issuing.ca, root.ca]).toEqual([false, true, true]);
    expect([leaf.selfIssued, issuing.selfIssued, root.selfIssued]).toEqual([false, false, true]);
  });

  it('the leaf: a serial of twenty bytes, its names, key and validity', () => {
    expect(leaf.serialHex).toBe('7F0102030405060708090A0B0C0D0E0F10111213');
    expect(leaf.serialDecimal).toBe(BigInt('0x7F0102030405060708090A0B0C0D0E0F10111213').toString());
    expect(leaf.warnings).toEqual([]);
    expect(leaf.subject.rfc4514).toBe('CN=www.example.com,O=Example Tools,L=Berlin,ST=Berlin,C=DE');
    expect(leaf.subject.display).toBe('www.example.com');
    expect(leaf.issuer.rfc4514).toBe('CN=Example Test Issuing CA 1,OU=Issuing,O=Example Tools,C=DE');
    expect(leaf.publicKey.description).toBe('EC P-256');
    expect(leaf.signatureAlgorithm).toBe('RSA PKCS#1 v1.5 with SHA-256');
    expect(leaf.notBefore.raw).toBe('251101000000Z');
    expect(leaf.notAfter.raw).toBe('261201120000Z');
    const now = Date.UTC(2026, 10, 22, 12);
    expect(validityText(validityStatus(leaf.notBefore, leaf.notAfter, now), now)).toBe('Valid: expires in 9 days');
    expect(validityPeriod(leaf.notBefore, leaf.notAfter)).toBe('395 days');
  });

  it('the leaf’s extensions, every one decoded', () => {
    expect(leaf.extensions.map(e => e.name)).toEqual([
      'Basic constraints',
      'Key usage',
      'Extended key usage',
      'Subject alternative names',
      'Subject key identifier',
      'Authority key identifier',
      'Authority information access',
      'CRL distribution points',
      'Certificate policies',
      'TLS feature',
      'Signed certificate timestamps',
      '1.2.3.4.5.6',
    ]);
    expect(critical(leaf)).toEqual(['Basic constraints', 'Key usage']);
    expect(lines(leaf, 'Extended key usage')).toEqual(['TLS server, TLS client, 1.3.6.1.4.1.311.10.3.12']);
    expect(lines(leaf, 'Subject alternative names')).toEqual([
      'DNS www.example.com',
      'DNS *.example.com',
      'DNS xn--bcher-kva.example (bücher.example)',
      'IP 192.0.2.10',
      'IP 2001:db8::1',
      'Email admin@example.com',
      'URI https://www.example.com/',
      'Directory CN=Directory Name,O=Example Tools',
      'Other name 1.3.6.1.4.1.311.20.2.3: user@example.com',
      'Other name 1.3.6.1.5.5.7.8.9: пример@example.com',
      'Registered ID 1.2.3.4',
    ]);
    expect(lines(leaf, 'Authority key identifier')).toEqual([`Key ID ${lines(issuing, 'Subject key identifier')[0]}`]);
    expect(lines(leaf, 'Authority information access')).toEqual([
      'OCSP http://ocsp.example.com/',
      'CA issuers http://ca.example.com/issuing.crt',
    ]);
    expect(lines(leaf, 'CRL distribution points')).toEqual(['URI http://crl.example.com/issuing.crl']);
    expect(lines(leaf, 'Certificate policies')).toEqual(['2.23.140.1.2.1 Domain validated']);
    expect(lines(leaf, 'TLS feature')).toEqual(['status_request (OCSP Must-Staple)']);
    const logOne = createHash('sha256').update('example log one').digest('base64');
    const logTwo = createHash('sha256').update('example log two').digest('base64');
    expect(lines(leaf, 'Signed certificate timestamps')).toEqual([
      '2 SCTs',
      `Log ID ${logOne}, 2025-11-01T00:00:00.123Z`,
      `Log ID ${logTwo}, 2025-11-01T00:01:00Z`,
    ]);
    expect(lines(leaf, '1.2.3.4.5.6')).toEqual([
      'hex 0C:17:45:78:61:6D:70:6C:65:20:65:78:74:65:6E:73:69:6F:6E:20:76:61:6C:75:65',
    ]);
  });

  it('the issuing CA: RSA 4096 and the extensions of a CA', () => {
    expect(issuing.publicKey.description).toBe('RSA 4096-bit, exponent 65537');
    expect(issuing.serialHex).toBe('1000');
    expect(lines(issuing, 'Basic constraints')).toEqual(['CA: yes, path length 0']);
    expect(lines(issuing, 'Key usage')).toEqual(['Digital signature, Certificate signing, CRL signing']);
    expect(lines(issuing, 'Authority key identifier')).toEqual([
      `Key ID ${lines(root, 'Subject key identifier')[0]}`,
      'Issuer Directory CN=Example Test Root CA,O=Example Tools,C=DE',
      'Serial 01',
    ]);
    expect(lines(issuing, 'Issuer alternative names')).toEqual(['DNS ca.example.com', 'Email ca@example.com']);
    expect(lines(issuing, 'Certificate policies')).toEqual([
      '2.5.29.32.0 Any policy',
      'CPS https://example.com/cps',
      'Notice reference: Example Tools, notices 1, 2',
      'User notice: Example notice text',
    ]);
    expect(critical(issuing)).toEqual(['Basic constraints', 'Key usage', 'Name constraints']);
    expect(lines(issuing, 'Name constraints')).toEqual([
      'Permitted DNS example.com',
      'Permitted IP 192.0.2.0/255.255.255.0',
      'Permitted IP 2001:db8::/ffff:ffff::',
      'Permitted Email example.com',
      'Permitted Directory O=Example Tools,C=DE',
      'Excluded DNS forbidden.invalid',
      'Excluded IP 198.51.100.0/255.255.255.0',
    ]);
    expect(lines(issuing, 'CRL distribution points')).toEqual([
      'URI http://crl.example.com/root.crl',
      'Reasons: Key compromise, CA compromise',
      'CRL issuer Directory CN=Example CRL Issuer',
      'Relative name CN=Example Partition 2',
    ]);
    expect(lines(issuing, 'Authority information access')).toEqual([
      'OCSP http://ocsp.example.com/',
      'CA issuers http://ca.example.com/root.crt',
    ]);
  });

  it('the root: RSA 2048, self-issued, its own key identifier', () => {
    expect(root.publicKey.description).toBe('RSA 2048-bit, exponent 65537');
    expect(lines(root, 'Basic constraints')).toEqual(['CA: yes']);
    expect(lines(root, 'Authority key identifier')).toEqual([`Key ID ${lines(root, 'Subject key identifier')[0]}`]);
  });
});

describe('keys and algorithms', () => {
  it.each<[string, string, string, number?]>([
    ['expired-p384', 'EC P-384', 'ECDSA with SHA-384'],
    ['future-p521', 'EC P-521', 'ECDSA with SHA-512'],
    ['ed25519', 'Ed25519', 'Ed25519'],
    ['ed448', 'Ed448', 'Ed448'],
    ['brainpool-p256', 'EC brainpoolP256r1', 'ECDSA with SHA-256'],
    ['rsa-pss', 'RSA-PSS 2048-bit, exponent 65537', 'RSASSA-PSS with SHA-256', 2048],
    ['dsa', 'DSA 2048-bit', '2.16.840.1.101.3.4.3.2', 2048],
    ['ml-dsa-65', 'ML-DSA-65', 'ML-DSA-65'],
    ['weak-v1', 'RSA 1024-bit, exponent 65537', 'RSA PKCS#1 v1.5 with SHA-1', 1024],
  ])('%s: %s, %s', (name, key, signature, bits) => {
    const c = one(name);
    expect(c.publicKey.description).toBe(key);
    expect(c.signatureAlgorithm).toBe(signature);
    if (bits) expect(c.publicKey.bits).toBe(bits);
  });

  it('weak sizes and algorithms are warned about (RSA under 2048, SHA-1)', () => {
    const weak = one('weak-v1');
    expect(weak.publicKey.weak).toBe(true);
    expect(weak.warnings).toEqual([
      'RSA keys shorter than 2048 bits are considered weak.',
      'This signature algorithm is no longer considered secure.',
    ]);
    for (const name of ['root-rsa2048', 'issuing-rsa4096', 'rsa-pss', 'dsa']) expect(one(name).warnings).toEqual([]);
  });
});

describe('validity', () => {
  it('expired, not yet valid (UTCTime 2049 → GeneralizedTime 2051), boundaries included', () => {
    const expired = one('expired-p384');
    const now = Date.UTC(2026, 10, 22);
    expect(validityText(validityStatus(expired.notBefore, expired.notAfter, now), now)).toBe('Expired 5 years ago');
    const future = one('future-p521');
    expect([future.notBefore.type, future.notBefore.raw, future.notAfter.type, future.notAfter.raw]).toEqual([
      'UTCTime',
      '490601000000Z',
      'GeneralizedTime',
      '20510601000000Z',
    ]);
    expect(validityText(validityStatus(future.notBefore, future.notAfter, now), now)).toBe(
      'Not valid yet: starts in 22 years',
    );
    const from = future.notBefore.date!.getTime();
    const to = future.notAfter.date!.getTime();
    expect(validityStatus(future.notBefore, future.notAfter, from).kind).toBe('valid');
    expect(validityStatus(future.notBefore, future.notAfter, to).kind).toBe('valid');
    expect(validityStatus(future.notBefore, future.notAfter, from - 1).kind).toBe('not-yet');
    expect(validityStatus(future.notBefore, future.notAfter, to + 1).kind).toBe('expired');
  });
});

describe('names', () => {
  it('string types, each by its rule; attributes without a short name as #hex in RFC 4514', () => {
    const c = one('strings');
    expect(c.subject.rdns.flat().map(a => [a.label, a.type, a.value])).toEqual([
      ['Country', 'PrintableString', 'DE'],
      ['Organization', 'TeletexString', 'Ex Ämple GmbH'],
      ['Organization', 'TeletexString', 'Example, "Quoted" + Co. <x>; a\\b'],
      ['Organizational unit', 'BMPString', 'Отдел'],
      ['Common name', 'BMPString', 'Smile ☺ example'],
      ['Domain component', 'IA5String', 'example'],
      ['User ID', 'PrintableString', 'user1'],
      ['Serial number', 'PrintableString', '12345'],
      ['Email', 'IA5String', 'info@example.com'],
      ['Title', 'PrintableString', 'Tester'],
      ['Business category', 'PrintableString', 'Private Organization'],
    ]);
    expect(c.subject.rfc4514).toBe(
      [
        '2.5.4.15=#131450726976617465204F7267616E697A6174696F6E',
        '2.5.4.12=#1306546573746572',
        '1.2.840.113549.1.9.1=#1610696E666F406578616D706C652E636F6D',
        '2.5.4.5=#13053132333435',
        'UID=user1',
        'DC=example',
        'CN=Smile ☺ example',
        'OU=Отдел',
        'O=Example\\, \\"Quoted\\" \\+ Co. \\<x\\>\\; a\\\\b',
        'O=Ex Ämple GmbH',
        'C=DE',
      ].join(','),
    );
    expect(c.extensions).toEqual([]);
    expect(c.version).toBe(3);
  });

  it('internationalised names: UTF8String as it is, IDN with its Unicode form, an internationalised mailbox', () => {
    const c = one('idn');
    expect(c.subject.rfc4514).toBe('CN=пример.example,OU=😀 Team,O=例え株式会社,C=JP');
    expect(c.subject.display).toBe('пример.example');
    expect(lines(c, 'Subject alternative names')).toEqual([
      'DNS xn--e1afmkfd.example (пример.example)',
      'Other name 1.3.6.1.5.5.7.8.9: 管理@例え.example',
    ]);
  });

  it('the precertificate poison', () => {
    expect(lines(one('precert'), 'Precertificate poison')).toEqual([
      'This is a precertificate for Certificate Transparency, not a usable certificate.',
    ]);
  });
});
