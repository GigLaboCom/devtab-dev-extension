/**
 * What a file is (docs/tools/specs/base64-file.md §5.2): empty, a binary format by its first bytes (with the ZIP family
 * narrowed by its directory), a DER structure, an SSH key, or text — PEM, SVG, HTML, XML, JSON or plain — else unknown.
 * Then the file's extension (Encode) or the type a data URI declared (Decode) refines what the bytes leave open, and
 * notes say where the name or the declared type disagree with the bytes, and when the bytes are also a ZIP archive.
 *
 * Reads only: nothing here runs, renders or loads the bytes. Every scan is linear and bounded (the head is 64 KiB, the
 * ZIP directory 1 MiB and 10,000 entries, DER and JSON 4 MiB).
 */
import { derForm, derOutline } from './derForms';
import {
  DIRECTORY_MAX_BYTES,
  DIRECTORY_MAX_ENTRIES,
  HEAD_BYTES,
  TAIL_BYTES,
  WHOLE_MAX_BYTES,
  binarySignature,
  latin1,
  pdfHeader,
  textEncodingOf,
  u16le,
  u32le,
} from './signatures';
import { FILE_TYPES, namedByExt, namedByMime, typeByExt, typeByMime } from './types';
import { scanJson } from '@workspace/tools-shared/json-scan';
import type { ByteSample, TextEncoding } from './signatures';
import type { FileType, NamedType, TypeId } from './types';

export interface Recognised {
  type: FileType;
  /** The bytes are text in this encoding (null: not text). */
  encoding: TextEncoding | null;
  /** A printable signature the text starts with but that did not count (text is text): `GIF89a is…` → 'gif'. */
  startsLike: TypeId | null;
  /** A ZIP end record and directory at the end of bytes whose type is not ZIP: a polyglot. */
  alsoZip: boolean;
  /** PEM: the label of the BEGIN line. */
  pemLabel: string | null;
}

// ---- ZIP

/** Where the central directory of a ZIP is, by the end record in `tail` (the last bytes of a file of `size`). */
export const zipDirectoryRange = (tail: Uint8Array, size: number): { offset: number; length: number } | null => {
  const base = size - tail.length;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tail[at] !== 0x50 || tail[at + 1] !== 0x4b || tail[at + 2] !== 0x05 || tail[at + 3] !== 0x06) continue;
    // The record ends the file exactly (its comment included).
    if (at + 22 + u16le(tail, at + 20) !== tail.length) continue;
    const entries = u16le(tail, at + 10);
    const length = u32le(tail, at + 12);
    const offset = u32le(tail, at + 16);
    if (length === 0xffffffff || offset === 0xffffffff) return null; // ZIP64: not followed
    if (entries === 0 || length === 0) return { offset: base + at, length: 0 };
    // The directory ends where the end record starts (data may come before the archive: a polyglot).
    const start = base + at - length;
    return start >= 0 ? { offset: start, length } : null;
  }
  return null;
};

