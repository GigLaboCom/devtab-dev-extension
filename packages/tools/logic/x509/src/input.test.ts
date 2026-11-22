// What the person gives (docs/tools/specs/x509.md §3) and everything that is not a certificate, named by what it is.
// Private keys are made here, for this run, by node:crypto and never stored; the tool must not read them.
import {
  blockNotes,
  CSR,
  DER_CRL,
  DER_PKCS12,
  DER_PKCS7,
  DER_PUBLIC_KEY,
  NO_CERTIFICATE,
  parseCertificate,
  PRIVATE_KEY_BLOCK,
  PRIVATE_KEY_FILE,
  PRIVATE_KEY_PASTED,
  readInput,
  shapeOf,
} from './index';
import { bits, ctx, int, nul, octet, oid, seq, set, utcTime, cn } from './der-builder';
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pem = (name: string): string => readFileSync(join(__dirname, '../fixtures', `${name}.pem`), 'utf8');
const LEAF = pem('spec-leaf');
const der = (text: string): Uint8Array => {
  const b = readInput({ text }).blocks[0];
  if (b?.kind !== 'certificate') throw new Error('no certificate');
  return b.der;
};
const LEAF_DER = der(LEAF);
const base64 = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString('base64');
const kinds = (input: Parameters<typeof readInput>[0]) =>
  readInput(input).blocks.map(b => (b.kind === 'skipped' ? `skipped ${b.reason}` : b.kind));

// Throwaway keys of every kind node:crypto writes, made for this run.
const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ed = generateKeyPairSync('ed25519');
const PRIVATE_PEMS: Array<[string, string]> = [
  ['PKCS#8', rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()],
  ['PKCS#1 (RSA PRIVATE KEY)', rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()],
  ['SEC 1 (EC PRIVATE KEY)', ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString()],
  ['Ed25519 PKCS#8', ed.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()],
  [
    'ENCRYPTED PRIVATE KEY',
    ec.privateKey
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: randomBytes(8).toString('hex') })
      .toString(),
  ],
  // The OpenSSH format is not one node:crypto writes: its label with random bytes is enough — the body is never read.
  [
    'OPENSSH PRIVATE KEY',
    ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ') +
      `\n${base64(randomBytes(96))}\n` +
      ['-----END', 'OPENSSH PRIVATE KEY-----'].join(' '),
  ],
];
const PRIVATE_DERS: Array<[string, Buffer]> = [
  ['PKCS#8', rsa.privateKey.export({ type: 'pkcs8', format: 'der' })],
  ['PKCS#1', rsa.privateKey.export({ type: 'pkcs1', format: 'der' })],
  ['SEC 1', ec.privateKey.export({ type: 'sec1', format: 'der' })],
  ['Ed25519 PKCS#8', ed.privateKey.export({ type: 'pkcs8', format: 'der' })],
  [
    'encrypted PKCS#8',
    ec.privateKey.export({ type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase: 'throwaway' }),
  ],
];

