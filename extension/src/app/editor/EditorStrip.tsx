/**
 * The strip of the editor's buttons over an editor (./strip.ts says what stands on it and what each control is now):
 * a project's file, a scratch, a file opened from the system and each side of «Compare code». A `role="toolbar"` of
 * real buttons with an icon, an `aria-label` and a tooltip each — the label and the key the editor binds, or, on a
 * greyed button that has one, the reason instead; toggles say their state with `aria-pressed`. A greyed button is
 * `aria-disabled`, not `disabled`, so it keeps its tooltip and its place in the Tab order and still says why. The other
 * toolbars of the page move by Tab, not by the arrow keys, and so does this one.
 *
 * What does not fit is left off from the end — the toggles first, then Find, back towards Save — and offered behind a
 * more button (⋯) at the strip's end, shown only then (and while its menu is open): the same controls in the same order,
 * a line between two stretches as on the strip, each greyed as its button would be with the reason under its label, the
 * key at its end, a check on a toggle that is on. A line pressed is its button pressed. The widths come from a copy of
 * the strip laid out out of sight, measured whenever the strip's own width changes. Tooltips open below the strip, over
 * the text, so they never cover the bar above it (a side's own actions in «Compare code»).
 */
import { gapBefore, standingOf, stretchOf, stripControls, fitCount, controlId } from './strip';
import { EDITOR_TEXT } from './text';
import { ariaKeys, keyLabel } from '@src/shared/keyLabels';
import { Button } from '@workspace/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@workspace/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@workspace/ui/tooltip';
import {
  ClipboardCopyIcon,
  ClipboardPasteIcon,
  CopyIcon,
  EllipsisIcon,
  ListIndentDecreaseIcon,
  ListIndentIncreaseIcon,
  PilcrowIcon,
  Redo2Icon,
  SaveIcon,
  ScissorsIcon,
  SearchIcon,
  TextSelectIcon,
  TextWrapIcon,
  Undo2Icon,
} from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { ControlStanding, StripCommand, StripControl, StripState, StripView } from './strip';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

const ICON: Record<string, LucideIcon> = {
  save: SaveIcon,
  undo: Undo2Icon,
  redo: Redo2Icon,
  cut: ScissorsIcon,
  copy: CopyIcon,
  copyAll: ClipboardCopyIcon,
  paste: ClipboardPasteIcon,
  selectAll: TextSelectIcon,
  indent: ListIndentIncreaseIcon,
  outdent: ListIndentDecreaseIcon,
  find: SearchIcon,
  softWrap: TextWrapIcon,
  whitespace: PilcrowIcon,
};

export interface EditorStripProps {
  /** The toolbar's accessible name. */
  label: string;
  state: StripState;
  onCommand(command: StripCommand): void;
  /** A toggle pressed: what it is to be now. */
  onView(view: StripView, on: boolean): void;
  /** The host's Save (only with `state.save`). */
  onSave?(): void;
  /** For one side of a comparison: which (`data-side`, as the side's own bar has it). */
  side?: 'old' | 'new';
}

