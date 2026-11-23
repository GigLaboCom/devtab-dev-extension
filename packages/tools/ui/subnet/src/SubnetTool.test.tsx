// docs/tools/specs/subnet.md §2 (scenarios), §6 (errors and notes next to their field), §8 (the interface: labels,
// copy buttons, the pager) and the history of docs/tools/history.md §10, with the host in memory. Large lists go to the
// worker: jsdom has none, so a fake one does what subnet.worker.ts does, off the test's stack.
import { definition } from './definition';
import { detect } from './detect';
import { splitDraft } from './entries';
import { subnetSettings } from './settings';
import SubnetTool from './SubnetTool';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { runMatch, runSummarize } from '@workspace/tool-logic-subnet';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobMessage, JobReply } from './runner';
import type { ToolHost } from '@workspace/tools-host';

let workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null = null;
  terminated = false;
  messages: JobMessage[] = [];
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    workers.push(this);
  }
  postMessage(message: unknown): void {
    const { id, job } = message as JobMessage;
    this.messages.push(message as JobMessage);
    const reply: JobReply = {
      id,
      ok: true,
      answer:
        job.task === 'match'
          ? { task: 'match', result: runMatch(job.addresses, job.blocks) }
          : { task: 'summarize', result: runSummarize(job.list) },
    };
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: reply });
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

