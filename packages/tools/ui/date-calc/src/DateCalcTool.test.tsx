// docs/tools/specs/date-calc.md §2 (scenarios), §3 (what Copy copies), §5.7 (the list of zones), §5.9 (Now), §6 (errors
// next to their field), §8 (the interface, the keyboard, the focus after a move) and the history of
// docs/tools/history.md §10. The machine's zone — the browser's — is pinned to Europe/Berlin; "now" is 2026-11-22T12:00Z.
import DateCalcTool from './DateCalcTool';
import { definition } from './definition';
import { detect } from './detect';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0, 789);

const input = (label: string) => screen.getByLabelText(label, { selector: 'input:not([role])' }) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const messages = (id: string) =>
  [...document.querySelectorAll(`#${id}-messages p`)].map(p => p.textContent?.trim() ?? '').filter(Boolean);
const part = (id: string) => document.querySelector(`[data-part="date-calc-${id}"]`) as HTMLElement;
const rows = (id: string): Record<string, string> =>
  Object.fromEntries(
    [...part(id).querySelectorAll('[data-slot="result-row"]')].map(r => [
      r.querySelector('.kit-result-row-label')?.textContent ?? '',
      r.querySelector('output')?.textContent ?? '',
    ]),
  );
const notes = (id: string) => [...part(id).querySelectorAll('[data-notes] p')].map(p => p.textContent);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const zoneRows = () =>
  [...document.querySelectorAll('[data-zone-row]')].map(tr => [
    (tr as HTMLElement).dataset.zoneRow,
    tr.querySelector('[data-local]')?.textContent ?? '',
    tr.querySelector('[data-offset]')?.textContent ?? '',
    tr.querySelector('[data-dst]')?.textContent ?? '',
  ]);
const picker = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement;
const chooseZone = (name: string, query: string) => {
  fireEvent.click(picker(name));
  fireEvent.change(picker(name), { target: { value: query } });
  fireEvent.keyDown(picker(name), { key: 'Enter' });
};

const machineZone = process.env.TZ;
let writeText: ReturnType<typeof vi.fn>;
beforeAll(() => {
  process.env.TZ = 'Europe/Berlin';
});
afterAll(() => {
  if (machineZone === undefined) delete process.env.TZ;
  else process.env.TZ = machineZone;
});
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Date Calculator’s definition', () => {
  it('describes the tool, recognises a duration and two moments, derives its result from the input, no shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'date-calc',
      title: 'Date Calculator',
      summary: 'Difference between two moments, a moment plus or minus a duration, one moment in many time zones.',
      order: 39,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'date difference',
      'days between',
      'duration',
      'add days',
      'time zone converter',
      'dst',
      'iso 8601 duration',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['difference', 'shift', 'zones']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect(detect('P3DT4H')).toBe(true);
    expect(detect('2024-03-01\n2024-04-01')).toBe(true);
    expect(detect('1700000000')).toBe(false);
    expect((await definition.load()).default).toBe(DateCalcTool);
  });
});

