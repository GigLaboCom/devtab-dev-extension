// docs/tools/specs/unix-time.md §2 (scenarios), §4 (Unit, Time zone, Now, Clear), §5.7 (the clock), §6 (the error next
// to the field), §8 (the interface: the rows, their copy buttons, the zone picker) and the history of
// docs/tools/history.md §10. The machine's zone is pinned to Europe/Berlin (the browser's zone of §2); the readable row
// follows the machine's language, so its expectation is computed with the same call.
import { definition } from './definition';
import { detect } from './detect';
import { unixTimeSettings } from './settings';
import UnixTimeTool from './UnixTimeTool';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as logic from '@workspace/tool-logic-unix-time';
import { memoryHost } from '@workspace/tools-host';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

vi.mock('@workspace/tool-logic-unix-time', async original => {
  const actual = await original<typeof logic>();
  return { ...actual, parseInput: vi.fn(actual.parseInput) };
});

const NOW = 1_795_176_000_000; // 2026-11-20T12:00:00Z
const field = () => screen.getByLabelText('Timestamp or date') as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const rows = (): Record<string, string> =>
  Object.fromEntries(
    [...screen.getByLabelText('Result').querySelectorAll('[data-row]')].map(row => [
      row.getAttribute('data-row'),
      row.querySelector('dd')?.textContent ?? '',
    ]),
  );
const label = (key: string) =>
  screen.getByLabelText('Result').querySelector(`[data-row="${key}"] dt`)?.textContent ?? null;
const messages = () => [...document.querySelectorAll('#unix-time-messages p')].map(p => p.textContent);
const zoneLine = () => document.querySelector('[data-zone-line]')?.textContent;
const choose = async (labelText: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(labelText));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};
const readable = (seconds: number, zone: string) =>
  logic.outputs(BigInt(seconds) * 1_000_000_000n, zone, NOW).readable ?? '';

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

describe('the Unix Time tool’s definition', () => {
  it('describes the tool, recognises its input, derives its result from the input, has no default shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'unix-time',
      title: 'Unix Time',
      summary: 'Turn a Unix timestamp into a date and a date into a timestamp, in any time zone.',
      order: 5,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toContain('epoch');
    expect(detect('1700000000')).toBe(true);
    expect(detect('4155552671')).toBe(false);
    expect((await definition.load()).default).toBe(UnixTimeTool);
  });
});

