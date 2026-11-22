/**
 * Generate (docs/tools/specs/qr.md §3, §8): what to encode — text, or the Wi-Fi form with its `WIFI:` string — the
 * three options, and the code with its information line and the four actions. Presentational: the state is QrTool's.
 */
import { copyPng, downloadBlob, pngBlob, svgBlob } from './image';
import { QrCode } from './QrCode';
import {
  endsWithSpace,
  infoLine,
  LEVEL_LABELS,
  LEVELS,
  MODULE_PX,
  PASSWORD_MASK,
  QUIET_ZONES,
  SECURITY_OPTIONS,
  STANDARD_QUIET,
  wifiNotes,
  wifiString,
} from '@workspace/tool-logic-qr';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';
import type { Content } from './QrTool';
import type { BuildResult, Level, ModulePx, QuietZone, WifiDetails, WifiSecurity } from '@workspace/tool-logic-qr';
import type { ReactElement } from 'react';

export interface MakeViewProps {
  content: Content;
  text: string;
  wifi: WifiDetails;
  level: Level;
  quiet: QuietZone;
  px: ModulePx;
  /** The string the code holds. */
  encoded: string;
  built: BuildResult | 'pending';
  /** What the history does with secrets now, when this code holds one. */
  kept: string | null;
  onContent: (content: Content) => void;
  onText: (text: string) => void;
  onWifi: (wifi: WifiDetails) => void;
  onLevel: (level: Level) => void;
  onQuiet: (quiet: QuietZone) => void;
  onPx: (px: ModulePx) => void;
  /** Copy image, Copy text, Download SVG or PNG was pressed: the code was taken. */
  onAction: () => void;
}

const QUIET_NOTE = 'ISO/IEC 18004 asks for a quiet zone of 4 modules; some scanners fail with less.';
const SPACE_NOTE = 'The text ends with a space or line break; it is encoded too.';

