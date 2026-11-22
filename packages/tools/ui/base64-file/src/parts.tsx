/**
 * Small presentational parts of the Base64 File tool (docs/tools/specs/base64-file.md §8): the facts as a list of
 * «label: value», the line of a long job with its Cancel, and saving a Blob as a file. Saving is a temporary
 * `<a download>` on an object URL clicked in the press and revoked right after (§5.5): a download, not a page or an
 * image — the Blob is `application/octet-stream`, so even an address that went astray would download, never render.
 */
import { Button } from '@workspace/ui/button';
import type { ReactElement } from 'react';

export const Facts = ({ rows, label }: { rows: ReadonlyArray<[string, string]>; label: string }): ReactElement => (
  <dl className="m-0 flex flex-col gap-1 text-sm" aria-label={label} data-facts>
    {rows.map(([name, value]) => (
      <div key={name} className="flex gap-3">
        <dt className="w-28 shrink-0 text-muted-foreground">{name}</dt>
        <dd className="m-0 min-w-0 break-all font-mono text-code" data-fact={name}>
          {value}
        </dd>
      </div>
    ))}
  </dl>
);

export const Working = ({
  verb,
  progress,
  onCancel,
}: {
  verb: string;
  progress: { done: number; total: number } | null;
  onCancel: () => void;
}): ReactElement => (
  <div className="flex items-center gap-3" data-part="working">
    <p className="m-0 text-sm text-muted-foreground" role="status">
      {progress && progress.total > 0 ? `${verb}… ${Math.floor((progress.done / progress.total) * 100)}%` : `${verb}…`}
    </p>
    <Button variant="outline" size="sm" onClick={onCancel}>
      Cancel
    </Button>
  </div>
);

/** Saves a Blob as a file named `name`: one short-lived object URL, revoked after the click (§5.5). */
export const saveBlob = (blob: Blob, name: string): void => {
  const typed =
    blob.type === 'application/octet-stream' ? blob : new Blob([blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(typed);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
