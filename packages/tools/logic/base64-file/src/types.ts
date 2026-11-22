/**
 * The file types the tool names (docs/tools/specs/base64-file.md §5.2): what a person sees (`name`), the MIME type a data
 * URI gets, the extension a saved file gets, the other extensions and MIME spellings that mean the same, whether the bytes
 * are text (Show text) and whether they are a private key (the history never keeps one, §11). Data only.
 */

export type TypeId =
  | 'empty'
  | 'pdf'
  | 'zip'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'odg'
  | 'epub'
  | 'jar'
  | 'apk'
  | 'gzip'
  | 'bzip2'
  | 'xz'
  | 'zstd'
  | '7z'
  | 'tar'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'bmp'
  | 'ico'
  | 'tiff'
  | 'woff'
  | 'woff2'
  | 'ttf'
  | 'otf'
  | 'ttc'
  | 'wasm'
  | 'sqlite'
  | 'mp3'
  | 'ogg'
  | 'wav'
  | 'flac'
  | 'mp4'
  | 'm4a'
  | 'mov'
  | 'webm'
  | 'mkv'
  | 'x509'
  | 'crl'
  | 'csr'
  | 'spki'
  | 'pkcs8'
  | 'pkcs8-encrypted'
  | 'rsa-private'
  | 'rsa-public'
  | 'ec-private'
  | 'pkcs7'
  | 'pkcs12'
  | 'der'
  | 'openssh-private'
  | 'ssh-public'
  | 'pem-certificate'
  | 'pem-private'
  | 'pem-public'
  | 'pem-request'
  | 'pem-crl'
  | 'pem'
  | 'pgp'
  | 'pgp-private'
  | 'svg'
  | 'html'
  | 'xml'
  | 'json'
  | 'text'
  | 'text-utf16'
  | 'unknown'
  // Refined from a file's extension or a data URI's declared type (§5.2 «Расширение имени»): not recognised by bytes.
  | 'by-name';

/** Where a type sits for a person: the group in which `detect` and the history treat it alike. */
export type TypeGroup = 'document' | 'archive' | 'image' | 'font' | 'media' | 'code' | 'key' | 'text' | 'none';

export interface FileType {
  id: TypeId;
  /** 'PDF document', 'WOFF2 font'… */
  name: string;
  /** The MIME type a data URI gets (Encode) and the one compared with a declared type (Decode). */
  mime: string;
  /** The extension a saved file gets, without the dot. */
  ext: string;
  /** Every extension that means this type (the first is `ext`). */
  exts: readonly string[];
  /** Other spellings of `mime` that declare the same type: no warning when a data URI uses one. */
  aliases: readonly string[];
  group: TypeGroup;
  /** The bytes are text: Show text is offered. */
  text: boolean;
  /** A private key or a keystore: never kept by the history (§11). */
  secret: boolean;
  /** Recognised by something specific in the bytes (a signature or a structure), not just «text» or nothing. */
  specific: boolean;
}

type Row = [id: TypeId, name: string, mime: string, exts: string, group: TypeGroup, flags?: string, aliases?: string];