describe('the Date Calculator, rendered with no host', () => {
  it('§8 the empty state: three parts, empty fields in the browser’s zone, Add, the browser’s zone and UTC listed', () => {
    render(<DateCalcTool />);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Difference',
      'Add or subtract',
      'Time zones',
    ]);
    for (const label of ['From', 'To', 'Start', 'Moment']) {
      expect(input(label).value).toBe('');
      expect(input(label).getAttribute('spellcheck')).toBe('false');
      expect(input(label).placeholder).toBe('2024-03-31T14:30, 2024-03-31 or 1711895400');
      expect(picker(`${label} time zone`).value).toBe('Europe/Berlin');
    }
    expect(input('Duration').placeholder).toBe('1h30m, 90 min, 2 weeks, -3d or P3DT4H');
    expect(screen.getByRole('radio', { name: 'Add' }).getAttribute('aria-checked')).toBe('true');
    expect(zoneRows()).toEqual([
      ['Europe/Berlin', '', '', ''],
      ['UTC', '', '', ''],
    ]);
    expect(button('Copy all').disabled).toBe(true);
    expect(part('difference').querySelector('[data-slot="result-row"]')).toBeNull();
    expect(
      screen.getByText(
        'Time zone rules come from this browser. Dates far in the future follow today’s rules.'.replace('’', "'"),
      ),
    ).toBeTruthy();
  });

  it('§2.1 days between 1 March and 1 April in Berlin: calendar, calendar days, exact, totals, ISO, and why', () => {
    render(<DateCalcTool />);
    type('From', '2024-03-01');
    type('To', '2024-04-01');
    expect(messages('date-calc-from')).toEqual(['Read as 2024-03-01T00:00:00+01:00 (Friday).']);
    expect(rows('difference')).toEqual({
      Calendar: '1 month',
      'Calendar days': '31 days',
      Exact: '30 days, 23 hours',
      'Total days': '≈30.958333',
      'Total hours': '743',
      'Total minutes': '44580',
      'Total seconds': '2674800',
      'Total milliseconds': '2674800000',
      'ISO 8601, calendar': 'P1M',
      'ISO 8601, exact': 'PT743H',
    });
    expect(notes('difference')).toEqual([
      'Calendar days and exact time differ by 1 hour: Europe/Berlin changed its clocks between the two moments (+01:00 at From, +02:00 at To). Clock changes: 2024-03-31T02:00 → 03:00 (+01:00 → +02:00).',
    ]);
  });

  it('§3 each row copies what it shows; a total marked ≈ copies the number without it', async () => {
    render(<DateCalcTool />);
    type('From', '2024-03-01');
    type('To', '2024-04-01');
    for (const [name, text] of [
      ['Copy calendar', '1 month'],
      ['Copy exact', '30 days, 23 hours'],
      ['Copy total days', '30.958333'],
      ['Copy total hours', '743'],
      ['Copy ISO 8601, calendar', 'P1M'],
      ['Copy ISO 8601, exact', 'PT743H'],
    ] as const) {
      await act(async () => {
        fireEvent.click(button(name));
      });
      expect(writeText).toHaveBeenLastCalledWith(text);
    }
  });

  it('§2.2 a month after January 31; §2.3 a day is not 24 hours; §2.4 a result in a gap', () => {
    render(<DateCalcTool />);
    chooseZone('Start time zone', 'utc');
    type('Start', '2024-01-31T10:00:00Z');
    type('Duration', '1 month');
    expect(messages('date-calc-duration')).toEqual(['Read as P1M (1 month).']);
    expect(rows('shift')).toEqual({
      'Result, UTC': '2024-02-29T10:00:00+00:00',
      'Day of week': 'Thursday',
      'Unix seconds': '1709200800',
      'Unix milliseconds': '1709200800000',
      'Elapsed (exact)': '29 days',
    });
    expect(notes('shift')).toEqual(['Day 31 does not exist in February 2024: the last day, 29, is used.']);

    chooseZone('Start time zone', 'berlin');
    type('Start', '2024-03-30T12:00');
    type('Duration', 'P1D');
    expect(rows('shift')['Result, Europe/Berlin']).toBe('2024-03-31T12:00:00+02:00');
    expect(rows('shift')['Result, UTC']).toBe('2024-03-31T10:00:00Z');
    expect(rows('shift')['Elapsed (exact)']).toBe('23 hours');
    type('Duration', '24h');
    expect(rows('shift')['Result, Europe/Berlin']).toBe('2024-03-31T13:00:00+02:00');

    type('Start', '2024-03-30T02:30');
    type('Duration', '1d');
    expect(rows('shift')['Result, Europe/Berlin']).toBe('2024-03-31T03:30:00+02:00');
    expect(notes('shift')[0]).toBe(
      '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. The result is 2024-03-31T03:30:00+02:00.',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Subtract' }));
    expect(rows('shift')['Result, Europe/Berlin']).toBe('2024-03-29T02:30:00+01:00');
  });

  it('§2.5 the list of zones: add by typing, move with the keyboard, the focus stays with the row, Copy all', async () => {
    render(<DateCalcTool />);
    type('Moment', '2024-03-31T10:30:00Z');
    chooseZone('Add a time zone', 'tokyo');
    expect(zoneRows()).toEqual([
      ['Europe/Berlin', '2024-03-31T12:30:00+02:00', 'UTC+02:00', 'Daylight saving time (+1 hour)'],
      ['UTC', '2024-03-31T10:30:00+00:00', 'UTC+00:00', 'No daylight saving in 2024'],
      ['Asia/Tokyo', '2024-03-31T19:30:00+09:00', 'UTC+09:00', 'No daylight saving in 2024'],
    ]);
    expect(button('Move Europe/Berlin up').disabled).toBe(true);
    expect(button('Move Asia/Tokyo down').disabled).toBe(true);
    const up = button('Move Asia/Tokyo up');
    up.focus();
    fireEvent.click(up);
    expect(zoneRows().map(r => r[0])).toEqual(['Europe/Berlin', 'Asia/Tokyo', 'UTC']);
    expect(document.activeElement).toBe(button('Move Asia/Tokyo up'));
    // At the top the same button turns off: the focus goes to the row's other move button.
    fireEvent.click(button('Move Asia/Tokyo up'));
    expect(zoneRows().map(r => r[0])).toEqual(['Asia/Tokyo', 'Europe/Berlin', 'UTC']);
    expect(document.activeElement).toBe(button('Move Asia/Tokyo down'));
    await act(async () => {
      fireEvent.click(button('Copy all'));
    });
    expect(writeText).toHaveBeenLastCalledWith(
      '2024-03-31T19:30:00+09:00[Asia/Tokyo]\n2024-03-31T12:30:00+02:00[Europe/Berlin]\n2024-03-31T10:30:00+00:00[UTC]',
    );
    await act(async () => {
      fireEvent.click(button('Copy time in Europe/Berlin'));
    });
    expect(writeText).toHaveBeenLastCalledWith('2024-03-31T12:30:00+02:00');
  });

  // 24 picks from the list of 419 zones, each a render of that list in jsdom: seconds on a loaded machine (Chrome opens
  // the list in 20–30 ms, §12). The limit is for the test's own work, not a bound on the tool.
  it('§5.7 a zone already listed, the limit of 24, removing to an empty list', { timeout: 30_000 }, () => {
    render(<DateCalcTool />);
    chooseZone('Add a time zone', 'utc');
    expect(messages('date-calc-add-zone')).toEqual(['UTC is already in the list.']);
    const more = [
      'tokyo',
      'kolkata',
      'new york',
      'sydney',
      'lord howe',
      'chatham',
      'kathmandu',
      'sao paulo',
      'apia',
      'casablanca',
      'dublin',
      'asuncion',
      'moscow',
      'caracas',
      'havana',
      'tehran',
      'london',
      'paris',
      'cairo',
      'nairobi',
      'lagos',
      'dubai',
    ];
    for (const q of more) chooseZone('Add a time zone', q);
    expect(zoneRows()).toHaveLength(24);
    chooseZone('Add a time zone', 'auckland');
    expect(messages('date-calc-add-zone')).toEqual(['The list holds up to 24 time zones.']);
    // Remove: the focus goes to the next row's Remove, the previous one at the end, the field when the list is empty.
    fireEvent.click(button('Remove Europe/Berlin'));
    expect(document.activeElement).toBe(button('Remove UTC'));
    for (const zone of zoneRows().map(r => r[0]!)) fireEvent.click(button(`Remove ${zone}`));
    expect(screen.getByText('No time zones in the list: add one above.')).toBeTruthy();
    expect(document.activeElement).toBe(picker('Add a time zone'));
  });

  it('§2.6 two systems, To earlier than From: negative durations, said once', () => {
    render(<DateCalcTool />);
    type('From', '1711878000');
    type('To', '2024-03-31T14:30:00+05:30');
    expect(messages('date-calc-from')).toEqual([
      'Read as Unix seconds (10 digits): 2024-03-31T11:40:00+02:00 (Sunday).',
    ]);
    expect(rows('difference').Exact).toBe('-40 minutes');
    expect(notes('difference')).toEqual(['To is earlier than From: the durations are negative.']);
  });

  it('§2.7, §2.8 text from the start page goes to its part', () => {
    render(<DateCalcTool input="P3DT4H" />);
    expect(input('Duration').value).toBe('P3DT4H');
    expect(messages('date-calc-duration')).toEqual(['Read as P3DT4H (3 days, 4 hours).']);
    expect(input('Start').value).toBe('');
    cleanup();
    render(<DateCalcTool input={'2024-03-01\n2024-04-01'} />);
    expect([input('From').value, input('To').value]).toEqual(['2024-03-01', '2024-04-01']);
    expect(rows('difference').Calendar).toBe('1 month');
  });

  it('§2.9 Now writes the current second in the field’s zone, once', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    render(<DateCalcTool />);
    fireEvent.click(button('Now: Start'));
    expect(input('Start').value).toBe('2026-11-22T13:00:00+01:00');
    expect(document.activeElement).toBe(input('Start'));
    vi.setSystemTime(NOW + 60_000);
    expect(input('Start').value).toBe('2026-11-22T13:00:00+01:00');
  });

  it('§6 errors stay next to their field; nothing below shows', () => {
    render(<DateCalcTool />);
    type('From', '01/02/2024');
    expect(messages('date-calc-from')).toEqual(['Dates with / or . are not read: write YYYY-MM-DD.']);
    expect(input('From').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('date-calc-from-messages')?.getAttribute('role')).toBe('status');
    type('To', '2024-04-01');
    expect(part('difference').querySelector('[data-slot="result-row"]')).toBeNull();
    type('Start', '2024-01-01');
    type('Duration', '1h -30m');
    expect(messages('date-calc-duration')).toEqual(['A sign goes only at the start: -1h30m.']);
    type('Start', '+275760-09-13T00:00:00Z');
    type('Duration', '1ms');
    expect(part('shift').querySelector('[data-shift-error]')?.textContent).toBe(
      'The result is out of range: moments from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.',
    );
  });

  it('§5.2 a zone in brackets is the moment’s zone; the picker reads a time without an offset', () => {
    render(<DateCalcTool />);
    type('Moment', '2024-03-31T12:00');
    chooseZone('Moment time zone', 'tokyo');
    expect(messages('date-calc-moment')).toEqual(['Read as 2024-03-31T12:00:00+09:00 (Sunday).']);
    type('Moment', '2023-11-14T23:13:20+01:00[Europe/Berlin]');
    expect(messages('date-calc-moment')).toEqual([
      'Read as 2023-11-14T23:13:20+01:00 (Tuesday).',
      'The zone in brackets is used: Europe/Berlin.',
    ]);
  });
});

