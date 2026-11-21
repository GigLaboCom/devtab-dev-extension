/**
 * The behaviour of the page's one finder (shared/finder.ts) around a text field — the start page's field and the
 * shell's palette both take it: the row Enter takes (always the highlighted one; arrows move it), Enter, and text
 * pasted into the empty field going to the `PasteRecogniser` (the tool that recognises it opens with the text, handed
 * over through memory: app/handoff.ts). When the recogniser's code has not arrived yet, the paste is held until it has:
 * then the tool opens, or the text goes into the field as the paste would have put it. The caller holds the query and
 * works out the rows; nothing here is stored.
 */
import { handOff } from '../handoff';
import { createDebug } from '@extension/logger';
import { PENDING } from '@src/tools/recogniser';
import { useState } from 'react';
import type { FieldResult } from '@src/shared/finder';
import type { WebSearch } from '@src/start/webSearch';
import type { PasteRecogniser } from '@src/tools/recogniser';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react';

const debug = createDebug('extension:finder');

export interface FinderOptions {
  query: string;
  setQuery: (query: string) => void;
  /** The rows, in the order shown. */
  results: readonly FieldResult[];
  /** Which tool pasted text is for; absent: pasted text is text. */
  recogniser?: PasteRecogniser;
  /** Opens one of our places (a route hash). */
  open: (hash: string) => void;
  /** Takes a web-search row; absent where there is none. */
  webSearch?: WebSearch;
  /** Escape empties a field with text in it (the start page); otherwise Escape is the page's (a dialog closes). */
  escapeClears?: boolean;
}

export interface Finder {
  /** The row Enter takes, or -1 when there is none. */
  current: number;
  setActive: (index: number) => void;
  take: (result: FieldResult) => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
}

export const useFinder = ({
  query,
  setQuery,
  results,
  recogniser,
  open,
  webSearch,
  escapeClears = false,
}: FinderOptions): Finder => {
  const [active, setActive] = useState(0);
  const current = results.length ? Math.min(active, results.length - 1) : -1;

  const take = (result: FieldResult): void => {
    if (result.kind === 'open') {
      open(result.destination.hash);
      return;
    }
    webSearch?.search(result.text).catch(e => debug.warn('web search', e));
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (current >= 0) take(results[current]);
    } else if (event.key === 'Escape' && escapeClears && query) {
      event.preventDefault();
      setQuery('');
      setActive(0);
    }
  };

  const openTool = (id: string, text: string): void => {
    handOff(id, text);
    open(`#/tools/${id}`);
  };

  /** What the held paste would have done: the text in the field, where the selection was (undoable where Chrome can). */
  const insert = (field: HTMLInputElement, text: string): void => {
    field.focus();
    if (!document.execCommand?.('insertText', false, text)) setQuery(text);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    if (!recogniser) return;
    const field = event.currentTarget;
    const replacesAll = field.value === '' || (field.selectionStart === 0 && field.selectionEnd === field.value.length);
    if (!replacesAll) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    const id = recogniser.recognise(text);
    if (id === PENDING) {
      event.preventDefault();
      recogniser
        .ready()
        .then(() => {
          const later = recogniser.recognise(text);
          if (later && later !== PENDING) openTool(later, text);
          else insert(field, text);
        })
        .catch(e => {
          debug.warn('recognise the pasted text', e);
          insert(field, text);
        });
      return;
    }
    if (!id) return;
    event.preventDefault();
    openTool(id, text);
  };

  return { current, setActive, take, onChange, onKeyDown, onPaste };
};
