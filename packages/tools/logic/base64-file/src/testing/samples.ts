/**
 * Byte samples of every type of docs/tools/specs/base64-file.md §5.2, built here from their signatures and structures
 * (a ZIP writer, a DER writer), plus a real certificate and request made by OpenSSL 4.1.0 for `CN=example.test` (public
 * material: no key is stored here — the keys of the tests are made by node:crypto when they run).
 */
export const bytes = (...parts: Array<string | number[] | Uint8Array>): Uint8Array => {
  const chunks = parts.map(p =>
    typeof p === 'string' ? Uint8Array.from(p, c => c.charCodeAt(0)) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const zeros = (n: number): number[] => new Array<number>(n).fill(0);
/** Bytes that are plainly not text (a NUL and high bytes), of length n. */
export const binary = (n: number, seed = 7): Uint8Array => {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  if (n > 0) out[0] = 0;
  return out;
};

const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const u32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** A ZIP of stored (or deflated) entries with a central directory (PKWARE APPNOTE §4.3), CRCs left 0. */
export const zip = (entries: ReadonlyArray<[name: string, content: string, deflate?: boolean]>): Uint8Array => {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    // «Deflated» entries keep their bytes as they are: the tool reads names, never contents.
    const data = utf8(content);
    const method = deflate ? 8 : 0;
    const local = bytes(
      [0x50, 0x4b, 3, 4],
      u16(20),
      u16(0),
      u16(method),
      u32(0),
      u32(0),
      u32(data.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
      data,
    );
    centrals.push(
      bytes(
        [0x50, 0x4b, 1, 2],
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u32(0),
        u32(0),
        u32(data.length),
        u32(content.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = bytes(...centrals);
  return bytes(
    ...locals,
    directory,
    [0x50, 0x4b, 5, 6],
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  );
};

export const EMPTY_ZIP = bytes([0x50, 0x4b, 5, 6], zeros(18));

// ---- DER writer (lengths in the shortest form)

const len = (n: number): number[] => {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return [0x80 | out.length, ...out];
};
export const tlv = (tag: number, ...content: Uint8Array[]): Uint8Array => {
  const body = bytes(...content);
  return bytes([tag], len(body.length), body);
};
export const seq = (...items: Uint8Array[]): Uint8Array => tlv(0x30, ...items);
export const int = (n: number): Uint8Array => tlv(0x02, Uint8Array.from(n < 0x80 ? [n] : [0, n]));
export const oid = (dotted: string): Uint8Array => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const groups: number[] = [];
    for (let v = n; ; v = Math.floor(v / 128)) {
      groups.unshift(v & 127);
      if (v < 128) break;
    }
    out.push(...groups.map((g, i) => (i < groups.length - 1 ? g | 128 : g)));
  }
  return tlv(0x06, Uint8Array.from(out));
};
export const octets = (data: Uint8Array): Uint8Array => tlv(0x04, data);
export const bits = (data: Uint8Array): Uint8Array => tlv(0x03, bytes([0], data));
export const utc = (text: string): Uint8Array => tlv(0x17, utf8(text));
export const ctx = (n: number, ...content: Uint8Array[]): Uint8Array => tlv(0xa0 | n, ...content);
const alg = seq(oid('1.2.840.10045.4.3.2'));
const name = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, utf8('example.test')))));

/** OpenSSL 4.1.0: `openssl req -new -x509 -key <EC P-256> -subj /CN=example.test -outform DER` (358 bytes). */
export const CERTIFICATE_DER_B64 =
  'MIIBYjCCAQigAwIBAgIULI/FBMKhSjIE/HAWbdttARxSji4wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MB4XDTI2MTEyMjE1Mzc0M1oXDTM2MTExOTE1Mzc0M1owFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExHhGxRbzc/vXd9NpQxxuDnhyfGNj3f6Oq7qH5NKHSvps4yWCZzZN4DS5kPcphGK8gXn3jx54Vx6dSmx+cTRQgKMyMDAwHQYDVR0OBBYEFPhazzmPwIPHYkS2TjlJhfCH3WfPMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgDQSV9KY44EE+Bx9+nufzUAVbwnj6ZHCVCenks7UP6Q0CIQC4S8A1ycdgwDRy0o9ZTLb5l4Z95Mge5wVVmKLqhi8zBA==';
/** OpenSSL 4.1.0: `openssl req -new -key <the same key> -subj /CN=example.test -outform DER` (212 bytes). */
export const REQUEST_DER_B64 =
  'MIHRMHkCAQAwFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExHhGxRbzc/vXd9NpQxxuDnhyfGNj3f6Oq7qH5NKHSvps4yWCZzZN4DS5kPcphGK8gXn3jx54Vx6dSmx+cTRQgKAAMAoGCCqGSM49BAMCA0gAMEUCIC0RFGS1iM2kySEDtnA05eGWwMPT2302K1NBddyeV44GAiEA2IbS1Q8ZFoYkMaLrsTwTn6IbhtkmbIPeDH5jYKBvZUc=';