describe('the Date Calculator’s history', () => {
  const entries = async (host: ToolHost, kind?: string) =>
    (await host.history.forOwner('date-calc', definition.history!).list(kind ? { kinds: [kind] } : {})).entries;

  it('an edit with a result is a snapshot of its part, written when the page is left; it opens back into that part only', async () => {
    const host = memoryHost();
    const { unmount } = render(<DateCalcTool host={host} />);
    type('From', '2024-03-01');
    type('To', '2024-04-01');
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(0);
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, 'difference');
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('2024-03-01 → 2024-04-01 · P1M · PT743H');

    render(<DateCalcTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: 2024-03-01 → 2024-04-01 · P1M · PT743H.')).toBeTruthy();
    expect([input('From').value, input('To').value]).toEqual(['2024-03-01', '2024-04-01']);
    expect(input('Start').value).toBe('');
    expect(rows('difference').Calendar).toBe('1 month');
  });

  it('a copy commits its part at once; an error or an empty field records nothing; the same twice is one entry', async () => {
    const host = memoryHost();
    render(<DateCalcTool host={host} />);
    type('Start', 'nonsense');
    type('Start', '');
    chooseZone('Start time zone', 'utc');
    type('Start', '2024-01-31T10:00:00Z');
    type('Duration', '1 month');
    await act(async () => {
      fireEvent.click(button('Copy result in UTC'));
    });
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.kind).toBe('shift');
    expect(list[0]!.label).toBe('2024-01-31T10:00:00Z + P1M → 2024-02-29T10:00:00+00:00');
    const opened = await host.history.forOwner('date-calc', definition.history!).open(list[0]!.id);
    expect(opened.ok && opened.payload).toEqual({
      start: { text: '2024-01-31T10:00:00Z', zone: 'UTC' },
      duration: '1 month',
      operation: 'add',
      result: '2024-02-29T10:00:00+00:00',
    });
    await act(async () => {
      fireEvent.click(button('Copy day of week'));
    });
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(1);
  });

  it('the zones part keeps its moment and its list in order', async () => {
    const host = memoryHost();
    render(<DateCalcTool host={host} />);
    type('Moment', '2024-03-31T10:30:00Z');
    chooseZone('Add a time zone', 'tokyo');
    fireEvent.click(button('Move Asia/Tokyo up'));
    await act(async () => {
      fireEvent.click(button('Copy all'));
    });
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, 'zones');
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('2024-03-31T10:30:00Z in Europe/Berlin, Asia/Tokyo, UTC');
    cleanup();
    render(<DateCalcTool host={host} restore={{ id: list[0]!.id }} />);
    await screen.findByText(/^Opened from History/);
    expect(zoneRows().map(r => r[0])).toEqual(['Europe/Berlin', 'Asia/Tokyo', 'UTC']);
    expect(input('Moment').value).toBe('2024-03-31T10:30:00Z');
  });

  it('text handed over by the start page is the first snapshot of the visit', async () => {
    const host = memoryHost();
    const { unmount } = render(<DateCalcTool host={host} input={'2024-03-01\n2024-04-01'} />);
    unmount();
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    expect((await entries(host))[0]!.kind).toBe('difference');
  });

  it('says why an entry cannot be opened; a kept zone this browser does not know falls back to its own', async () => {
    render(<DateCalcTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
    cleanup();
    const host = memoryHost();
    const history = host.history.forOwner('date-calc', definition.history!);
    await history.session().commit({
      kind: 'zones',
      payload: {
        moment: { text: '2024-03-31T10:30:00Z', zone: 'Mars/Base' },
        zones: ['Asia/Calcutta', 'Mars/Base', 7],
      },
      label: 'kept',
    });
    const [entry] = await entries(host);
    render(<DateCalcTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept.')).toBeTruthy();
    expect(picker('Moment time zone').value).toBe('Europe/Berlin');
    expect(zoneRows().map(r => r[0])).toEqual(['Asia/Kolkata']);
    expect(within(part('zones')).getByText('2024-03-31T16:00:00+05:30')).toBeTruthy();
  });
});

