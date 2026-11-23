// docs/tools/specs/cron.md §2 (scenarios), §4 (Dialect, Time zone, Runs), §5.9 (a run as shown, the clock), §6 (the
// error under the field), §8 (the interface: Read as, the description and its notes, the next runs, the copy buttons,
// the keyboard) and the history of docs/tools/history.md §10. "Now" is 2026-11-19T18:30:00Z (§2); the machine's zone —
// the browser's — is pinned to Europe/Berlin, so the Local column shows until Europe/Berlin is chosen.
import CronTool from './CronTool';
import { definition } from './definition';
import { detect } from './detect';
import { cronSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as logic from '@workspace/tool-logic-cron';
import { memoryHost } from '@workspace/tools-host';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

vi.mock('@workspace/tool-logic-cron', async original => {
  const actual = await original<typeof logic>();
  return { ...actual, parseCron: vi.fn(actual.parseCron), nextRuns: vi.fn(actual.nextRuns) };
});

const NOW = Date.UTC(2026, 10, 19, 18, 30);
const field = () => screen.getByLabelText('Expression') as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const readAs = () => [...document.querySelectorAll('#cron-read-as p')].map(p => p.textContent?.trim() ?? '');
const description = () => document.querySelector('[data-description]')?.textContent ?? '';
const notes = () => [...document.querySelectorAll('[data-notes] p')].map(p => p.textContent);
const headers = () => screen.queryAllByRole('columnheader').map(h => h.textContent);
const table = (): string[][] =>
  [...document.querySelectorAll('[data-runs] tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.textContent ?? ''),
  );
const column = (n: number) => table().map(row => row[n]);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const zonePicker = () => screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement;
const chooseZone = (query: string) => {
  fireEvent.click(zonePicker());
  fireEvent.change(zonePicker(), { target: { value: query } });
  fireEvent.keyDown(zonePicker(), { key: 'Enter' });
};
const choose = async (labelText: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(labelText));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};
/** The clock stands at `when`; `ticking` — its timers too, to move it by hand (a list that opens needs real ones). */
const at = (when: number, ticking = false) => {
  vi.useFakeTimers({ toFake: ticking ? ['setTimeout', 'clearTimeout', 'Date'] : ['Date'] });
  vi.setSystemTime(when);
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
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Cron tool’s definition', () => {
  it('describes the tool, recognises its input, derives its result from the input, has no default shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'cron',
      title: 'Cron',
      summary: 'Explain a cron expression and list its next runs.',
      order: 12,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'cron',
      'crontab',
      'schedule',
      'quartz',
      'next run',
      'cron expression',
      'every minute',
      'timer',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds).toEqual([{ id: 'explain', title: 'Explained' }]);
    expect(detect('0 9 * * 1-5')).toBe(true);
    expect(detect('1 2 3 4 5')).toBe(false);
    expect((await definition.load()).default).toBe(CronTool);
  });
});

