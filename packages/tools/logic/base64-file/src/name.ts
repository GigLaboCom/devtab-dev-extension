/**
 * The name a saved file gets (docs/tools/specs/base64-file.md §5.4). Its base comes from a data URI's `name` or
 * `filename` parameter, a PEM label, or `file`; it is cleaned of whatever could steer a save elsewhere or hide in a
 * name — path separators, control and invisible formatting characters, characters Windows refuses, leading and trailing
 * dots and spaces, reserved device names — and given the extension the bytes call for.
 */
import { extensionOf } from './recognise';
import type { FileType } from './types';

export const MAX_NAME_CHARS = 120;
export const DEFAULT_NAME = 'file';

/** Invisible formatting characters (Unicode category Cf): bidirectional controls, zero widths, the BOM. */
const FORMAT = /^\p{Cf}$/u;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

/** The name cleaned (§5.4): what is left of it, never empty (`file`), never a path. */
export const cleanFileName = (name: string): string => {
  let base = name.split(/[\\/]/).pop() ?? '';
  base = [...base]
    .filter(ch => {
      const c = ch.codePointAt(0)!;
      return c >= 0x20 && !(c >= 0x7f && c <= 0x9f) && !FORMAT.test(ch);
    })
    .join('')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (RESERVED.test(base)) base = `_${base}`;
  if (base.length > MAX_NAME_CHARS) {
    const ext = extensionOf(base);
    const keep = ext && ext.length < 16 ? ext.length + 1 : 0;
    base = base.slice(0, MAX_NAME_CHARS - keep).replace(/[\s.]+$/, '') + (keep ? `.${ext}` : '');
  }
  return base || DEFAULT_NAME;
};

const PEM_BASES: ReadonlyArray<[RegExp, string]> = [
  [/PRIVATE KEY$/, 'key'],
  [/CERTIFICATE REQUEST$/, 'request'],
  [/CERTIFICATE$/, 'certificate'],
  [/PUBLIC KEY$/, 'public-key'],
  [/CRL$/, 'crl'],
];

/** The base a PEM label suggests: `CERTIFICATE` → `certificate`. */
export const pemBase = (label: string | null): string | null => {
  if (!label) return null;
  for (const [pattern, base] of PEM_BASES) if (pattern.test(label)) return base;
  return null;
};

/**
 * The suggested name: the cleaned base with the extension of a specifically recognised type (replacing one that is not
 * of that type); for text and unknown bytes the base's own extension stays, and a base without one gets the type's.
 */
export const suggestName = (base: string | null, type: FileType): string => {
  const clean = cleanFileName(base ?? DEFAULT_NAME);
  const ext = extensionOf(clean);
  if (type.specific) {
    if (type.exts.includes(ext)) return clean;
    const stem = ext ? clean.slice(0, clean.length - ext.length - 1) : clean;
    return `${stem || DEFAULT_NAME}.${type.ext}`;
  }
  return ext ? clean : `${clean}.${type.ext}`;
};

/** Encode's Save: the output as text, named after the file. */
export const textFileName = (fileName: string | null): string => `${cleanFileName(fileName ?? DEFAULT_NAME)}.txt`;