// flags: t — text, s — secret (a private key), g — generic (not recognised by anything specific).
const ROWS: readonly Row[] = [
  ['empty', 'Empty file', 'application/octet-stream', 'bin', 'none', 'g'],
  ['pdf', 'PDF document', 'application/pdf', 'pdf', 'document', '', 'application/x-pdf'],
  ['zip', 'ZIP archive', 'application/zip', 'zip', 'archive', '', 'application/x-zip-compressed application/x-zip'],
  [
    'docx',
    'Word document (DOCX)',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'docx',
    'document',
  ],
  [
    'xlsx',
    'Excel workbook (XLSX)',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xlsx',
    'document',
  ],
  [
    'pptx',
    'PowerPoint presentation (PPTX)',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'pptx',
    'document',
  ],
  ['odt', 'OpenDocument text', 'application/vnd.oasis.opendocument.text', 'odt', 'document'],
  ['ods', 'OpenDocument spreadsheet', 'application/vnd.oasis.opendocument.spreadsheet', 'ods', 'document'],
  ['odp', 'OpenDocument presentation', 'application/vnd.oasis.opendocument.presentation', 'odp', 'document'],
  ['odg', 'OpenDocument drawing', 'application/vnd.oasis.opendocument.graphics', 'odg', 'document'],
  ['epub', 'EPUB book', 'application/epub+zip', 'epub', 'document'],
  ['jar', 'Java archive (JAR)', 'application/java-archive', 'jar', 'archive', '', 'application/x-java-archive'],
  ['apk', 'Android package (APK)', 'application/vnd.android.package-archive', 'apk', 'archive'],
  ['gzip', 'gzip', 'application/gzip', 'gz tgz', 'archive', '', 'application/x-gzip application/x-gunzip'],
  ['bzip2', 'bzip2', 'application/x-bzip2', 'bz2 tbz2', 'archive', '', 'application/x-bzip'],
  ['xz', 'xz', 'application/x-xz', 'xz txz', 'archive'],
  ['zstd', 'Zstandard', 'application/zstd', 'zst', 'archive', '', 'application/x-zstd'],
  ['7z', '7z archive', 'application/x-7z-compressed', '7z', 'archive'],
  ['tar', 'tar archive', 'application/x-tar', 'tar', 'archive'],
  ['png', 'PNG image', 'image/png', 'png', 'image', '', 'image/x-png image/apng'],
  ['jpeg', 'JPEG image', 'image/jpeg', 'jpg jpeg jpe jfif', 'image', '', 'image/jpg image/pjpeg'],
  ['gif', 'GIF image', 'image/gif', 'gif', 'image'],
  ['webp', 'WebP image', 'image/webp', 'webp', 'image'],
  ['avif', 'AVIF image', 'image/avif', 'avif', 'image'],
  ['heic', 'HEIF image', 'image/heic', 'heic heif', 'image', '', 'image/heif image/heic-sequence image/heif-sequence'],
  ['bmp', 'BMP image', 'image/bmp', 'bmp dib', 'image', '', 'image/x-ms-bmp image/x-bmp'],
  ['ico', 'ICO icon', 'image/x-icon', 'ico cur', 'image', '', 'image/vnd.microsoft.icon image/ico'],
  ['tiff', 'TIFF image', 'image/tiff', 'tif tiff', 'image', '', 'image/tiff-fx'],
  ['woff', 'WOFF font', 'font/woff', 'woff', 'font', '', 'application/font-woff application/x-font-woff'],
  ['woff2', 'WOFF2 font', 'font/woff2', 'woff2', 'font', '', 'application/font-woff2'],
  [
    'ttf',
    'TrueType font',
    'font/ttf',
    'ttf',
    'font',
    '',
    'font/sfnt application/x-font-ttf application/x-font-truetype application/font-sfnt',
  ],
  [
    'otf',
    'OpenType font',
    'font/otf',
    'otf',
    'font',
    '',
    'font/sfnt application/x-font-opentype application/font-sfnt',
  ],
  ['ttc', 'Font collection', 'font/collection', 'ttc otc', 'font'],
  ['wasm', 'WebAssembly module', 'application/wasm', 'wasm', 'code'],
  [
    'sqlite',
    'SQLite database',
    'application/vnd.sqlite3',
    'sqlite sqlite3 db',
    'document',
    '',
    'application/x-sqlite3',
  ],
  ['mp3', 'MP3 audio', 'audio/mpeg', 'mp3', 'media', '', 'audio/mp3 audio/x-mpeg'],
  ['ogg', 'Ogg media', 'audio/ogg', 'ogg oga ogv opus', 'media', '', 'video/ogg application/ogg'],
  ['wav', 'WAVE audio', 'audio/wav', 'wav', 'media', '', 'audio/x-wav audio/wave audio/vnd.wave'],
  ['flac', 'FLAC audio', 'audio/flac', 'flac', 'media', '', 'audio/x-flac'],
  ['mp4', 'MP4 video', 'video/mp4', 'mp4 m4v', 'media', '', 'video/x-m4v application/mp4'],
  ['m4a', 'MP4 audio', 'audio/mp4', 'm4a m4b', 'media', '', 'audio/x-m4a'],
  ['mov', 'QuickTime video', 'video/quicktime', 'mov qt', 'media'],
  ['webm', 'WebM video', 'video/webm', 'webm', 'media', '', 'audio/webm'],
  ['mkv', 'Matroska video', 'video/x-matroska', 'mkv mka', 'media', '', 'audio/x-matroska'],
  [
    'x509',
    'DER certificate',
    'application/pkix-cert',
    'cer der crt',
    'key',
    '',
    'application/x-x509-ca-cert application/x-x509-user-cert application/x-x509-server-cert',
  ],
  ['crl', 'DER certificate revocation list', 'application/pkix-crl', 'crl der', 'key', '', 'application/x-pkcs7-crl'],
  ['csr', 'DER certificate request', 'application/pkcs10', 'csr p10 der', 'key', '', 'application/x-pkcs10'],
  ['spki', 'DER public key', 'application/octet-stream', 'der pub', 'key'],
  ['pkcs8', 'DER private key (PKCS #8)', 'application/pkcs8', 'key p8 der', 'key', 's'],
  ['pkcs8-encrypted', 'DER encrypted private key', 'application/pkcs8-encrypted', 'key p8e der', 'key', 's'],
  ['rsa-private', 'DER RSA private key (PKCS #1)', 'application/octet-stream', 'key der', 'key', 's'],
  ['rsa-public', 'DER RSA public key (PKCS #1)', 'application/octet-stream', 'der pub', 'key'],
  ['ec-private', 'DER EC private key', 'application/octet-stream', 'key der', 'key', 's'],
  [
    'pkcs7',
    'DER PKCS #7 / CMS',
    'application/pkcs7-mime',
    'p7b p7c p7m p7s',
    'key',
    '',
    'application/x-pkcs7-certificates application/pkcs7-signature application/x-pkcs7-mime',
  ],
  ['pkcs12', 'DER PKCS #12 keystore', 'application/pkcs12', 'p12 pfx', 'key', 's', 'application/x-pkcs12'], // gitleaks:allow — a type name and a MIME type, not a key
  ['der', 'DER (ASN.1) data', 'application/octet-stream', 'der', 'key'],
  ['openssh-private', 'OpenSSH private key', 'application/octet-stream', 'bin', 'key', 's'],
  ['ssh-public', 'SSH public key', 'application/octet-stream', 'bin', 'key'],
  ['pem-certificate', 'PEM certificate', 'application/x-pem-file', 'pem crt cer', 'key', 't'],
  ['pem-private', 'PEM private key', 'application/x-pem-file', 'key pem', 'key', 'ts'],
  ['pem-public', 'PEM public key', 'application/x-pem-file', 'pem pub', 'key', 't'],
  ['pem-request', 'PEM certificate request', 'application/x-pem-file', 'csr pem', 'key', 't'],
  ['pem-crl', 'PEM revocation list', 'application/x-pem-file', 'crl pem', 'key', 't'],
  ['pem', 'PEM data', 'application/x-pem-file', 'pem', 'key', 't'],
  [
    'pgp',
    'OpenPGP armored data',
    'application/pgp-keys',
    'asc',
    'key',
    't',
    'application/pgp-signature application/pgp-encrypted',
  ],
  ['pgp-private', 'OpenPGP private key', 'application/pgp-keys', 'asc', 'key', 'ts'],
  ['svg', 'SVG image', 'image/svg+xml', 'svg', 'image', 't', 'image/svg'],
  ['html', 'HTML document', 'text/html', 'html htm', 'text', 't', 'application/xhtml+xml'],
  ['xml', 'XML document', 'application/xml', 'xml', 'text', 't', 'text/xml'],
  ['json', 'JSON', 'application/json', 'json', 'text', 't', 'text/json'],
  ['text', 'Text (UTF-8)', 'text/plain', 'txt', 'text', 'tg'],
  ['text-utf16', 'Text (UTF-16)', 'text/plain;charset=utf-16', 'txt', 'text', 'tg'],
  ['unknown', 'Unknown binary data', 'application/octet-stream', 'bin', 'none', 'g', 'binary/octet-stream'],
];

