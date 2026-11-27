/**
 * The rows of the page's one finder — the start page's field and the shell's palette draw the same list: a listbox of
 * our places (icon, title, Tool or Section) and, on the start page, the web search; the row Enter takes is highlighted
 * and marked "Enter". Rows may come in labelled groups (the palette before anything is typed: Recent, then the menu);
 * an unlabelled group draws its rows straight in the listbox. The field keeps the focus: a click takes a row without
 * moving it, and the highlighted row is scrolled into view inside the list only, never the page.
 */
import { revealIn } from './reveal';
import { iconOf } from '@src/app/destinationIcons';
import { GlobeIcon } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { FieldResult, FinderGroup } from '@src/shared/finder';
import type { ComponentType, ReactElement } from 'react';

export interface FinderListProps {
  /** The listbox's id; each row's is `<id>-<index>`, the index counted across the groups. */
  id: string;
  groups: readonly FinderGroup[];
  /** The highlighted row (what Enter takes), or -1. */
  current: number;
  onHover: (index: number) => void;
  onTake: (result: FieldResult) => void;
  hidden?: boolean;
  className: string;
  /** The shortcut of a row's place, as shown (the palette: the user's shortcuts). */
  keyOf?: (result: FieldResult) => string | undefined;
  /** The icon of a command row (the palette's). */
  commandIcon?: ComponentType<{ 'aria-hidden'?: 'true'; className?: string }>;
}

const rowKey = (result: FieldResult): string =>
  result.kind === 'web' ? 'web' : result.kind === 'command' ? result.id : result.destination.id;

const ResultRow = ({
  result,
  commandIcon,
}: {
  result: FieldResult;
  commandIcon?: FinderListProps['commandIcon'];
}): ReactElement => {
  if (result.kind === 'web')
    return (
      <>
        <GlobeIcon aria-hidden="true" className="kit-command-result-icon" />
        <span className="kit-command-result-title">
          Search the web for <q>{result.text}</q>
        </span>
      </>
    );
  const command = result.kind === 'command';
  const Icon = (command ? commandIcon : undefined) ?? iconOf(command ? '' : result.destination.id);
  const title = command ? result.title : result.destination.title;
  const marked = new Set(result.match?.positions);
  const keyword = result.match?.keyword;
  return (
    <>
      <Icon aria-hidden="true" className="kit-command-result-icon" />
      <span className="kit-command-result-title">
        {marked.size ? (
          <>
            {/* The matched letters marked for the eye; a screen reader reads the title whole. */}
            <span aria-hidden="true">{[...title].map((c, i) => (marked.has(i) ? <mark key={i}>{c}</mark> : c))}</span>
            <span className="sr-only">{title}</span>
          </>
        ) : (
          title
        )}
      </span>
      <span className="kit-command-result-kind">
        {command ? 'Command' : result.destination.kind === 'tool' ? 'Tool' : 'Section'}
        {keyword && ` · matches “${keyword}”`}
      </span>
    </>
  );
};

export const FinderList = ({
  id,
  groups,
  current,
  onHover,
  onTake,
  hidden,
  className,
  keyOf,
  commandIcon,
}: FinderListProps): ReactElement => {
  const list = useRef<HTMLUListElement>(null);

  // Inside the list only: scrollIntoView would also scroll the page under the start page's field.
  useLayoutEffect(() => {
    const box = list.current;
    const row = current >= 0 ? box?.querySelector<HTMLElement>(`[id="${id}-${current}"]`) : null;
    if (box && row) revealIn(box, row);
  }, [current, id]);

  let index = 0;
  const option = (result: FieldResult, prefix: string): ReactElement => {
    const i = index++;
    const shortcut = keyOf?.(result);
    return (
      <li
        key={`${prefix}${rowKey(result)}`}
        id={`${id}-${i}`}
        role="option"
        tabIndex={-1}
        aria-selected={i === current}
        className="kit-command-result"
        onMouseDown={e => e.preventDefault()}
        onMouseMove={() => i !== current && onHover(i)}
        onClick={() => onTake(result)}
        onKeyDown={() => undefined}>
        <ResultRow result={result} commandIcon={commandIcon} />
        {shortcut && <kbd className="cn-kbd">{shortcut}</kbd>}
        {i === current && (
          <kbd className="cn-kbd kit-command-result-enter" aria-hidden="true">
            Enter
          </kbd>
        )}
      </li>
    );
  };

  return (
    <ul ref={list} id={id} role="listbox" aria-label="Results" className={className} hidden={hidden}>
      {groups.map(group =>
        group.label === undefined ? (
          group.results.map(result => option(result, ''))
        ) : (
          <li key={group.id} role="presentation" className="kit-command-group">
            <div id={`${id}-group-${group.id}`} role="presentation" className="kit-command-group-label">
              {group.label}
            </div>
            <ul role="group" aria-labelledby={`${id}-group-${group.id}`} className="kit-command-group-rows">
              {group.results.map(result => option(result, `${group.id}:`))}
            </ul>
          </li>
        ),
      )}
    </ul>
  );
};