describe('the Date Calculator’s saved parameters: the zone list and the operation (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('date-calc').saved();
  const listed = () => zoneRows().map(r => r[0]);
  const operation = () =>
    screen.getByRole('radio', { name: 'Subtract' }).getAttribute('aria-checked') === 'true' ? 'subtract' : 'add';

  it('the list the person built and Subtract are saved — no moment, duration or field zone; reopened, as left', async () => {
    const host = memoryHost();
    const first = render(<DateCalcTool host={host} />);
    expect(listed()).toEqual(['Europe/Berlin', 'UTC']);
    type('Moment', '2024-03-31T10:30:00Z');
    type('Duration', 'P1D');
    chooseZone('Start time zone', 'utc');
    chooseZone('Add a time zone', 'tokyo');
    fireEvent.click(button('Move Asia/Tokyo up'));
    fireEvent.click(button('Remove UTC'));
    fireEvent.click(screen.getByRole('radio', { name: 'Subtract' }));
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { zones: ['Europe/Berlin', 'Asia/Tokyo'], operation: 'subtract' },
    });
    expect(JSON.stringify(savedOf(host))).not.toMatch(/2024|P1D/);

    render(<DateCalcTool host={host} />);
    expect(listed()).toEqual(['Europe/Berlin', 'Asia/Tokyo']);
    expect(operation()).toBe('subtract');
    expect(input('Moment').value).toBe('');
    expect(picker('Start time zone').value).toBe('Europe/Berlin');
  });

  it('an empty list is a list too; going back to the default list removes it from storage', async () => {
    const host = memoryHost();
    render(<DateCalcTool host={host} />);
    fireEvent.click(button('Remove Europe/Berlin'));
    fireEvent.click(button('Remove UTC'));
    expect(savedOf(host)?.values).toEqual({ zones: [] });
    chooseZone('Add a time zone', 'berlin');
    chooseZone('Add a time zone', 'utc');
    expect(listed()).toEqual(['Europe/Berlin', 'UTC']);
    expect(savedOf(host)).toBeUndefined();
  });

  it('a saved list it cannot show (an unknown zone, a repeat, too many) is the default list; a valid operation stays', async () => {
    const host = memoryHost();
    host.settings.forTool('date-calc').save(1, { zones: ['Asia/Tokyo', 'Mars/Base'], operation: 'subtract' });
    const a = render(<DateCalcTool host={host} />);
    expect(listed()).toEqual(['Europe/Berlin', 'UTC']);
    expect(operation()).toBe('subtract');
    a.unmount();
    host.settings.forTool('date-calc').save(1, { zones: ['UTC', 'UTC'], operation: 'times' });
    const b = render(<DateCalcTool host={host} />);
    expect(listed()).toEqual(['Europe/Berlin', 'UTC']);
    expect(operation()).toBe('add');
    b.unmount();
    host.settings.forTool('date-calc').save(1, { zones: Array.from({ length: 25 }, (_, i) => `Etc/GMT+${i % 12}`) });
    render(<DateCalcTool host={host} />);
    expect(listed()).toEqual(['Europe/Berlin', 'UTC']);
  });

  it('an entry opened from History shows its list for the visit; what is saved stays; a pasted text keeps the saved list', async () => {
    const host = memoryHost();
    host.settings.forTool('date-calc').save(1, { zones: ['Asia/Tokyo'] });
    await host.history
      .forOwner('date-calc', definition.history!)
      .session()
      .commit({
        kind: 'zones',
        payload: { moment: { text: '2024-03-31T10:30:00Z', zone: 'UTC' }, zones: ['America/New_York', 'UTC'] },
        label: 'kept',
      });
    const [entry] = (await host.history.forOwner('date-calc', definition.history!).list({})).entries;
    const opened = render(<DateCalcTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept.')).toBeTruthy();
    expect(listed()).toEqual(['America/New_York', 'UTC']);
    opened.unmount();
    expect(savedOf(host)?.values).toEqual({ zones: ['Asia/Tokyo'] });

    render(<DateCalcTool host={host} input="2024-03-31T10:30:00Z" />);
    expect(listed()).toEqual(['Asia/Tokyo']);
    expect(input('Moment').value).toBe('2024-03-31T10:30:00Z');
  });

  it('reset puts the default list and Add back and keeps every moment; the rows follow', async () => {
    const host = memoryHost();
    host.settings.forTool('date-calc').save(1, { zones: ['Asia/Tokyo'], operation: 'subtract' });
    render(<DateCalcTool host={host} />);
    type('Moment', '2024-03-31T10:30:00Z');
    type('Duration', 'P1D');
    await act(async () => host.settings.forTool('date-calc').reset());
    expect(listed()).toEqual(['Europe/Berlin', 'UTC']);
    expect(operation()).toBe('add');
    expect([input('Moment').value, input('Duration').value]).toEqual(['2024-03-31T10:30:00Z', 'P1D']);
    expect(within(part('zones')).getByText('2024-03-31T12:30:00+02:00')).toBeTruthy();
    expect(savedOf(host)).toBeUndefined();
  });
});
