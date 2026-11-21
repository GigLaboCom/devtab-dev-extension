/**
 * The start page's one field. It serves our own places first: typing finds sections and tools by title and keywords
 * (src/start/finder.ts); text pasted into the empty field goes to the tools' `detect`, and the tool that recognises it
 * opens with it. When web search is on, the last row searches the web through the WebSearch seam. The highlighted row
 * — always marked "Enter" — is what Enter takes; arrows move it. Nothing is fetched while typing, and the text is never
 * stored: it lives in this component's state.
 *
 * Focus (seen in the probe, docs/decisions.md D16): on a new tab Chrome gives the keys to the address bar, and a page
 * cannot take them. The field is focused anyway — one Tab, or a click into the page, lands the keys in it — but looks
 * focused only while the page really has focus, and says "Press Tab" until then.
 */
import { go } from '../route';
import { createDebug } from '@extension/logger';
import { iconOf } from '@src/app/destinationIcons';
import { handOff } from '@src/app/handoff';
import { detectTool, fieldResults } from '@src/start/finder';
import { GlobeIcon, SearchIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Destination } from '@src/shared/destinations';
import type { FieldResult } from '@src/start/finder';
import type { WebSearch } from '@src/start/webSearch';
import type { ToolDefinition } from '@src/tools/registry';
import type { ClipboardEvent, KeyboardEvent, ReactElement } from 'react';

const debug = createDebug('extension:start:field');

export interface CommandFieldProps {
  destinations: readonly Destination[];
  tools: readonly ToolDefinition[];
  /** Absent when web search is switched off: Enter then only opens our places. */
  webSearch?: WebSearch;
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

const ResultRow = ({ result }: { result: FieldResult }): ReactElement => {
  if (result.kind === 'web')
    return (
      <>
        <GlobeIcon aria-hidden="true" className="kit-command-result-icon" />
        <span className="kit-command-result-title">
          Search the web for <q>{result.text}</q>
        </span>
      </>
    );
  const Icon = iconOf(result.destination.id);
  return (
    <>
      <Icon aria-hidden="true" className="kit-command-result-icon" />
      <span className="kit-command-result-title">{result.destination.title}</span>
      <span className="kit-command-result-kind">{result.destination.kind === 'tool' ? 'Tool' : 'Section'}</span>
    </>
  );
};

export const CommandField = ({ destinations, tools, webSearch }: CommandFieldProps): ReactElement => {
  const id = useId();
  const listId = `${id}-results`;
  const hintId = `${id}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const pageFocused = usePageFocus();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(
    () => fieldResults(query, { destinations, webSearch: webSearch !== undefined }),
    [query, destinations, webSearch],
  );
  const current = results.length ? Math.min(active, results.length - 1) : -1;
  const open = results.length > 0;
  const nothing = query.trim() !== '' && !open;

  useEffect(() => input.current?.focus(), []);

  const take = (result: FieldResult): void => {
    if (result.kind === 'open') {
      go(result.destination.hash);
      return;
    }
    webSearch?.search(result.text).catch(e => debug.warn('web search', e));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current >= 0) take(results[current]);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
      setActive(0);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const field = e.currentTarget;
    const replacesAll = field.value === '' || (field.selectionStart === 0 && field.selectionEnd === field.value.length);
    if (!replacesAll) return;
    const text = e.clipboardData.getData('text/plain');
    const tool = detectTool(text, tools);
    if (!tool) return;
    e.preventDefault();
    handOff(tool.id, text);
    go(`#/tools/${tool.id}`);
  };

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
        onChange={e => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <ul id={listId} role="listbox" aria-label="Results" className="kit-command-results" hidden={!open}>
        {results.map((result, i) => (
          <li
            key={result.kind === 'web' ? 'web' : result.destination.id}
            id={`${listId}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === current}
            className="kit-command-result"
            onMouseDown={e => e.preventDefault()}
            onMouseMove={() => i !== current && setActive(i)}
            onClick={() => take(result)}
            onKeyDown={() => undefined}>
            <ResultRow result={result} />
            {i === current && (
              <kbd className="cn-kbd kit-command-result-enter" aria-hidden="true">
                Enter
              </kbd>
            )}
          </li>
        ))}
      </ul>
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