beforeEach(() => {
  workers = [];
  writeText.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const task = (name: 'Explain' | 'Match' | 'Split' | 'Summarize') =>
  fireEvent.click(screen.getByRole('radio', { name }));
const blockField = () => screen.getByLabelText('Block') as HTMLInputElement;
const message = (field: string) => document.querySelector(`[data-field="${field}"]`)?.textContent ?? '';
const rows = (): Record<string, string> =>
  Object.fromEntries(
    [...document.querySelectorAll('[aria-label="Block details"] [data-row]')].map(row => [
      row.getAttribute('data-row'),
      row.querySelector('output')?.textContent ?? '',
    ]),
  );
const tableRows = (name: string) =>
  [...within(screen.getByRole('table', { name })).getAllByRole('row')]
    .slice(1)
    .map(r => [...r.querySelectorAll('td')].map(td => td.textContent));

describe('the Subnet Calculator’s definition', () => {
  it('describes the tool, derives its result from the input, has no default shortcut, loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'subnet',
      title: 'Subnet Calculator',
      summary: 'IPv4 and IPv6 CIDR blocks: masks, ranges, host counts; match, split and summarize.',
      order: 40,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toEqual([
      'subnet',
      'cidr',
      'netmask',
      'ip range',
      'ipv4',
      'ipv6',
      'ip address',
      'supernet',
    ]);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['explain', 'split', 'match', 'summarize']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(SubnetTool);
  });

  it('recognises a CIDR block and a column of them, from a module of its own (§7)', () => {
    expect(['10.0.0.0/8', '2001:db8::/32', '10.0.0.0/8\n172.16.0.0/12'].map(detect)).toEqual([true, true, true]);
    expect(['1.2.3.4', '::1', '12:34:56', '10.0.0.0 255.0.0.0'].map(detect)).toEqual([false, false, false, false]);
  });
});

describe('Explain', () => {
  it('renders with no host, empty: no rows, no messages', () => {
    render(<SubnetTool />);
    expect(screen.getByRole('radio', { name: 'Explain' }).getAttribute('aria-checked')).toBe('true');
    expect(blockField().value).toBe('');
    expect(document.querySelector('[aria-label="Block details"]')).toBeNull();
    expect(message('block')).toBe('');
  });

  it('§2.1: 10.0.12.5/22 — the note about host bits and the rows', () => {
    render(<SubnetTool />);
    type(blockField(), '10.0.12.5/22');
    expect(message('block')).toBe(
      'Host bits are set: 10.0.12.5/22 is the address 10.0.12.5 in the block 10.0.12.0/22.',
    );
    expect(rows()).toMatchObject({
      network: '10.0.12.0/22',
      netmask: '255.255.252.0',
      wildcard: '0.0.3.255',
      prefix: '22',
      first: '10.0.12.0',
      last: '10.0.15.255',
      broadcast: '10.0.15.255',
      hosts: '10.0.12.1 – 10.0.15.254',
      'host-count': '1,022',
      addresses: '1,024 (2^10)',
      address: '10.0.12.5',
      binary: '00001010.00000000.00001100.00000101',
      kind: 'Private-Use',
    });
    const binary = document.querySelector('[data-row="binary"]')!;
    expect(binary.querySelector('[data-part="network-bits"]')!.textContent).toBe('00001010.00000000.000011');
    expect(binary.querySelector('[data-part="host-bits"]')!.className).toContain('text-muted-foreground');
    expect(binary.textContent).toContain('The first 22 bits are the network, the last 10 the host.');
    expect(screen.getByText('All but the network and broadcast addresses.')).toBeTruthy();
  });

  it('copies a row without digit groups; the binary row as text', async () => {
    render(<SubnetTool />);
    type(blockField(), '10.0.12.0/22');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy usable host count' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy binary' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy reverse DNS name' })));
    expect(writeText.mock.calls.map(c => c[0])).toEqual([
      '1022',
      '00001010.00000000.00001100.00000000',
      '0.12.0.10.in-addr.arpa',
    ]);
  });

  it('§2.2–§2.4: masks, IPv6, and the octal trap refused with words', () => {
    render(<SubnetTool />);
    type(blockField(), '10.0.12.0 0.0.3.255');
    expect(message('block')).toBe('0.0.3.255 is a wildcard mask: the block is /22.');
    expect(rows().network).toBe('10.0.12.0/22');
    type(blockField(), '2001:db8::/48');
    expect(rows()).toMatchObject({ netmask: 'ffff:ffff:ffff::', networks64: '65,536 (2^16)', kind: 'Documentation' });
    expect(rows().broadcast).toBeUndefined();
    type(blockField(), '010.0.0.1');
    expect(message('block')).toBe(
      'Column 1: Part 1 "010" has a leading zero, which some programs read as octal: write it without the zero (10), or as 8 if octal was meant.',
    );
    expect(document.querySelector('[aria-label="Block details"]')).toBeNull();
    expect(blockField().getAttribute('aria-invalid')).toBe('true');
  });

  it('a range is not a block: Summarize this range carries it over', () => {
    render(<SubnetTool />);
    type(blockField(), '192.168.0.5 - 192.168.0.20');
    expect(message('block')).toContain('A range is not one block: Summarize gives its blocks.');
    fireEvent.click(screen.getByRole('button', { name: 'Summarize this range' }));
    expect(screen.getByRole('radio', { name: 'Summarize' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Blocks and ranges') as HTMLTextAreaElement).value).toBe(
      '192.168.0.5 - 192.168.0.20',
    );
    expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value.split('\n')).toHaveLength(5);
  });

  it('text handed over by the start page: a block opens Explain, a column opens Summarize', () => {
    render(<SubnetTool input="10.0.0.0/8" />);
    expect(blockField().value).toBe('10.0.0.0/8');
    expect(rows().network).toBe('10.0.0.0/8');
    cleanup();
    render(<SubnetTool input={'10.0.0.0/25\n10.0.0.128/25'} />);
    expect(screen.getByRole('radio', { name: 'Summarize' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value).toBe('10.0.0.0/24');
  });
});

describe('Split', () => {
  it('§2.6: /24 into /26 and into 3 subnets; the input is shared with Explain', async () => {
    render(<SubnetTool />);
    type(blockField(), '10.0.0.0/24');
    task('Split');
    expect(blockField().value).toBe('10.0.0.0/24');
    expect(message('split')).toBe('Enter a prefix length from 24 to 32.');
    type(screen.getByLabelText('New prefix length'), '26');
    expect(message('split')).toBe('4 subnets /26 · 64 addresses each · 62 usable hosts each');
    expect(tableRows('Subnets')).toEqual([
      ['1', '10.0.0.0/26', '10.0.0.0', '10.0.0.63'],
      ['2', '10.0.0.64/26', '10.0.0.64', '10.0.0.127'],
      ['3', '10.0.0.128/26', '10.0.0.128', '10.0.0.191'],
      ['4', '10.0.0.192/26', '10.0.0.192', '10.0.0.255'],
    ]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy subnets' })));
    expect(writeText).toHaveBeenLastCalledWith('10.0.0.0/26\n10.0.0.64/26\n10.0.0.128/26\n10.0.0.192/26');
    fireEvent.click(screen.getByRole('radio', { name: 'Number of subnets' }));
    type(screen.getByLabelText('Count'), '3');
    expect(message('split')).toBe('3 subnets asked: /26 gives 4 subnets of 64 addresses (1 spare).');
    type(screen.getByLabelText('Count'), '300');
    expect(message('split')).toBe('A /24 has 256 addresses: it cannot be split into 300 subnets.');
  });

  it('§2.7: /8 into /24 pages by 1,000; /8 into /32 cannot be copied', { timeout: 60_000 }, async () => {
    render(<SubnetTool />);
    task('Split');
    type(blockField(), '10.0.0.0/8');
    type(screen.getByLabelText('New prefix length'), '/24');
    expect(screen.getByText('Subnets 1–1,000 of 65,536')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.getByText('Subnets 65,001–65,536 of 65,536')).toBeTruthy();
    await waitFor(() => expect(tableRows('Subnets')).toHaveLength(536), { timeout: 20_000 });
    expect(tableRows('Subnets').at(-1)).toEqual(['65,536', '10.255.255.0/24', '10.255.255.0', '10.255.255.255']);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy subnets' })));
    expect(writeText.mock.calls.at(-1)![0].split('\n')).toHaveLength(65_536);
    type(screen.getByLabelText('New prefix length'), '32');
    expect(screen.getByText('Subnets 1–1,000 of 16,777,216')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy subnets' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Copying takes up to 65,536 subnets; this split has 16,777,216.')).toBeTruthy();
  });

  it('refuses a prefix shorter than the block', () => {
    render(<SubnetTool />);
    task('Split');
    type(blockField(), '10.0.12.0/22');
    type(screen.getByLabelText('New prefix length'), '20');
    expect(message('split')).toBe('A /20 is larger than the block /22: choose 22 to 32.');
    type(screen.getByLabelText('New prefix length'), 'x');
    expect(message('split')).toBe('Write the prefix length as a whole number.');
  });
});

describe('Match', () => {
  it('§2.5: three addresses against three blocks; Copy outside / inside / table', async () => {
    render(<SubnetTool />);
    task('Match');
    type(screen.getByLabelText('Addresses'), '10.0.12.77\n192.168.1.10\n2001:db8::1');
    type(screen.getByLabelText('Blocks'), '10.0.0.0/8\n10.0.12.0/22\n2001:db8::/32');
    expect(screen.getByText('2 of 3 addresses are in a block.')).toBeTruthy();
    expect(tableRows('Matches')).toEqual([
      ['1', '10.0.12.77', '10.0.12.0/22', '2'],
      ['2', '192.168.1.10', '—', '0'],
      ['3', '2001:db8::1', '2001:db8::/32', '1'],
    ]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy outside' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy inside' })));
    expect(writeText.mock.calls.map(c => c[0])).toEqual(['192.168.1.10', '10.0.12.77\n2001:db8::1']);
  });

  it('a block in Addresses is an error of its line', () => {
    render(<SubnetTool />);
    task('Match');
    type(screen.getByLabelText('Addresses'), '10.0.0.1\n10.0.0.0/24');
    type(screen.getByLabelText('Blocks'), '10.0.0.0/8');
    expect(message('addresses')).toBe('Line 2: A block, not an address: blocks go in the Blocks list.');
  });

  it('large lists go to the worker after 300 ms; the answer comes back', { timeout: 60_000 }, async () => {
    render(<SubnetTool />);
    task('Match');
    const addresses = Array.from({ length: 3_000 }, (_, i) => `10.0.${i >> 8}.${i & 255}`).join('\n');
    type(screen.getByLabelText('Addresses'), addresses);
    type(screen.getByLabelText('Blocks'), '10.0.0.0/24\n10.0.1.0/24');
    expect(screen.getByText('Working…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('512 of 3,000 addresses are in a block.')).toBeTruthy(), {
      timeout: 2_000,
    });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.url.pathname).toMatch(/subnet\.worker\.ts$/);
    expect(screen.getByText('Addresses 1–1,000 of 3,000')).toBeTruthy();
  });
});

