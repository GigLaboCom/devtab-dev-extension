/**
 * A chosen, dropped or pasted file, read as far as the page needs before any decoding (docs/tools/specs/image-convert.md
 * §5.2, §5.6): its head — type, header facts, the bounds — and, for an SVG, its text, its own size and notes. The list
 * says at once what will not work; the worker checks the head again before it decodes.
 */
import { HEAD_BYTES, inspectHead, inspectSvg } from '@workspace/tool-logic-image-convert';
import type { ImageType, Size } from '@workspace/tool-logic-image-convert';

export interface Source {
  id: number;
  file: File;
  name: string;
  bytes: number;
  type: ImageType | null;
  /** After EXIF orientation; an SVG's own size. */
  size: Size | null;
  notes: string[];
  error: string | null;
  mayHaveAlpha: boolean;
  /** An SVG's text (drawn on the page as an image). */
  svg: string | null;
}

let nextId = 0;

export const readSource = async (file: File): Promise<Source> => {
  const base: Source = {
    id: ++nextId,
    file,
    name: file.name || 'image',
    bytes: file.size,
    type: null,
    size: null,
    notes: [],
    error: null,
    mayHaveAlpha: false,
    svg: null,
  };
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  } catch {
    return { ...base, error: 'This file could not be read.' };
  }
  const inspected = inspectHead(head, file.size);
  if (!inspected.ok) return { ...base, type: inspected.type ?? null, error: inspected.message };
  const known = { ...base, type: inspected.type, mayHaveAlpha: inspected.facts.mayHaveAlpha };
  if (inspected.type.kind !== 'svg') return { ...known, size: inspected.size, notes: inspected.notes };
  const text = await file.text();
  const svg = inspectSvg(text);
  if (!svg.ok) return { ...known, error: svg.message };
  return { ...known, size: svg.size, notes: svg.notes, svg: text };
};

/** A pasted SVG text as a file of its own. */
export const pastedSvg = (text: string): File => new File([text], 'pasted.svg', { type: 'image/svg+xml' });