export const fromB64 = (b64: string): Uint8Array => Uint8Array.from(Buffer.from(b64, 'base64'));

/** A CRL's shape (RFC 5280 §5.1): version 2, signature, issuer, thisUpdate, nextUpdate. */
export const CRL = seq(
  seq(int(1), alg, name, utc('261122000000Z'), utc('261222000000Z')),
  alg,
  bits(Uint8Array.from([1, 2, 3])),
);
/** A PKCS #7 certificate bundle's shape (RFC 5652 §3): signedData and its content. */
export const PKCS7 = seq(oid('1.2.840.113549.1.7.2'), ctx(0, seq(int(1), tlv(0x31), seq(oid('1.2.840.113549.1.7.1')))));
/** A PFX's shape (RFC 7292 §4): version 3, ContentInfo of data, MacData. */
export const PKCS12 = seq(
  int(3),
  seq(oid('1.2.840.113549.1.7.1'), ctx(0, octets(Uint8Array.from([0x30, 0x00])))),
  seq(seq(seq(oid('1.3.14.3.2.26'), tlv(0x05)), octets(new Uint8Array(20))), octets(new Uint8Array(8)), int(100)),
);
/** DER that is none of the named forms: SEQUENCE { BOOLEAN TRUE, UTF8String }. */
export const OTHER_DER = seq(tlv(0x01, Uint8Array.from([0xff])), tlv(0x0c, utf8('other')));

/** A ustar header (POSIX.1-2024 pax, «ustar Interchange Format») with its checksum, and one empty block. */
export const tar = (): Uint8Array => {
  const h = new Uint8Array(512);
  const put = (at: number, text: string) => h.set(utf8(text), at);
  put(0, 'hello.txt');
  put(100, '0000644\0');
  put(108, '0000000\0');
  put(116, '0000000\0');
  put(124, '00000000000\0');
  put(136, '00000000000\0');
  put(156, '0');
  put(257, 'ustar\0');
  put(263, '00');
  for (let i = 148; i < 156; i++) h[i] = 32;
  const sum = h.reduce((a, b) => a + b, 0);
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return bytes(h, new Uint8Array(512));
};

const ftyp = (major: string, ...compatible: string[]): Uint8Array =>
  bytes(be32(16 + 4 * compatible.length), 'ftyp', major, [0, 0, 0, 0], ...compatible, binary(32));
const sfntHeader = (version: string | number[]): Uint8Array =>
  bytes(version, [0, 1, 0, 16, 0, 0, 0, 0], 'head', zeros(12), binary(64));