describe('Summarize', () => {
  it('§2.8: four blocks → two; a range → five; lines with errors left out with a line', async () => {
    render(<SubnetTool />);
    task('Summarize');
    type(screen.getByLabelText('Blocks and ranges'), '10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/23\n10.0.4.0/24');
    expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value).toBe('10.0.0.0/22\n10.0.4.0/24');
    expect(screen.getByText('4 entries → 2 blocks · 1,280 addresses')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy all' })));
    expect(writeText).toHaveBeenLastCalledWith('10.0.0.0/22\n10.0.4.0/24');
    type(screen.getByLabelText('Blocks and ranges'), '10.0.0.0/24\n010.0.0.1');
    expect(screen.getByText('1 line could not be read and is not in the result.')).toBeTruthy();
    expect(message('list')).toContain('Line 2: Part 1 "010" has a leading zero');
  });
});

describe('history', () => {
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('subnet', definition.history!).list({})).entries;

  it('an Explain edit that reads is a snapshot; it opens back', async () => {
    const host = memoryHost();
    const { unmount } = render(<SubnetTool host={host} />);
    type(blockField(), '10.0.12.5/2');
    type(blockField(), '10.0.12.5/22');
    type(blockField(), '010.0.0.1');
    type(blockField(), '10.0.12.5/22');
    await act(async () => undefined);
    expect(await entries(host)).toHaveLength(0); // a snapshot waits for rest or the page leaving
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.kind).toBe('explain');
    expect(list[0]!.label).toBe('10.0.12.5/22 · 10.0.12.0/22 · Private-Use');
    render(<SubnetTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: 10.0.12.5/22 · 10.0.12.0/22 · Private-Use.')).toBeTruthy();
    expect(blockField().value).toBe('10.0.12.5/22');
  });

  it('a copy commits at once: Split with its parameters, Summarize with the list as a blob; both open back', async () => {
    const host = memoryHost();
    render(<SubnetTool host={host} />);
    task('Split');
    type(blockField(), '10.0.0.0/8');
    type(screen.getByLabelText('New prefix length'), '24');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy subnets' })));
    task('Summarize');
    type(screen.getByLabelText('Blocks and ranges'), '10.0.0.0/25\n10.0.0.128/25');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy' })));
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list.map(e => e.kind).sort()).toEqual(['split', 'summarize']);
    });
    const split = list.find(e => e.kind === 'split')!;
    const sum = list.find(e => e.kind === 'summarize')!;
    expect(split.label).toBe('Split 10.0.0.0/8 into /24 · 65,536 subnets');
    expect(sum.label).toBe('Summarize 2 entries → 1 block');
    cleanup();
    render(<SubnetTool host={host} restore={{ id: split.id }} />);
    expect(await screen.findByText('Opened from History: Split 10.0.0.0/8 into /24 · 65,536 subnets.')).toBeTruthy();
    expect((screen.getByLabelText('New prefix length') as HTMLInputElement).value).toBe('24');
    expect(screen.getByText('Subnets 1–1,000 of 65,536')).toBeTruthy();
    cleanup();
    render(<SubnetTool host={host} restore={{ id: sum.id }} />);
    expect(await screen.findByText('Opened from History: Summarize 2 entries → 1 block.')).toBeTruthy();
    expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value).toBe('10.0.0.0/24');
  });

  it('Match keeps both lists as blobs; an empty or erroneous state records nothing', async () => {
    const host = memoryHost();
    render(<SubnetTool host={host} />);
    type(blockField(), 'nope');
    task('Match');
    type(screen.getByLabelText('Addresses'), '10.0.0.1');
    type(screen.getByLabelText('Blocks'), '10.0.0.0/8');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy table' })));
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host);
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('Match 1 address against 1 block · 1 inside');
    const opened = await host.history.forOwner('subnet', definition.history!).open(list[0]!.id);
    expect(opened.ok && (await opened.blobs.addresses!.text())).toBe('10.0.0.1');
    expect(opened.ok && (await opened.blobs.blocks!.text())).toBe('10.0.0.0/8');
  });

  it('says why an entry cannot be opened', async () => {
    render(<SubnetTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });
});

