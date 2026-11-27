/**
 * The shell's palette: a modal over the page that goes to any of our places — the sections, every tool, History and
 * Settings. It opens from the toolbar and by ⌘K / Ctrl+K (useFind.ts). What it lists is the `PaletteSource` seam
 * (src/shell/palette.ts): before anything is typed the places opened last, then the menu; a query finds places the way
 * the start page's field does — the same finder, the same rows (app/finder/). Text pasted into the empty field goes to
 * the `PasteRecogniser` (the tools' `detect`, whose chunk the palette asks for as it opens), and the tool that
 * recognises it opens with the text, as on the start page. There is no web search here: the palette goes to our places
 * only.
 *
 * A dialog with a combobox and a listbox (@workspace/ui/dialog, Radix): focus stays inside while it is open, the page
 * behind is inert — no focus, no pointer, hidden from assistive technology; «Compare code»'s editor, in a frame behind
 * it, refuses to focus itself meanwhile (viewer/focusGuard.ts) —, Escape or a click outside closes it. Where focus goes
 * after is the shell's (`onClosed`): back where it was, or into the page that was opened. Nothing typed here is stored.
 *
 * A query also finds the sections' commands that have a target now (D38, `PaletteContext.commands`): choosing one
 * closes the palette, focus goes back where it was, and then the command runs there — so a popup it opens, or a panel
 * it focuses, keeps the focus.
 */
import { FinderList } from '../finder/FinderList';
import { useFinder } from '../finder/useFinder';
import { keyLabel } from '@src/shared/keyLabels';
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/dialog';
import { SearchIcon, SquareChevronRightIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FinderGroup } from '@src/shared/finder';
import type { KeyChord } from '@src/shared/keys';
import type { PaletteContext, PaletteSource } from '@src/shell/palette';
import type { PasteRecogniser } from '@src/tools/recogniser';
import type { ReactElement } from 'react';

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: PaletteSource;
  context: PaletteContext;
  /** Which tool pasted text is for. */
  recogniser: PasteRecogniser;
  /** Goes to one of our places (a route hash). */
  go: (hash: string) => void;
  /** The palette has closed: `went` — to a place it opened, or back where the user was. */
  onClosed: (went: boolean) => void;
  /** The user's shortcut for an action (by the action's id: `open:<place>`, a command's id), shown on its row. */
  keyOf?: (id: string) => KeyChord | undefined;
  mac?: boolean;
  /** Runs a command row once the palette has closed. */
  onCommand?: (id: string) => void;
}

type Offer = Promise<readonly FinderGroup[]> & { status?: string; value?: readonly FinderGroup[] };

/** The source's rows for a query: at once when it already knows them (`settled`), otherwise when they arrive. */
const useOffer = (source: PaletteSource, query: string, context: PaletteContext): readonly FinderGroup[] => {
  const offer = useMemo(() => source.offer(query, context) as Offer, [source, query, context]);
  const [late, setLate] = useState<{ offer: Offer; groups: readonly FinderGroup[] }>();
  const ready = offer.status === 'fulfilled' ? offer.value : undefined;
  useEffect(() => {
    if (ready) return;
    let current = true;
    offer.then(groups => current && setLate({ offer, groups })).catch(() => current && setLate({ offer, groups: [] }));
    return () => {
      current = false;
    };
  }, [offer, ready]);
  return ready ?? (late?.offer === offer ? late.groups : []);
};

/** The content: mounted on each opening, so every opening starts empty. */
const PaletteBody = ({
  source,
  context,
  recogniser,
  leave,
  keyOf,
  mac = false,
  command,
}: Pick<PaletteProps, 'source' | 'context' | 'recogniser' | 'keyOf' | 'mac'> & {
  leave: (hash: string) => void;
  command: (id: string) => void;
}): ReactElement => {
  const id = useId();
  const listId = `${id}-results`;
  const hintId = `${id}-hint`;
  const [query, setQuery] = useState('');
  const groups = useOffer(source, query, context);
  const results = useMemo(() => groups.flatMap(g => g.results), [groups]);
  const finder = useFinder({ query, setQuery, results, recogniser, open: leave, command });
  // Opening the palette asks for the tools' `detect`, so a paste a moment later is recognised at once.
  useEffect(() => void recogniser.ready().catch(() => undefined), [recogniser]);
  const { current } = finder;
  const nothing = query.trim() !== '' && !results.length;
  return (
    <>
      <DialogTitle className="sr-only">Find a tool or section</DialogTitle>
      <div className="kit-palette-field">
        <SearchIcon aria-hidden="true" className="kit-palette-icon" />
        <input
          className="kit-palette-input"
          type="text"
          role="combobox"
          aria-label="Find a tool or section"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
          aria-describedby={hintId}
          placeholder="Find a tool or section, or paste text"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={finder.onChange}
          onKeyDown={finder.onKeyDown}
          onPaste={finder.onPaste}
          data-autofocus=""
        />
      </div>
      <FinderList
        id={listId}
        className="kit-command-results kit-palette-results"
        groups={groups}
        current={current}
        onHover={finder.setActive}
        onTake={finder.take}
        hidden={!results.length}
        keyOf={result => {
          const chord =
            result.kind === 'open'
              ? keyOf?.(`open:${result.destination.id}`)
              : result.kind === 'command'
                ? keyOf?.(result.id)
                : undefined;
          return chord && keyLabel(chord, mac);
        }}
        commandIcon={SquareChevronRightIcon}
      />
      {nothing && (
        <p className="kit-palette-empty" role="status">
          No section or tool matches <q>{query.trim()}</q>.
        </p>
      )}
      <p id={hintId} className="kit-palette-hint">
        <kbd className="cn-kbd">↑</kbd> <kbd className="cn-kbd">↓</kbd> to move, <kbd className="cn-kbd">Enter</kbd> to
        open, <kbd className="cn-kbd">Esc</kbd> to close. Paste text to open the tool that reads it.
      </p>
    </>
  );
};

export const Palette = ({
  open,
  onOpenChange,
  source,
  context,
  recogniser,
  go,
  onClosed,
  keyOf,
  mac,
  onCommand,
}: PaletteProps): ReactElement => {
  const went = useRef(false);
  const chosen = useRef<string | null>(null);
  const leave = (hash: string): void => {
    went.current = true;
    onOpenChange(false);
    go(hash);
  };
  const command = (id: string): void => {
    chosen.current = id;
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next) {
          went.current = false;
          chosen.current = null;
        }
        onOpenChange(next);
      }}>
      <DialogContent
        className="kit-palette"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={e => {
          // The field, not the first focusable element Radix would pick.
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('[data-autofocus]')?.focus();
        }}
        onCloseAutoFocus={e => {
          e.preventDefault();
          onClosed(went.current);
          went.current = false;
          const id = chosen.current;
          chosen.current = null;
          // After the dialog has gone and the page behind is no longer inert.
          if (id) setTimeout(() => onCommand?.(id), 0);
        }}>
        <PaletteBody
          source={source}
          context={context}
          recogniser={recogniser}
          leave={leave}
          command={command}
          keyOf={keyOf}
          mac={mac}
        />
      </DialogContent>
    </Dialog>
  );
};
