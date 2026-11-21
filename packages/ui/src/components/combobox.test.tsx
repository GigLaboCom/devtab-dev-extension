import { Combobox, filterRows } from './combobox';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComboboxRows } from './combobox';

const ROWS: ComboboxRows = {
  pinned: [{ value: 'Europe/Berlin', label: 'Europe/Berlin', hint: 'UTC+01:00', badge: 'Your time zone' }],
  rest: [
    { value: 'UTC', label: 'UTC', hint: 'UTC+00:00' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata', hint: 'UTC+05:30', keywords: 'Asia/Calcutta India Standard Time' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin', hint: 'UTC+01:00' },
    { value: 'America/New_York', label: 'America/New_York', hint: 'UTC-05:00' },
  ],
};

const Picker = ({ items = () => ROWS, onChange }: { items?: () => ComboboxRows; onChange?: (v: string) => void }) => {
  const [value, setValue] = useState('UTC');
  return (
    <>
      <label htmlFor="zone">Time zone</label>
      <Combobox
        id="zone"
        value={value}
        onValueChange={v => {
          setValue(v);
          onChange?.(v);
        }}
        items={items}
        listLabel="Time zones"
        empty="No time zones match."
      />
    </>
  );
};

const field = () => screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement;
const options = () => screen.queryAllByRole('option').map(o => o.textContent);
const highlighted = () => document.querySelector('[data-highlighted]')?.textContent;

beforeAll(() => {
  // jsdom has no layout: the highlighted row is scrolled into view with nothing to scroll.
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(cleanup);

describe('filterRows', () => {
  it('pinned rows first and not repeated; every word of the query in the label, hint, keywords or badge', () => {
    expect(filterRows(ROWS, '').map(r => r.value)).toEqual([
      'Europe/Berlin',
      'UTC',
      'Asia/Kolkata',
      'America/New_York',
    ]);
    expect(filterRows(ROWS, 'calcutta').map(r => r.value)).toEqual(['Asia/Kolkata']);
    expect(filterRows(ROWS, 'new york').map(r => r.value)).toEqual(['America/New_York']);
    expect(filterRows(ROWS, '+05:30').map(r => r.value)).toEqual(['Asia/Kolkata']);
    expect(filterRows(ROWS, 'your clock')).toEqual([]);
    expect(filterRows(ROWS, 'your time').map(r => r.value)).toEqual(['Europe/Berlin']);
  });

  it('a row named by the query comes before rows that only mention it in a hint — "utc" finds UTC first', () => {
    // Every row's hint holds "UTC": the pinned row must not win because of that.
    expect(filterRows(ROWS, 'utc').map(r => r.value)).toEqual([
      'UTC',
      'Europe/Berlin',
      'Asia/Kolkata',
      'America/New_York',
    ]);
    expect(filterRows(ROWS, ' UTC ')[0]?.value).toBe('UTC');
    // A label match before a keyword match, the list's order inside each group.
    expect(filterRows(ROWS, 'asia').map(r => r.value)).toEqual(['Asia/Kolkata']);
    expect(filterRows(ROWS, 'e').map(r => r.value)).toEqual(['Europe/Berlin', 'America/New_York', 'Asia/Kolkata']);
  });
});

describe('Combobox', () => {
  it('is a labelled field with the input classes; closed, it shows the chosen value', () => {
    render(<Picker />);
    expect(field().value).toBe('UTC');
    expect(field().className).toContain('cn-input');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens whole on a click, asks for its rows then, highlights the chosen row; typing filters; Enter chooses', () => {
    const items = vi.fn(() => ROWS);
    const onChange = vi.fn();
    render(<Picker items={items} onChange={onChange} />);
    expect(items).not.toHaveBeenCalled();
    fireEvent.click(field());
    expect(items).toHaveBeenCalledTimes(1);
    const list = screen.getByRole('listbox', { name: 'Time zones' });
    expect(list.className).toContain('cn-select-content');
    expect(options()).toEqual([
      'Europe/BerlinYour time zoneUTC+01:00',
      'UTCUTC+00:00',
      'Asia/KolkataUTC+05:30',
      'America/New_YorkUTC-05:00',
    ]);
    expect(highlighted()).toBe('UTCUTC+00:00');
    expect(field().getAttribute('aria-activedescendant')).toBe(document.querySelector('[data-highlighted]')?.id);
    expect(screen.getByRole('option', { name: /^UTC/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.change(field(), { target: { value: 'kolk' } });
    expect(options()).toEqual(['Asia/KolkataUTC+05:30']);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Asia/Kolkata');
    expect(field().value).toBe('Asia/Kolkata');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('↓ opens and moves, ↑ moves back; Escape and leaving the field put the chosen value back', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(highlighted()).toBe('Asia/KolkataUTC+05:30');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(highlighted()).toBe('Europe/BerlinYour time zoneUTC+01:00');
    fireEvent.change(field(), { target: { value: 'new' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field().value).toBe('UTC');
    fireEvent.click(field());
    fireEvent.change(field(), { target: { value: 'zzz' } });
    expect(screen.getByRole('listbox').textContent).toBe('No time zones match.');
    fireEvent.blur(field());
    expect(field().value).toBe('UTC');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a click on a row chooses it; the press keeps the focus in the field', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.click(field());
    const row = screen.getByRole('option', { name: /New_York/ });
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(row);
    });
    expect(onChange).toHaveBeenCalledWith('America/New_York');
    expect(field().value).toBe('America/New_York');
  });

  it('choosing the row already chosen changes nothing', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.click(field());
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