describe('the Cron tool, rendered with no host', () => {
  it('§8 the empty state: an empty field, the defaults, nothing described, the copy buttons off', () => {
    at(NOW);
    render(<CronTool />);
    expect(field().value).toBe('');
    expect(field().placeholder).toBe('0 9 * * 1-5');
    expect(field().getAttribute('spellcheck')).toBe('false');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(readAs()).toEqual(['']);
    expect(screen.getByLabelText('Dialect').textContent).toBe('Auto');
    expect(zonePicker().value).toBe('UTC');
    expect(screen.getByLabelText('Runs').textContent).toBe('10');
    expect(description()).toBe('');
    expect(notes()).toEqual([]);
    expect(screen.getByText('Next runs in UTC')).toBeTruthy();
    expect(headers()).toEqual(['When', 'Local (Europe/Berlin)', 'In', 'Note']);
    expect(table()).toEqual([]);
    expect(button('Copy description').disabled).toBe(true);
    expect(button('Copy runs').disabled).toBe(true);
  });

  it('§2.1: 0 9 * * 1-5 — Read as, the description, the weekdays at nine with their local time and distance', () => {
    at(NOW);
    render(<CronTool />);
    type('0 9 * * 1-5');
    expect(readAs()).toEqual(['Read as: Unix cron (5 fields)']);
    expect(description()).toBe('At 09:00, Monday through Friday');
    expect(notes()).toEqual([]);
    expect(table().slice(0, 3)).toEqual([
      ['Fri 2026-11-20 09:00 UTC', 'Fri 2026-11-20 10:00 +01:00', 'in 14 hours', ''],
      ['Mon 2026-11-23 09:00 UTC', 'Mon 2026-11-23 10:00 +01:00', 'in 3 days', ''],
      ['Tue 2026-11-24 09:00 UTC', 'Tue 2026-11-24 10:00 +01:00', 'in 4 days', ''],
    ]);
    expect(table()).toHaveLength(10);
    expect(document.querySelector('[data-dst-line]')).toBeNull();
  });

  it('§2.2: 0 0 1 * MON — the OR note under the description', () => {
    at(NOW);
    render(<CronTool input="0 0 1 * MON" />);
    expect(description()).toBe('At 00:00, on day 1 of the month, and on Monday');
    expect(notes()).toEqual([
      'Runs when the day of month OR the day of week matches: cron does this when both fields are set.',
    ]);
    expect(column(0).slice(0, 4)).toEqual([
      'Mon 2026-11-23 00:00 UTC',
      'Mon 2026-11-30 00:00 UTC',
      'Tue 2026-12-01 00:00 UTC',
      'Mon 2026-12-07 00:00 UTC',
    ]);
  });

  it('§2.3: 0 0 */2 * 1 — the AND note; Mondays with an odd date', () => {
    at(NOW);
    render(<CronTool input="0 0 */2 * 1" />);
    expect(notes()).toEqual(["One day field starts with *, so a day must match both fields (cron's rule)."]);
    expect(column(0).slice(0, 4)).toEqual([
      'Mon 2026-11-23 00:00 UTC',
      'Mon 2026-12-07 00:00 UTC',
      'Mon 2026-12-21 00:00 UTC',
      'Mon 2027-01-11 00:00 UTC',
    ]);
  });

  it('§2.4: 0 0 12 ? * 2-6 from Spring — Quartz (6 fields) and its numbering note; seconds in the times', () => {
    at(NOW);
    render(<CronTool input="0 0 12 ? * 2-6" />);
    expect(readAs()).toEqual(['Read as: Quartz (6 fields)']);
    expect(description()).toBe('At 12:00, Monday through Friday');
    expect(notes()).toEqual(['Quartz numbers days from 1 = Sunday to 7 = Saturday.']);
    expect(column(0)[0]).toBe('Fri 2026-11-20 12:00:00 UTC');
  });

  it('§2.5: 30 2 * * * in Europe/Berlin — the night the clocks move forward, its note and the line under the table', () => {
    at(Date.UTC(2027, 2, 26, 12));
    render(<CronTool input="30 2 * * *" />);
    chooseZone('berlin');
    expect(zonePicker().value).toBe('Europe/Berlin');
    expect(screen.getByText('Next runs in Europe/Berlin')).toBeTruthy();
    expect(headers()).toEqual(['When', 'In', 'Note']); // the browser's zone is the one chosen
    expect(table().slice(0, 3)).toEqual([
      ['Sat 2027-03-27 02:30 +01:00', 'in 13 hours', ''],
      ['Sun 2027-03-28 03:00 +02:00', 'in 1 day', 'after the clocks moved forward'],
      ['Mon 2027-03-29 02:30 +02:00', 'in 2 days', ''],
    ]);
    expect(document.querySelector('[data-dst-line]')?.textContent).toBe(
      'Daylight saving time: a job at a fixed time runs once — when the clocks move forward, or on the first pass of a repeated hour. Other jobs follow the clock (Vixie cron).',
    );
  });

  it('the night the clocks move back: the second pass of */30 is marked', () => {
    at(Date.UTC(2027, 9, 30, 12));
    render(<CronTool input="*/30 2 * * *" />);
    chooseZone('berlin');
    expect(
      table()
        .slice(0, 4)
        .map(r => [r[0], r[2]]),
    ).toEqual([
      ['Sun 2027-10-31 02:00 +02:00', ''],
      ['Sun 2027-10-31 02:30 +02:00', ''],
      ['Sun 2027-10-31 02:00 +01:00', 'repeated hour, second pass'],
      ['Sun 2027-10-31 02:30 +01:00', 'repeated hour, second pass'],
    ]);
  });

  it('§2.6: 0 0 30 2 * — described, and why it never runs instead of the table', () => {
    at(NOW);
    render(<CronTool input="0 0 30 2 *" />);
    expect(description()).toBe('At 00:00, on day 30 of the month, only in February');
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelector('[data-no-runs]')?.textContent).toBe(
      'This never runs: no selected month has day 30.',
    );
    expect(button('Copy runs').disabled).toBe(true);
    expect(button('Copy description').disabled).toBe(false);
  });

  it('§2.7, §6: 60 * * * * — the error under the field with its column, read out politely; nothing else', () => {
    at(NOW);
    render(<CronTool />);
    type('60 * * * *');
    expect(readAs()).toEqual(['Column 1: 60 is out of range for minute (0–59)']);
    expect(document.getElementById('cron-read-as')?.getAttribute('role')).toBe('status');
    expect(document.querySelector('#cron-read-as [data-tone="error"]')).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe('cron-read-as');
    expect(description()).toBe('');
    expect(table()).toEqual([]);
    expect(button('Copy description').disabled).toBe(true);
    expect(button('Copy runs').disabled).toBe(true);
    type('  60 * * * *');
    expect(readAs()).toEqual(['Column 3: 60 is out of range for minute (0–59)']);
  });

  it('§2.8: a whole crontab line — the command is ignored, the rest as §2.1', () => {
    at(NOW);
    render(<CronTool input="0 3 * * * /usr/local/bin/backup.sh" />);
    expect(readAs()).toEqual(['Read as: crontab line — the command after the 5th field is ignored']);
    expect(description()).toBe('At 03:00');
    expect(column(0)[0]).toBe('Fri 2026-11-20 03:00 UTC');
  });

  it('§6: longer than 1,000 characters is refused before it is read', () => {
    at(NOW);
    render(<CronTool />);
    vi.mocked(logic.parseCron).mockClear();
    type(`0 9 * * 1-5 ${' '.repeat(1000)}`);
    expect(readAs()).toEqual(['The expression is longer than 1,000 characters.']);
    expect(logic.parseCron).not.toHaveBeenCalled();
  });

  it('a macro says what it stands for', () => {
    at(NOW);
    render(<CronTool input="@weekly" />);
    expect(readAs()).toEqual(['Read as: Unix cron macro: @weekly = 0 0 * * 0']);
    expect(description()).toBe('At 00:00, only on Sunday');
  });

  it('§4 Dialect: the same text read with seconds; Quartz with five fields is an error', async () => {
    at(NOW);
    render(<CronTool input="0 0 12 ? * 1-5" />);
    expect(readAs()).toEqual(['Read as: Quartz (6 fields)']);
    await choose('Dialect', 'With seconds (6 fields)');
    expect(readAs()).toEqual(['Read as: Cron with seconds (6 fields)']);
    expect(notes()).toEqual(['Day numbers: 0 and 7 = Sunday, as in Unix cron and Spring.']);
    expect(column(0)[0]).toBe('Fri 2026-11-20 12:00:00 UTC');
    type('0 9 * * 1-5');
    await choose('Dialect', 'Quartz (6–7 fields)');
    expect(readAs()).toEqual(['Quartz needs 6 or 7 fields, found 5.']);
    await choose('Dialect', 'Auto');
    expect(readAs()).toEqual(['Read as: Unix cron (5 fields)']);
  });

  it('§4 Runs: 5, 20 or 50 rows; with seconds, 50 runs a second apart', async () => {
    at(NOW);
    render(<CronTool input="* * * * * *" />);
    await choose('Runs', '5');
    expect(table()).toHaveLength(5);
    await choose('Runs', '50');
    expect(table()).toHaveLength(50);
    expect(column(0)[0]).toBe('Thu 2026-11-19 18:30:01 UTC');
    expect(column(0)[49]).toBe('Thu 2026-11-19 18:30:50 UTC');
    await choose('Runs', '20');
    expect(table()).toHaveLength(20);
  });

  it('§3 Copy description copies the words without the notes; Copy runs one ISO instant a line in the zone', async () => {
    at(NOW);
    render(<CronTool input="0 0 1 * MON" />);
    await choose('Runs', '5');
    await act(async () => {
      fireEvent.click(button('Copy description'));
    });
    expect(writeText).toHaveBeenLastCalledWith('At 00:00, on day 1 of the month, and on Monday');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(button('Copy runs'));
    });
    expect(writeText).toHaveBeenLastCalledWith(
      [
        '2026-11-23T00:00:00+00:00',
        '2026-11-30T00:00:00+00:00',
        '2026-12-01T00:00:00+00:00',
        '2026-12-07T00:00:00+00:00',
        '2026-12-14T00:00:00+00:00',
      ].join('\n'),
    );
    // "Copied" stays until the result changes.
    type('0 0 2 * MON');
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('Copy runs writes the instants in the zone chosen, after the clocks moved', async () => {
    at(Date.UTC(2027, 2, 27, 12));
    render(<CronTool input="30 2 * * *" />);
    chooseZone('berlin');
    await choose('Runs', '5');
    await act(async () => {
      fireEvent.click(button('Copy runs'));
    });
    expect(String(writeText.mock.calls.at(-1)?.[0]).split('\n').slice(0, 2)).toEqual([
      '2027-03-28T03:00:00+02:00',
      '2027-03-29T02:30:00+02:00',
    ]);
  });

  it('the Local column goes when the zone chosen is the browser’s, and comes back', () => {
    at(NOW);
    render(<CronTool input="0 9 * * 1-5" />);
    expect(headers()).toContain('Local (Europe/Berlin)');
    chooseZone('berlin');
    expect(headers()).toEqual(['When', 'In', 'Note']);
    expect(column(0)[0]).toBe('Fri 2026-11-20 09:00 +01:00');
    chooseZone('coordinated universal');
    expect(headers()).toEqual(['When', 'Local (Europe/Berlin)', 'In', 'Note']);
  });

  it('the zone picker opens with your zone and UTC first and finds a zone by a word', () => {
    at(NOW);
    render(<CronTool />);
    fireEvent.click(zonePicker());
    const options = screen.getAllByRole('option').map(o => o.textContent);
    expect(options[0]).toBe('Europe/BerlinYour time zoneUTC+01:00');
    expect(options[1]).toBe('UTCUTC+00:00');
    fireEvent.change(zonePicker(), { target: { value: 'kolkata' } });
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Asia/KolkataUTC+05:30']);
    fireEvent.keyDown(zonePicker(), { key: 'Escape' });
    expect(zonePicker().value).toBe('UTC');
  });

  it('only the next runs follow the clock: the In column ticks, the page is not read again each second', () => {
    at(NOW, true);
    render(<CronTool input="*/15 * * * *" />);
    const parses = vi.mocked(logic.parseCron).mock.calls.length;
    const counted = vi.mocked(logic.nextRuns).mock.calls.length;
    expect(column(2).slice(0, 2)).toEqual(['in 15 minutes', 'in 30 minutes']);
    act(() => vi.advanceTimersByTime(60_000));
    expect(column(2).slice(0, 2)).toEqual(['in 14 minutes', 'in 29 minutes']);
    expect(vi.mocked(logic.parseCron).mock.calls.length).toBe(parses);
    expect(vi.mocked(logic.nextRuns).mock.calls.length).toBe(counted);
    // The clock reaches the first run: it leaves the table and the list is counted again from now.
    act(() => vi.advanceTimersByTime(14 * 60_000));
    expect(column(0)[0]).toBe('Thu 2026-11-19 19:00 UTC');
    expect(column(2)[0]).toBe('in 15 minutes');
    expect(table()).toHaveLength(10);
    expect(vi.mocked(logic.parseCron).mock.calls.length).toBe(parses);
  });

  it('the keyboard goes through the field, the three options, the two copy buttons', () => {
    at(NOW);
    render(<CronTool input="0 9 * * 1-5" />);
    const focusable = [...document.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')].filter(
      el => !(el as HTMLButtonElement).disabled,
    );
    expect(focusable.map(el => el.getAttribute('aria-label') ?? (el.id || el.textContent))).toEqual([
      'cron-input',
      'cron-dialect',
      'cron-zone',
      'cron-runs',
      'Copy description',
      'Copy runs',
    ]);
  });
});