/** One sample per type (id → bytes). */
export const SAMPLES: ReadonlyArray<[id: string, bytes: Uint8Array]> = [
  ['pdf', bytes('%PDF-1.7\n%', [0xe2, 0xe3, 0xcf, 0xd3], '\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')],
  ['zip', zip([['hello.txt', 'hello']])],
  ['zip', EMPTY_ZIP],
  [
    'docx',
    zip([
      ['[Content_Types].xml', '<Types/>'],
      ['_rels/.rels', '<Relationships/>'],
      ['word/document.xml', '<w:document/>', true],
    ]),
  ],
  [
    'xlsx',
    zip([
      ['[Content_Types].xml', '<Types/>'],
      ['xl/workbook.xml', '<workbook/>', true],
    ]),
  ],
  [
    'pptx',
    zip([
      ['[Content_Types].xml', '<Types/>'],
      ['ppt/presentation.xml', '<p/>', true],
    ]),
  ],
  [
    'odt',
    zip([
      ['mimetype', 'application/vnd.oasis.opendocument.text'],
      ['content.xml', '<x/>', true],
    ]),
  ],
  ['ods', zip([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet']])],
  ['odp', zip([['mimetype', 'application/vnd.oasis.opendocument.presentation']])],
  ['odg', zip([['mimetype', 'application/vnd.oasis.opendocument.graphics']])],
  [
    'epub',
    zip([
      ['mimetype', 'application/epub+zip'],
      ['META-INF/container.xml', '<container/>'],
    ]),
  ],
  [
    'jar',
    zip([
      ['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\n'],
      ['A.class', 'x'],
    ]),
  ],
  [
    'apk',
    zip([
      ['AndroidManifest.xml', 'x'],
      ['classes.dex', 'dex\n035'],
      ['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\n'],
    ]),
  ],
  // RFC 1952 §2.3: ID1 ID2 CM=8 FLG=0 MTIME XFL OS=3, then deflate data (here any bytes).
  ['gzip', bytes([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03], binary(30))],
  ['bzip2', bytes('BZh91AY&SY', binary(40))],
  ['bzip2', bytes('BZh9', [0x17, 0x72, 0x45, 0x38, 0x50, 0x90], zeros(4))],
  ['xz', bytes([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], binary(40))],
  ['zstd', bytes([0x28, 0xb5, 0x2f, 0xfd], binary(40))],
  ['7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], binary(40))],
  ['tar', tar()],
  ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], binary(40))],
  ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0], binary(40))],
  ['gif', bytes('GIF89a', [3, 0, 2, 0, 0x80, 0, 0], binary(20))],
  ['gif', bytes('GIF87a', [3, 0, 2, 0, 0, 0, 0])],
  ['webp', bytes('RIFF', [26, 0, 0, 0], 'WEBPVP8L', binary(20))],
  ['avif', ftyp('avif', 'mif1', 'miaf')],
  ['avif', ftyp('mif1', 'avif', 'miaf')],
  ['heic', ftyp('heic', 'mif1', 'heic')],
  ['heic', ftyp('mif1', 'heic')],
  ['bmp', bytes('BM', u32(70), zeros(4), u32(54), u32(40), binary(40))],
  ['ico', bytes([0, 0, 1, 0, 1, 0, 16, 16], binary(30))],
  ['ico', bytes([0, 0, 2, 0, 1, 0, 32, 32], binary(30))],
  ['tiff', bytes([0x49, 0x49, 0x2a, 0x00], binary(20))],
  ['tiff', bytes([0x4d, 0x4d, 0x00, 0x2a], binary(20))],
  ['woff', bytes('wOFF', [0, 1, 0, 0], binary(40))],
  ['woff2', bytes('wOF2', [0, 1, 0, 0], binary(40))],
  ['ttf', sfntHeader([0, 1, 0, 0])],
  ['ttf', sfntHeader('true')],
  ['otf', sfntHeader('OTTO')],
  ['ttc', bytes('ttcf', [0, 1, 0, 0], [0, 0, 0, 1], binary(20))],
  ['wasm', bytes([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])],
  ['sqlite', bytes('SQLite format 3\0', [0x10, 0, 1, 1], zeros(80))],
  ['mp3', bytes('ID3', [3, 0, 0, 0, 0, 0, 10], binary(30))],
  ['ogg', bytes('OggS', [0, 2], binary(30))],
  ['wav', bytes('RIFF', [36, 0, 0, 0], 'WAVEfmt ', binary(20))],
  ['flac', bytes('fLaC', [0, 0, 0, 0x22], binary(34))],
  ['mp4', ftyp('isom', 'isom', 'iso2', 'mp41')],
  ['m4a', ftyp('M4A ', 'M4A ', 'mp42')],
  ['mov', ftyp('qt  ', 'qt  ')],
  ['webm', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], 'webm', binary(20))],
  ['mkv', bytes([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x82, 0x88], 'matroska', binary(20))],
  ['x509', fromB64(CERTIFICATE_DER_B64)],
  ['csr', fromB64(REQUEST_DER_B64)],
  ['crl', CRL],
  ['pkcs7', PKCS7],
  ['pkcs12', PKCS12],
  ['der', OTHER_DER],
  ['openssh-private', bytes('openssh-key-v1\0', be32(4), 'none', binary(40))],
  ['ssh-public', bytes(be32(11), 'ssh-ed25519', be32(32), binary(32))],
  ['pem-certificate', utf8(`-----BEGIN CERTIFICATE-----\n${CERTIFICATE_DER_B64}\n-----END CERTIFICATE-----\n`)],
  ['pem-request', utf8(`-----BEGIN CERTIFICATE REQUEST-----\n${REQUEST_DER_B64}\n-----END CERTIFICATE REQUEST-----\n`)],
  ['pem-private', utf8('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n')], // gitleaks:allow — a PEM label around 4 characters, no key
  ['pem-private', utf8('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n')], // gitleaks:allow — a PEM label around 4 characters, no key
  ['pem-public', utf8('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n')],
  ['pem-crl', utf8('-----BEGIN X509 CRL-----\nAAAA\n-----END X509 CRL-----\n')],
  ['pem', utf8('-----BEGIN DH PARAMETERS-----\nAAAA\n-----END DH PARAMETERS-----\n')],
  ['pgp', utf8('-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQENBF\n-----END PGP PUBLIC KEY BLOCK-----\n')],
  ['pgp-private', utf8('-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQ\n-----END PGP PRIVATE KEY BLOCK-----\n')], // gitleaks:allow — a PEM label around 4 characters, no key
  ['svg', utf8('<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>')],
  ['html', utf8('<!DOCTYPE html>\n<html><script>alert(1)</script></html>')],
  ['html', utf8('  <p>hi</p>')],
  ['xml', utf8('<?xml version="1.0"?><root/>')],
  ['json', utf8('{"a": [1, 2, 3]}')],
  ['json', utf8('\u{FEFF}[1]')],
  ['text', utf8('hello world\n')],
  ['text', utf8('Привет, 😀\n')],
  ['text', utf8('{"broken": ')],
  ['text-utf16', bytes([0xff, 0xfe], 'h', [0], 'i', [0])],
  ['unknown', binary(64)],
];