/** The names in a central directory (PKWARE APPNOTE §4.3.12), up to DIRECTORY_MAX_ENTRIES; null when it is not one. */
export const zipNames = (directory: Uint8Array): string[] | null => {
  const names: string[] = [];
  let at = 0;
  while (at + 46 <= directory.length && names.length < DIRECTORY_MAX_ENTRIES) {
    if (u32le(directory, at) !== 0x02014b50) return names.length ? names : null;
    const nameLength = u16le(directory, at + 28);
    const extra = u16le(directory, at + 30);
    const comment = u16le(directory, at + 32);
    names.push(latin1(directory, at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
  }
  return names.length ? names : null;
};

/** The names of local headers from the start, while their sizes are known (no data descriptor): the fallback. */
const localNames = (head: Uint8Array): string[] => {
  const names: string[] = [];
  let at = 0;
  while (at + 30 <= head.length && names.length < 64 && u32le(head, at) === 0x04034b50) {
    const flags = u16le(head, at + 6);
    const size = u32le(head, at + 18);
    const nameLength = u16le(head, at + 26);
    const extra = u16le(head, at + 28);
    names.push(latin1(head, at + 30, at + 30 + nameLength));
    if (flags & 8 || size === 0xffffffff) break;
    at += 30 + nameLength + extra + size;
  }
  return names;
};

const ODF: Readonly<Record<string, TypeId>> = {
  'application/epub+zip': 'epub',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.graphics': 'odg',
};

/** The ZIP family (§5.2 «Семья ZIP»): EPUB and OpenDocument by the stored `mimetype`, OOXML, APK, JAR by names. */
const zipFamily = (sample: ByteSample): TypeId => {
  const h = sample.head;
  if (u32le(h, 0) === 0x04034b50) {
    const nameLength = u16le(h, 26);
    const extra = u16le(h, 28);
    if (latin1(h, 30, 30 + nameLength) === 'mimetype' && u16le(h, 8) === 0) {
      const size = u32le(h, 18);
      const content = latin1(h, 30 + nameLength + extra, 30 + nameLength + extra + Math.min(size, 128)).trim();
      if (ODF[content]) return ODF[content]!;
    }
  }
  const names = new Set((sample.directory && zipNames(sample.directory)) || localNames(h));
  if (names.has('[Content_Types].xml')) {
    if (names.has('word/document.xml')) return 'docx';
    if (names.has('xl/workbook.xml')) return 'xlsx';
    if (names.has('ppt/presentation.xml')) return 'pptx';
  }
  if (names.has('AndroidManifest.xml') && names.has('classes.dex')) return 'apk';
  if (names.has('META-INF/MANIFEST.MF')) return 'jar';
  return 'zip';
};

// ---- Text kinds

const isWhite = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;

/** The head as a string for the text checks (UTF-8, its first 4 KiB or 64 KiB). */
const textOf = (head: Uint8Array, limit: number): string =>
  new TextDecoder('utf-8').decode(head.subarray(0, Math.min(head.length, limit)));

/** The label of a first line `-----BEGIN <label>-----` (RFC 7468 §2), or null. */
export const pemLabelOf = (text: string): string | null => {
  const m =
    /^\u{FEFF}?[\t\n\f\r ]*-----BEGIN ([\x21-\x2C\x2E-\x7E](?:[\x20-\x2C\x2E-\x7E]*[\x21-\x2C\x2E-\x7E])?)-----[\t ]*(?:\r?\n|$)/u.exec(
      text,
    );
  return m ? m[1]! : null;
};

const pemType = (label: string): TypeId => {
  if (label.startsWith('PGP ')) return label === 'PGP PRIVATE KEY BLOCK' ? 'pgp-private' : 'pgp';
  if (/PRIVATE KEY$/.test(label)) return 'pem-private';
  if (/^(?:X509 |X\.509 |TRUSTED )?CERTIFICATE$/.test(label)) return 'pem-certificate';
  if (/^(?:NEW )?CERTIFICATE REQUEST$/.test(label)) return 'pem-request';
  if (/PUBLIC KEY$/.test(label)) return 'pem-public';
  if (label === 'X509 CRL') return 'pem-crl';
  return 'pem';
};

/**
 * The root element is `<svg>` (§5.2 п. 6; as base64-image §15): after a BOM, white space, an XML declaration, comments,
 * a DOCTYPE (with an internal subset) and processing instructions, within the first 4 KiB.
 */
export const svgRoot = (text: string): boolean => {
  const n = Math.min(text.length, 4096);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < n && isWhite(text.charCodeAt(i))) i++;
    if (i >= n || text[i] !== '<') return false;
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0 || end >= n) return false;
      i = end + 2;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0 || end >= n) return false;
      i = end + 3;
    } else if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) {
      let depth = 0;
      let j = i + 9;
      for (; j < n; j++) {
        const c = text[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= n) return false;
      i = j + 1;
    } else return /^<svg[\s>/]/.test(text.slice(i, i + 5));
  }
};

/** The HTML patterns of WHATWG MIME Sniffing §7.1, each followed by a tag-terminating byte (space or `>`). */
const HTML_START =
  /^[\t\n\f\r ]*<(?:!DOCTYPE HTML|HTML|HEAD|SCRIPT|IFRAME|H1|DIV|FONT|TABLE|A|STYLE|TITLE|B|BODY|BR|P|!--)[ >]/i;