const typeOf = ([id, name, mime, exts, group, flags = '', aliases = '']: Row): FileType => {
  const list = exts.split(' ');
  return {
    id,
    name,
    mime,
    ext: list[0]!,
    exts: list,
    aliases: aliases ? aliases.split(' ') : [],
    group,
    text: flags.includes('t'),
    secret: flags.includes('s'),
    specific: !flags.includes('g'),
  };
};

export const FILE_TYPES: Readonly<Record<Exclude<TypeId, 'by-name'>, FileType>> = Object.fromEntries(
  ROWS.map(row => [row[0], typeOf(row)]),
) as Record<Exclude<TypeId, 'by-name'>, FileType>;

export const fileType = (id: Exclude<TypeId, 'by-name'>): FileType => FILE_TYPES[id];

/**
 * Extensions the bytes do not tell (§5.2 «Расширение имени»): a text kind refines «Text», a binary kind names bytes that
 * are not recognised. A binary extension whose format the signatures know is not listed: such a file is recognised by
 * its bytes or it is not that format.
 */
const NAMED: ReadonlyArray<[exts: string, mime: string, name: string, text: boolean]> = [
  ['csv', 'text/csv', 'CSV text', true],
  ['tsv', 'text/tab-separated-values', 'TSV text', true],
  ['md markdown', 'text/markdown', 'Markdown text', true],
  ['js mjs cjs', 'text/javascript', 'JavaScript', true],
  ['ts mts cts tsx jsx', 'text/plain', 'Source code', true],
  ['css', 'text/css', 'CSS', true],
  ['yaml yml', 'application/yaml', 'YAML', true],
  ['toml ini cfg conf env properties', 'text/plain', 'Configuration text', true],
  ['sh bash zsh', 'text/x-shellscript', 'Shell script', true],
  ['py rb go rs java kt c h cc cpp hpp cs swift php pl sql lua r', 'text/plain', 'Source code', true],
  ['log', 'text/plain', 'Log text', true],
  ['vcf', 'text/vcard', 'vCard', true],
  ['ics', 'text/calendar', 'iCalendar', true],
  ['eml', 'message/rfc822', 'E-mail message', true],
  ['rtf', 'application/rtf', 'RTF document', true],
  ['mp3', 'audio/mpeg', 'MP3 audio', false],
  ['aac', 'audio/aac', 'AAC audio', false],
  ['mid midi', 'audio/midi', 'MIDI', false],
  ['avi', 'video/x-msvideo', 'AVI video', false],
  ['exe dll', 'application/vnd.microsoft.portable-executable', 'Windows executable', false],
  ['iso', 'application/x-iso9660-image', 'Disc image', false],
  ['doc', 'application/msword', 'Word document (DOC)', false],
  ['xls', 'application/vnd.ms-excel', 'Excel workbook (XLS)', false],
  ['ppt', 'application/vnd.ms-powerpoint', 'PowerPoint presentation (PPT)', false],
  ['class', 'application/java-vm', 'Java class', false],
  ['dmg', 'application/x-apple-diskimage', 'Disk image', false],
  ['deb', 'application/vnd.debian.binary-package', 'Debian package', false],
  ['rpm', 'application/x-rpm', 'RPM package', false],
];