describe('the Cron tool’s history', () => {
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('cron', definition.history!).list({ kinds: ['explain'] })).entries;

  it('an edit that reads is a snapshot (change), written when the page is left; it opens back with its options', async () => {
    const host = memoryHost();
    const { unmount } = render(<CronTool host={host} />);
    type('0 0 12 ? * 1-5');
    await choose('Dialect', 'With seconds (6 fields)');
    await choose('Runs', '5');
    chooseZone('kolkata');
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(0); // a snapshot waits for 3 s of rest or the page leaving
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('0 0 12 ? * 1-5 — At 12:00, Monday through Friday');

    render(<CronTool host={host} restore={{ id: list[0]!.id }} />);
    expect(
      await screen.findByText('Opened from History: 0 0 12 ? * 1-5 — At 12:00, Monday through Friday.'),
    ).toBeTruthy();
    expect(field().value).toBe('0 0 12 ? * 1-5');
    expect(screen.getByLabelText('Dialect').textContent).toBe('With seconds (6 fields)');
    expect(screen.getByLabelText('Runs').textContent).toBe('5');
    expect(zonePicker().value).toBe('Asia/Kolkata');
    expect(table()).toHaveLength(5);
  });

  it('Copy description and Copy runs commit at once; an error or an empty field records nothing', async () => {
    const host = memoryHost();
    render(<CronTool host={host} />);
    type('60 * * * *');
    type('');
    type('0 9 * * 1-5');
    await act(async () => {
      fireEvent.click(button('Copy runs'));
    });
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    const opened = await host.history.forOwner('cron', definition.history!).open(list[0]!.id);
    expect(opened.ok && opened.payload).toEqual({
      expression: '0 9 * * 1-5',
      dialect: 'auto',
      timeZone: 'UTC',
      runs: 10,
      readAs: 'Unix cron (5 fields)',
      description: 'At 09:00, Monday through Friday',
    });
    // The same again is not a second entry.
    await act(async () => {
      fireEvent.click(button('Copy description'));
    });
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(1);
  });

  it('text handed over by the start page is the first snapshot of the visit', async () => {
    const host = memoryHost();
    const { unmount } = render(<CronTool host={host} input="@daily" />);
    unmount();
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    expect((await entries(host))[0]!.label).toBe('@daily — At 00:00');
  });

  it('says why an entry cannot be opened', async () => {
    render(<CronTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });

  it('a kept zone this browser does not know falls back to UTC; damaged options to the defaults', async () => {
    const host = memoryHost();
    const history = host.history.forOwner('cron', definition.history!);
    await history.session().commit({
      kind: 'explain',
      payload: { expression: '@hourly', dialect: 'cobol', timeZone: 'Mars/Base', runs: 7 },
      label: 'kept',
    });
    const [entry] = await entries(host);
    render(<CronTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept.')).toBeTruthy();
    expect(field().value).toBe('@hourly');
    expect(zonePicker().value).toBe('UTC');
    expect(screen.getByLabelText('Dialect').textContent).toBe('Auto');
    expect(screen.getByLabelText('Runs').textContent).toBe('10');
  });
});

describe('the Cron tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('cron').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('cron').save(cronSettings.schema, values as never);
    await host.settings!.forTool('cron').flush();
  };
  const shown = (label: string) => screen.getByLabelText(label).textContent;

  it('saves Dialect, Time zone and Runs the person chose; reopened, it is as left, with no expression', async () => {
    const host = memoryHost();
    const first = render(<CronTool host={host} />);
    type('0 0 12 * * 1-5');
    await choose('Dialect', 'With seconds (6 fields)');
    await choose('Runs', '20');
    chooseZone('kolkata');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { dialect: 'seconds', timeZone: 'Asia/Kolkata', runs: 20 },
    });

    render(<CronTool host={host} />);
    expect(field().value).toBe('');
    expect(shown('Dialect')).toBe('With seconds (6 fields)');
    expect(shown('Runs')).toBe('20');
    expect(zonePicker().value).toBe('Asia/Kolkata');
    type('0 0 12 * * 1-5');
    expect(table()).toHaveLength(20);
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    // An old name of a zone is not how the list writes it: UTC, as for a zone this browser does not know.
    await seed(host, { dialect: 'cobol', timeZone: 'Asia/Calcutta', runs: 50 });
    render(<CronTool host={host} />);
    expect(shown('Dialect')).toBe('Auto');
    expect(zonePicker().value).toBe('UTC');
    expect(shown('Runs')).toBe('50');
    cleanup();
    await seed(host, { dialect: 'quartz', timeZone: 'Mars/Base', runs: 7 });
    render(<CronTool host={host} />);
    expect(shown('Dialect')).toBe('Quartz (6–7 fields)');
    expect(zonePicker().value).toBe('UTC');
    expect(shown('Runs')).toBe('10');
  });

  it('a handed-over expression keeps the saved options; an opened entry shows its own for the visit', async () => {
    const host = memoryHost();
    const kept = { dialect: 'seconds', timeZone: 'Asia/Kolkata', runs: 5 };
    await seed(host, kept);
    const handed = render(<CronTool host={host} input="0 0 12 * * 1-5" />);
    expect(field().value).toBe('0 0 12 * * 1-5');
    expect(shown('Dialect')).toBe('With seconds (6 fields)');
    expect(table()).toHaveLength(5);
    handed.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });
    // The handed-over expression's first snapshot carries the options the page opened with.
    await waitFor(async () =>
      expect(
        (await host.history.forOwner('cron', definition.history!).list({ kinds: ['explain'] })).entries,
      ).toHaveLength(1),
    );

    await host.history
      .forOwner('cron', definition.history!)
      .session()
      .commit({
        kind: 'explain',
        payload: { expression: '@hourly', dialect: 'unix', timeZone: 'Europe/Berlin', runs: 20 },
        label: 'kept entry',
      });
    const entry = (await host.history.forOwner('cron', definition.history!).list({ kinds: ['explain'] })).entries.find(
      e => e.label === 'kept entry',
    );
    const opened = render(<CronTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept entry.')).toBeTruthy();
    expect(shown('Dialect')).toBe('Unix cron (5 fields)');
    expect(zonePicker().value).toBe('Europe/Berlin');
    expect(shown('Runs')).toBe('20');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    render(<CronTool host={host} />);
    expect(shown('Dialect')).toBe('With seconds (6 fields)');
    expect(zonePicker().value).toBe('Asia/Kolkata');
    expect(shown('Runs')).toBe('5');
  });

  it('reset puts the options back to the defaults and keeps the expression; the runs follow', async () => {
    const host = memoryHost();
    await seed(host, { dialect: 'unix', timeZone: 'Asia/Kolkata', runs: 5 });
    render(<CronTool host={host} />);
    type('0 9 * * 1-5');
    expect(table()).toHaveLength(5);
    await act(async () => host.settings!.forTool('cron').reset());
    expect(shown('Dialect')).toBe('Auto');
    expect(zonePicker().value).toBe('UTC');
    expect(shown('Runs')).toBe('10');
    expect(field().value).toBe('0 9 * * 1-5');
    expect(table()).toHaveLength(10);
    expect(savedOf(host)).toBeUndefined();
  });
});