describe('the Unix Time tool, rendered with no host', () => {
  it('§2.1: 1700000000 — the note and every row, in Europe/Berlin', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    render(<UnixTimeTool input="1700000000" />);
    expect(messages()).toEqual(['Read as seconds (10 digits).']);
    expect(rows()).toEqual({
      seconds: '1700000000',
      milliseconds: '1700000000000',
      microseconds: '1700000000000000',
      nanoseconds: '1700000000000000000',
      isoUtc: '2023-11-14T22:13:20Z',
      isoZone: '2023-11-14T23:13:20+01:00',
      rfc2822: 'Tue, 14 Nov 2023 23:13:20 +0100',
      httpDate: 'Tue, 14 Nov 2023 22:13:20 GMT',
      readable: readable(1_700_000_000, 'Europe/Berlin'),
      dayOfWeek: 'Tuesday',
      dayOfYear: '318',
      isoWeekDate: '2023-W46-2',
      relative: '3 years ago',
    });
    expect(label('isoZone')).toBe('ISO 8601, Europe/Berlin');
    expect(zoneLine()).toBe('UTC+01:00 · Central European Standard Time');
    expect((screen.getByLabelText('Time zone') as HTMLInputElement).value).toBe('Europe/Berlin');
  });

  it('§2.2–§2.4: milliseconds, nanoseconds beyond 2^53, seconds with a fraction', () => {
    render(<UnixTimeTool />);
    type('1700000000123');
    expect(messages()).toEqual(['Read as milliseconds (13 digits).']);
    expect(rows()).toMatchObject({ isoUtc: '2023-11-14T22:13:20.123Z', seconds: '1700000000' });
    type('1700000000123456789');
    expect(messages()).toEqual(['Read as nanoseconds (19 digits).']);
    expect(rows().isoUtc).toBe('2023-11-14T22:13:20.123456789Z');
    type('1700000000.123');
    expect(rows()).toMatchObject({ isoUtc: '2023-11-14T22:13:20.123Z', milliseconds: '1700000000123' });
  });

  it('§2.5: Unit → Milliseconds reads the same digits as milliseconds, and the note goes', async () => {
    render(<UnixTimeTool input="1700000000" />);
    await choose('Unit', 'Milliseconds');
    expect(rows().isoUtc).toBe('1970-01-20T16:13:20Z');
    expect(messages()).toEqual([]);
  });

  it('§2.6: a wall time in a gap — the two notes, the instant an hour later', () => {
    render(<UnixTimeTool input="2024-03-31T02:30" />);
    expect(messages()).toEqual([
      'No offset in the text: read as Europe/Berlin time.',
      '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. Showing 2024-03-31T03:30:00+02:00.',
    ]);
    expect(rows().seconds).toBe('1711848600');
    expect(zoneLine()).toBe('UTC+02:00 · Central European Summer Time');
  });

  it('§2.7, §2.8: an HTTP date; a Java zoned date-time whose zone agrees — no notes', () => {
    render(<UnixTimeTool input="Tue, 14 Nov 2023 22:13:20 GMT" />);
    expect(rows().seconds).toBe('1700000000');
    type('2023-11-14T23:13:20+01:00[Europe/Berlin]');
    expect(rows().seconds).toBe('1700000000');
    expect(messages()).toEqual([]);
  });

  it('§2.9, §6: an error under the field, read out politely; the rows are empty and their buttons off', () => {
    render(<UnixTimeTool input="01/02/2024" />);
    const status = document.getElementById('unix-time-messages')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(messages()).toEqual(['01/02/2024 is ambiguous: January 2 or February 1. Write 2024-01-02 or 2024-02-01.']);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe('unix-time-messages');
    expect(Object.values(rows()).every(v => v === '')).toBe(true);
    expect((screen.getByRole('button', { name: 'Copy seconds' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('§2.10: an empty field shows the time now and follows the clock; Now writes it in and it stops', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW + 250);
    render(<UnixTimeTool />);
    expect(messages()).toEqual(['Showing the current time.']);
    expect(rows()).toMatchObject({
      milliseconds: '1795176000250',
      relative: 'now',
      isoZone: '2026-11-20T13:00:00.250+01:00',
    });
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(750));
    expect(rows()).toMatchObject({ seconds: '1795176001', milliseconds: '1795176001000' });
    act(() => vi.advanceTimersByTime(2000));
    expect(rows().seconds).toBe('1795176003');

    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    expect(field().value).toBe('1795176003000');
    expect(document.activeElement).toBe(field());
    expect(messages()).toEqual(['Read as milliseconds (13 digits).']);
    act(() => vi.advanceTimersByTime(5000));
    expect(rows()).toMatchObject({ seconds: '1795176003', relative: '5 seconds ago' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(field().value).toBe('');
    expect(rows().seconds).toBe('1795176008');
  });

  it('Now writes the current moment in the chosen unit (§5.7)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 123);
    render(<UnixTimeTool />);
    await choose('Unit', 'Seconds');
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    expect(field().value).toBe('1795176000');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await choose('Unit', 'Nanoseconds');
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    expect(field().value).toBe('1795176000123000000');
    expect(rows().isoUtc).toBe('2026-11-20T12:00:00.123Z');
  });

  it('only the parts that show a ticking value follow the clock: the page is not rendered again each second', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    render(<UnixTimeTool input="1795176000" />);
    const parses = vi.mocked(logic.parseInput).mock.calls.length;
    const seconds = rows().seconds;
    act(() => vi.advanceTimersByTime(5000));
    expect(rows().relative).toBe('5 seconds ago');
    expect(rows().seconds).toBe(seconds);
    expect(vi.mocked(logic.parseInput).mock.calls.length).toBe(parses);
    // The empty field: the rows tick, the page still does not.
    type('');
    const empty = vi.mocked(logic.parseInput).mock.calls.length;
    act(() => vi.advanceTimersByTime(3000));
    expect(rows().seconds).toBe('1795176008');
    expect(vi.mocked(logic.parseInput).mock.calls.length).toBe(empty);
  });

  it('Unit is off for a date and on for a number or an empty field', () => {
    render(<UnixTimeTool input="2023-11-14" />);
    const unit = () => (screen.getByLabelText('Unit') as HTMLButtonElement).disabled;
    expect(unit()).toBe(true);
    type('1700000000');
    expect(unit()).toBe(false);
    type('');
    expect(unit()).toBe(false);
  });

  it('rows that are not defined for the instant say why, and their buttons are off', () => {
    render(<UnixTimeTool input="-000001-01-01T00:00:00Z" />);
    expect(rows()).toMatchObject({
      rfc2822: 'Only for years 1900 to 9999.',
      httpDate: 'Only for years 1900 to 9999.',
      readable: 'Not shown for years before 1 AD.',
      isoWeekDate: '-000002-W53-5',
    });
    expect((screen.getByRole('button', { name: 'Copy RFC 2822' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Copy readable date' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Copy seconds' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('copies exactly the value shown; the icon says Copied for 2 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<UnixTimeTool input="1700000000" />);
    const names = [...screen.getByLabelText('Result').querySelectorAll('button')].map(b =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      'Copy seconds',
      'Copy milliseconds',
      'Copy microseconds',
      'Copy nanoseconds',
      'Copy ISO 8601 in UTC',
      'Copy ISO 8601 in Europe/Berlin',
      'Copy RFC 2822',
      'Copy HTTP date',
      'Copy readable date',
      'Copy day of week',
      'Copy day of year',
      'Copy ISO week date',
      'Copy relative time',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy ISO 8601 in Europe/Berlin' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('2023-11-14T23:13:20+01:00');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy day of year' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenLastCalledWith('318');
  });

  it('copying while the time runs takes the value shown at the press', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    render(<UnixTimeTool />);
    act(() => vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole('button', { name: 'Copy seconds' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('1795176004');
  });
});

describe('the time zone picker (§8 «combobox»)', () => {
  const picker = () => screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement;
  const options = () => screen.queryAllByRole('option').map(o => o.textContent);

  it('opens whole with your zone and UTC first, the chosen one highlighted; filters by words; Enter chooses', () => {
    render(<UnixTimeTool input="1700000000" />);
    fireEvent.click(picker());
    expect(picker().getAttribute('aria-expanded')).toBe('true');
    const all = options();
    expect(all).toHaveLength(419);
    expect(all[0]).toBe('Europe/BerlinYour time zoneUTC+01:00');
    expect(all[1]).toBe('UTCUTC+00:00');
    expect(all.filter(o => o?.startsWith('Europe/Berlin'))).toHaveLength(1);
    const active = document.getElementById(picker().getAttribute('aria-activedescendant')!)!;
    expect(active.textContent).toContain('Europe/Berlin');

    fireEvent.change(picker(), { target: { value: 'kolkata' } });
    expect(options()).toEqual(['Asia/KolkataUTC+05:30']);
    fireEvent.change(picker(), { target: { value: 'india' } });
    expect(options()).toContain('Asia/KolkataUTC+05:30');
    fireEvent.change(picker(), { target: { value: '+05:30' } });
    expect(options()).toEqual(['Asia/ColomboUTC+05:30', 'Asia/KolkataUTC+05:30']);
    fireEvent.change(picker(), { target: { value: 'kiev' } });
    expect(options()).toEqual(['Europe/KyivUTC+02:00']);
    fireEvent.change(picker(), { target: { value: 'new york' } });
    expect(options()).toEqual(['America/New_YorkUTC-05:00']);
    fireEvent.keyDown(picker(), { key: 'Enter' });

    expect(picker().getAttribute('aria-expanded')).toBe('false');
    expect(picker().value).toBe('America/New_York');
    expect(label('isoZone')).toBe('ISO 8601, America/New_York');
    expect(rows().isoZone).toBe('2023-11-14T17:13:20-05:00');
    expect(zoneLine()).toBe('UTC-05:00 · Eastern Standard Time');
  });

  it('↓ / ↑ move the highlight; Escape and leaving put the chosen name back; nothing matches says so', () => {
    render(<UnixTimeTool input="1700000000" />);
    fireEvent.keyDown(picker(), { key: 'ArrowDown' });
    expect(picker().getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(picker(), { key: 'ArrowDown' });
    const active = () => document.getElementById(picker().getAttribute('aria-activedescendant')!)?.textContent;
    expect(active()).toBe('UTCUTC+00:00');
    fireEvent.keyDown(picker(), { key: 'ArrowUp' });
    expect(active()).toContain('Europe/Berlin');
    fireEvent.change(picker(), { target: { value: 'atlantis' } });
    expect(screen.getByText('No time zones match.')).toBeTruthy();
    fireEvent.keyDown(picker(), { key: 'Escape' });
    expect(picker().value).toBe('Europe/Berlin');
    fireEvent.change(picker(), { target: { value: 'tokyo' } });
    fireEvent.blur(picker());
    expect(picker().value).toBe('Europe/Berlin');
    expect(picker().getAttribute('aria-expanded')).toBe('false');
  });

  it('choosing UTC drops the zone’s ISO row; a click on an option chooses it', () => {
    render(<UnixTimeTool input="1700000000" />);
    fireEvent.click(picker());
    fireEvent.click(screen.getByRole('option', { name: 'UTC UTC+00:00' }));
    expect(picker().value).toBe('UTC');
    expect(label('isoZone')).toBeNull();
    expect(rows().rfc2822).toBe('Tue, 14 Nov 2023 22:13:20 +0000');
    expect(zoneLine()).toBe('UTC+00:00 · Coordinated Universal Time');
  });

  it('the zone reads a date without an offset (the notes name it)', () => {
    render(<UnixTimeTool input="2023-11-14T22:13" />);
    fireEvent.click(picker());
    fireEvent.change(picker(), { target: { value: 'kolkata' } });
    fireEvent.keyDown(picker(), { key: 'Enter' });
    expect(rows().seconds).toBe('1699980180');
    expect(messages()).toEqual(['No offset in the text: read as Asia/Kolkata time.']);
  });
});

describe('the Unix Time tool’s history', () => {
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('unix-time', definition.history!).list({ kinds: ['convert'] })).entries;

  it('an edit that reads is a snapshot (change), written when the page is left; it opens back with unit and zone', async () => {
    const host = memoryHost();
    const { unmount } = render(<UnixTimeTool host={host} />);
    type('2023-11-14T22:13');
    fireEvent.click(screen.getByRole('combobox', { name: 'Time zone' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Time zone' }), { target: { value: 'kolkata' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Time zone' }), { key: 'Enter' });
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(0); // a snapshot waits for 3 s of rest or the page leaving
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('2023-11-14T22:13 → 2023-11-14T16:43:00Z');

    render(<UnixTimeTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: 2023-11-14T22:13 → 2023-11-14T16:43:00Z.')).toBeTruthy();
    expect(field().value).toBe('2023-11-14T22:13');
    expect((screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement).value).toBe('Asia/Kolkata');
    expect(rows().seconds).toBe('1699980180');
  });

  it('a copied row commits at once, with the unit; an error or an empty field records nothing', async () => {
    const host = memoryHost();
    render(<UnixTimeTool host={host} />);
    type('01/02/2024');
    type('');
    type('1700000000');
    await choose('Unit', 'Milliseconds');
    fireEvent.click(screen.getByRole('button', { name: 'Copy ISO 8601 in UTC' }));
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('1700000000 → 1970-01-20T16:13:20Z');
    const opened = await host.history.forOwner('unix-time', definition.history!).open(list[0]!.id);
    expect(opened.ok && opened.payload).toEqual({
      input: '1700000000',
      unit: 'ms',
      timeZone: 'Europe/Berlin',
      epochNs: '1700000000000000',
      isoUtc: '1970-01-20T16:13:20Z',
    });
  });

  it('Now commits the moment it wrote', async () => {
    const host = memoryHost();
    render(<UnixTimeTool host={host} />);
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    const written = field().value;
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    expect((await entries(host))[0]!.label?.startsWith(`${written} → `)).toBe(true);
  });

  it('text handed over by the start page is the first snapshot of the visit', async () => {
    const host = memoryHost();
    const { unmount } = render(<UnixTimeTool host={host} input="1700000000000" />);
    unmount();
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    expect((await entries(host))[0]!.label).toBe('1700000000000 → 2023-11-14T22:13:20Z');
  });

  it('says why an entry cannot be opened', async () => {
    render(<UnixTimeTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });

  it('a kept zone this browser does not know falls back to the browser’s', async () => {
    const host = memoryHost();
    const history = host.history.forOwner('unix-time', definition.history!);
    await history.session().commit({
      kind: 'convert',
      payload: { input: '0', unit: 'auto', timeZone: 'Mars/Base', epochNs: '0', isoUtc: '1970-01-01T00:00:00Z' },
      label: 'kept',
    });
    const [entry] = await entries(host);
    render(<UnixTimeTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept.')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement).value).toBe('Europe/Berlin');
    expect(within(screen.getByLabelText('Result')).getAllByText('1970-01-01T00:00:00Z')).toHaveLength(1);
  });
});

describe('the Unix Time tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('unix-time').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('unix-time').save(unixTimeSettings.schema, values as never);
    await host.settings!.forTool('unix-time').flush();
  };
  const picker = () => screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement;
  const pickZone = (words: string) => {
    fireEvent.click(picker());
    fireEvent.change(picker(), { target: { value: words } });
    fireEvent.keyDown(picker(), { key: 'Enter' });
  };
  const unit = () => screen.getByLabelText('Unit').textContent;
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('unix-time', definition.history!).list({ kinds: ['convert'] })).entries;

  it('saves the unit and the zone the person chose; reopened, it is as left; the browser’s zone is not stored', async () => {
    const host = memoryHost();
    const first = render(<UnixTimeTool host={host} />);
    type('1700000000');
    await choose('Unit', 'Milliseconds');
    pickZone('kolkata');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { unit: 'ms', timeZone: 'Asia/Kolkata' } });
    expect(JSON.stringify(savedOf(host))).not.toContain('1700000000');
    const second = render(<UnixTimeTool host={host} />);
    expect(field().value).toBe('');
    expect(unit()).toBe('Milliseconds');
    expect(picker().value).toBe('Asia/Kolkata');
    pickZone('berlin');
    second.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { unit: 'ms' } });
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    // An old zone name the picker does not list; then a unit that does not exist.
    await seed(host, { unit: 'ns', timeZone: 'Asia/Calcutta' });
    const first = render(<UnixTimeTool host={host} />);
    expect(unit()).toBe('Nanoseconds');
    expect(picker().value).toBe('Europe/Berlin');
    first.unmount();
    await seed(host, { unit: 'minutes', timeZone: 'UTC' });
    render(<UnixTimeTool host={host} />);
    expect(unit()).toBe('Auto');
    expect(picker().value).toBe('UTC');
  });

  it('a paste opens with what is saved; an opened entry shows its own unit and zone for the visit; what is saved stays', async () => {
    const host = memoryHost();
    await seed(host, { unit: 'ms', timeZone: 'UTC' });
    const pasted = render(<UnixTimeTool host={host} input="1700000000" />);
    expect(unit()).toBe('Milliseconds');
    expect(rows().seconds).toBe('1700000');
    pasted.unmount();
    // The handed text's snapshot is taken with the unit and the zone the page opened with.
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    const kept = await host.history.forOwner('unix-time', definition.history!).open(list[0]!.id);
    expect(kept.ok && kept.payload).toMatchObject({ unit: 'ms', timeZone: 'UTC' });

    await host.history
      .forOwner('unix-time', definition.history!)
      .session()
      .commit({
        kind: 'convert',
        payload: { input: '0', unit: 'auto', timeZone: 'Asia/Kolkata', epochNs: '0', isoUtc: '1970-01-01T00:00:00Z' },
        label: 'kept in Kolkata',
      });
    const entry = (await entries(host)).find(e => e.label === 'kept in Kolkata')!;
    const opened = render(<UnixTimeTool host={host} restore={{ id: entry.id }} />);
    expect(await screen.findByText('Opened from History: kept in Kolkata.')).toBeTruthy();
    expect(unit()).toBe('Auto');
    expect(picker().value).toBe('Asia/Kolkata');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { unit: 'ms', timeZone: 'UTC' } });
    render(<UnixTimeTool host={host} />);
    expect(unit()).toBe('Milliseconds');
    expect(picker().value).toBe('UTC');
  });

  it('reset puts the unit and the zone back to the defaults (the browser’s zone) and keeps the input', async () => {
    const host = memoryHost();
    await seed(host, { unit: 'ms', timeZone: 'UTC' });
    render(<UnixTimeTool host={host} />);
    type('1700000000');
    expect(rows().seconds).toBe('1700000');
    await act(async () => host.settings!.forTool('unix-time').reset());
    expect(unit()).toBe('Auto');
    expect(picker().value).toBe('Europe/Berlin');
    expect(field().value).toBe('1700000000');
    expect(rows().seconds).toBe('1700000000');
    expect(savedOf(host)).toBeUndefined();
  });
});