const textKind = (sample: ByteSample, encoding: TextEncoding): { id: TypeId; pemLabel: string | null } => {
  if (encoding !== 'utf-8') return { id: 'text-utf16', pemLabel: null };
  const start = textOf(sample.head, HEAD_BYTES);
  const label = pemLabelOf(start);
  if (label) return { id: pemType(label), pemLabel: label };
  const body = start.charCodeAt(0) === 0xfeff ? start.slice(1) : start;
  if (svgRoot(body)) return { id: 'svg', pemLabel: null };
  if (HTML_START.test(body.slice(0, 64))) return { id: 'html', pemLabel: null };
  if (/^[\t\n\f\r ]*<\?xml[\s?]/.test(body.slice(0, 64))) return { id: 'xml', pemLabel: null };
  const first = /^[\t\n\f\r ]*([{[])/.exec(body.slice(0, 1024));
  if (first && sample.whole && sample.whole.length === sample.size) {
    const text = new TextDecoder('utf-8').decode(sample.whole);
    if (scanJson(text).ok) return { id: 'json', pemLabel: null };
  }
  return { id: 'text', pemLabel: null };
};

/** `%%EOF` within the last 1,024 bytes (ISO 32000-2 §7.5.5): what makes an all-text `%PDF-` file a PDF. */
const pdfEnd = (sample: ByteSample): boolean => {
  const end = sample.tail ?? sample.head;
  const from = Math.max(0, end.length - 1024);
  return latin1(end, from, end.length).includes('%%EOF');
};

/** Does a ZIP directory sit at the end of these bytes (the directory read from where the end record points)? */
const zipAtEnd = (sample: ByteSample): boolean =>
  !!sample.directory && sample.directory.length >= 46 && u32le(sample.directory, 0) === 0x02014b50;

// ---- Recognising

/** §5.2: the type of the sampled bytes, before a name or a declared type refines it. */
export const recogniseBytes = (sample: ByteSample): Recognised => {
  const base = { encoding: null, startsLike: null, alsoZip: false, pemLabel: null };
  if (sample.size === 0) return { ...base, type: FILE_TYPES.empty };
  const { head, size } = sample;
  const encoding = textEncodingOf(head, size);
  const text = encoding !== null;
  const result = (id: Exclude<TypeId, 'by-name'>, more: Partial<Recognised> = {}): Recognised => {
    const type = FILE_TYPES[id];
    const alsoZip =
      !['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'odg', 'epub', 'jar', 'apk'].includes(id) &&
      zipAtEnd(sample);
    return { ...base, encoding, type, alsoZip, ...more };
  };

  if (pdfHeader(head) && (!text || pdfEnd(sample))) return result('pdf');
  const signature = binarySignature(head, size, text);
  if (signature.id)
    return result(
      signature.id === 'zip'
        ? (zipFamily(sample) as Exclude<TypeId, 'by-name'>)
        : (signature.id as Exclude<TypeId, 'by-name'>),
    );
  const startsLike = signature.startsLike ?? (pdfHeader(head) ? 'pdf' : null);
  if (!text) {
    if (sample.whole && derOutline(head, size)) {
      const form = derForm(sample.whole, WHOLE_MAX_BYTES);
      if (form) return result(form as Exclude<TypeId, 'by-name'>);
    }
    return result('unknown');
  }
  const kind = textKind(sample, encoding);
  return result(kind.id as Exclude<TypeId, 'by-name'>, { startsLike, pemLabel: kind.pemLabel });
};

/** The sample of bytes held whole in memory (tests, `detect`, small inputs on the page). */
export const sampleOf = (bytes: Uint8Array): ByteSample => {
  const head = bytes.subarray(0, HEAD_BYTES);
  const tail = bytes.length > HEAD_BYTES ? bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES)) : undefined;
  const range = zipDirectoryRange(tail ?? head, bytes.length);
  const directory =
    range && range.length > 0
      ? bytes.subarray(range.offset, range.offset + Math.min(range.length, DIRECTORY_MAX_BYTES))
      : undefined;
  return {
    size: bytes.length,
    head,
    ...(tail ? { tail } : {}),
    ...(directory ? { directory } : {}),
    ...(bytes.length <= WHOLE_MAX_BYTES ? { whole: bytes } : {}),
  };
};

const bytesOf = async (blob: Blob, from: number, to: number): Promise<Uint8Array> =>
  new Uint8Array(await blob.slice(from, to).arrayBuffer());

/**
 * The sample of a Blob (a chosen file, the decoded bytes): its head, its tail, the ZIP directory the tail points at, and
 * the whole when it is small and DER or JSON could need it — never more than a few MiB, whatever the size.
 */
export const sampleBlob = async (blob: Blob): Promise<ByteSample> => {
  const size = blob.size;
  const head = await bytesOf(blob, 0, Math.min(size, HEAD_BYTES));
  if (size <= HEAD_BYTES) return sampleOf(head);
  const tail = await bytesOf(blob, Math.max(0, size - TAIL_BYTES), size);
  const range = zipDirectoryRange(tail, size);
  const directory =
    range && range.length > 0
      ? await bytesOf(blob, range.offset, range.offset + Math.min(range.length, DIRECTORY_MAX_BYTES))
      : undefined;
  const encoding = textEncodingOf(head, size);
  const wantWhole =
    size <= WHOLE_MAX_BYTES &&
    (encoding === null ? derOutline(head, size) : /^\u{FEFF}?[\t\n\f\r ]*[{[]/u.test(textOf(head, 1024)));
  const whole = wantWhole ? await bytesOf(blob, 0, size) : undefined;
  return { size, head, tail, ...(directory ? { directory } : {}), ...(whole ? { whole } : {}) };
};

export const recogniseBlob = async (blob: Blob): Promise<Recognised> => recogniseBytes(await sampleBlob(blob));

// ---- A name or a declared type, and the notes

export interface Described {
  /** The type the tool goes by: by the bytes, or refined by the name or the declared type. */
  type: FileType;
  /** For a data URI (Encode): the recognised MIME, with `;charset=utf-8` for UTF-8 text of a `text/…` type. */
  dataUriType: string;
  notes: string[];
  recognised: Recognised;
}

/** The extension of a file name, lower case, without the dot; '' for none (and for `.bashrc`). */
export const extensionOf = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
};

/** 'a PDF document', 'an HTML document', 'an EPUB book' — the article as the name is read aloud. */
export const withArticle = (name: string): string => {
  const word = name.split(/[\s(]/)[0]!;
  const initialism =
    /^[A-Z0-9]{2,}/.test(word) &&
    ![
      'HEIF',
      'FLAC',
      'JPEG',
      'WAVE',
      'DER',
      'PEM',
      'PNG',
      'GIF',
      'BMP',
      'TIFF',
      'WOFF',
      'WOFF2',
      'JSON',
      'PDF',
    ].includes(word);
  const vowel = initialism ? /^[AEFHILMNORSX]/.test(word) : /^[AEIOU]/i.test(word);
  return `${vowel ? 'an' : 'a'} ${name}`;
};

const byName = (named: NamedType, text: boolean): FileType => ({
  id: 'by-name',
  name: named.name,
  mime: named.mime,
  ext: named.ext,
  exts: [named.ext],
  aliases: [],
  group: text ? 'text' : 'none',
  text,
  secret: false,
  specific: false,
});

const bareMime = (mime: string): string => mime.split(';')[0]!.trim().toLowerCase();

export const ALSO_ZIP_NOTE = 'The bytes are also a ZIP archive: its directory is at the end.';

/**
 * §5.2 «Расширение имени (Encode) и объявленный тип (Decode)»: what a name's extension or a declared type adds to the
 * bytes, and the notes where they disagree.
 */
export const describe = (
  recognised: Recognised,
  hints: { fileName?: string | null; declaredMime?: string | null } = {},
): Described => {
  const notes: string[] = [];
  let type = recognised.type;
  const ext = hints.fileName ? extensionOf(hints.fileName) : '';
  const declared = hints.declaredMime ? bareMime(hints.declaredMime) : '';
  const extType = ext ? typeByExt(ext) : null;
  const extNamed = ext ? namedByExt(ext) : null;
  const declType = declared ? typeByMime(declared) : null;
  const declNamed = declared && !declType ? namedByMime(declared) : null;
  const isText = recognised.encoding !== null;

  if (type.id === 'empty') {
    // Nothing to say about an empty file.
  } else if (type.specific) {
    if (ext && (extType || extNamed) && !type.exts.includes(ext))
      notes.push(`The name says .${ext}, but the bytes are ${withArticle(type.name)}.`);
    const same = bareMime(type.mime) === declared || type.aliases.includes(declared);
    if (declared && declared !== 'application/octet-stream' && !same && !(declared === 'text/plain' && type.text))
      notes.push(`Declared ${declared}, but the bytes are ${withArticle(type.name)}.`);
  } else if (type.id === 'text' || type.id === 'text-utf16') {
    const textual = (extType && extType.text) || (extNamed && extNamed.text);
    if (ext && textual) type = extType ?? byName(extNamed!, true);
    else if (ext && (extType || extNamed)) notes.push(`The name says .${ext}, but the bytes are text.`);
    if (declared && declared !== 'application/octet-stream' && declared !== 'text/plain') {
      if ((declType && declType.text) || (declNamed && declNamed.text)) {
        if (!ext || !textual) type = declType ?? byName(declNamed!, true);
      } else if (declType || declNamed || !declared.startsWith('text/'))
        notes.push(`Declared ${declared}, but the bytes are text.`);
    }
  } else {
    // Unknown bytes.
    if (ext && extNamed && !extNamed.text) type = byName(extNamed, false);
    else if (ext && extType) notes.push(`The name says .${ext}, but the bytes are not ${withArticle(extType.name)}.`);
    else if (ext && extNamed) notes.push(`The name says .${ext}, but the bytes are not text.`);
    if (declared && declared !== 'application/octet-stream' && type.id === 'unknown') {
      if (declNamed && !declNamed.text) type = byName(declNamed, false);
      else if (declType) notes.push(`Declared ${declared}, but the bytes are not ${withArticle(declType.name)}.`);
    }
  }
  if (recognised.alsoZip) notes.push(ALSO_ZIP_NOTE);
  const utf8Text = recognised.encoding === 'utf-8';
  const dataUriType =
    utf8Text && type.mime.startsWith('text/') && !type.mime.includes(';') ? `${type.mime};charset=utf-8` : type.mime;
  return { type, dataUriType, notes, recognised: { ...recognised, encoding: isText ? recognised.encoding : null } };
};
