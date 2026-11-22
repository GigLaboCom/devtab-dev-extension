// docs/tools/specs/data-units.md §2 (scenarios), §3 (what Copy copies), §6 (errors and notes next to their field), §8
// (the interface), the history of docs/tools/history.md §10 and the saved parameters of docs/tools/settings.md §3.
import DataUnitsTool from './DataUnitsTool';
import { definition } from './definition';
import { detect } from './detect';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

const input = (label: string) => screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const radio = (name: string) => screen.getByRole('radio', { name });
const pressed = (name: string) => radio(name).getAttribute('aria-checked') === 'true';
/** Every result row on the page: its id → the shown value. */
const rows = (): Record<string, string> =>
  Object.fromEntries(
    [...document.querySelectorAll('[data-slot="result-row"]')].map(r => [
      (r as HTMLElement).dataset.row ?? '',
      r.querySelector('output')?.textContent ?? '',
    ]),
  );
const messages = (id: string) =>
  [...document.querySelectorAll(`#data-units-${id}-message p`)].map(p => p.textContent?.trim() ?? '').filter(Boolean);
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: label }));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(cleanup);

describe('the Data Units definition', () => {
  it('describes the tool, derives its result from the input, no shortcut; detect is its own module', async () => {
    expect(definition).toMatchObject({
      id: 'data-units',
      title: 'Data Units',
      summary: 'Bytes, KB and KiB, MB and MiB, bits and bytes, Mbps and MB/s, and how long a transfer takes — exact.',
      order: 41,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual(['bytes', 'mb to gb', 'mib', 'kb', 'bitrate', 'mbps', 'download time']);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['convert', 'transfer']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(DataUnitsTool);
    expect(detect('1.5 GiB')).toBe(true);
    expect(detect('4096')).toBe(false);
  });
});

describe('Convert (§2, §8)', () => {
  it('renders with no host: Convert, Decimal, Exact, an empty field, no rows, no messages', () => {
    render(<DataUnitsTool />);
    expect(pressed('Convert')).toBe(true);
    expect(pressed('Decimal (1000)')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Digits' }).textContent).toBe('Exact');
    expect(input('Value').value).toBe('');
    expect(input('Value').placeholder).toBe('1.5 GiB, 250 MB, 4096 or 100 Mbps');
    expect(input('Value').getAttribute('spellcheck')).toBe('false');
    expect(Object.keys(rows())).toEqual([]);
    expect(messages('value')).toEqual([]);
  });

  it('§2 item 1: 1.5 GiB in every unit, bytes first, no reading line', () => {
    render(<DataUnitsTool />);
    type('Value', '1.5 GiB');
    const r = rows();
    expect(r.bytes).toBe('1,610,612,736');
    expect(r.kB).toBe('1,610,612.736');
    expect(r.GB).toBe('1.610612736');
    expect(r.MiB).toBe('1,536');
    expect(r.bits).toBe('12,884,901,888');
    expect(r.Gibit).toBe('12');
    expect(Object.keys(r)).toHaveLength(42);
    expect([...document.querySelectorAll('[data-section]')].map(s => (s as HTMLElement).dataset.section)).toEqual([
      'bytes',
      'bits',
    ]);
    expect(messages('value')).toEqual([]);
  });

  it('§2 item 2: 250 MB with the reading line; Binary (1024) changes the rows and the line', () => {
    render(<DataUnitsTool />);
    type('Value', '250 MB');
    expect(rows().MiB).toBe('238.4185791015625');
    expect(messages('value')).toEqual([
      'MB is read as decimal: 1 MB = 1,000,000 bytes (SI). As binary (JEDEC, Windows), 250 MB is 262,144,000 bytes.',
    ]);
    fireEvent.click(radio('Binary (1024)'));
    expect(rows().MiB).toBe('250');
    expect(rows().MB).toBe('262.144');
    expect(messages('value')[0]).toMatch(/^MB is read as binary \(JEDEC, Windows\): 1 MB = 1,048,576 bytes\./);
  });

  it('§2 item 3: a rate shows bits per second first, with the everyday abbreviation', () => {
    render(<DataUnitsTool />);
    type('Value', '100 Mbps');
    expect([...document.querySelectorAll('[data-section]')].map(s => s.getAttribute('aria-label'))).toEqual([
      'Bits per second',
      'Bytes per second',
    ]);
    expect(rows()['MB/s']).toBe('12.5');
    expect(rows()['MiB/s']).toBe('11.920928955078125');
    expect(screen.getByText('Mbit/s (Mbps)')).toBeTruthy();
  });

  it('§2 item 4 and §6: notes and errors next to the field, word for word', () => {
    render(<DataUnitsTool />);
    type('Value', '20mb');
    expect(messages('value')[0]).toBe('"mb" is read as megabits: a lower-case b is a bit. For megabytes write MB.');
    type('Value', '256Mi');
    expect(messages('value')).toEqual([
      'Column 4: "Mi" alone is a prefix, not a unit: write 256 MiB, 256 MB or 256 Mibit. Config suffixes shows how programs read it.',
    ]);
    expect(input('Value').getAttribute('aria-invalid')).toBe('true');
    expect(Object.keys(rows())).toEqual([]);
    expect(document.getElementById('data-units-value-message')?.getAttribute('role')).toBe('status');
    type('Value', '4096');
    expect(messages('value')).toEqual(['No unit: read as bytes.']);
  });

  it('Digits: rounded rows are marked ≈ and copied without the mark or groups (§3, §5 item 13)', async () => {
    render(<DataUnitsTool />);
    type('Value', '1.5 GiB');
    await choose('Digits', '6 significant');
    expect(rows().kB).toBe('≈ 1,610,613');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy kB' }));
    });
    expect(writeText).toHaveBeenLastCalledWith('1610613');
  });

  it('a pasted value opens Convert with it, whatever task was saved', () => {
    const host = memoryHost();
    host.settings.forTool('data-units').save(1, { task: 'suffixes' });
    render(<DataUnitsTool host={host} input="1.5 GiB" />);
    expect(pressed('Convert')).toBe(true);
    expect(input('Value').value).toBe('1.5 GiB');
    expect(rows().MiB).toBe('1,536');
    expect(host.settings.forTool('data-units').saved()?.values).toEqual({ task: 'suffixes' });
  });
});

describe('Transfer time (§2 items 5–7)', () => {
  it('4.7 GB at 100 Mbps, then 12.5 % overhead', () => {
    render(<DataUnitsTool />);
    fireEvent.click(radio('Transfer time'));
    expect(pressed('Time')).toBe(true);
    expect(screen.queryByLabelText('Time', { selector: 'input' })).toBeNull();
    type('Size', '4.7 GB');
    type('Rate', '100 Mbps');
    expect(rows()).toMatchObject({ time: '6 minutes 16 seconds', seconds: '376', clock: '0:06:16' });
    type('Overhead', '12.5');
    expect(rows()).toMatchObject({
      time: '≈ 7 minutes 9.714 seconds',
      exact: '3008/7 seconds',
      effective: '87.5 Mbps',
    });
    expect(messages('rate')[0]).toMatch(/^Mbps is read as decimal/);
  });

  it('solve for Rate and for Size show ladders', () => {
    render(<DataUnitsTool />);
    fireEvent.click(radio('Transfer time'));
    fireEvent.click(radio('Rate'));
    type('Size', '1 GB');
    type('Time', '10 min');
    expect(screen.getByText('Rate needed')).toBeTruthy();
    expect(rows().exact).toBe('40000000/3 bit/s');
    expect(rows()['Mbit/s']).toBe('≈ 13.333333333333333333');
    fireEvent.click(radio('Size'));
    type('Rate', '1 Gbps');
    type('Time', '1:00:00');
    expect(screen.getByText('Size moved')).toBeTruthy();
    expect(rows().GB).toBe('450');
  });

  it('errors under their fields', () => {
    render(<DataUnitsTool />);
    fireEvent.click(radio('Transfer time'));
    type('Size', '1 GB');
    type('Rate', '0 Mbps');
    expect(messages('rate')).toEqual(['A rate of 0 never finishes the transfer: enter a rate above 0.']);
    type('Rate', '100 MB');
    expect(messages('rate')).toEqual(['Column 5: This is a size: Rate takes a rate, as in 100 Mbps or 12.5 MB/s.']);
    type('Overhead', '100');
    expect(messages('overhead')).toEqual(['Column 1: Overhead is a percentage from 0 to below 100.']);
  });
});

describe('Config suffixes', () => {
  it('a table of nine programs, without links', () => {
    render(<DataUnitsTool />);
    fireEvent.click(radio('Config suffixes'));
    const table = screen.getByRole('table', { name: 'Config suffixes' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(9);
    expect(table.querySelector('a')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Decimal (1000)' })).toBeNull();
  });
});

describe('the Data Units history', () => {
  const entries = async (host: ToolHost, kind?: string) =>
    (await host.history.forOwner('data-units', definition.history!).list(kind ? { kinds: [kind] } : {})).entries;

  it('an edit that reads is a snapshot, written when the page is left; it opens back', async () => {
    const host = memoryHost();
    const { unmount } = render(<DataUnitsTool host={host} />);
    type('Value', 'nonsense');
    type('Value', '250 MB');
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(0);
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, 'convert');
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('250 MB = 250,000,000 bytes · decimal');
    render(<DataUnitsTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: 250 MB = 250,000,000 bytes · decimal.')).toBeTruthy();
    expect(input('Value').value).toBe('250 MB');
    expect(rows().MiB).toBe('238.4185791015625');
  });

  it('a copy commits at once; the same twice is one entry; a transfer opens back with its fields and solve', async () => {
    const host = memoryHost();
    render(<DataUnitsTool host={host} />);
    fireEvent.click(radio('Transfer time'));
    type('Size', '4.7 GB');
    type('Rate', '100 Mbps');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy time' }));
    });
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(writeText).toHaveBeenLastCalledWith('6 minutes 16 seconds');
    expect(list[0]!.kind).toBe('transfer');
    expect(list[0]!.label).toBe('4.7 GB at 100 Mbps → 6 minutes 16 seconds');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy seconds' }));
    });
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(1);
    cleanup();
    render(<DataUnitsTool host={host} restore={{ id: list[0]!.id }} />);
    await screen.findByText(/^Opened from History/);
    expect(pressed('Transfer time')).toBe(true);
    expect([input('Size').value, input('Rate').value]).toEqual(['4.7 GB', '100 Mbps']);
    expect(rows().time).toBe('6 minutes 16 seconds');
  });

  it('text handed over by the start page is the first snapshot; an entry it cannot open says so', async () => {
    const host = memoryHost();
    const { unmount } = render(<DataUnitsTool host={host} input="1.5 GiB" />);
    unmount();
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    render(<DataUnitsTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });
});

describe('the Data Units saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('data-units').saved();

  it('task, reading, digits and solve are saved — no value or field; reopened, as left', async () => {
    const host = memoryHost();
    const first = render(<DataUnitsTool host={host} />);
    type('Value', '250 MB');
    fireEvent.click(radio('Binary (1024)'));
    await choose('Digits', '9 significant');
    fireEvent.click(radio('Transfer time'));
    fireEvent.click(radio('Rate'));
    type('Size', '1 GB');
    type('Overhead', '5');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { reading: 'binary', digits: 9, task: 'transfer', solve: 'rate' },
    });
    expect(JSON.stringify(savedOf(host))).not.toMatch(/250|1 GB/);
    render(<DataUnitsTool host={host} />);
    expect(pressed('Transfer time')).toBe(true);
    expect(pressed('Rate')).toBe(true);
    expect(pressed('Binary (1024)')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Digits' }).textContent).toBe('9 significant');
    expect(input('Size').value).toBe('');
  });

  it('a record it cannot show falls back field by field', () => {
    const host = memoryHost();
    host.settings.forTool('data-units').save(1, { task: 'nonsense', reading: 'binary', digits: 7, solve: 'size' });
    render(<DataUnitsTool host={host} />);
    expect(pressed('Convert')).toBe(true);
    expect(pressed('Binary (1024)')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Digits' }).textContent).toBe('Exact');
  });

  it('an entry opened from History wins for the visit and leaves what is saved alone', async () => {
    const host = memoryHost();
    host.settings.forTool('data-units').save(1, { reading: 'binary', task: 'suffixes' });
    await host.history
      .forOwner('data-units', definition.history!)
      .session()
      .commit({ kind: 'convert', payload: { value: '1 MB', reading: 'decimal', digits: 3 }, label: 'kept' });
    const [entry] = (await host.history.forOwner('data-units', definition.history!).list({})).entries;
    render(<DataUnitsTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: kept.')).toBeTruthy();
    expect(pressed('Convert')).toBe(true);
    expect(pressed('Decimal (1000)')).toBe(true);
    expect(rows().MiB).toBe('≈ 0.954');
    expect(savedOf(host)?.values).toEqual({ reading: 'binary', task: 'suffixes' });
  });

  it('reset puts the defaults back and keeps the value', async () => {
    const host = memoryHost();
    host.settings.forTool('data-units').save(1, { reading: 'binary', digits: 3 });
    render(<DataUnitsTool host={host} />);
    type('Value', '250 MB');
    expect(rows().MiB).toBe('250');
    await act(async () => host.settings.forTool('data-units').reset());
    expect(pressed('Decimal (1000)')).toBe(true);
    expect(input('Value').value).toBe('250 MB');
    expect(rows().MiB).toBe('238.4185791015625');
    expect(savedOf(host)).toBeUndefined();
  });
});
