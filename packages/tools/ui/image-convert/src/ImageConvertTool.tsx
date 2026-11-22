/**
 * The Image Converter's page (docs/tools/specs/image-convert.md §8). Two tasks: Convert — up to 20 images to PNG, JPEG
 * or WebP, resized or not, an SVG drawn at the chosen size — and Icons — one source to favicon.ico and named PNG sets.
 * Files come by Choose, a drop or a paste anywhere on the page (an SVG's text too); they are read as far as the list
 * needs (sources.ts), then decoded, resized and encoded in the package's worker (convert.worker.ts) when the person
 * presses Convert or Make icons — never on every keystroke: twenty 50-megapixel files would be seconds of work per digit.
 * Saving is a download of each file, or one .zip.
 *
 * History (D17): an entry when Convert or Make icons ends — the parameters and each file's type and sizes, never its
 * pixels or name (entries.ts). Saved parameters (D21, settings.ts): every control but the files.
 */
import { draftOf, readEntry } from './entries';
import { imageConvertHistory } from './history';
import { runConvert, runIcons } from './jobs';
import { saveBlob } from './page';
import { NumberField, ResultLine, SourceLine } from './parts';
import { createRunner, Cancelled } from './runner';
import { imageConvertSettings } from './settings';
import { pastedSvg, readSource } from './sources';
import { KEEPING, NOTHING_TO_MAKE, ONLY_FIRST } from './texts';
import {
  FORMAT_LABELS,
  ICO_SIZES,
  ICON_SET_IDS,
  ICON_SET_LABELS,
  MAX_FILES,
  MAX_PERCENT,
  MAX_PX,
  MAX_QUALITY,
  METADATA_NOTE,
  MIN_PERCENT,
  MIN_PX,
  MIN_QUALITY,
  JPEG_ALPHA_NOTE,
  count,
  looksLikeSvgText,
  parseWhole,
  sizeText,
  wholeNumberError,
} from '@workspace/tool-logic-image-convert';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { FileDrop } from '@workspace/ui/file-drop';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IconResult } from './convert.worker';
import type { ConvertParameters, IconsParameters } from './entries';
import type { Result } from './jobs';
import type { Source } from './sources';
import type { Fit, IconSet, OutputFormat, SizeMode } from '@workspace/tool-logic-image-convert';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/x-icon,image/avif,image/svg+xml,.svg,.ico';
const FORMATS: readonly OutputFormat[] = ['png', 'jpeg', 'webp'];
const SIZE_MODES: ReadonlyArray<{ value: SizeMode; label: string }> = [
  { value: 'original', label: 'Original size' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'both', label: 'Width and height' },
  { value: 'percent', label: 'Percentage' },
];
const FITS: ReadonlyArray<{ value: Fit; label: string }> = [
  { value: 'contain', label: 'Fit inside' },
  { value: 'cover', label: 'Fill and crop' },
  { value: 'exact', label: 'Stretch' },
];

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const fieldText = (n: number): string => (n > 0 ? String(n) : '');

type Task = 'convert' | 'icons';
type Working = { done: number; total: number } | null;
type IconsDone = { files: IconResult[]; notes: string[]; markup: string };

