/**
 * The Inspect card (docs/tools/specs/uuid.md §8): one line to paste a UUID or ULID into, then the error next to it or
 * the table of what it holds (`<dl>`, rows from the logic's `inspectRows`). It owns the clock (`useNow`) for the
 * relative time, so the tick re-renders this card only. The text is the parent's state: History restores it.
 */
import { inspectRows, parseId } from '@workspace/tool-logic-uuid';
import { useNow } from '@workspace/tools-host';
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/card';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ToolMessage } from '@workspace/ui/tool-page';
import { cn } from '@workspace/ui/utils';
import { useMemo } from 'react';
import type { ClipboardEvent, ReactElement } from 'react';

export interface InspectProps {
  value: string;
  onChange: (value: string) => void;
}

export const Inspect = ({ value, onChange }: InspectProps): ReactElement => {
  const now = useNow();
  const parsed = useMemo(() => parseId(value), [value]);
  const rows = useMemo(() => (parsed.ok ? inspectRows(parsed.value, { nowMs: now }) : []), [parsed, now]);

  // A one-line field drops the line breaks of pasted text, so two identifiers on two lines would read as one long
  // string; the pasted text is kept as it is and is told apart (§6: "Paste one UUID or ULID.").
  const paste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\r\n]/.test(text.trim())) return;
    e.preventDefault();
    onChange(text);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inspect</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="uuid-inspect">Paste a UUID or ULID</Label>
          <Input
            id="uuid-inspect"
            className="font-mono text-code"
            placeholder="017f22e2-79b0-7cc3-98c4-dc0c0c07398f"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            value={value.replace(/[\r\n]+/g, ' ')}
            onChange={e => onChange(e.target.value)}
            onPaste={paste}
            aria-invalid={!parsed.ok && parsed.message !== '' ? true : undefined}
            aria-describedby={!parsed.ok && parsed.message !== '' ? 'uuid-inspect-error' : undefined}
          />
          {/* Changes while typing: read out politely (status), as the JSON tool does. */}
          {!parsed.ok && parsed.message !== '' && (
            <ToolMessage id="uuid-inspect-error" tone="error" role="status">
              {parsed.message}
            </ToolMessage>
          )}
        </div>
        {rows.length > 0 && (
          <dl
            aria-label="Inspection"
            className="m-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
            {rows.map(row => (
              <div key={row.label} className="contents" data-row={row.label}>
                <dt className="text-sm whitespace-nowrap text-muted-foreground">{row.label}</dt>
                <dd className="m-0 flex min-w-0 flex-col gap-0.5">
                  <span
                    className={cn(
                      'break-all text-foreground select-text',
                      row.code ? 'font-mono text-code' : 'text-sm',
                    )}>
                    {row.value}
                  </span>
                  {row.lines?.map(line => (
                    <span key={line} className="text-sm text-foreground">
                      {line}
                    </span>
                  ))}
                  {row.note && <span className="text-sm text-muted-foreground">{row.note}</span>}
                </dd>
                {row.copy ? <CopyButton icon value={row.value} label={row.copy} /> : <span />}
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
};