const Tip = ({ standing, mac, children }: { standing: ControlStanding; mac: boolean; children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="bottom">
      {standing.why ?? standing.label}
      {!standing.why && standing.key && <kbd className="cn-kbd">{keyLabel(standing.key, mac)}</kbd>}
    </TooltipContent>
  </Tooltip>
);

export const EditorStrip = ({ label, state, onCommand, onView, onSave, side }: EditorStripProps): ReactElement => {
  const controls = stripControls(!!state.save);
  const standings = controls.map(control => standingOf(control, state));
  const root = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [kept, setKept] = useState(controls.length);
  const [menuOpen, setMenuOpen] = useState(false);

  const press = (control: StripControl, standing: ControlStanding): void => {
    if (!standing.enabled) return;
    if (control.kind === 'save') onSave?.();
    else if (control.kind === 'view') onView(control.view, !standing.on);
    else onCommand(control.command);
  };

  // How many controls fit: the copy out of sight gives each control's width and the gap before it.
  const count = controls.length;
  useLayoutEffect(() => {
    const strip = root.current;
    const copy = measure.current;
    if (!strip || !copy) return;
    const fit = (): void => {
      const widths: number[] = [];
      const gaps: number[] = new Array<number>(count).fill(0);
      let more = 0;
      for (const el of copy.children as HTMLCollectionOf<HTMLElement>) {
        const index = Number(el.dataset.index);
        if (el.dataset.measure === 'control') widths[index] = el.offsetWidth;
        else if (el.dataset.measure === 'gap') gaps[index] = el.offsetWidth;
        else if (el.dataset.measure === 'more') more = el.offsetWidth;
      }
      const style = getComputedStyle(strip);
      const inner = strip.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
      const gap = parseFloat(style.columnGap || '0') || 0;
      // Each control and gap is one flex item: the strip's gap goes between them.
      const spaced = widths.map((width, i) => width + gap + (gaps[i] ? gaps[i]! + gap : 0));
      setKept(fitCount(spaced, [], inner + gap, more + gap));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [count]);

  const shown = controls.slice(0, kept);
  const hidden = controls.slice(kept);
  const withMore = hidden.length > 0 || menuOpen;
  const gapClass = (gap: 'line' | 'spacer'): string => `kit-editor-strip-${gap}`;

  return (
    <TooltipProvider>
      <div
        ref={root}
        className="kit-editor-strip"
        role="toolbar"
        aria-label={label}
        data-side={side}
        data-kept={kept}
        data-hidden={hidden.length || undefined}>
        {shown.map((control, index) => {
          const standing = standings[index]!;
          const gap = gapBefore(controls, index);
          const Icon = ICON[standing.id]!;
          return (
            <Fragment key={standing.id}>
              {gap && <span className={gapClass(gap)} aria-hidden="true" />}
              <Tip standing={standing} mac={state.mac}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="kit-editor-strip-button"
                  data-control={standing.id}
                  aria-label={standing.label}
                  aria-disabled={standing.enabled ? undefined : true}
                  aria-pressed={standing.on === null ? undefined : standing.on}
                  {...(standing.key && !standing.why && { 'aria-keyshortcuts': ariaKeys(standing.key, state.mac) })}
                  onClick={() => press(control, standing)}>
                  <Icon aria-hidden="true" />
                </Button>
              </Tip>
            </Fragment>
          );
        })}
        {withMore && (
          <MoreMenu
            controls={hidden}
            standings={standings.slice(kept)}
            mac={state.mac}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onPress={press}
          />
        )}
        {/* Out of sight: the whole strip at its natural widths, for measuring — spans, nothing to focus. */}
        <div ref={measure} className="kit-editor-strip-measure" aria-hidden="true">
          {controls.map((control, index) => {
            const gap = gapBefore(controls, index);
            return (
              <Fragment key={controlId(control)}>
                {gap && <span data-measure="gap" data-index={index} className={gapClass(gap)} />}
                <span data-measure="control" data-index={index} className="cn-button cn-button-size-icon-sm" />
              </Fragment>
            );
          })}
          <span data-measure="more" className="cn-button cn-button-size-icon-sm" />
        </div>
      </div>
    </TooltipProvider>
  );
};

const MoreMenu = ({
  controls,
  standings,
  mac,
  open,
  onOpenChange,
  onPress,
}: {
  controls: readonly StripControl[];
  standings: readonly ControlStanding[];
  mac: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPress(control: StripControl, standing: ControlStanding): void;
}): ReactElement => (
  <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="kit-editor-strip-button kit-editor-strip-more"
            data-control="more"
            aria-label={EDITOR_TEXT.stripMore}>
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">{EDITOR_TEXT.stripMore}</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" className="kit-editor-strip-menu">
      {controls.map((control, index) => {
        const standing = standings[index]!;
        const Icon = ICON[standing.id]!;
        const line = index > 0 && stretchOf(control) !== stretchOf(controls[index - 1]!);
        const body = (
          <>
            <Icon aria-hidden="true" />
            <span className="kit-editor-strip-menu-text">
              <span>{standing.label}</span>
              {standing.why && <span className="kit-editor-strip-menu-why">{standing.why}</span>}
            </span>
            {standing.key && !standing.why && (
              <DropdownMenuShortcut>{keyLabel(standing.key, mac)}</DropdownMenuShortcut>
            )}
          </>
        );
        return (
          <Fragment key={standing.id}>
            {line && <DropdownMenuSeparator />}
            {control.kind === 'view' ? (
              <DropdownMenuCheckboxItem
                data-control={standing.id}
                checked={!!standing.on}
                disabled={!standing.enabled}
                onCheckedChange={() => onPress(control, standing)}>
                {body}
              </DropdownMenuCheckboxItem>
            ) : (
              <DropdownMenuItem
                data-control={standing.id}
                disabled={!standing.enabled}
                onSelect={() => onPress(control, standing)}>
                {body}
              </DropdownMenuItem>
            )}
          </Fragment>
        );
      })}
    </DropdownMenuContent>
  </DropdownMenu>
);