export interface NamedType {
  ext: string;
  mime: string;
  name: string;
  text: boolean;
}

const NAMED_BY_EXT = new Map<string, NamedType>(
  NAMED.flatMap(([exts, mime, name, text]) => exts.split(' ').map(ext => [ext, { ext, mime, name, text }] as const)),
);

/** What an extension (without the dot, any case) says on its own; null when the bytes decide or it is unknown. */
export const namedByExt = (ext: string): NamedType | null => NAMED_BY_EXT.get(ext.toLowerCase()) ?? null;

/** The recognised type an extension belongs to (its format has a signature or a structure here); null otherwise. */
export const typeByExt = (ext: string): FileType | null => {
  const lower = ext.toLowerCase();
  if (!lower) return null;
  for (const t of Object.values(FILE_TYPES)) if (t.specific && t.exts.includes(lower)) return t;
  return null;
};

/** The type a MIME type names (its own or an alias), lower case and without parameters; null when none does. */
export const typeByMime = (mime: string): FileType | null => {
  const bare = mime.split(';')[0]!.trim().toLowerCase();
  if (!bare || bare === 'application/octet-stream') return null;
  for (const t of Object.values(FILE_TYPES))
    if (t.specific && (t.mime.split(';')[0] === bare || t.aliases.includes(bare))) return t;
  return null;
};

/** A MIME type a data URI declared, by what the extension table says of it; null when it says nothing. */
export const namedByMime = (mime: string): NamedType | null => {
  const bare = mime.split(';')[0]!.trim().toLowerCase();
  for (const n of NAMED_BY_EXT.values()) if (n.mime === bare) return n;
  return null;
};

/** The types whose bytes are a private key or a keystore (§11: never kept). */
export const SECRET_TYPES: readonly TypeId[] = ROWS.filter(r => (r[5] ?? '').includes('s')).map(r => r[0]);
