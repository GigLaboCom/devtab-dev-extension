/**
 * The Image Converter's history entries (D17; history.ts declares what is kept): drafts, labels and the reader of an
 * opened entry. Payload schema 1. No pixels and no file names: a file is its type, sizes in pixels and bytes, the
 * result's sizes or the reason it failed (the reasons never name a file).
 */
import {
  FORMAT_LABELS,
  ICON_SET_IDS,
  ICON_SET_LABELS,
  ICO_SIZES,
  count,
  sizeText,
} from '@workspace/tool-logic-image-convert';
import type { IconSet, OutputFormat, ResizeOptions, Size } from '@workspace/tool-logic-image-convert';
import type { HistoryDraft, OpenedEntry } from '@workspace/tools-host';

export interface FileFact {
  /** 'PNG', 'SVG', … or null when the bytes were not an image. */
  type: string | null;
  size?: Size;
  bytes: number;
  out?: { size: Size; bytes: number };
  error?: string;
}

export interface ConvertParameters {
  format: OutputFormat;
  quality: number;
  lossless: boolean;
  background: string;
  resize: ResizeOptions;
}

export interface IconsParameters {
  icoSizes: number[];
  icoImages: 'png' | 'bmp';
  sets: IconSet[];
  background: string;
}

export type Entry =
  | ({ task: 'convert'; files: FileFact[] } & ConvertParameters)
  | ({ task: 'icons'; source: FileFact; made: Array<{ name: string; bytes: number }> } & IconsParameters);

export const formatWithQuality = (p: Pick<ConvertParameters, 'format' | 'quality' | 'lossless'>): string =>
  p.format === 'png'
    ? 'PNG'
    : p.format === 'webp' && p.lossless
      ? 'WebP lossless'
      : `${FORMAT_LABELS[p.format]} ${p.quality}`;

const ratio = (out: number, source: number): string =>
  source > 0 ? (out / source < 0.01 ? '<1%' : `${Math.round((100 * out) / source)}%`) : '';

/** 'PNG 2,880 × 1,800 → WebP 80 · 1,440 × 900 · 3% of the original'; '3 images → JPEG 85 · 1 failed'. */
export const convertLabel = (entry: Extract<Entry, { task: 'convert' }>): string => {
  const target = formatWithQuality(entry);
  const done = entry.files.filter(f => f.out);
  const failed = entry.files.length - done.length;
  if (entry.files.length === 1) {
    const [file] = entry.files as [FileFact];
    if (!file.out) return `${file.type ?? 'A file'} → ${target} · failed`;
    const from = [file.type, file.size ? sizeText(file.size) : null].filter(Boolean).join(' ');
    return `${from} → ${target} · ${sizeText(file.out.size)} · ${ratio(file.out.bytes, file.bytes)} of the original`;
  }
  return `${count(entry.files.length)} images → ${target}${failed ? ` · ${count(failed)} failed` : ''}`;
};

/** 'Icons from SVG 24 × 24 · favicon.ico (16, 32, 48), Favicon · 4 files'. */
export const iconsLabel = (entry: Extract<Entry, { task: 'icons' }>): string => {
  const parts = [
    entry.icoSizes.length ? `favicon.ico (${entry.icoSizes.join(', ')})` : null,
    ...entry.sets.map(s => ICON_SET_LABELS[s]),
  ].filter(Boolean);
  const source = `${entry.source.type ?? 'an image'}${entry.source.size ? ` ${sizeText(entry.source.size)}` : ''}`;
  return `Icons from ${source} · ${parts.join(', ')} · ${count(entry.made.length)} ${entry.made.length === 1 ? 'file' : 'files'}`;
};

export const draftOf = (entry: Entry): HistoryDraft => ({
  kind: entry.task,
  payload: entry as unknown as HistoryDraft['payload'],
  label: entry.task === 'convert' ? convertLabel(entry) : iconsLabel(entry),
});

// ---- Reading an opened entry back: every field checked, anything unknown is no entry.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => values.includes(v as T);
const whole = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const COLOUR = /^#[0-9a-f]{6}$/;

const readResize = (v: unknown): ResizeOptions | null => {
  if (!isObject(v)) return null;
  const { mode, width, height, percent, fit, enlarge } = v;
  if (!oneOf(mode, ['original', 'width', 'height', 'both', 'percent'] as const)) return null;
  if (!whole(width, 0, 65_535) || !whole(height, 0, 65_535) || !whole(percent, 1, 1000)) return null;
  if (!oneOf(fit, ['contain', 'cover', 'exact'] as const) || typeof enlarge !== 'boolean') return null;
  return { mode, width, height, percent, fit, enlarge };
};

/** The parameters an opened entry brings back, or null when it is not one of ours. */
export const readEntry = (
  opened: Extract<OpenedEntry, { ok: true }>,
): ({ task: 'convert' } & ConvertParameters) | ({ task: 'icons' } & IconsParameters) | null => {
  const p = opened.payload;
  if (!isObject(p) || opened.entry.schema !== 1) return null;
  const background = typeof p.background === 'string' && COLOUR.test(p.background) ? p.background : null;
  if (!background) return null;
  if (p.task === 'convert') {
    const resize = readResize(p.resize);
    if (!oneOf(p.format, ['png', 'jpeg', 'webp'] as const) || !whole(p.quality, 1, 100) || !resize) return null;
    if (typeof p.lossless !== 'boolean') return null;
    return { task: 'convert', format: p.format, quality: p.quality, lossless: p.lossless, background, resize };
  }
  if (p.task === 'icons') {
    const icoSizes = Array.isArray(p.icoSizes)
      ? p.icoSizes.filter((s): s is number => ICO_SIZES.includes(s as number))
      : [];
    const sets = Array.isArray(p.sets) ? ICON_SET_IDS.filter(s => (p.sets as unknown[]).includes(s)) : [];
    if (!oneOf(p.icoImages, ['png', 'bmp'] as const)) return null;
    return { task: 'icons', icoSizes, icoImages: p.icoImages, sets, background };
  }
  return null;
};
