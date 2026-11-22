/**
 * Convert and Make icons as jobs (docs/tools/specs/image-convert.md §5.3, §5.8): files one by one through the worker,
 * SVGs drawn on the page first; each result or failure reported as it comes, the history entry at the end. A job stops
 * when the runner is cancelled (Cancel, Clear, the other task, leaving the page).
 */
import { drawSvg, drawSvgSquare, loadSvg } from './page';
import { Cancelled } from './runner';
import {
  NOT_SQUARE_NOTE,
  iconFiles,
  iconMarkup,
  outputName,
  planSize,
  uniqueNames,
} from '@workspace/tool-logic-image-convert';
import type { ConvertOptions, IconResult } from './convert.worker';
import type { ConvertParameters, Entry, FileFact, IconsParameters } from './entries';
import type { Runner } from './runner';
import type { Source } from './sources';
import type { OutputFormat, Size } from '@workspace/tool-logic-image-convert';

export interface Result {
  /** The source's id. */
  id: number;
  name: string;
  format: OutputFormat;
  blob: Blob | null;
  size: Size | null;
  notes: string[];
  error: string | null;
}

const factOf = (source: Source, result?: Result): FileFact => ({
  type: source.type?.name ?? null,
  ...(source.size ? { size: source.size } : {}),
  bytes: source.bytes,
  ...(result?.blob && result.size ? { out: { size: result.size, bytes: result.blob.size } } : {}),
  ...(source.error || result?.error ? { error: (source.error ?? result?.error)! } : {}),
});

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One file: an SVG drawn here at the planned size and encoded there; a raster decoded, resized, encoded there. */
const convertOne = async (runner: Runner, source: Source, options: ConvertOptions, name: string): Promise<Result> => {
  if (source.svg !== null && source.size) {
    const plan = planSize(source.size, options.resize, true);
    if (!plan.ok)
      return { id: source.id, name, format: options.format, blob: null, size: null, notes: [], error: plan.message };
    const image = await loadSvg(source.svg);
    const bitmap = drawSvg(image, source.size, plan.size, plan.crop);
    const done = await runner.encode(bitmap, options, true);
    const notes = [...source.notes, ...done.notes];
    return { id: source.id, name, format: options.format, blob: done.blob, size: done.size, notes, error: null };
  }
  const done = await runner.convert(source.file, options);
  return {
    id: source.id,
    name,
    format: options.format,
    blob: done.blob,
    size: done.size,
    notes: done.notes,
    error: null,
  };
};

export const runConvert = async (
  runner: Runner,
  sources: readonly Source[],
  parameters: ConvertParameters,
  onResult: (result: Result, done: number) => void,
): Promise<{ results: Result[]; entry: Entry } | null> => {
  const ready = sources.filter(s => !s.error);
  const names = uniqueNames(ready.map(s => outputName(s.name, parameters.format)));
  const results: Result[] = [];
  for (const [i, source] of ready.entries()) {
    let result: Result;
    try {
      result = await convertOne(runner, source, parameters, names[i]!);
    } catch (error) {
      if (error instanceof Cancelled) return null;
      const name = names[i]!;
      result = {
        id: source.id,
        name,
        format: parameters.format,
        blob: null,
        size: null,
        notes: [],
        error: message(error),
      };
    }
    results.push(result);
    onResult(result, i + 1);
  }
  const files = sources.map(s =>
    factOf(
      s,
      results.find(r => r.id === s.id),
    ),
  );
  return { results, entry: { task: 'convert', ...parameters, files } };
};

export interface IconsOutcome {
  files: IconResult[];
  notes: string[];
  markup: string;
  entry: Entry;
}

export const runIcons = async (
  runner: Runner,
  source: Source,
  parameters: IconsParameters,
): Promise<IconsOutcome | null> => {
  const files = iconFiles(parameters.sets);
  const options = {
    files,
    icoSizes: parameters.icoSizes,
    icoImages: parameters.icoImages,
    background: parameters.background,
  };
  try {
    let outcome: { files: IconResult[]; notes: string[] };
    if (source.svg !== null && source.size) {
      const own = source.size;
      const image = await loadSvg(source.svg);
      const sizes = [...new Set([...parameters.icoSizes, ...files.map(f => f.size)])];
      const bitmaps = sizes.map(size => ({ size, bitmap: drawSvgSquare(image, own, size) }));
      outcome = await runner.icons({ bitmaps }, options);
      outcome.notes = [...source.notes, ...(own.width !== own.height ? [NOT_SQUARE_NOTE] : []), ...outcome.notes];
    } else outcome = await runner.icons({ file: source.file }, options);
    const markup = iconMarkup(parameters.icoSizes, parameters.sets);
    const entry: Entry = {
      task: 'icons',
      ...parameters,
      source: factOf(source),
      made: outcome.files.map(f => ({ name: f.name, bytes: f.blob.size })),
    };
    return { ...outcome, markup, entry };
  } catch (error) {
    if (error instanceof Cancelled) return null;
    throw error;
  }
};
