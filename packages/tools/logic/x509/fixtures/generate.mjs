#!/usr/bin/env node
// Makes the X.509 tool's test certificates with OpenSSL (3.5 or later: ML-DSA, -not_before / -not_after):
//
//   node packages/tools/logic/x509/fixtures/generate.mjs
//
// Every key is generated in a temporary directory, used to sign, and deleted with it: no private key is ever written
// here. Names are invented (example.com, *.invalid, the documentation addresses of RFC 5737 / RFC 3849). Keys and
// signatures are random, so a new run gives new bytes: the tests read what they expect from the certificates' own
// fields and from `openssl x509 -text` (oracle.test.ts), never from a copy of old output — except the specification's
// three fixtures (spec.ts), which are fixed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'x509-fixtures-'));
const openssl = (...args) => {
  try {
    return execFileSync('openssl', args, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`openssl ${args.join(' ')}\n${error.stderr?.toString() ?? error}`);
  }
};
const write = (name, text) => writeFileSync(join(tmp, name), text);

/** A key of this kind in tmp/<name>.key. */
const key = (name, ...genpkey) => openssl('genpkey', ...genpkey, '-out', `${name}.key`);

/** DER of an OCTET STRING-wrapped TLS SignedCertificateTimestampList (RFC 6962 §3.3) with two invented SCTs. */
const sctList = () => {
  const u16 = n => [(n >> 8) & 0xff, n & 0xff];
  const u64 = n => {
    const out = [];
    for (let i = 7; i >= 0; i--) out.push(Number((BigInt(n) >> BigInt(8 * i)) & 0xffn));
    return out;
  };
  const sct = (logName, ms) => {
    const logId = [...createHash('sha256').update(logName).digest()];
    // An ECDSA signature's shape (SEQUENCE of two INTEGERs); the values are invented, nothing verifies them.
    const r = [...createHash('sha256').update(`${logName} r`).digest()].map((b, i) => (i === 0 ? b & 0x7f : b));
    const s = [...createHash('sha256').update(`${logName} s`).digest()].map((b, i) => (i === 0 ? b & 0x7f : b));
    const signature = [0x30, 68, 0x02, 32, ...r, 0x02, 32, ...s];
    const body = [0, ...logId, ...u64(ms), ...u16(0), 4, 3, ...u16(signature.length), ...signature];
    return [...u16(body.length), ...body];
  };
  const list = [...sct('example log one', 1761955200123), ...sct('example log two', 1761955260000)];
  const tls = [...u16(list.length), ...list];
  const len = tls.length < 0x80 ? [tls.length] : tls.length < 0x100 ? [0x81, tls.length] : [0x82, ...u16(tls.length)];
  return Buffer.from([0x04, ...len, ...tls])
    .toString('hex')
    .toUpperCase();
};

/**
 * One certificate: a config with [dn] and [ext], signed by `ca` (another fixture's name) or by itself. `dates` are
 * [notBefore, notAfter] as OpenSSL's -not_before / -not_after take them (YYYYMMDDHHMMSSZ).
 */
const certificate = ({
  name,
  keyArgs,
  dn,
  ext = '',
  ca,
  serial,
  dates,
  digest = ['-sha256'],
  mask,
  sigopts = [],
  v1,
}) => {
  key(name, ...keyArgs);
  const config = [
    '[req]',
    'distinguished_name = dn',
    'prompt = no',
    'utf8 = yes',
    `string_mask = ${mask ?? 'utf8only'}`,
    '[dn]',
    dn.trim(),
    '[ext]',
    ext.trim(),
    '',
  ].join('\n');
  write(`${name}.cnf`, config);
  const common = ['-set_serial', serial, '-not_before', dates[0], '-not_after', dates[1], ...digest, ...sigopts];
  if (ca) {
    openssl(
      'req',
      '-new',
      '-key',
      `${name}.key`,
      '-config',
      `${name}.cnf`,
      '-out',
      `${name}.csr`,
      ...(mask ? [] : ['-utf8']),
    );
    openssl(
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      `${ca}.pem`,
      '-CAkey',
      `${ca}.key`,
      '-extfile',
      `${name}.cnf`,
      '-extensions',
      'ext',
      '-out',
      `${name}.pem`,
      ...common,
    );
  } else {
    openssl(
      'req',
      '-new',
      '-x509',
      ...(v1 ? ['-x509v1'] : ['-extensions', 'ext']),
      '-key',
      `${name}.key`,
      '-config',
      `${name}.cnf`,
      '-out',
      `${name}.pem`,
      ...common,
    );
  }
  const pem = readFileSync(join(tmp, `${name}.pem`), 'utf8');
  writeFileSync(join(OUT, `${name}.pem`), pem);
};

