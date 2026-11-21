/**
 * Adding or editing one tile of a row the user fills by hand (a part with a TileEditor: My shortcuts), in place under the row: a title and an address; when editing, also
 * moving it left or right and removing it. The address must be a website (http or https; a bare host gets https://).
 */
import { normalizeUrl } from '@src/start/settings';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Shortcut } from '@src/start/settings';
import type { FormEvent, KeyboardEvent, ReactElement } from 'react';

export interface ShortcutFormProps {
  /** The form's name when adding ("Add shortcut"). */
  addLabel?: string;
  /** The shortcut being edited; absent when adding. */
  shortcut?: Shortcut;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onSave: (fields: { title: string; url: string }) => void;
  onCancel: () => void;
  onRemove?: () => void;
  onMove?: (step: -1 | 1) => void;
}

export const ShortcutForm = ({
  addLabel = 'Add shortcut',
  shortcut,
  canMoveLeft,
  canMoveRight,
  onSave,
  onCancel,
  onRemove,
  onMove,
}: ShortcutFormProps): ReactElement => {
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(shortcut?.title ?? '');
  const [address, setAddress] = useState(shortcut?.url ?? '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => first.current?.focus(), []);

  const cancelOnEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onCancel();
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const url = normalizeUrl(address);
    if (!url) {
      setInvalid(true);
      return;
    }
    onSave({ title: title.trim() || new URL(url).hostname.replace(/^www\./, ''), url });
  };

  return (
    <form className="kit-tile-form" aria-label={shortcut ? `Edit ${shortcut.title}` : addLabel} onSubmit={submit}>
      <div className="kit-tile-form-fields">
        <div className="kit-tile-form-field">
          <Label htmlFor={`${id}-title`}>Title</Label>
          <Input
            ref={first}
            id={`${id}-title`}
            value={title}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={cancelOnEscape}
            onChange={e => setTitle(e.target.value)}
          />
        </div>
        <div className="kit-tile-form-field">
          <Label htmlFor={`${id}-url`}>Address</Label>
          <Input
            id={`${id}-url`}
            value={address}
            placeholder="example.com"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onKeyDown={cancelOnEscape}
            onChange={e => {
              setAddress(e.target.value);
              setInvalid(false);
            }}
          />
        </div>
      </div>
      {invalid && (
        <p id={`${id}-error`} className="kit-tile-form-error">
          Enter a website address, such as example.com or example.com/page.
        </p>
      )}
      <div className="kit-tile-form-actions">
        <Button type="submit">{shortcut ? 'Save' : 'Add'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {shortcut && onMove && (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Move left"
              disabled={!canMoveLeft}
              onClick={() => onMove(-1)}>
              <ArrowLeftIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Move right"
              disabled={!canMoveRight}
              onClick={() => onMove(1)}>
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </>
        )}
        {shortcut && onRemove && (
          <Button type="button" variant="destructive" className="kit-tile-form-remove" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
    </form>
  );
};