describe('saved parameters (D21, docs/tools/settings.md)', () => {
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('subnet', definition.history!).list({})).entries;
  const savedOf = (host: ToolHost) => host.settings!.forTool('subnet').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('subnet').save(subnetSettings.schema, values as never);
    await host.settings!.forTool('subnet').flush();
  };
  const on = (name: string) => screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true';
  const shownTask = () => ['Explain', 'Match', 'Split', 'Summarize'].find(on);
  const shownBy = () => (on('Number of subnets') ? 'count' : 'prefix');

  it('saves the task and Split by the person chose — never a block or a number; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<SubnetTool host={host} />);
    type(blockField(), '10.0.0.0/24');
    await host.settings!.forTool('subnet').flush();
    expect(savedOf(host)).toBeUndefined();
    task('Split');
    fireEvent.click(screen.getByRole('radio', { name: 'Number of subnets' }));
    type(screen.getByLabelText('Count'), '3');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'split', by: 'count' } });
    expect(JSON.stringify(savedOf(host))).not.toMatch(/10\.0|"3"/);

    const second = render(<SubnetTool host={host} />);
    expect(shownTask()).toBe('Split');
    expect(shownBy()).toBe('count');
    expect(blockField().value).toBe('');
    expect((screen.getByLabelText('Count') as HTMLInputElement).value).toBe('');
    // Summarize this range is the person's choice of task too.
    type(blockField(), '10.0.0.1 - 10.0.0.9');
    fireEvent.click(screen.getByRole('button', { name: 'Summarize this range' }));
    second.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'summarize', by: 'count' } });
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, { task: 'supernet', by: 'count', unknown: 1 });
    render(<SubnetTool host={host} />);
    expect(shownTask()).toBe('Explain');
    task('Split');
    expect(shownBy()).toBe('count');
  });

  it('an entry opened from History and a paste win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    await host.history
      .forOwner('subnet', definition.history!)
      .session()
      .commit(
        splitDraft({ block: '10.0.0.0/24', by: 'prefix', prefix: '26', count: '', subnets: '4' }, '10.0.0.0/24', 26),
      );
    const [entry] = await entries(host);
    await seed(host, { task: 'match', by: 'count' });
    const opened = render(<SubnetTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(/^Opened from History: Split 10\.0\.0\.0\/24/)).toBeTruthy();
    expect(shownTask()).toBe('Split');
    expect(shownBy()).toBe('prefix');
    expect((screen.getByLabelText('New prefix length') as HTMLInputElement).value).toBe('26');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'match', by: 'count' } });

    // A paste from the start page: a block opens Explain, a column Summarize — for the visit.
    const block = render(<SubnetTool host={host} input="10.0.0.0/8" />);
    expect(shownTask()).toBe('Explain');
    expect(rows().network).toBe('10.0.0.0/8');
    block.unmount();
    const column = render(<SubnetTool host={host} input={'10.0.0.0/25\n10.0.0.128/25'} />);
    expect(shownTask()).toBe('Summarize');
    column.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'match', by: 'count' } });
    render(<SubnetTool host={host} />);
    expect(shownTask()).toBe('Match');
  });

  it('reset puts the task and Split by back to their defaults and keeps every field', async () => {
    const host = memoryHost();
    await seed(host, { task: 'split', by: 'count' });
    render(<SubnetTool host={host} />);
    type(blockField(), '10.0.0.0/24');
    type(screen.getByLabelText('Count'), '3');
    await act(async () => host.settings!.forTool('subnet').reset());
    expect(shownTask()).toBe('Explain');
    expect(blockField().value).toBe('10.0.0.0/24');
    expect(rows().network).toBe('10.0.0.0/24');
    task('Split');
    expect(shownBy()).toBe('prefix');
    fireEvent.click(screen.getByRole('radio', { name: 'Number of subnets' }));
    expect((screen.getByLabelText('Count') as HTMLInputElement).value).toBe('3');
    await host.settings!.forTool('subnet').flush();
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'split', by: 'count' } });
    await act(async () => host.settings!.forTool('subnet').reset());
    expect(savedOf(host)).toBeUndefined();
  });
});
