/**
 * The Color tool's page (docs/tools/specs/color.md §8): a colour in any CSS notation — its swatch, what happens to it
 * outside sRGB, every notation with a copy button, its CSS name — and its WCAG contrast on a background. The host wraps
 * it in the kit's ToolPage (title, summary, the history line); this is the body. Logic: @workspace/tool-logic-color.
 * History: through the host — `recorder.change` when a person changes the colour or the background (typing, a picker,
 * Swap), `recorder.commit` when a format is copied; `useRestore` opens an entry the host asks for. No network, no
 * permission: the pickers are the browser's own (`<input type="color">`, `EyeDropper` where Chrome has it).
 */
import { colorDraft, isColorPayload } from './entries';
import { colorHistory } from './history';
import { ContrastSample, Swatch } from './swatches';
import { colorName, contrast, convertColor, parseColor, pickerValue } from '@workspace/tool-logic-color';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { ToolMessage, ToolPane } from '@workspace/ui/tool-page';
import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ColorPayload } from './history';
import type { Color, ColorName, Contrast, Formats, ParseColorResult } from '@workspace/tool-logic-color';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** The background the page opens with (§4). */
export const DEFAULT_BACKGROUND = '#ffffff';
/** What a picker shows for an empty or unreadable field (§5.8). */
const PICKER_EMPTY = '#000000';

const ROWS: ReadonlyArray<{ key: keyof Formats | 'name'; label: string }> = [
  { key: 'hex', label: 'HEX' },
  { key: 'rgb', label: 'RGB' },
  { key: 'hsl', label: 'HSL' },
  { key: 'hwb', label: 'HWB' },
  { key: 'lab', label: 'LAB' },
  { key: 'lch', label: 'LCH' },
  { key: 'oklab', label: 'OKLAB' },
  { key: 'oklch', label: 'OKLCH' },
  { key: 'p3', label: 'Display P3' },
  { key: 'name', label: 'Name' },
];

const CHECKS: ReadonlyArray<{ key: keyof Contrast; label: string; threshold: string }> = [
  { key: 'aaNormal', label: 'AA · normal text', threshold: '4.5:1' },
  { key: 'aaLarge', label: 'AA · large text', threshold: '3:1' },
  { key: 'aaaNormal', label: 'AAA · normal text', threshold: '7:1' },
  { key: 'aaaLarge', label: 'AAA · large text', threshold: '4.5:1' },
  { key: 'nonText', label: 'UI components and graphics', threshold: '3:1' },
];

/** Chrome's screen colour picker (95+); not in every browser, so the button is there only when it is. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
type EyeDropperWindow = Window & { EyeDropper?: new () => EyeDropperApi };
const eyeDropper = (): (new () => EyeDropperApi) | undefined =>
  typeof window === 'undefined' ? undefined : (window as EyeDropperWindow).EyeDropper;

const nameText = (name: ColorName): string => ('exact' in name ? name.exact.join(' / ') : `≈ ${name.nearest}`);

/** The words under a field: its error, or how a bare hex was read. */
const FieldMessage = ({ parsed }: { parsed: ParseColorResult }): ReactElement =>
  // Live while typing: read out politely (status), not as an alert on every keystroke (the recipe over §8).
  !parsed.ok && 'message' in parsed ? (
    <ToolMessage tone="error" role="status">
      {parsed.message}
    </ToolMessage>
  ) : (
    <ToolMessage>{parsed.ok && parsed.note ? parsed.note : null}</ToolMessage>
  );

const gamutLine = (f: Formats): string =>
  `${f.inP3 ? 'Outside sRGB, inside Display P3.' : 'Outside sRGB and Display P3.'} The sRGB formats show the closest colour by CSS Color 4 gamut mapping: ${f.hex}. Browsers clip it instead: ${f.clippedHex}.`;

/** A system colour picker next to a field: `#rrggbb` of the field's colour, or black. */
const Picker = ({
  label,
  color,
  onPick,
}: {
  label: string;
  color: Color | null;
  onPick: (hex: string) => void;
}): ReactElement => (
  <input
    type="color"
    aria-label={label}
    title={label}
    className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
    value={color ? pickerValue(color) : PICKER_EMPTY}
    onChange={e => onPick(e.target.value)}
  />
);

const ColorTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [colorText, setColorText] = useState(initial ?? '');
  const [backgroundText, setBackgroundText] = useState(DEFAULT_BACKGROUND);
  const [restored, setRestored] = useState<string | null>(null);
  // Every change of a field: a copy button says "Copied" until the next one (§8), even if a value comes back.
  const [version, setVersion] = useState(0);
  const { history, recorder } = useToolHistory(host, 'color', colorHistory);
  const ids = useId();
  const Dropper = useMemo(eyeDropper, []);

  const parsed = useMemo(() => parseColor(colorText), [colorText]);
  const background = useMemo(() => parseColor(backgroundText), [backgroundText]);
  const color = parsed.ok ? parsed.color : null;
  const bg = background.ok ? background.color : null;
  const formats = useMemo(() => (color ? convertColor(color) : null), [color]);
  const name = useMemo(() => (color ? colorName(color) : null), [color]);
  const ratio = useMemo(() => (color && bg ? contrast(color, bg) : null), [color, bg]);

  // What the history keeps of the current state: both fields as typed, once the colour reads.
  const draft = useMemo(
    (): HistoryDraft | null => (color ? colorDraft({ color: colorText, background: backgroundText }) : null),
    [color, colorText, backgroundText],
  );
  // A snapshot only after a person's edit (handed text counts as one), never after an entry is opened.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (edited.current && draft) recorder.change(draft);
  }, [recorder, draft]);
  const commit = (): void => {
    if (draft) void recorder.commit(draft);
  };

  const edit = (next: { color?: string; background?: string }): void => {
    edited.current = true;
    setRestored(null);
    setVersion(v => v + 1);
    if (next.color !== undefined) setColorText(next.color);
    if (next.background !== undefined) setBackgroundText(next.background);
  };

  const pickFromScreen = (): void => {
    if (!Dropper) return;
    new Dropper().open().then(
      result => edit({ color: result.sRGBHex }),
      // Esc or a click elsewhere (AbortError): nothing to say.
      () => undefined,
    );
  };

  useRestore(history, restore, opened => {
    if (!opened.ok) {
      setRestored(
        opened.reason === 'locked'
          ? 'This entry is encrypted: unlock the history to open it.'
          : opened.reason === 'newer-schema'
            ? 'This entry was kept by a newer version of the tool.'
            : 'This entry could not be opened.',
      );
      return;
    }
    const p: ColorPayload = isColorPayload(opened.payload)
      ? opened.payload
      : { color: '', background: DEFAULT_BACKGROUND };
    edited.current = false;
    setVersion(v => v + 1);
    setColorText(p.color);
    setBackgroundText(p.background);
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  const value = (key: keyof Formats | 'name'): string =>
    !formats || !name ? '' : key === 'name' ? nameText(name) : String(formats[key] ?? '');

  return (
    <div className="flex flex-col gap-4">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPane label="Color" htmlFor="color-input">
        <div className="flex items-center gap-2">
          <Input
            id="color-input"
            className="flex-1 font-mono text-code"
            spellCheck={false}
            autoComplete="off"
            placeholder="#ff8800, rgb(…), oklch(…)"
            value={colorText}
            onChange={e => edit({ color: e.target.value })}
          />
          <Picker label="Pick a colour" color={color} onPick={hex => edit({ color: hex })} />
          {Dropper && (
            <Button variant="outline" onClick={pickFromScreen}>
              Pick from screen
            </Button>
          )}
        </div>
        <FieldMessage parsed={parsed} />
      </ToolPane>

      <div className="flex items-start gap-3">
        <Swatch formats={formats} translucent={color !== null && (color.alpha ?? 1) < 1} />
        <ToolMessage className="flex-1" data-gamut>
          {formats && !formats.inSrgb ? gamutLine(formats) : null}
        </ToolMessage>
      </div>

      <Table aria-label="Formats">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Format</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="w-24">
              <span className="sr-only">Copy</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map(row => {
            const shown = value(row.key);
            const labelId = `${ids}-format-${row.key}`;
            const buttonId = `${ids}-copy-${row.key}`;
            return (
              <TableRow key={row.key}>
                <TableCell id={labelId} className="text-muted-foreground">
                  {row.label}
                </TableCell>
                <TableCell className="font-mono text-code break-all" data-format={row.key}>
                  {shown}
                  {row.key === 'name' && name && 'nearest' in name && (
                    <span className="ml-2 font-sans text-xs text-muted-foreground">(ΔE {name.distance})</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <CopyButton
                    key={version}
                    id={buttonId}
                    aria-labelledby={`${buttonId} ${labelId}`}
                    value={shown}
                    onCopied={commit}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <ToolPane label="Contrast">
        <div className="flex flex-col gap-1">
          <Label htmlFor="color-background">Background</Label>
          <div className="flex items-center gap-2">
            <Input
              id="color-background"
              className="flex-1 font-mono text-code"
              spellCheck={false}
              autoComplete="off"
              value={backgroundText}
              onChange={e => edit({ background: e.target.value })}
            />
            <Picker label="Pick a background colour" color={bg} onPick={hex => edit({ background: hex })} />
            <Button
              variant="outline"
              aria-label="Swap colour and background"
              onClick={() => edit({ color: backgroundText, background: colorText })}>
              Swap
            </Button>
          </div>
          <FieldMessage parsed={background} />
        </div>
        {ratio && (
          <div className="flex flex-wrap items-start gap-4" data-contrast>
            <ContrastSample foreground={ratio.foreground} background={ratio.background} />
            <div className="flex min-w-60 flex-1 flex-col gap-2">
              <p className="m-0 text-lg font-semibold tabular-nums" data-ratio>
                {ratio.shown}
              </p>
              {ratio.foregroundBlended && (
                <ToolMessage>
                  {`The text colour is semi-transparent: contrast uses it blended over the background (${ratio.foreground}).`}
                </ToolMessage>
              )}
              {ratio.backgroundBlended && (
                <ToolMessage>
                  {`The background is semi-transparent: contrast uses it over white (${ratio.background}).`}
                </ToolMessage>
              )}
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="WCAG checks">
                {CHECKS.map(check => {
                  const pass = ratio[check.key] === true;
                  return (
                    <li key={check.key} className="flex items-center gap-3 text-sm" data-check={check.key}>
                      <span className="flex-1">{check.label}</span>
                      <span className="w-12 text-right text-muted-foreground tabular-nums">{check.threshold}</span>
                      <span className={`flex w-16 items-center gap-1 ${pass ? 'text-success' : 'text-destructive'}`}>
                        {pass ? (
                          <CircleCheckIcon aria-hidden="true" className="size-4" />
                        ) : (
                          <CircleXIcon aria-hidden="true" className="size-4" />
                        )}
                        {pass ? 'Pass' : 'Fail'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </ToolPane>
    </div>
  );
};

export default ColorTool;
