/**
 * The small popup that picks a language (D38), as IDEs pick the language of a new scratch file: it appears at once,
 * the filter field has the keyboard — type to narrow, ↑ / ↓ to move, Enter to choose, Escape to close — and the
 * language offered first (the one used last) is chosen until the person moves. The list is the editor's, the one list
 * of «Compare code» (src/compare/languages.ts): a new language of the editor appears here by itself. The same popup
 * changes the language of the open scratch.
 *
 * A dialog with a combobox and a listbox (@workspace/ui/dialog, Radix): focus stays inside while it is open, the page
 * behind is inert, Escape or a press outside closes it, and focus goes back where it was — unless a choice opened
 * something that takes it (`onChosenClose`). A refusal of the choice (the scratch limit) is said inside, and the popup
 * stays open.
 */
import { TEXT } from './text';
import { LANGUAGES } from '@src/compare/languages';
import { fold } from '@src/shared/finder';
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/dialog';
import { SearchIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LanguageOption } from '@src/compare/languages';
import type { ReactElement } from 'react';

export interface LanguagePickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The popup's title: what the choice is for. */
  title: string;
  /** The language offered first and chosen at the start (the one used last); null: the list's order. */
  first: string | null;
  /** A language is chosen; the popup stays open until the caller closes it. */
  onChoose(language: string): void;
  /** Why the latest choice was refused, said inside the popup. */
  problem?: string | null;
  busy?: boolean;
  /** The popup closed after a choice that moved the keyboard elsewhere: focus is not given back. */
  onChosenClose?: boolean;
}

/** The languages for a filter: the first one first; a label's start before a word's start before an extension. */
export const languagesFor = (query: string, first: string | null): LanguageOption[] => {
  const ordered = first
    ? [...LANGUAGES.filter(l => l.id === first), ...LANGUAGES.filter(l => l.id !== first)]
    : [...LANGUAGES];
  const q = fold(query.trim()).replace(/^\./, '');
  if (!q) return ordered;
  const rank = (l: LanguageOption): number => {
    const label = fold(l.label);
    if (label.startsWith(q) || l.id.startsWith(q)) return 0;
    if (label.split(/[\s/]+/).some(word => word.startsWith(q))) return 1;
    if (l.extensions.some(e => e === q)) return 2;
    if (l.extensions.some(e => e.startsWith(q)) || label.includes(q)) return 3;
    return -1;
  };
  return ordered
    .map(l => ({ l, r: rank(l) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map(x => x.l);
};

const PickerBody = ({
  first,
  title,
  onChoose,
  problem,
  busy,
}: Pick<LanguagePickerProps, 'first' | 'title' | 'onChoose' | 'problem' | 'busy'>): ReactElement => {
  const id = useId();
  const listId = `${id}-languages`;
  const hintId = `${id}-hint`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const shown = useMemo(() => languagesFor(query, first), [query, first]);
  const current = shown.length ? Math.min(active, shown.length - 1) : -1;
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const row = current >= 0 ? list.current?.querySelector<HTMLElement>(`[id="${listId}-${current}"]`) : null;
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [current, listId]);
  // A new filter starts at its best match.
  useEffect(() => setActive(0), [query]);

  const choose = (language: LanguageOption | undefined): void => {
    if (language && !busy) onChoose(language.id);
  };

  return (
    <>
      <DialogTitle className="kit-projects-picker-title">{title}</DialogTitle>
      <div className="kit-palette-field">
        <SearchIcon aria-hidden="true" className="kit-palette-icon" />
        <input
          className="kit-palette-input"
          type="text"
          role="combobox"
          aria-label={TEXT.languageFilter}
          aria-autocomplete="list"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
          aria-describedby={hintId}
          placeholder={TEXT.languageFilterPlaceholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          data-autofocus=""
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              if (!shown.length) return;
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((current + step + shown.length) % shown.length);
            } else if (e.key === 'Home' || e.key === 'End') {
              if (!shown.length || query) return;
              e.preventDefault();
              setActive(e.key === 'Home' ? 0 : shown.length - 1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(shown[current]);
            }
          }}
        />
      </div>
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-label={TEXT.languages}
        className="kit-command-results kit-palette-results kit-projects-picker-list"
        hidden={!shown.length}>
        {shown.map((language, i) => (
          <li
            key={language.id}
            id={`${listId}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === current}
            className="kit-command-result"
            data-language={language.id}
            onMouseDown={e => e.preventDefault()}
            onMouseMove={() => i !== current && setActive(i)}
            onClick={() => choose(language)}
            onKeyDown={() => undefined}>
            <span className="kit-command-result-title">{language.label}</span>
            <span className="kit-command-result-kind">
              {language.id === first ? TEXT.languageLast : `.${language.extensions[0]}`}
            </span>
            {i === current && (
              <kbd className="cn-kbd kit-command-result-enter" aria-hidden="true">
                Enter
              </kbd>
            )}
          </li>
        ))}
      </ul>
      {!shown.length && (
        <p className="kit-palette-empty" role="status">
          {TEXT.noLanguage(query.trim())}
        </p>
      )}
      {problem && (
        <p className="kit-projects-note kit-projects-picker-problem" data-tone="error" role="alert">
          {problem}
        </p>
      )}
      <p id={hintId} className="kit-palette-hint">
        <kbd className="cn-kbd">↑</kbd> <kbd className="cn-kbd">↓</kbd> {TEXT.pickerMove},{' '}
        <kbd className="cn-kbd">Enter</kbd> {TEXT.pickerChoose}, <kbd className="cn-kbd">Esc</kbd> {TEXT.pickerClose}.
      </p>
    </>
  );
};

export const LanguagePicker = ({ open, onOpenChange, onChosenClose, ...body }: LanguagePickerProps): ReactElement => {
  // Where the keyboard was: a control of the page, or the editor's frame (whose own document takes the keys back only
  // when its window is focused, as the palette does it). Read as the popup opens, before the page behind turns inert
  // and drops the focus.
  const before = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    const active = document.activeElement;
    before.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpen.current = open;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="kit-palette kit-projects-picker"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={e => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('[data-autofocus]')?.focus();
        }}
        onCloseAutoFocus={e => {
          e.preventDefault();
          const back = before.current;
          before.current = null;
          if (onChosenClose || !back?.isConnected) return;
          back.focus({ preventScroll: true });
          if (back instanceof HTMLIFrameElement) back.contentWindow?.focus();
        }}>
        <PickerBody {...body} />
      </DialogContent>
    </Dialog>
  );
};