const Option = <T extends string | number>({
  id,
  label,
  value,
  items,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  items: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}): ReactElement => (
  <div className="flex items-center gap-2">
    <Label htmlFor={id} className="text-muted-foreground font-normal">
      {label}
    </Label>
    <Select
      value={String(value)}
      onValueChange={v => {
        const next = items.find(i => String(i.value) === v);
        if (next) onChange(next.value);
      }}>
      <SelectTrigger id={id} size="sm" className="min-w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(i => (
          <SelectItem key={String(i.value)} value={String(i.value)}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export const MakeView = (props: MakeViewProps): ReactElement => {
  const { content, text, wifi, level, quiet, px, encoded, built, kept } = props;
  const [showPassword, setShowPassword] = useState(false);
  /** Copy image's outcome, for the code it copied: "Copied" or the error until the next change (§8). */
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const ready = built !== 'pending' && built.ok ? built : null;
  const key = `${encoded}\u0000${level}\u0000${quiet}\u0000${px}`;
  const copiedNow = copied?.key === key ? copied : null;
  const message = built !== 'pending' && !built.ok && 'message' in built ? built.message : null;
  const setWifi = (patch: Partial<WifiDetails>) => props.onWifi({ ...wifi, ...patch });
  // The string under the form shows the password only when asked to (the code and Copy text hold the real one).
  const shownWifi = wifiString(showPassword || wifi.password === '' ? wifi : { ...wifi, password: PASSWORD_MASK });

  const copyImage = (): void => {
    if (!ready) return;
    props.onAction();
    copyPng(pngBlob(ready.modules, quiet, px)).then(
      () => setCopied({ key, ok: true }),
      () => setCopied({ key, ok: false }),
    );
  };
  const download = (kind: 'svg' | 'png'): void => {
    if (!ready) return;
    props.onAction();
    if (kind === 'svg') downloadBlob(svgBlob(ready.modules, quiet, px), 'qr-code.svg');
    else void pngBlob(ready.modules, quiet, px).then(blob => downloadBlob(blob, 'qr-code.png'));
  };

  const textMessages = (
    <div data-field="text">
      {message ? (
        <ToolMessage tone="error" role="status">
          {message}
        </ToolMessage>
      ) : content === 'text' && endsWithSpace(text) ? (
        <ToolMessage>{SPACE_NOTE}</ToolMessage>
      ) : (
        <ToolMessage />
      )}
    </div>
  );

  return (
    <>
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-label="Content"
          value={content}
          onValueChange={value => value && props.onContent(value as Content)}>
          <ToggleGroupItem value="text">Text</ToggleGroupItem>
          <ToggleGroupItem value="wifi">Wi-Fi</ToggleGroupItem>
        </ToggleGroup>
      </ToolOptions>

      <ToolPanes>
        <ToolPane label={content === 'text' ? 'Text' : 'Wi-Fi'} {...(content === 'text' ? { htmlFor: 'qr-text' } : {})}>
          {content === 'text' ? (
            <>
              <Textarea
                id="qr-text"
                className="h-40 resize-y font-mono text-code field-sizing-fixed"
                spellCheck={false}
                placeholder="https://example.com/ or any text"
                value={text}
                onChange={e => props.onText(e.target.value)}
              />
              {textMessages}
              {kept && (
                <p className="text-muted-foreground m-0 text-sm" data-kept>
                  {kept}
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3" data-wifi-form>
              <div className="flex flex-col gap-1">
                <Label htmlFor="qr-ssid">Network name</Label>
                <Input
                  id="qr-ssid"
                  spellCheck={false}
                  autoComplete="off"
                  value={wifi.ssid}
                  onChange={e => setWifi({ ssid: e.target.value })}
                />
                <div data-field="ssid">
                  {wifi.ssid === '' ? <ToolMessage>Enter the network name.</ToolMessage> : <ToolMessage />}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="qr-security">Security</Label>
                <Select value={wifi.security} onValueChange={v => setWifi({ security: v as WifiSecurity })}>
                  <SelectTrigger id="qr-security" className="w-56 max-w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECURITY_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="qr-password">Password</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="qr-password"
                    className="font-mono"
                    type={showPassword ? 'text' : 'password'}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={wifi.security === 'none'}
                    value={wifi.security === 'none' ? '' : wifi.password}
                    onChange={e => setWifi({ password: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={showPassword}
                    disabled={wifi.security === 'none'}
                    onClick={() => setShowPassword(s => !s)}>
                    {showPassword ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                    {showPassword ? 'Hide' : 'Show'}
                  </Button>
                </div>
                <div data-field="password">
                  {wifiNotes(wifi).map(n => (
                    <ToolMessage key={n}>{n}</ToolMessage>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="qr-hidden" checked={wifi.hidden} onCheckedChange={c => setWifi({ hidden: c === true })} />
                <Label htmlFor="qr-hidden" className="font-normal">
                  Hidden network
                </Label>
              </div>
              {wifi.ssid !== '' && (
                <output
                  className="font-mono text-code break-all text-muted-foreground"
                  aria-label="Wi-Fi string"
                  aria-live="off"
                  data-wifi-string>
                  {shownWifi}
                </output>
              )}
              {textMessages}
              {kept && (
                <p className="text-muted-foreground m-0 text-sm" data-kept>
                  {kept}
                </p>
              )}
            </div>
          )}
          <ToolOptions className="mt-2">
            <Option
              id="qr-level"
              label="Error correction"
              value={level}
              items={LEVELS.map(l => ({ value: l, label: LEVEL_LABELS[l] }))}
              onChange={props.onLevel}
            />
            <Option
              id="qr-quiet"
              label="Quiet zone"
              value={quiet}
              items={QUIET_ZONES.map(q => ({ value: q, label: `${q} ${q === 1 ? 'module' : 'modules'}` }))}
              onChange={props.onQuiet}
            />
            <Option
              id="qr-px"
              label="PNG size"
              value={px}
              items={MODULE_PX.map(p => ({ value: p, label: `${p} px per module` }))}
              onChange={props.onPx}
            />
          </ToolOptions>
        </ToolPane>

        <ToolPane label="QR code">
          <div className="flex flex-col items-start gap-2">
            {ready ? (
              <QrCode modules={ready.modules} quiet={quiet} />
            ) : (
              <div
                className="flex size-64 shrink-0 items-center justify-center rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
                data-qr-empty>
                {encoded === ''
                  ? content === 'text'
                    ? 'Enter text to make a QR code.'
                    : 'Enter Wi-Fi details to make a QR code.'
                  : ''}
              </div>
            )}
            <p className="m-0 text-sm text-muted-foreground" role="status" data-info>
              {ready ? infoLine(ready, level) : ''}
            </p>
            {ready && quiet < STANDARD_QUIET && <ToolMessage data-quiet-note>{QUIET_NOTE}</ToolMessage>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => download('svg')}>
                Download SVG
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => download('png')}>
                Download PNG
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!ready}
                data-copy-image
                data-copied={copiedNow?.ok || undefined}
                onClick={copyImage}>
                {copiedNow?.ok ? 'Copied' : 'Copy image'}
              </Button>
              <CopyButton variant="outline" label="Copy text" value={ready ? encoded : ''} onCopied={props.onAction} />
            </div>
            {copiedNow && !copiedNow.ok && (
              <ToolMessage tone="error" data-copy-error>
                Could not copy the image.
              </ToolMessage>
            )}
          </div>
        </ToolPane>
      </ToolPanes>
    </>
  );
};
