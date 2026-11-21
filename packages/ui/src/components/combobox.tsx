/**
 * A field with a list to search (docs/tools/specs/unix-time.md §8 «combobox»), the WAI-ARIA APG «Combobox» with a
 * listbox: an `<input role="combobox">` with `aria-expanded`, `aria-controls` and `aria-activedescendant`, and a
 * `role="listbox"` of `role="option"`. It looks like the kit's Select: the field is `cn-input`, the list
 * `cn-select-content`, a row `cn-select-item`, at most 320 px, under the field (`kit-combobox*` in
 * @workspace/dna/style-gpui-tools.css, so a page without tools does not carry it). No library: Radix Select cannot
 * search and `<datalist>` does not take the theme.
 *
 * Built by the Unix Time tool for its time zone picker and moved into the kit unchanged when Cron needed the same
 * picker (2026-11-21). It knows nothing of zones: a tool gives it the rows (for zones: `zoneOptions` of
 * @workspace/tools-shared/time).
 *
 * - The rows are built when the list opens (`items()`), so a list that depends on the time stays as it was while open.
 * - Opened, the list is whole, the chosen row highlighted and scrolled into view, the text selected so typing replaces
 *   it; the filter starts with the first character typed: every word of the query is a substring of the row's label,
 *   hint and keywords (lower case, `_` and `/` read as spaces), in the list's order.
 * - `pinned` rows come first with their `badge` and are not repeated below.
 * - ↓ / ↑ open the list and move the highlight, Enter chooses, Escape closes and puts the chosen name back, as does
 *   leaving the field without choosing; Home / End stay the field's.
 */
import { cn } from '../lib/utils';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

export interface ComboboxItem {
  value: string;
  label: string;
  hint?: string;
  keywords?: string;
  /** A word after the label of a pinned row: "Your time zone". */
  badge?: string;
}

export interface ComboboxRows {
  pinned: ComboboxItem[];
  rest: ComboboxItem[];
}

export interface ComboboxProps {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  /** The rows, asked for when the list opens. */
  items: () => ComboboxRows;
  /** The list's accessible name. */
  listLabel: string;
  /** Said when nothing matches. */
  empty: string;
  className?: string;
  'aria-describedby'?: string;
}

const normal = (text: string): string => text.toLowerCase().replace(/[_/]/g, ' ');

/**
 * Rows whose label, hint and keywords hold every word of the query. Their order: a row whose label is the query, then
 * rows whose label holds every word, then rows matched only through the hint, keywords or badge — and inside each
 * group the list's own order, pinned ones first. Without the groups a query that every row's hint happens to hold
 * ("utc", when every time zone's hint is "UTC±…") left the row named "UTC" behind the pinned one.
 */
export const filterRows = (rows: ComboboxRows, query: string): ComboboxItem[] => {
  const pinnedValues = new Set(rows.pinned.map(item => item.value));
  const all = [...rows.pinned, ...rows.rest.filter(item => !pinnedValues.has(item.value))];
  const whole = normal(query).trim().replace(/\s+/g, ' ');
  const words = whole.split(' ').filter(Boolean);
  if (words.length === 0) return all;
  const groups: ComboboxItem[][] = [[], [], []];
  for (const item of all) {
    const label = normal(item.label);
    const text = `${label} ${normal(`${item.hint ?? ''} ${item.keywords ?? ''} ${item.badge ?? ''}`)}`;
    if (!words.every(word => text.includes(word))) continue;
    groups[label.trim() === whole ? 0 : words.every(word => label.includes(word)) ? 1 : 2].push(item);
  }
  return groups.flat();
};

export const Combobox = ({
  id,
  value,
  onValueChange,
  items,
  listLabel,
  empty,
  className,
  'aria-describedby': describedBy,
}: ComboboxProps): ReactElement => {
  const listId = `${useId()}-list`;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ComboboxRows>({ pinned: [], rest: [] });
  const [text, setText] = useState(value);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);

  const shown = useMemo(() => (open ? filterRows(rows, typed ? text : '') : []), [open, rows, typed, text]);
  const pinnedCount = typed ? 0 : rows.pinned.length;

  const show = (): void => {
    if (open) return;
    const next = items();
    const all = filterRows(next, '');
    setRows(next);
    setTyped(false);
    setText(value);
    setActive(
      Math.max(
        0,
        all.findIndex(item => item.value === value),
      ),
    );
    setOpen(true);
    input.current?.select();
  };
  const close = (): void => {
    setOpen(false);
    setTyped(false);
  };
  const choose = (item: ComboboxItem | undefined): void => {
    if (!item) return;
    setOpen(false);
    setTyped(false);
    if (item.value !== value) onValueChange(item.value);
  };

  // The highlighted row stays in view as it moves (and the chosen one when the list opens).
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, shown]);

  const keyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show();
      const last = shown.length - 1;
      setActive(i => (e.key === 'ArrowDown' ? Math.min(i + 1, last) : Math.max(i - 1, 0)));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  };

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;
  return (
    <div className={cn('relative', className)}>
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        className="cn-input w-full min-w-0 outline-none"
        // Closed, the field shows the chosen value; open, what is typed (the chosen value until then).
        value={open ? text : value}
        onClick={show}
        onChange={e => {
          if (!open) show();
          setText(e.target.value);
          setTyped(true);
          setActive(0);
        }}
        onKeyDown={keyDown}
        onBlur={close}
      />
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="cn-select-content kit-combobox-list">
          {shown.length === 0 && (
            <li role="presentation" className="kit-combobox-empty">
              {empty}
            </li>
          )}
          {shown.map((item, index) => (
            // The keyboard stays in the field (aria-activedescendant, APG): an option takes no focus and no keys.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={item.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={item.value === value}
              data-index={index}
              data-highlighted={index === active ? '' : undefined}
              data-state={item.value === value ? 'checked' : 'unchecked'}
              data-pinned-last={index === pinnedCount - 1 ? '' : undefined}
              className="cn-select-item kit-combobox-item"
              // Keep the focus in the field: the press must not blur it before the click chooses.
              onMouseDown={e => e.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(item)}>
              <span className="kit-combobox-label">
                {item.label}
                {item.badge && <span className="kit-combobox-badge">{item.badge}</span>}
              </span>
              {item.hint && <span className="kit-combobox-hint">{item.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
