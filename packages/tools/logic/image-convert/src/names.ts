/**
 * File names of results (docs/tools/specs/image-convert.md §5.10): the source's name without its last extension,
 * cleaned of what file systems refuse, with the format's extension; repeats in one list get " (2)", " (3)".
 */
import type { OutputFormat } from './types';

export const FORMAT_EXT: Record<OutputFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };
export const FORMAT_LABELS: Record<OutputFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };
export const FORMAT_MIME: Record<OutputFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Characters Windows, macOS or Linux refuse in a name (control characters are refused too). */
const REFUSED = '/\\:*?"<>|';
const safe = (c: string): string =>
  c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f || REFUSED.includes(c) ? '_' : c;

/** The base of a file name: no last extension, nothing a file system refuses, no spaces or dots at its edges. */
export const baseName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const cleaned = base
    .split('')
    .map(safe)
    .join('')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '');
  return (cleaned || 'image').slice(0, 200);
};

export const outputName = (sourceName: string, format: OutputFormat): string =>
  `${baseName(sourceName)}.${FORMAT_EXT[format]}`;

/** The names with repeats numbered: a.png, a (2).png, a (3).png — compared without case, as macOS and Windows do. */
export const uniqueNames = (names: readonly string[]): string[] => {
  const taken = new Set<string>();
  return names.map(name => {
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
};
