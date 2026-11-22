/**
 * Read (docs/tools/specs/qr.md §5.6, §8): the drop zone with Choose image (the kit's FileDrop), the preview on a canvas
 * — not an `<img>`: showing it needs no image address — and what the code holds: the text, read-only, with Copy; a
 * link is text and never opened; Wi-Fi details as a table with the password hidden until Show; bytes that are not text
 * also as hex. Presentational: the state is QrTool's; the canvas stays mounted so a pasted image can be drawn into it
 * from either half.
 */
import { foundLine, isLink, maskWifiPassword, parseWifi } from '@workspace/tool-logic-qr';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { FileDrop } from '@workspace/ui/file-drop';
import { Label } from '@workspace/ui/label';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@workspace/ui/table';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement, RefObject } from 'react';

export type ReadState =
  | { state: 'empty' }
  | { state: 'reading'; preview?: boolean }
  | { state: 'done'; text: string; count: number; hex: string | null; preview: boolean }
  | { state: 'failed'; message: string; preview: boolean };

export interface ReadViewProps {
  hidden: boolean;
  read: ReadState;
  /** Reads ended so far. */
  serial: number;
  preview: RefObject<HTMLCanvasElement | null>;
  /** The preview's side in CSS pixels; the canvas has device pixels. */
  previewSide: number;
  kept: string | null;
  onFile: (file: File) => void;
  onCopied: () => void;
}

const LINK_NOTE = 'Links are shown as text and are never opened.';

export const ReadView = ({
  hidden,
  read,
  serial,
  preview,
  previewSide,
  kept,
  onFile,
  onCopied,
}: ReadViewProps): ReactElement => {
  const [show, setShow] = useState(false);
  const done = read.state === 'done' ? read : null;
  const wifi = done ? parseWifi(done.text) : null;
  const masked = done && wifi && wifi.password !== '' && !show;
  const shown = done ? (masked ? maskWifiPassword(done.text) : done.text) : '';
  const hasPreview = read.state !== 'empty' && read.preview === true;
  const scale = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));

  return (
    <div className="flex flex-col gap-3" hidden={hidden} data-read data-read-serial={serial}>
      <FileDrop
        label="Drop an image here, paste it, or choose a file."
        choose="Choose image"
        accept="image/*"
        onFiles={([file]) => file && onFile(file)}
      />
      <ToolPanes hidden={read.state === 'empty'}>
        <ToolPane label="Image">
          <canvas
            ref={preview}
            width={Math.round(previewSide * scale)}
            height={Math.round(previewSide * scale)}
            className="size-60 shrink-0"
            role="img"
            aria-label="Image preview"
            hidden={!hasPreview}
          />
          {read.state === 'reading' && (
            <p className="m-0 text-sm text-muted-foreground" role="status">
              Reading…
            </p>
          )}
        </ToolPane>
        <ToolPane
          label="Content"
          htmlFor="qr-content"
          actions={<CopyButton value={done?.text ?? ''} onCopied={onCopied} />}>
          <Textarea
            id="qr-content"
            className="h-32 resize-y font-mono text-code field-sizing-fixed"
            spellCheck={false}
            readOnly
            value={shown}
          />
          <div className="flex flex-col" role="status" data-read-info>
            {done && <ToolMessage role={undefined}>{foundLine(done.text)}</ToolMessage>}
            {done && done.count > 1 && (
              <ToolMessage
                role={
                  undefined
                }>{`This image holds ${done.count} QR codes; the first one found is shown.`}</ToolMessage>
            )}
            {done && isLink(done.text) && <ToolMessage role={undefined}>{LINK_NOTE}</ToolMessage>}
            {done?.hex && (
              <ToolMessage role={undefined}>
                Some bytes of this code are not text in its encoding: they are shown one character a byte (ISO-8859-1)
                above, and exactly as hex below.
              </ToolMessage>
            )}
          </div>
          {read.state === 'failed' && (
            <ToolMessage tone="error" data-read-error>
              {read.message}
            </ToolMessage>
          )}
          {done?.hex && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="qr-bytes">Bytes (hex)</Label>
                <CopyButton value={done.hex} label="Copy hex" />
              </div>
              <Textarea
                id="qr-bytes"
                className="h-20 resize-y font-mono text-code field-sizing-fixed"
                spellCheck={false}
                readOnly
                value={done.hex}
              />
            </div>
          )}
          {wifi && (
            <div className="flex flex-col gap-2" data-wifi-table>
              <Table aria-label="Wi-Fi details">
                <TableBody>
                  <TableRow>
                    <TableHead scope="row">Network</TableHead>
                    <TableCell className="font-mono">{wifi.ssid}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead scope="row">Security</TableHead>
                    <TableCell className="font-mono">{wifi.security}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead scope="row">Password</TableHead>
                    <TableCell className="font-mono">
                      <span className="mr-2" data-password>
                        {wifi.password === '' ? '' : show ? wifi.password : '••••••••'}
                      </span>
                      {wifi.password !== '' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-pressed={show}
                          onClick={() => setShow(s => !s)}>
                          {show ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                          {show ? 'Hide' : 'Show'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead scope="row">Hidden</TableHead>
                    <TableCell>{wifi.hidden ? 'yes' : 'no'}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {kept && (
                <p className="text-muted-foreground m-0 text-sm" data-kept>
                  {kept}
                </p>
              )}
            </div>
          )}
          {!wifi && kept && (
            <p className="text-muted-foreground m-0 text-sm" data-kept>
              {kept}
            </p>
          )}
        </ToolPane>
      </ToolPanes>
    </div>
  );
};