describe('PEM in text (RFC 7468)', () => {
  it('finds a block with CRLF line ends and text around it', () => {
    const text = `Bag Attributes\r\n    localKeyID: 01\r\n${LEAF.replace(/\n/g, '\r\n')}trailing words`;
    expect(kinds({ text })).toEqual(['certificate']);
  });

  it('accepts X509 CERTIFICATE and X.509 CERTIFICATE (RFC 7468 §5.1)', () => {
    for (const label of ['X509 CERTIFICATE', 'X.509 CERTIFICATE']) {
      const text = LEAF.replace(/CERTIFICATE/g, label);
      expect(readInput({ text }).blocks).toMatchObject([{ kind: 'certificate', label }]);
    }
  });

  it('reads Base64 with line breaks or on one line, and a PEM whose breaks are written \\n (JSON)', () => {
    const body = LEAF.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    expect(kinds({ text: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----` })).toEqual(['certificate']);
    expect(kinds({ text: `-----BEGIN CERTIFICATE-----${body}-----END CERTIFICATE-----` })).toEqual(['certificate']);
    const json = JSON.stringify({ cert: LEAF });
    expect(json).toContain('\\n');
    expect(kinds({ text: json })).toEqual(['certificate']);
  });

  it('an END line for another label is an error, never a certificate', () => {
    const text = LEAF.replace('-----END CERTIFICATE-----', '-----END CERTIFICATE REQUEST-----');
    expect(readInput({ text }).blocks).toEqual([
      {
        kind: 'error',
        label: 'CERTIFICATE',
        message: 'The CERTIFICATE block ends with an END line for "CERTIFICATE REQUEST".',
        line: 1,
      },
    ]);
  });

  it('a block cut by the next BEGIN has no END line; the next block is still read', () => {
    const text = `${LEAF.replace('-----END CERTIFICATE-----\n', '')}${LEAF}`;
    expect(readInput({ text }).blocks).toMatchObject([
      { kind: 'error', message: 'The CERTIFICATE block has no END line.', line: 1 },
      { kind: 'certificate', line: 17 },
    ]);
  });

  it('a BEGIN line without a label, or without its closing dashes, is not a block', () => {
    expect(readInput({ text: '-----BEGIN -----\nMIIB\n-----END -----' })).toMatchObject({
      blocks: [{ kind: 'skipped', reason: 'other', message: 'A "" block is not a certificate; it was skipped.' }],
    });
    expect(readInput({ text: '-----BEGIN CERTIFICATE\nMIIB' })).toEqual({ blocks: [], message: NO_CERTIFICATE });
  });

  it('an empty block', () => {
    expect(readInput({ text: '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----' }).blocks).toMatchObject([
      { kind: 'error', message: 'The CERTIFICATE block is empty.' },
    ]);
  });

  it('TRUSTED CERTIFICATE: the certificate, and a note that the trust settings are not shown', () => {
    const trusted = Buffer.concat([Buffer.from(LEAF_DER), Buffer.from(seq(seq(oid('1.3.6.1.5.5.7.3.1'))))]);
    const text = `-----BEGIN TRUSTED CERTIFICATE-----\n${base64(trusted)}\n-----END TRUSTED CERTIFICATE-----\n`;
    const [block] = readInput({ text }).blocks;
    expect(block).toMatchObject({ kind: 'certificate', trust: true, trailing: trusted.length - LEAF_DER.length });
    expect(blockNotes(block!)).toEqual(['OpenSSL trust settings after the certificate are not shown.']);
    if (block?.kind === 'certificate') expect(parseCertificate(block.der).ok).toBe(true);
  });

  it('bytes after the certificate in a CERTIFICATE block: a warning, the certificate read', () => {
    const extra = Buffer.concat([Buffer.from(LEAF_DER), Buffer.from([0, 0, 1])]);
    const [block] = readInput({ bytes: extra }).blocks;
    expect(blockNotes(block!)).toEqual(['3 extra bytes after the certificate were ignored.']);
    const one = readInput({
      text: `-----BEGIN CERTIFICATE-----\n${base64(Buffer.concat([Buffer.from(LEAF_DER), Buffer.from([0x05])]))}\n-----END CERTIFICATE-----`,
    });
    expect(blockNotes(one.blocks[0]!)).toEqual(['1 extra byte after the certificate was ignored.']);
  });

  it('counts lines for each block', () => {
    const read = readInput({ text: `a\nb\n${LEAF}\n${LEAF}` });
    expect(read.blocks.map(b => b.line)).toEqual([3, 21]);
  });
});

describe('private keys: recognised, named, never read', () => {
  it.each(PRIVATE_PEMS)('a %s block is skipped with the warning; its body is not decoded', (_, key) => {
    expect(readInput({ text: key })).toEqual({
      blocks: [
        {
          kind: 'skipped',
          label: expect.stringMatching(/PRIVATE KEY$/),
          reason: 'private-key',
          message: PRIVATE_KEY_BLOCK,
          line: 1,
        },
      ],
      message: NO_CERTIFICATE,
    });
    // Not decoded: Base64 that is not Base64 at all changes nothing (a decoded body would be an error).
    const broken = key.replace(/\n[A-Za-z0-9+/]{8}/, '\n!!!!!!!!');
    expect(readInput({ text: broken }).blocks[0]).toMatchObject({ reason: 'private-key' });
    // Without an END line it is still a private key, not a "no END line" error that would quote it.
    expect(readInput({ text: key.replace(/-----END[^]*$/, '') }).blocks[0]).toMatchObject({ reason: 'private-key' });
  });

  it('a private key between certificates: both certificates read, the key skipped', () => {
    expect(kinds({ text: `${LEAF}${PRIVATE_PEMS[0]![1]}${LEAF}` })).toEqual([
      'certificate',
      'skipped private-key',
      'certificate',
    ]);
  });

  it.each(PRIVATE_DERS)('DER %s as a file or as Base64: a private key by its shape', (_, bytes) => {
    expect(readInput({ bytes: new Uint8Array(bytes) }).blocks).toEqual([
      { kind: 'skipped', label: 'DER', reason: 'private-key', message: PRIVATE_KEY_FILE, line: 1 },
    ]);
    expect(readInput({ text: base64(bytes) }).blocks).toEqual([
      { kind: 'skipped', label: 'Base64', reason: 'private-key', message: PRIVATE_KEY_PASTED, line: 1 },
    ]);
  });

  it('a PEM private key in a text file says it in the file’s words', () => {
    expect(readInput({ bytes: new TextEncoder().encode(PRIVATE_PEMS[0]![1]) }).blocks[0]).toMatchObject({
      reason: 'private-key',
      message: PRIVATE_KEY_BLOCK,
    });
  });

  it('a CERTIFICATE label on a private key does not make it a certificate', () => {
    const relabelled = PRIVATE_PEMS[0]![1].replace(/PRIVATE KEY/g, 'CERTIFICATE');
    expect(readInput({ text: relabelled }).blocks[0]).toMatchObject({ kind: 'skipped', reason: 'private-key' });
  });
});

describe('what else is recognised and named', () => {
  it('PEM blocks of other kinds: skipped with their label', () => {
    const publicKey = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(readInput({ text: publicKey }).blocks).toEqual([
      {
        kind: 'skipped',
        label: 'PUBLIC KEY',
        reason: 'other',
        message: 'A "PUBLIC KEY" block is not a certificate; it was skipped.',
        line: 1,
      },
    ]);
    for (const label of ['X509 CRL', 'PKCS7', 'CMS', 'RSA PUBLIC KEY', 'NEW CERTIFICATE REQUEST'])
      expect(readInput({ text: `-----BEGIN ${label}-----\nMIIB\n-----END ${label}-----` }).blocks[0]).toMatchObject({
        label,
        reason: label.includes('REQUEST') ? 'csr' : 'other',
      });
  });

  it('DER by shape: public key, request, CRL, PKCS#7, PKCS#12', () => {
    const algorithm = seq(oid('1.2.840.113549.1.1.11'), nul());
    const shapes: Array<[string, number[], string]> = [
      ['public key', Array.from(rsa.publicKey.export({ type: 'spki', format: 'der' })), DER_PUBLIC_KEY],
      [
        'request',
        seq(
          seq(int(0), cn('csr.example'), seq(seq(oid('1.2.840.10045.2.1')), bits([4])), ctx(0)),
          algorithm,
          bits([1]),
        ),
        CSR,
      ],
      ['CRL', seq(seq(int(1), algorithm, cn('ca.example'), utcTime('250101000000Z')), algorithm, bits([1])), DER_CRL],
      ['CRL v1', seq(seq(algorithm, cn('ca.example'), utcTime('250101000000Z')), algorithm, bits([1])), DER_CRL],
      ['PKCS#7', seq(oid('1.2.840.113549.1.7.2'), ctx(0, seq(int(1), set()))), DER_PKCS7],
      ['PKCS#12', seq(int(3), seq(oid('1.2.840.113549.1.7.1'), ctx(0, octet([1, 2]))), seq()), DER_PKCS12],
    ];
    for (const [, bytes, message] of shapes) {
      const shape = shapeOf(new Uint8Array(bytes), 'file');
      expect(shape).toMatchObject({ kind: 'skipped', message });
      expect(readInput({ bytes: new Uint8Array(bytes) }).blocks[0]).toMatchObject({ kind: 'skipped', message });
    }
  });

  it('a certificate is a certificate', () => {
    expect(shapeOf(LEAF_DER, 'file')).toEqual({ kind: 'certificate' });
  });
});

describe('files', () => {
  it('DER when the first byte is 0x30; otherwise text (UTF-8, a byte order mark is fine)', () => {
    expect(kinds({ bytes: LEAF_DER })).toEqual(['certificate']);
    expect(kinds({ bytes: new TextEncoder().encode(`\ufeff${LEAF}`) })).toEqual(['certificate']);
    expect(readInput({ bytes: new Uint8Array([0xff, 0xfe, 0x00]) })).toEqual({ blocks: [], message: NO_CERTIFICATE });
  });

  it('Base64 that is not a SEQUENCE is not taken for DER', () => {
    expect(readInput({ text: 'aGVsbG8gd29ybGQ=' })).toEqual({ blocks: [], message: NO_CERTIFICATE });
  });
});

const OPENSSL = (() => {
  try {
    return spawnSync('openssl', ['version'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!OPENSSL)('real requests, CRLs and PKCS#12 made by OpenSSL (keys thrown away with the folder)', () => {
  it('named by shape, from DER and from PEM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'x509-shapes-'));
    try {
      const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync(
        join(dir, 'ca.cnf'),
        '[ca]\ndefault_ca=d\n[d]\ndatabase=index.txt\ncrlnumber=crlnumber\ndefault_md=sha256\ndefault_crl_days=30\n',
      );
      writeFileSync(join(dir, 'index.txt'), '');
      writeFileSync(join(dir, 'crlnumber'), '01\n');
      run(
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-keyout',
        'k.pem',
        '-subj',
        '/CN=shapes.example',
        '-days',
        '1',
        '-out',
        'c.pem',
      );
      run('req', '-new', '-key', 'k.pem', '-subj', '/CN=csr.example', '-outform', 'DER', '-out', 'r.der');
      run('ca', '-config', 'ca.cnf', '-gencrl', '-keyfile', 'k.pem', '-cert', 'c.pem', '-out', 'crl.pem');
      run('crl', '-in', 'crl.pem', '-outform', 'DER', '-out', 'crl.der');
      run('pkcs12', '-export', '-nokeys', '-in', 'c.pem', '-passout', 'pass:throwaway', '-out', 'p.p12');
      run('crl2pkcs7', '-nocrl', '-certfile', 'c.pem', '-outform', 'DER', '-out', 'p7.der');
      const file = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
      expect(readInput({ bytes: file('r.der') }).blocks[0]).toMatchObject({ reason: 'csr', message: CSR });
      expect(readInput({ bytes: file('crl.der') }).blocks[0]).toMatchObject({ message: DER_CRL });
      expect(readInput({ bytes: file('p.p12') }).blocks[0]).toMatchObject({ message: DER_PKCS12 });
      expect(readInput({ bytes: file('p7.der') }).blocks[0]).toMatchObject({ message: DER_PKCS7 });
      expect(readInput({ text: readFileSync(join(dir, 'crl.pem'), 'utf8') }).blocks[0]).toMatchObject({
        label: 'X509 CRL',
        reason: 'other',
      });
      expect(readInput({ bytes: file('k.pem') }).blocks[0]).toMatchObject({ reason: 'private-key' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
