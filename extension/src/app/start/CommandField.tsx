/**
 * The start page's one field. It serves our own places first: typing finds sections and tools by title and keywords
 * (src/shared/finder.ts, with the page's `PlaceMatcher` — strict until the fuzzy one has arrived or when fuzzy matching
 * is off; the shell's palette takes the same finder and the same list, app/finder/); text pasted into the empty field
 * goes to the page's `PasteRecogniser` (the tools' `detect`, loaded after the first paint), and the tool that recognises
 * it opens with it. When web search is on, the last row searches the web through the WebSearch seam. The highlighted row
 * — always marked "Enter" — is what Enter takes; arrows move it. Nothing is fetched while typing, and the text is never
 * stored: it lives in this component's state.
 *
 * Focus (seen in the probe, docs/decisions.md D16): on a new tab Chrome gives the keys to the address bar, and a page
 * cannot take them. The field is focused anyway — one Tab, or a click into the page, lands the keys in it — but looks
 * focused only while the page really has focus, and says "Press Tab" until then. The shortcut that opens the shell's
 * palette elsewhere (`find`, ⌘K / Ctrl+K by default) focuses this field here (`findRef`; the start page's listener,
 * src/shortcuts/startKeys.ts): the start page has one search, not two.
 */
import { go } from '../route';
import { FinderList } from '@src/app/finder/FinderList';
import { useFinder } from '@src/app/finder/useFinder';
import { fieldResults } from '@src/shared/finder';
import { SearchIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Destination } from '@src/shared/destinations';
import type { PlaceMatcher } from '@src/shared/finder';
import type { WebSearch } from '@src/start/webSearch';
import type { PasteRecogniser } from '@src/tools/recogniser';
import type { MutableRefObject, ReactElement } from 'react';

export interface CommandFieldProps {
  destinations: readonly Destination[];
  /** Absent when web search is switched off: Enter then only opens our places. */
  webSearch?: WebSearch;
  /** How a query matches our places; absent: strictly. */
  matcher?: PlaceMatcher;
  /** Which tool pasted text is for; absent: pasted text is text. */
  recogniser?: PasteRecogniser;
  /** Route hashes of the places opened last: they come first among equal matches. */
  recent?: readonly string[];
  /** Set to what puts the keys in the field (the `find` shortcut on the start page). */
  findRef?: MutableRefObject<(() => void) | null>;
}

const usePageFocus = (): boolean => {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = (): void => setFocused(true);
    const off = (): void => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
};

export const CommandField = ({
  destinations,
  webSearch,
  matcher,
  recogniser,
  recent,
  findRef,
}: CommandFieldProps): ReactElement => {
  const id = useId();
  const listId = `${id}-results`;
  const hintId = `${id}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const pageFocused = usePageFocus();
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => fieldResults(query, { destinations, webSearch: webSearch !== undefined, recent, matcher }),
    [query, destinations, webSearch, recent, matcher],
  );
  const finder = useFinder({ query, setQuery, results, recogniser, open: go, webSearch, escapeClears: true });
  const { current } = finder;
  const open = results.length > 0;
  const nothing = query.trim() !== '' && !open;

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    if (!findRef) return;
    findRef.current = () => {
      input.current?.focus();
      input.current?.select();
    };
    return () => {
      findRef.current = null;
    };
  }, [findRef]);

  return (
    <div className="kit-command" data-page-focus={pageFocused}>
      <SearchIcon aria-hidden="true" className="kit-command-icon" />
      <input
        ref={input}
        className="cn-input kit-command-input"
        type="text"
        role="combobox"
        aria-label="Find a tool or search the web"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
        aria-describedby={hintId}
        placeholder={webSearch ? 'Find a tool, paste text, or search the web' : 'Find a tool, or paste text'}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={finder.onChange}
        onKeyDown={finder.onKeyDown}
        onPaste={finder.onPaste}
      />
      <FinderList
        id={listId}
        className="kit-command-results"
        groups={[{ id: 'results', results }]}
        current={current}
        onHover={finder.setActive}
        onTake={finder.take}
        hidden={!open}
      />
      <p id={hintId} className="kit-command-hint">
        {nothing ? (
          <>Nothing here matches. Web search is off in Settings.</>
        ) : !pageFocused ? (
          <>
            Press <kbd className="cn-kbd">Tab</kbd> or click here to type.
          </>
        ) : (
          <>&nbsp;</>
        )}
      </p>
    </div>
  );
};
