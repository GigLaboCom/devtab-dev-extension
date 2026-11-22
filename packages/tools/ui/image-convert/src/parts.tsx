/**
 * The rows the page lists (docs/tools/specs/image-convert.md §8): a source with its facts, notes or error; a result
 * with its preview, facts, notes and Save; a numeric field with its label. Presentational: state is the caller's.
 * A preview is `<img>` on an object URL of the result's Blob — made when the row appears, revoked when it goes.
 */
import { formatBytes, ratioText, sizeText } from '@workspace/tool-logic-image-convert';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ToolMessage } from '@workspace/ui/tool-page';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Source } from './sources';
import type { ReactElement } from 'react';

/** `<img>` on the Blob's own object URL, revoked when the row goes away or the Blob changes. */
export const Thumb = ({ blob, alt }: { blob: Blob; alt: string }): ReactElement | null => {
  const [url, setUrl] = useState<{ of: Blob; url: string } | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(blob);
    setUrl({ of: blob, url: made });
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  if (!url || url.of !== blob) return null;
  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      <img src={url.url} alt={alt} className="max-h-24 max-w-24 object-contain" />
    </div>
  );
};

const Notes = ({ notes, error }: { notes: readonly string[]; error?: string | null }): ReactElement => (
  <div className="flex flex-col" role="status" data-part="notes">
    {error && (
      <ToolMessage tone="error" role={undefined} data-part="error">
        {error}
      </ToolMessage>
    )}
    {notes.map(note => (
      <ToolMessage key={note} role={undefined}>
        {note}
      </ToolMessage>
    ))}
  </div>
);

export const sourceFacts = (source: Source): string =>
  [source.type?.name, source.size ? sizeText(source.size) : null, formatBytes(source.bytes)]
    .filter(Boolean)
    .join(' · ');

export const SourceLine = ({ source, onRemove }: { source: Source; onRemove?: () => void }): ReactElement => (
  <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0" data-source={source.name}>
    <div className="flex items-start gap-2">
      <div className="min-w-0 grow">
        <p className="m-0 break-all text-sm">{source.name}</p>
        <p className="m-0 font-mono text-code text-muted-foreground" data-part="facts">
          {sourceFacts(source)}
        </p>
      </div>
      {onRemove && (
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${source.name}`} onClick={onRemove}>
          <X aria-hidden />
        </Button>
      )}
    </div>
    <Notes notes={source.notes} error={source.error} />
  </li>
);

export interface ResultLineProps {
  name: string;
  blob: Blob | null;
  /** What the facts say after the name: the format and size, or the sizes inside an .ico. */
  facts: string;
  sourceBytes?: number;
  notes: readonly string[];
  error?: string | null;
  preview?: boolean;
  onSave?: () => void;
}

export const ResultLine = ({
  name,
  blob,
  facts,
  sourceBytes,
  notes,
  error,
  preview = true,
  onSave,
}: ResultLineProps): ReactElement => (
  <li className="flex gap-3 border-b border-border py-2 last:border-b-0" data-result={name}>
    {blob && preview && <Thumb blob={blob} alt={`Preview of ${name}`} />}
    <div className="flex min-w-0 grow flex-col gap-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 grow">
          <p className="m-0 break-all text-sm">{name}</p>
          {blob && (
            <p className="m-0 font-mono text-code text-muted-foreground" data-part="facts">
              {[facts, formatBytes(blob.size), sourceBytes ? ratioText(blob.size, sourceBytes) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
        {blob && onSave && (
          <Button variant="outline" size="sm" onClick={onSave} aria-label={`Save ${name}`}>
            Save
          </Button>
        )}
      </div>
      <Notes notes={notes} error={error} />
    </div>
  </li>
);

export interface NumberFieldProps {
  id: string;
  label: string;
  unit?: string;
  value: string;
  min: number;
  max: number;
  invalid: boolean;
  disabled?: boolean;
  onChange: (text: string) => void;
}

export const NumberField = ({
  id,
  label,
  unit,
  value,
  min,
  max,
  invalid,
  disabled = false,
  onChange,
}: NumberFieldProps): ReactElement => (
  <div className="flex items-center gap-2">
    <Label htmlFor={id} className="text-muted-foreground">
      {label}
    </Label>
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      className="w-24"
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
    {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
  </div>
);