const ImageConvertTool = ({ host, restore }: ToolProps): ReactElement => {
  const { history, recorder, status } = useToolHistory(host, 'image-convert', imageConvertHistory);
  const [texts, setTexts] = useState<Record<'width' | 'height' | 'percent' | 'quality', string> | null>(null);
  const saved = useSavedSettings(host, 'image-convert', imageConvertSettings, { onReset: () => setTexts(null) });
  const v = saved.values;
  const task: Task = v.task;
  const format: OutputFormat = v.format;
  const quality = format === 'jpeg' ? v.jpegQuality : v.webpQuality;
  // The numeric fields as typed; null — as the saved values say.
  const shown = texts ?? {
    width: fieldText(v.width),
    height: fieldText(v.height),
    percent: String(v.percent),
    quality: String(quality),
  };

  const runner = useMemo(() => createRunner(), []);
  useEffect(() => () => runner.cancel(), [runner]);

  // ---- Convert
  const [sources, setSources] = useState<Source[]>([]);
  const [overflow, setOverflow] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [ranWith, setRanWith] = useState<string | null>(null);
  const [working, setWorking] = useState<Working>(null);
  // ---- Icons
  const [iconSource, setIconSource] = useState<Source | null>(null);
  const [icons, setIcons] = useState<IconsDone | null>(null);
  const [iconsWith, setIconsWith] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // ---- Both
  const [announcement, setAnnouncement] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const reads = useRef(0);

  // ---- The parameters and their checks (§5.5)
  const widthN = parseWhole(shown.width, MIN_PX, MAX_PX);
  const heightN = parseWhole(shown.height, MIN_PX, MAX_PX);
  const percentN = parseWhole(shown.percent, MIN_PERCENT, MAX_PERCENT);
  const qualityN = parseWhole(shown.quality, MIN_QUALITY, MAX_QUALITY);
  const needsWidth = v.sizeMode === 'width' || v.sizeMode === 'both';
  const needsHeight = v.sizeMode === 'height' || v.sizeMode === 'both';
  const needsQuality = format !== 'png' && !(format === 'webp' && v.lossless);
  const errors = {
    width: needsWidth && widthN === null ? wholeNumberError('Width', MIN_PX, MAX_PX) : null,
    height: needsHeight && heightN === null ? wholeNumberError('Height', MIN_PX, MAX_PX) : null,
    percent:
      v.sizeMode === 'percent' && percentN === null ? wholeNumberError('Percentage', MIN_PERCENT, MAX_PERCENT) : null,
    quality: needsQuality && qualityN === null ? wholeNumberError('Quality', MIN_QUALITY, MAX_QUALITY) : null,
  };
  const valid = Object.values(errors).every(e => e === null);
  const convertParameters: ConvertParameters = {
    format,
    quality: qualityN ?? quality,
    lossless: v.lossless,
    background: v.background,
    resize: {
      mode: v.sizeMode,
      width: widthN ?? v.width,
      height: heightN ?? v.height,
      percent: percentN ?? v.percent,
      fit: v.fit,
      enlarge: v.enlarge,
    },
  };
  const icoSizes = ICO_SIZES.filter(s => v.icoSizes.includes(String(s)));
  const sets = ICON_SET_IDS.filter(s => v.sets.includes(s));
  const iconsParameters: IconsParameters = { icoSizes, icoImages: v.icoImages, sets, background: v.background };

  const editText = (field: keyof typeof shown, text: string): void => {
    setTexts({ ...shown, [field]: text });
    if (field === 'quality') {
      const n = parseWhole(text, MIN_QUALITY, MAX_QUALITY);
      if (n !== null) saved.set(format === 'jpeg' ? { jpegQuality: n } : { webpQuality: n });
      return;
    }
    const n = field === 'percent' ? parseWhole(text, MIN_PERCENT, MAX_PERCENT) : parseWhole(text, MIN_PX, MAX_PX);
    if (n !== null) saved.set({ [field]: n });
  };
  const setFormat = (next: OutputFormat): void => {
    saved.set({ format: next });
    // The Quality field follows the format's own quality.
    setTexts(t => (t ? { ...t, quality: String(next === 'jpeg' ? v.jpegQuality : v.webpQuality) } : t));
  };

  // ---- Files
  const stopWork = (): void => {
    runner.cancel();
    setWorking(null);
  };
  const addFiles = (files: File[]): void => {
    if (!files.length) return;
    setRestored(null);
    setFailure(null);
    const serial = ++reads.current;
    if (task === 'icons') {
      stopWork();
      setIcons(null);
      void readSource(files[0]!).then(source => serial === reads.current && setIconSource(source));
      return;
    }
    const room = MAX_FILES - sources.length;
    setOverflow(files.length > room);
    void Promise.all(files.slice(0, Math.max(0, room)).map(readSource)).then(read =>
      setSources(list => [...list, ...read].slice(0, MAX_FILES)),
    );
  };
  const latestAdd = useRef(addFiles);
  latestAdd.current = addFiles;

  // A paste anywhere on the tool's page: image files, or an SVG's text outside a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const images = Array.from(event.clipboardData.items)
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (images.length) {
        event.preventDefault();
        latestAdd.current(images);
        return;
      }
      if (isEditable(event.target)) return;
      const text = event.clipboardData.getData('text/plain').trim();
      if (!looksLikeSvgText(text)) return;
      event.preventDefault();
      latestAdd.current([pastedSvg(text)]);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const clear = (): void => {
    stopWork();
    ++reads.current;
    setRestored(null);
    setFailure(null);
    setAnnouncement('');
    if (task === 'convert') {
      setSources([]);
      setResults([]);
      setOverflow(false);
      setRanWith(null);
    } else {
      setIconSource(null);
      setIcons(null);
      setIconsWith(null);
    }
  };

  // ---- Convert
  const convert = async (): Promise<void> => {
    if (!valid || working) return;
    const ready = sources.filter(s => !s.error);
    if (!ready.length) return;
    setRestored(null);
    setFailure(null);
    setResults([]);
    setAnnouncement('');
    setWorking({ done: 0, total: ready.length });
    const parameters = convertParameters;
    const outcome = await runConvert(runner, sources, parameters, (result, done) => {
      setResults(list => [...list, result]);
      setWorking({ done, total: ready.length });
    });
    setWorking(null);
    if (!outcome) return;
    setRanWith(JSON.stringify(parameters));
    const failed = outcome.results.filter(r => r.error).length;
    const n = outcome.results.length;
    setAnnouncement(
      failed
        ? `Converted ${count(n - failed)} of ${count(n)} ${n === 1 ? 'image' : 'images'}; ${count(failed)} failed.`
        : `Converted ${count(n)} ${n === 1 ? 'image' : 'images'}.`,
    );
    void recorder.commit(draftOf(outcome.entry));
  };

  // ---- Icons
  const makeIcons = async (): Promise<void> => {
    if (!iconSource || iconSource.error || working || (!icoSizes.length && !sets.length)) return;
    setRestored(null);
    setFailure(null);
    setIcons(null);
    setAnnouncement('');
    setWorking({ done: 0, total: 1 });
    try {
      const outcome = await runIcons(runner, iconSource, iconsParameters);
      setWorking(null);
      if (!outcome) return;
      setIcons({ files: outcome.files, notes: outcome.notes, markup: outcome.markup });
      setIconsWith(JSON.stringify(iconsParameters));
      setAnnouncement(`Made ${count(outcome.files.length)} icon ${outcome.files.length === 1 ? 'file' : 'files'}.`);
      void recorder.commit(draftOf(outcome.entry));
    } catch (error) {
      setWorking(null);
      if (!(error instanceof Cancelled)) setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const saveAll = (files: Array<{ name: string; blob: Blob }>, name: string): void => {
    void runner.zip(files).then(
      blob => saveBlob(blob, name),
      (error: unknown) =>
        !(error instanceof Cancelled) && setFailure(error instanceof Error ? error.message : String(error)),
    );
  };

  // ---- Opening an entry of the history: its parameters for this visit; the pictures were never kept.
  useRestore(history, restore, opened => {
    if (!opened.ok) {
      setRestored(
        opened.reason === 'newer-schema'
          ? 'This entry was kept by a newer version of the tool.'
          : 'This entry could not be opened.',
      );
      return;
    }
    const entry = readEntry(opened);
    if (!entry) return setRestored('This entry could not be opened.');
    stopWork();
    if (entry.task === 'convert') {
      const r = entry.resize;
      saved.visit({
        task: 'convert',
        format: entry.format,
        ...(entry.format === 'jpeg' ? { jpegQuality: entry.quality } : { webpQuality: entry.quality }),
        lossless: entry.lossless,
        background: entry.background,
        sizeMode: r.mode,
        width: r.width,
        height: r.height,
        percent: r.percent,
        fit: r.fit,
        enlarge: r.enlarge,
      });
      setTexts({
        width: fieldText(r.width),
        height: fieldText(r.height),
        percent: String(r.percent),
        quality: String(entry.quality),
      });
    } else
      saved.visit({
        task: 'icons',
        icoSizes: entry.icoSizes.map(String),
        icoImages: entry.icoImages,
        sets: entry.sets,
        background: entry.background,
      });
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}. The images are not kept: choose them again.`);
  });

  const stale =
    (task === 'convert' ? ranWith : iconsWith) !== null &&
    (task === 'convert'
      ? ranWith !== JSON.stringify(convertParameters)
      : iconsWith !== JSON.stringify(iconsParameters));
  const anySource = task === 'convert' ? sources.length > 0 : iconSource !== null;
  const jpegAlpha = task === 'convert' && format === 'jpeg' && sources.some(s => s.mayHaveAlpha && !s.error);
  const hasRaster = sources.some(s => s.svg === null && !s.error);

  const toggleList = (list: readonly string[], item: string, on: boolean): string[] =>
    on ? [...new Set([...list, item])] : list.filter(x => x !== item);

  const progress = working && (
    <div className="flex items-center gap-2" role="status">
      <span className="text-sm text-muted-foreground">
        {task === 'convert'
          ? `Converting ${count(Math.min(working.done + 1, working.total))} of ${count(working.total)}…`
          : 'Making icons…'}
      </span>
      <Button variant="outline" size="sm" onClick={stopWork}>
        Cancel
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-task={task}>
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Task"
          value={task}
          onValueChange={value => {
            if ((value === 'convert' || value === 'icons') && value !== task) {
              stopWork();
              setRestored(null);
              setFailure(null);
              saved.set({ task: value });
            }
          }}>
          <ToggleGroupItem value="convert">Convert</ToggleGroupItem>
          <ToggleGroupItem value="icons">Icons</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="outline" className="ml-auto" onClick={clear}>
          Clear
        </Button>
      </ToolOptions>

      {task === 'convert' ? (
        <ToolOptions className="flex-wrap" data-part="convert-options">
          <div className="flex items-center gap-2">
            <Label htmlFor="image-convert-format" className="text-muted-foreground">
              Format
            </Label>
            <Select
              value={format}
              onValueChange={value => FORMATS.includes(value as OutputFormat) && setFormat(value as OutputFormat)}>
              <SelectTrigger id="image-convert-format" className="min-w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map(f => (
                  <SelectItem key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {format !== 'png' && (
            <NumberField
              id="image-convert-quality"
              label="Quality"
              value={needsQuality ? shown.quality : '100'}
              min={MIN_QUALITY}
              max={MAX_QUALITY}
              invalid={errors.quality !== null}
              disabled={!needsQuality}
              onChange={text => editText('quality', text)}
            />
          )}
          {format === 'webp' && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="image-convert-lossless"
                checked={v.lossless}
                onCheckedChange={checked => saved.set({ lossless: checked === true })}
              />
              <Label htmlFor="image-convert-lossless" className="font-normal">
                Lossless
              </Label>
            </div>
          )}
          {format === 'jpeg' && (
            <div className="flex items-center gap-2">
              <Label htmlFor="image-convert-background" className="text-muted-foreground">
                Background
              </Label>
              <input
                id="image-convert-background"
                type="color"
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
                value={v.background}
                onChange={e => saved.set({ background: e.target.value.toLowerCase() })}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="image-convert-size" className="text-muted-foreground">
              Size
            </Label>
            <Select
              value={v.sizeMode}
              onValueChange={value =>
                SIZE_MODES.some(m => m.value === value) && saved.set({ sizeMode: value as SizeMode })
              }>
              <SelectTrigger id="image-convert-size" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_MODES.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsWidth && (
            <NumberField
              id="image-convert-width"
              label="Width"
              unit="px"
              value={shown.width}
              min={MIN_PX}
              max={MAX_PX}
              invalid={errors.width !== null}
              onChange={text => editText('width', text)}
            />
          )}
          {needsHeight && (
            <NumberField
              id="image-convert-height"
              label="Height"
              unit="px"
              value={shown.height}
              min={MIN_PX}
              max={MAX_PX}
              invalid={errors.height !== null}
              onChange={text => editText('height', text)}
            />
          )}
          {v.sizeMode === 'percent' && (
            <NumberField
              id="image-convert-percent"
              label="Percentage"
              unit="%"
              value={shown.percent}
              min={MIN_PERCENT}
              max={MAX_PERCENT}
              invalid={errors.percent !== null}
              onChange={text => editText('percent', text)}
            />
          )}
          {v.sizeMode === 'both' && (
            <div className="flex items-center gap-2">
              <Label htmlFor="image-convert-fit" className="text-muted-foreground">
                Fit
              </Label>
              <Select
                value={v.fit}
                onValueChange={value => FITS.some(f => f.value === value) && saved.set({ fit: value as Fit })}>
                <SelectTrigger id="image-convert-fit" className="min-w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FITS.map(f => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {v.sizeMode !== 'original' && (sources.length === 0 || hasRaster) && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="image-convert-enlarge"
                checked={v.enlarge}
                onCheckedChange={checked => saved.set({ enlarge: checked === true })}
              />
              <Label htmlFor="image-convert-enlarge" className="font-normal">
                Allow enlarging
              </Label>
            </div>
          )}
          <Button
            className="ml-auto"
            disabled={!valid || working !== null || !sources.some(s => !s.error)}
            onClick={() => void convert()}>
            Convert
          </Button>
        </ToolOptions>
      ) : (
        <ToolOptions className="flex-wrap" data-part="icons-options">
          <fieldset className="m-0 flex items-center gap-3 border-0 p-0">
            <legend className="float-left mr-1 text-sm text-muted-foreground">favicon.ico</legend>
            {ICO_SIZES.map(size => (
              <div key={size} className="flex items-center gap-1.5">
                <Checkbox
                  id={`image-convert-ico-${size}`}
                  checked={v.icoSizes.includes(String(size))}
                  onCheckedChange={checked =>
                    saved.set({ icoSizes: toggleList(v.icoSizes, String(size), checked === true) })
                  }
                />
                <Label htmlFor={`image-convert-ico-${size}`} className="font-normal">
                  {size}
                </Label>
              </div>
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <Label htmlFor="image-convert-ico-images" className="text-muted-foreground">
              ICO images
            </Label>
            <Select
              value={v.icoImages}
              onValueChange={value => (value === 'png' || value === 'bmp') && saved.set({ icoImages: value })}>
              <SelectTrigger id="image-convert-ico-images" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="bmp">BMP up to 48 px, PNG above</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <fieldset className="m-0 flex items-center gap-3 border-0 p-0">
            <legend className="float-left mr-1 text-sm text-muted-foreground">PNG sets</legend>
            {ICON_SET_IDS.map(id => (
              <div key={id} className="flex items-center gap-1.5">
                <Checkbox
                  id={`image-convert-set-${id}`}
                  checked={v.sets.includes(id)}
                  onCheckedChange={checked =>
                    saved.set({ sets: toggleList(v.sets, id, checked === true) as IconSet[] })
                  }
                />
                <Label htmlFor={`image-convert-set-${id}`} className="font-normal">
                  {ICON_SET_LABELS[id]}
                </Label>
              </div>
            ))}
          </fieldset>
          {sets.includes('favicon') && (
            <div className="flex items-center gap-2">
              <Label htmlFor="image-convert-icon-background" className="text-muted-foreground">
                Background
              </Label>
              <input
                id="image-convert-icon-background"
                type="color"
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
                value={v.background}
                onChange={e => saved.set({ background: e.target.value.toLowerCase() })}
              />
            </div>
          )}
          <Button
            className="ml-auto"
            disabled={
              !iconSource || iconSource.error !== null || working !== null || (!icoSizes.length && !sets.length)
            }
            onClick={() => void makeIcons()}>
            Make icons
          </Button>
        </ToolOptions>
      )}

      <div className="flex flex-col" data-part="field-errors">
        {Object.entries(errors).map(
          ([field, error]) =>
            error &&
            task === 'convert' && (
              <ToolMessage key={field} id={`image-convert-${field}-error`} tone="error" role="status">
                {error}
              </ToolMessage>
            ),
        )}
        {task === 'icons' && !icoSizes.length && !sets.length && (
          <ToolMessage tone="error" role="status">
            {NOTHING_TO_MAKE}
          </ToolMessage>
        )}
      </div>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      {failure && (
        <ToolMessage tone="error" data-part="failure">
          {failure}
        </ToolMessage>
      )}

      {task === 'convert' ? (
        <ToolPanes>
          <ToolPane label="Images">
            <FileDrop
              label="Drop images here, paste one, or"
              choose="Choose images"
              accept={ACCEPT}
              multiple
              onFiles={files => latestAdd.current(files)}>
              <p className="m-0 text-xs text-muted-foreground">
                PNG, JPEG, WebP, GIF, BMP, ICO, AVIF or SVG · up to 20 files, 100 megapixels each
              </p>
            </FileDrop>
            {overflow && <ToolMessage>{ONLY_FIRST}</ToolMessage>}
            {jpegAlpha && <ToolMessage>{JPEG_ALPHA_NOTE}</ToolMessage>}
            {sources.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0" aria-label="Images" data-part="sources">
                {sources.map(source => (
                  <SourceLine
                    key={source.id}
                    source={source}
                    onRemove={() => {
                      if (working) stopWork();
                      setSources(list => list.filter(s => s.id !== source.id));
                      setResults(list => list.filter(r => r.id !== source.id));
                    }}
                  />
                ))}
              </ul>
            )}
          </ToolPane>
          <ToolPane
            label="Results"
            actions={
              results.filter(r => r.blob).length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    saveAll(
                      results.filter(r => r.blob).map(r => ({ name: r.name, blob: r.blob! })),
                      'images.zip',
                    )
                  }>
                  Save all (.zip)
                </Button>
              )
            }>
            {progress}
            {stale && <ToolMessage>The settings changed: press Convert to apply them.</ToolMessage>}
            {results.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0" aria-label="Results" data-part="results">
                {results.map(result => {
                  const source = sources.find(s => s.id === result.id);
                  return (
                    <ResultLine
                      key={`${result.id}-${result.name}`}
                      name={result.name}
                      blob={result.blob}
                      facts={result.size ? `${FORMAT_LABELS[result.format]} · ${sizeText(result.size)}` : ''}
                      sourceBytes={source?.bytes}
                      notes={result.notes}
                      error={result.error}
                      onSave={result.blob ? () => saveBlob(result.blob!, result.name) : undefined}
                    />
                  );
                })}
              </ul>
            )}
            {!results.length && !working && (
              <p className="m-0 text-sm text-muted-foreground">
                {anySource ? 'Press Convert to make the results.' : 'The results appear here.'}
              </p>
            )}
          </ToolPane>
        </ToolPanes>
      ) : (
        <ToolPanes>
          <ToolPane label="Source">
            <FileDrop
              label="Drop an image here, paste it, or"
              choose="Choose image"
              accept={ACCEPT}
              onFiles={files => latestAdd.current(files)}>
              <p className="m-0 text-xs text-muted-foreground">
                A square image of 512 px or more, or an SVG, makes the sharpest icons
              </p>
            </FileDrop>
            {iconSource && (
              <ul className="m-0 flex list-none flex-col p-0" aria-label="Source" data-part="sources">
                <SourceLine source={iconSource} />
              </ul>
            )}
          </ToolPane>
          <ToolPane
            label="Icons"
            actions={
              icons &&
              icons.files.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => saveAll(icons.files, 'icons.zip')}>
                  Save all (.zip)
                </Button>
              )
            }>
            {progress}
            {stale && <ToolMessage>The settings changed: press Make icons to apply them.</ToolMessage>}
            {icons && (
              <>
                <div className="flex flex-col" role="status" data-part="icon-notes">
                  {icons.notes.map(note => (
                    <ToolMessage key={note} role={undefined}>
                      {note}
                    </ToolMessage>
                  ))}
                </div>
                <ul className="m-0 flex list-none flex-col p-0" aria-label="Icons" data-part="results">
                  {icons.files.map(file => (
                    <ResultLine
                      key={file.name}
                      name={file.name}
                      blob={file.blob}
                      facts={
                        file.name.endsWith('.ico')
                          ? `${count(file.sizes.length)} ${file.sizes.length === 1 ? 'image' : 'images'} (${file.sizes.join(', ')})`
                          : sizeText({ width: file.sizes[0]!, height: file.sizes[0]! })
                      }
                      notes={[]}
                      onSave={() => saveBlob(file.blob, file.name)}
                    />
                  ))}
                </ul>
                {icons.markup && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="image-convert-markup">Markup</Label>
                      <CopyButton value={icons.markup} size="sm" />
                    </div>
                    <ResultField
                      id="image-convert-markup"
                      className="h-40 resize-y font-mono text-code field-sizing-fixed"
                      spellCheck={false}
                      value={icons.markup}
                    />
                  </div>
                )}
              </>
            )}
            {!icons && !working && (
              <p className="m-0 text-sm text-muted-foreground">
                {anySource ? 'Press Make icons to make the files.' : 'The icons appear here.'}
              </p>
            )}
          </ToolPane>
        </ToolPanes>
      )}

      {task === 'convert' && (
        <p className="m-0 text-sm text-muted-foreground" data-part="metadata">
          {METADATA_NOTE}
        </p>
      )}
      {status.gate === 'on' && anySource && (
        <p className="m-0 text-sm text-muted-foreground" data-part="keeping">
          {KEEPING}
        </p>
      )}
      <p className="sr-only" aria-live="polite" data-part="announcement">
        {announcement}
      </p>
    </div>
  );
};

export default ImageConvertTool;
