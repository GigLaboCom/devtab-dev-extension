// OpenSSL as the oracle, when the machine has it (otherwise skipped): every fixture read by `openssl x509` — the
// version, serial, signature algorithm, issuer and subject (RFC 2253), dates, key, fingerprints and every extension of
// `-text` — turned into the tool's words and compared field by field. Where the two disagree on purpose (the
// specification asks for another form) the difference is listed below, and any other difference fails the test.
import { fingerprints, formatIPv6, parseCertificate, readInput } from './index';
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Certificate } from './index';

const OPENSSL = (() => {
  try {
    return spawnSync('openssl', ['version'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
})();
const HEAVY = { timeout: 120_000 };
const DIR = join(__dirname, '../fixtures');
const FIXTURES = readdirSync(DIR)
  .filter(f => f.endsWith('.pem'))
  .map(f => f.slice(0, -4));

const openssl = (file: string, ...args: string[]): string =>
  execFileSync('openssl', ['x509', '-in', join(DIR, `${file}.pem`), '-noout', ...args], { encoding: 'utf8' });

const SIGNATURES: Record<string, string> = {
  sha1WithRSAEncryption: 'RSA PKCS#1 v1.5 with SHA-1',
  sha256WithRSAEncryption: 'RSA PKCS#1 v1.5 with SHA-256',
  'ecdsa-with-SHA256': 'ECDSA with SHA-256',
  'ecdsa-with-SHA384': 'ECDSA with SHA-384',
  'ecdsa-with-SHA512': 'ECDSA with SHA-512',
  ED25519: 'Ed25519',
  ED448: 'Ed448',
  'ML-DSA-65': 'ML-DSA-65',
  dsa_with_SHA256: '2.16.840.1.101.3.4.3.2',
};
const KEY_USAGE: Record<string, string> = {
  'Digital Signature': 'Digital signature',
  'Non Repudiation': 'Content commitment',
  'Key Encipherment': 'Key encipherment',
  'Data Encipherment': 'Data encipherment',
  'Key Agreement': 'Key agreement',
  'Certificate Sign': 'Certificate signing',
  'CRL Sign': 'CRL signing',
  'Encipher Only': 'Encipher only',
  'Decipher Only': 'Decipher only',
};
const PURPOSES: Record<string, string> = {
  'TLS Web Server Authentication': 'TLS server',
  'TLS Web Client Authentication': 'TLS client',
  'Code Signing': 'Code signing',
  'E-mail Protection': 'Email protection',
  'Time Stamping': 'Time stamping',
  'OCSP Signing': 'OCSP signing',
};
const EXTENSIONS: Record<string, string> = {
  'X509v3 Basic Constraints': 'Basic constraints',
  'X509v3 Key Usage': 'Key usage',
  'X509v3 Extended Key Usage': 'Extended key usage',
  'X509v3 Subject Alternative Name': 'Subject alternative names',
  'X509v3 Issuer Alternative Name': 'Issuer alternative names',
  'X509v3 Subject Key Identifier': 'Subject key identifier',
  'X509v3 Authority Key Identifier': 'Authority key identifier',
  'Authority Information Access': 'Authority information access',
  'X509v3 CRL Distribution Points': 'CRL distribution points',
  'X509v3 Certificate Policies': 'Certificate policies',
  'X509v3 Name Constraints': 'Name constraints',
  'TLS Feature': 'TLS feature',
  'CT Precertificate SCTs': 'Signed certificate timestamps',
  'CT Precertificate Poison': 'Precertificate poison',
};
const POLICY_NAMES: Record<string, string> = {
  'X509v3 Any Policy': '2.5.29.32.0 Any policy',
  '2.23.140.1.2.1': '2.23.140.1.2.1 Domain validated',
};
const REASONS: Record<string, string> = {
  'Key Compromise': 'Key compromise',
  'CA Compromise': 'CA compromise',
  'Affiliation Changed': 'Affiliation changed',
  Superseded: 'Superseded',
  'Cessation Of Operation': 'Cessation of operation',
  'Certificate Hold': 'Certificate hold',
  'Privilege Withdrawn': 'Privilege withdrawn',
  'AA Compromise': 'AA compromise',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `/O=Example Tools/CN=Directory Name` or `C = DE, O = Example Tools` → RFC 4514 in reverse order. */
const dirName = (text: string): string => {
  const parts = text.startsWith('/') ? text.slice(1).split('/') : text.split(', ');
  return parts
    .map(p => p.replace(' = ', '='))
    .reverse()
    .join(',');
};
/** OpenSSL's IPv6 `2001:DB8:0:0:0:0:0:1` → RFC 5952. */
const ipv6 = (text: string): string =>
  formatIPv6(new Uint8Array(text.split(':').flatMap(g => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff])));
const ip = (text: string): string =>
  text
    .split('/')
    .map(part => (part.includes(':') ? ipv6(part) : part))
    .join('/');
/** OpenSSL 4.1 does not show the UTF-8 of an other name (SmtpUTF8Mailbox, RFC 9598): a marker, listed below. */
const UNSHOWN = 'Other name 1.3.6.1.5.5.7.8.9: (OpenSSL does not show its UTF-8)';

const generalName = (entry: string): string => {
  const [kind, ...rest] = entry.split(':');
  const value = rest.join(':');
  switch (kind) {
    case 'DNS':
      return `DNS ${value}`;
    case 'IP Address':
    case 'IP':
      return `IP ${ip(value)}`;
    case 'email':
      return `Email ${value}`;
    case 'URI':
      return `URI ${value}`;
    case 'DirName':
      return `Directory ${dirName(value)}`;
    case 'Registered ID':
      return `Registered ID ${value}`;
    case 'othername': {
      const [type, ...v] = value.trim().split(':');
      const oid = type === 'UPN' ? '1.3.6.1.4.1.311.20.2.3' : type === 'SmtpUTF8Mailbox' ? '1.3.6.1.5.5.7.8.9' : type!;
      return type === 'SmtpUTF8Mailbox' ? UNSHOWN : `Other name ${oid}: ${v.join(':')}`;
    }
    default:
      return `?${entry}`;
  }
};

/** The `X509v3 extensions:` part of `-text`: name, critical, value lines. */
const textExtensions = (text: string): Array<{ name: string; critical: boolean; lines: string[] }> => {
  const out: Array<{ name: string; critical: boolean; lines: string[] }> = [];
  const start = text.indexOf('        X509v3 extensions:\n');
  if (start < 0) return out;
  const end = text.indexOf('\n    Signature Algorithm:', start);
  for (const line of text.slice(start, end).split('\n').slice(1)) {
    const header = /^ {12}(\S.*?):( critical)?\s*$/.exec(line);
    if (header) out.push({ name: header[1]!, critical: !!header[2], lines: [] });
    else if (line.trim() !== '') out[out.length - 1]!.lines.push(line);
  }
  return out;
};

/** One extension of `-text` in the tool's words (lines as the tool writes them). */
const toolWords = (name: string, lines: string[]): string[] => {
  const t = lines.map(l => l.trim()).filter(l => l !== '');
  switch (name) {
    case 'X509v3 Basic Constraints': {
      const ca = t[0]!.startsWith('CA:TRUE');
      const path = /pathlen:(\d+)/.exec(t[0]!)?.[1];
      return [`CA: ${ca ? 'yes' : 'no'}${path ? `, path length ${path}` : ''}`];
    }
    case 'X509v3 Key Usage':
      return [
        t[0]!
          .split(', ')
          .map(w => KEY_USAGE[w] ?? w)
          .join(', '),
      ];
    case 'X509v3 Extended Key Usage':
      return [
        t[0]!
          .split(', ')
          .map(w => PURPOSES[w] ?? w)
          .join(', '),
      ];
    case 'X509v3 Subject Alternative Name':
    case 'X509v3 Issuer Alternative Name':
      return t[0]!.split(', ').map(generalName);
    case 'X509v3 Subject Key Identifier':
      return [t[0]!];
    case 'X509v3 Authority Key Identifier':
      return t.map(l =>
        l.startsWith('DirName:')
          ? `Issuer Directory ${dirName(l.slice(8))}`
          : l.startsWith('serial:')
            ? `Serial ${l.slice(7)}`
            : `Key ID ${l.replace(/^keyid:/, '')}`,
      );
    case 'Authority Information Access':
      return t.map(l => l.replace(/^OCSP - URI:/, 'OCSP ').replace(/^CA Issuers - URI:/, 'CA issuers '));
    case 'X509v3 CRL Distribution Points': {
      const out: string[] = [];
      let section = '';
      for (const l of t) {
        if (l.endsWith(':') && !l.includes('//')) section = l;
        else if (section === 'Full Name:') out.push(generalName(l));
        else if (section === 'Reasons:')
          out.push(
            `Reasons: ${l
              .split(', ')
              .map(w => REASONS[w] ?? w)
              .join(', ')}`,
          );
        else if (section === 'CRL Issuer:') out.push(`CRL issuer ${generalName(l)}`);
        else if (section === 'Relative Name:') out.push(`Relative name ${dirName(l)}`);
      }
      return out;
    }
    case 'X509v3 Certificate Policies': {
      const out: string[] = [];
      let organization = '';
      for (const l of t) {
        if (l.startsWith('Policy: ')) out.push(POLICY_NAMES[l.slice(8)] ?? l.slice(8));
        else if (l.startsWith('CPS: ')) out.push(`CPS ${l.slice(5)}`);
        else if (l.startsWith('Organization: ')) organization = l.slice(14);
        else if (l.startsWith('Numbers: '))
          out.push(`Notice reference: ${organization}, ${l.includes(',') ? 'notices' : 'notice'} ${l.slice(9)}`);
        else if (l.startsWith('Explicit Text: ')) out.push(`User notice: ${l.slice(15)}`);
      }
      return out;
    }
    case 'X509v3 Name Constraints': {
      const out: string[] = [];
      let word = '';
      for (const l of t) {
        if (l === 'Permitted:' || l === 'Excluded:') word = l.slice(0, -1);
        else out.push(`${word} ${generalName(l)}`);
      }
      return out;
    }
    case 'TLS Feature':
      return t.map(l => (l === 'status_request' ? 'status_request (OCSP Must-Staple)' : l));
    case 'CT Precertificate Poison':
      return ['This is a precertificate for Certificate Transparency, not a usable certificate.'];
    case 'CT Precertificate SCTs': {
      const out: string[] = [];
      let logId = '';
      let collecting = false;
      for (const l of t) {
        if (l.startsWith('Log ID    : ')) {
          logId = l.slice(12);
          collecting = true;
        } else if (collecting && /^[0-9A-F:]+$/.test(l)) logId += l;
        else if (l.startsWith('Timestamp : ')) {
          collecting = false;
          const m = /^(\w{3}) +(\d+) (\d\d):(\d\d):(\d\d)\.(\d{3}) (\d{4}) GMT$/.exec(l.slice(12))!;
          const ms = Date.UTC(+m[7]!, MONTHS.indexOf(m[1]!), +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
          const iso = new Date(ms).toISOString().replace('.000Z', 'Z');
          out.push(`Log ID ${Buffer.from(logId.replace(/:/g, ''), 'hex').toString('base64')}, ${iso}`);
        } else collecting = false;
      }
      return [`${out.length} ${out.length === 1 ? 'SCT' : 'SCTs'}`, ...out];
    }
    default:
      return [];
  }
};

/** Differences that are the specification's choice, not mistakes: `fixture: field: openssl … | tool …`. */
const EXPECTED_DIFFERENCES = [
  // IDN: the tool adds the Unicode form of an A-label after it.
  'idn: Subject alternative names: DNS xn--e1afmkfd.example | DNS xn--e1afmkfd.example (пример.example)',
  // OpenSSL 4.1 prints an SmtpUTF8Mailbox (RFC 9598) byte by byte, not as UTF-8; the tool decodes it.
  'idn: Subject alternative names: OpenSSL does not show the UTF-8 of | Other name 1.3.6.1.5.5.7.8.9: 管理@例え.example',
  // The authority key identifier's serial: OpenSSL drops the leading zero, the tool writes the bytes (as it writes the
  // certificate's own serial, §5.3).
  'issuing-rsa4096: Authority key identifier: Serial 1 | Serial 01',
  'leaf-p256: Subject alternative names: DNS xn--bcher-kva.example | DNS xn--bcher-kva.example (bücher.example)',
  'leaf-p256: Subject alternative names: OpenSSL does not show the UTF-8 of | Other name 1.3.6.1.5.5.7.8.9: пример@example.com',
  // §5.5: attributes without a short name in the table are written as OID=#hex; OpenSSL has names for them.
  'strings: subject: businessCategory=Private Organization | 2.5.4.15=#131450726976617465204F7267616E697A6174696F6E',
  'strings: subject: title=Tester | 2.5.4.12=#1306546573746572',
  'strings: subject: emailAddress=info@example.com | 1.2.840.113549.1.9.1=#1610696E666F406578616D706C652E636F6D',
  'strings: subject: serialNumber=12345 | 2.5.4.5=#13053132333435',
  'strings: issuer: businessCategory=Private Organization | 2.5.4.15=#131450726976617465204F7267616E697A6174696F6E',
  'strings: issuer: title=Tester | 2.5.4.12=#1306546573746572',
  'strings: issuer: emailAddress=info@example.com | 1.2.840.113549.1.9.1=#1610696E666F406578616D706C652E636F6D',
  'strings: issuer: serialNumber=12345 | 2.5.4.5=#13053132333435',
];

const ours = (file: string): Certificate => {
  const block = readInput({ text: readFileSync(join(DIR, `${file}.pem`), 'utf8') }).blocks[0];
  if (block?.kind !== 'certificate') throw new Error(file);
  const r = parseCertificate(block.der);
  if (!r.ok) throw new Error(r.message);
  return r.certificate;
};

/** Splits an RFC 2253 string at the commas that separate RDNs (not `\,`). */
const rdns = (text: string): string[] => text.split(/(?<!\\),/);

describe.skipIf(!OPENSSL)('openssl x509 reads every fixture as the tool does', () => {
  it('field by field; the only differences are the listed ones', HEAVY, async () => {
    const differences: string[] = [];
    const compare = (file: string, field: string, theirs: string, mine: string) => {
      if (theirs !== mine) differences.push(`${file}: ${field}: ${theirs} | ${mine}`);
    };
    for (const file of FIXTURES) {
      const c = ours(file);
      const text = openssl(file, '-text', '-nameopt', 'RFC2253,-esc_msb');
      compare(file, 'version', /Version: (\d)/.exec(text)![1]!, String(c.version));
      compare(file, 'serial', openssl(file, '-serial').trim().replace('serial=', ''), c.serialHex);
      const signature = /Signature Algorithm: (\S+)/.exec(text)![1]!;
      const pss = /Hash Algorithm: (\w+)/.exec(text)?.[1];
      compare(
        file,
        'signature algorithm',
        signature === 'rsassaPss'
          ? `RSASSA-PSS with ${pss!.toUpperCase().replace('SHA', 'SHA-')}`
          : (SIGNATURES[signature] ?? signature),
        c.signatureAlgorithm,
      );
      for (const [field, name] of [
        ['subject', c.subject],
        ['issuer', c.issuer],
      ] as const) {
        const theirs = rdns(openssl(file, `-${field}`, '-nameopt', 'RFC2253,-esc_msb').trim().replace(`${field}=`, ''));
        const mine = rdns(name.rfc4514);
        expect(theirs.length, `${file} ${field} RDNs`).toBe(mine.length);
        theirs.forEach((t, i) => compare(file, field, t, mine[i]!));
      }
      const dates = openssl(file, '-dates', '-dateopt', 'iso_8601');
      for (const [which, time] of [
        ['notBefore', c.notBefore],
        ['notAfter', c.notAfter],
      ] as const) {
        const iso = new RegExp(`${which}=(\\S+) (\\S+)Z`).exec(dates)!;
        compare(file, which, String(Date.parse(`${iso[1]}T${iso[2]}Z`)), String(time.date?.getTime()));
      }
      const bits = /Public-Key: \((\d+) bit/.exec(text)?.[1];
      if (bits && c.publicKey.bits !== undefined) compare(file, 'key bits', bits, String(c.publicKey.bits));
      const curve = /NIST CURVE: (\S+)/.exec(text)?.[1] ?? /ASN1 OID: (\S+)/.exec(text)?.[1];
      if (curve && c.publicKey.name === 'EC') compare(file, 'curve', curve, c.publicKey.description.replace('EC ', ''));
      const exponent = /Exponent: (\d+)/.exec(text)?.[1];
      if (exponent) compare(file, 'exponent', exponent, /exponent (\d+)/.exec(c.publicKey.description)![1]!);
      const prints = await fingerprints(c.der);
      compare(file, 'SHA-1', openssl(file, '-fingerprint', '-sha1').trim().split('=')[1]!, prints.sha1);
      compare(file, 'SHA-256', openssl(file, '-fingerprint', '-sha256').trim().split('=')[1]!, prints.sha256);
      const theirs = textExtensions(text);
      const known = c.extensions.filter(e => e.value.kind === 'text');
      expect(
        theirs.filter(e => EXTENSIONS[e.name]).map(e => EXTENSIONS[e.name]),
        `${file}: extensions`,
      ).toEqual(known.map(e => e.name));
      for (const t of theirs) {
        const mine = c.extensions.find(e => e.name === EXTENSIONS[t.name] || e.oid === t.name);
        if (!mine) {
          differences.push(`${file}: ${t.name}: missing`);
          continue;
        }
        compare(file, `${mine.name} critical`, String(t.critical), String(mine.critical));
        if (!EXTENSIONS[t.name] || mine.value.kind !== 'text') continue;
        const words = toolWords(t.name, t.lines);
        expect(words.length, `${file}: ${mine.name} lines`).toBe(mine.value.lines.length);
        words.forEach((w, i) => {
          const line = (mine.value as { lines: string[] }).lines[i]!;
          compare(
            file,
            mine.name,
            w,
            w === UNSHOWN ? line.replace(/: .*$/, ': (OpenSSL does not show its UTF-8)') : line,
          );
          if (w === UNSHOWN) differences.push(`${file}: ${mine.name}: OpenSSL does not show the UTF-8 of | ${line}`);
        });
      }
    }
    expect(differences).toEqual(EXPECTED_DIFFERENCES);
  });
});