const RSA = bits => ['-algorithm', 'RSA', '-pkeyopt', `rsa_keygen_bits:${bits}`];
const EC = curve => ['-algorithm', 'EC', '-pkeyopt', `ec_paramgen_curve:${curve}`];

try {
  // A chain of three: root (RSA 2048) → issuing CA (RSA 4096) → leaf (EC P-256).
  certificate({
    name: 'root-rsa2048',
    keyArgs: RSA(2048),
    serial: '0x01',
    dates: ['20250101000000Z', '20450101000000Z'],
    dn: 'C = DE\nO = Example Tools\nCN = Example Test Root CA',
    ext: `
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always`,
  });
  certificate({
    name: 'issuing-rsa4096',
    keyArgs: RSA(4096),
    ca: 'root-rsa2048',
    serial: '0x1000',
    dates: ['20250101000000Z', '20350101000000Z'],
    dn: 'C = DE\nO = Example Tools\nOU = Issuing\nCN = Example Test Issuing CA 1',
    ext: `
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, digitalSignature, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always, issuer:always
issuerAltName = DNS:ca.example.com, email:ca@example.com
certificatePolicies = @policy_any
nameConstraints = critical, permitted;DNS:example.com, permitted;IP:192.0.2.0/255.255.255.0, permitted;IP:2001:db8::/ffff:ffff::, permitted;email:example.com, permitted;dirName:nc_dir, excluded;DNS:forbidden.invalid, excluded;IP:198.51.100.0/255.255.255.0
crlDistributionPoints = crl_full, crl_relative
authorityInfoAccess = OCSP;URI:http://ocsp.example.com/, caIssuers;URI:http://ca.example.com/root.crt
[policy_any]
policyIdentifier = 2.5.29.32.0
CPS.1 = "https://example.com/cps"
userNotice.1 = @notice
[notice]
explicitText = "Example notice text"
organization = "Example Tools"
noticeNumbers = 1, 2
[nc_dir]
C = DE
O = Example Tools
[crl_full]
fullname = URI:http://crl.example.com/root.crl
reasons = keyCompromise, CACompromise
CRLissuer = dirName:crl_issuer
[crl_issuer]
CN = Example CRL Issuer
[crl_relative]
relativename = crl_relative_dn
[crl_relative_dn]
CN = Example Partition 2`,
  });
  certificate({
    name: 'leaf-p256',
    keyArgs: EC('P-256'),
    ca: 'issuing-rsa4096',
    // Twenty bytes, the most RFC 5280 §4.1.2.2 allows, the first below 0x80 so no sign byte is needed.
    serial: '0x7F0102030405060708090A0B0C0D0E0F10111213',
    dates: ['20251101000000Z', '20261201120000Z'],
    dn: 'C = DE\nST = Berlin\nL = Berlin\nO = Example Tools\nCN = www.example.com',
    ext: `
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth, clientAuth, 1.3.6.1.4.1.311.10.3.12
subjectAltName = @san
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
authorityInfoAccess = OCSP;URI:http://ocsp.example.com/, caIssuers;URI:http://ca.example.com/issuing.crt
crlDistributionPoints = URI:http://crl.example.com/issuing.crl
certificatePolicies = 2.23.140.1.2.1
tlsfeature = status_request
1.3.6.1.4.1.11129.2.4.2 = DER:${sctList()}
1.2.3.4.5.6 = ASN1:UTF8String:Example extension value
[san]
DNS.1 = www.example.com
DNS.2 = *.example.com
DNS.3 = xn--bcher-kva.example
IP.1 = 192.0.2.10
IP.2 = 2001:db8::1
email.1 = admin@example.com
URI.1 = https://www.example.com/
dirName.1 = san_dir
otherName.1 = 1.3.6.1.4.1.311.20.2.3;UTF8:user@example.com
otherName.2 = 1.3.6.1.5.5.7.8.9;FORMAT:UTF8,UTF8:пример@example.com
RID.1 = 1.2.3.4
[san_dir]
O = Example Tools
CN = Directory Name`,
  });

  certificate({
    name: 'expired-p384',
    keyArgs: EC('P-384'),
    serial: '0x0E',
    dates: ['20200101000000Z', '20210101000000Z'],
    digest: ['-sha384'],
    dn: 'CN = expired.example.com',
    ext: 'basicConstraints = critical, CA:false\nsubjectAltName = DNS:expired.example.com',
  });
  certificate({
    name: 'future-p521',
    keyArgs: EC('P-521'),
    serial: '0x0F',
    // notBefore in 2049 is a UTCTime, notAfter in 2051 a GeneralizedTime (RFC 5280 §4.1.2.5).
    dates: ['20490601000000Z', '20510601000000Z'],
    digest: ['-sha512'],
    dn: 'CN = future.example.com',
    ext: 'subjectAltName = DNS:future.example.com',
  });
  certificate({
    name: 'ed25519',
    keyArgs: ['-algorithm', 'ed25519'],
    serial: '0x25519',
    dates: ['20250101000000Z', '20350101000000Z'],
    digest: [],
    dn: 'CN = ed25519.example',
    ext: 'basicConstraints = critical, CA:true\nsubjectKeyIdentifier = hash',
  });
  certificate({
    name: 'ed448',
    keyArgs: ['-algorithm', 'ed448'],
    serial: '0x448',
    dates: ['20250101000000Z', '20350101000000Z'],
    digest: [],
    dn: 'CN = ed448.example',
    ext: 'keyUsage = critical, digitalSignature',
  });
  certificate({
    name: 'brainpool-p256',
    keyArgs: EC('brainpoolP256r1'),
    serial: '0x0B',
    dates: ['20250101000000Z', '20350101000000Z'],
    dn: 'CN = brainpool.example',
    ext: 'subjectAltName = DNS:brainpool.example',
  });
  // Weak on purpose: RSA 1024, SHA-1, version 1 (no extensions), no expiration date.
  certificate({
    name: 'weak-v1',
    keyArgs: RSA(1024),
    serial: '5',
    dates: ['20200101000000Z', '99991231235959Z'],
    digest: ['-sha1'],
    v1: true,
    dn: 'CN = weak.invalid',
  });
  certificate({
    name: 'rsa-pss',
    keyArgs: ['-algorithm', 'RSA-PSS', '-pkeyopt', 'rsa_keygen_bits:2048'],
    serial: '0x55',
    dates: ['20250101000000Z', '20350101000000Z'],
    sigopts: ['-sigopt', 'rsa_padding_mode:pss', '-sigopt', 'rsa_pss_saltlen:32'],
    dn: 'CN = pss.example',
    ext: 'basicConstraints = CA:false',
  });
  openssl('genpkey', '-genparam', '-algorithm', 'DSA', '-pkeyopt', 'pbits:2048', '-out', 'dsa.params');
  certificate({
    name: 'dsa',
    keyArgs: ['-paramfile', 'dsa.params'],
    serial: '0x0D',
    dates: ['20250101000000Z', '20350101000000Z'],
    dn: 'CN = dsa.example',
    ext: 'basicConstraints = CA:false',
  });
  certificate({
    name: 'ml-dsa-65',
    keyArgs: ['-algorithm', 'ML-DSA-65'],
    serial: '0x65',
    dates: ['20250101000000Z', '20350101000000Z'],
    digest: [],
    dn: 'CN = ml-dsa.example',
    ext: 'keyUsage = critical, digitalSignature',
  });
  // The string types of a Name (no UTF8String in the mask: PrintableString, TeletexString, IA5String, BMPString —
  // OpenSSL takes the narrowest that fits; it refuses to write a UniversalString, which the unit tests build by hand),
  // characters RFC 4514 escapes, and attributes without a short name.
  certificate({
    name: 'strings',
    keyArgs: EC('P-256'),
    serial: '0x5E',
    dates: ['20250101000000Z', '20350101000000Z'],
    mask: 'MASK:0x956',
    dn: `
C = DE
0.O = Ex Ämple GmbH
1.O = Example\\, \\"Quoted\\" + Co. <x>; a\\\\b
OU = Отдел
CN = Smile ☺ example
DC = example
UID = user1
serialNumber = 12345
emailAddress = info@example.com
title = Tester
businessCategory = Private Organization`,
    ext: 'subjectKeyIdentifier = none\nauthorityKeyIdentifier = none',
  });
  // Internationalised names: UTF8String in the subject, an IDN (A-label) and an internationalised e-mail address.
  certificate({
    name: 'idn',
    keyArgs: EC('P-256'),
    serial: '0x1D',
    dates: ['20250101000000Z', '20350101000000Z'],
    dn: 'C = JP\nO = 例え株式会社\nOU = 😀 Team\nCN = пример.example',
    ext: `
subjectAltName = @idn_san
[idn_san]
DNS.1 = xn--e1afmkfd.example
otherName.1 = 1.3.6.1.5.5.7.8.9;FORMAT:UTF8,UTF8:管理@例え.example`,
  });
  // A Certificate Transparency precertificate (RFC 6962 §3.1): the poison extension, critical.
  certificate({
    name: 'precert',
    keyArgs: EC('P-256'),
    serial: '0x9C',
    dates: ['20250101000000Z', '20350101000000Z'],
    dn: 'CN = precert.example.com',
    ext: '1.3.6.1.4.1.11129.2.4.3 = critical, DER:0500\nsubjectAltName = DNS:precert.example.com',
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
