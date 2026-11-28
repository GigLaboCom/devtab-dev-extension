/**
 * The indent indicator at an editor (D39; research §6.3), as IDEs have it in their status bar: "Spaces: 4" / "Tab: 4"
 * and where it comes from — chosen for this file, detected from the content, the language's value, the default. A
 * press opens a small popup: spaces or tabs and the size for this file only (it lives while the file is open), back to
 * automatic, and a way to Settings → Editor.
 *
 * A real button with a popover (@workspace/ui/popover, Radix): the keyboard goes into the popup when it opens, Escape
 * or a press outside closes it, and the focus comes back to the button. A press into the editor's frame does not reach
 * this page, so the popup also closes when the page loses the focus to the frame.
 */
import { EDITOR_TEXT } from './text';
import { indentSource } from '@src/editorSettings/resolve';
import { Button } from '@workspace/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { useEffect, useId, useState } from 'react';
import type { Effective, FileChoice } from '@src/editorSettings/resolve';
import type { ReactElement } from 'react';

/** The sizes offered for a file; the current one joins them when it is another. */
const SIZES = [2, 4, 8];

export interface IndentIndicatorProps {
  effective: Effective;
  /** The person's choice for this file; null: automatic. */
  choice: FileChoice | null;
  /** The language's name, for "Go’s value". */
  languageLabel: string;
  onChoose(choice: FileChoice | null): void;
  /** For one side of a comparison: which ("original", "changed"). */
  side?: string;
  /** Opened from outside (a shortcut); the popup says when it closes. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** Settings → Editor's address. */
  settingsHref: string;
  /** The value alone in the button (a narrow bar); where it comes from stays in its tooltip and the popup. */
  compact?: boolean;
}

export const IndentIndicator = ({
  effective,
  choice,
  languageLabel,
  onChoose,
  side,
  open: wanted,
  onOpenChange,
  settingsHref,
  compact = false,
}: IndentIndicatorProps): ReactElement => {
  const [own, setOwn] = useState(false);
  const open = wanted ?? own;
  const setOpen = (next: boolean): void => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const id = useId();
  const { indentStyle, indentSize } = effective.values;
  const source = indentSource(effective);
  const summary = EDITOR_TEXT.indicator(indentStyle, indentSize);
  const from = EDITOR_TEXT.sourceWord(source, languageLabel);
  const sizes = SIZES.includes(indentSize) ? SIZES : [...SIZES, indentSize].sort((a, b) => a - b);

  // The editor's frame takes the focus without a press on this page: the popup closes then.
  useEffect(() => {
    if (!open) return;
    const blurred = (): void => setOpen(false);
    window.addEventListener('blur', blurred);
    return () => window.removeEventListener('blur', blurred);
    // `setOpen` is made anew each render; only being open matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="kit-indent-indicator"
          aria-label={EDITOR_TEXT.indicatorLabel(summary, from)}
          title={EDITOR_TEXT.sourceSentence(source, languageLabel)}
          data-indent={`${indentStyle}:${indentSize}`}
          data-source={source}>
          <span className="kit-indent-value">{summary}</span>
          {!compact && <span className="kit-indent-source">{from}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="kit-indent-popup" aria-labelledby={`${id}-title`}>
        <PopoverHeader>
          <PopoverTitle id={`${id}-title`}>
            {side ? EDITOR_TEXT.popupTitleSide(side) : EDITOR_TEXT.popupTitle}
          </PopoverTitle>
          <PopoverDescription>{EDITOR_TEXT.sourceSentence(source, languageLabel)}</PopoverDescription>
        </PopoverHeader>
        <div className="kit-indent-field">
          <span id={`${id}-style`} className="kit-indent-label">
            {EDITOR_TEXT.indentWith}
          </span>
          <ToggleGroup
            type="single"
            variant="segmented"
            size="sm"
            aria-labelledby={`${id}-style`}
            value={indentStyle}
            onValueChange={(value: string) => {
              if (value === 'space' || value === 'tab') onChoose({ ...choice, indentStyle: value });
            }}>
            <ToggleGroupItem value="space">{EDITOR_TEXT.spaces}</ToggleGroupItem>
            <ToggleGroupItem value="tab">{EDITOR_TEXT.tabs}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="kit-indent-field">
          <span id={`${id}-size`} className="kit-indent-label">
            {EDITOR_TEXT.sizeLabel}
          </span>
          <ToggleGroup
            type="single"
            variant="segmented"
            size="sm"
            aria-labelledby={`${id}-size`}
            value={String(indentSize)}
            onValueChange={(value: string) => {
              if (value) onChoose({ ...choice, indentSize: Number(value) });
            }}>
            {sizes.map(size => (
              <ToggleGroupItem key={size} value={String(size)}>
                {size}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="kit-indent-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={!choice}
            title={EDITOR_TEXT.automaticHint}
            onClick={() => onChoose(null)}>
            {EDITOR_TEXT.automatic}
          </Button>
          <Button variant="link" size="sm" asChild>
            <a href={settingsHref} onClick={() => setOpen(false)}>
              {EDITOR_TEXT.openSettings}
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
