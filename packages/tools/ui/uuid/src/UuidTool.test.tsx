import { definition } from './definition';
import { detect } from './detect';
import { uuidSettings } from './settings';
import UuidTool from './UuidTool';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUTO_COPY, AUTO_COPY_REFUSED, memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

// docs/tools/specs/uuid.md §2 (scenarios), §4 (what regenerates), §6 (errors next to their field), §8 (the interface),
// and the history of docs/tools/history.md §10.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const result = () => (screen.getByLabelText('Generated identifiers') as HTMLTextAreaElement).value;
const lines = () => result().split('\n');
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choose = async (label: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};
const inspection = () => {
  const dl = screen.queryByLabelText('Inspection');
  if (!dl) return {};
  return Object.fromEntries(
    [...dl.querySelectorAll('[data-row]')].map(row => [
      row.getAttribute('data-row'),
      row.querySelector('dd > span')?.textContent,
    ]),
  );
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the UUID / ULID tool’s definition', () => {
  it('describes the tool, detects identifiers and loads its component', async () => {
    expect(definition).toMatchObject({ id: 'uuid', title: 'UUID / ULID', order: 6 });
    expect(definition.summary).toBe(
      'Generate UUIDs (v4, v7, v5, v3) and ULIDs, or inspect one: version, variant, time.',
    );
    expect(definition.keywords).toContain('rfc 9562');
    expect(detect('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toBe(true);
    expect(detect('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(detect('12345678901234567890123456')).toBe(false);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['generate', 'inspect']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(UuidTool);
  });
});

describe('Generate, with no host', () => {
  it('§2.1: opens with one UUID v4 and copies it', async () => {
    render(<UuidTool />);
    expect(result()).toMatch(V4);
    const copy = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(copy);
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith(result());
    expect(copy.textContent).toBe('Copied');
    expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy();
    expect((screen.getByLabelText('Generated identifiers') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('§2.2: UUID v7, How many 5 — five ascending UUIDs, one ms; Copy all', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1645557742000);
    render(<UuidTool />);
    await choose('Type', 'UUID v7 (time-ordered)');
    type('How many', '5');
    expect(lines()).toHaveLength(5);
    for (const line of lines()) expect(line).toMatch(V7);
    expect([...lines()].sort()).toEqual(lines());
    expect(new Set(lines().map(l => l.slice(0, 13)))).toEqual(new Set(['017f22e2-79b0']));
    expect((screen.getByLabelText('Generated identifiers') as HTMLTextAreaElement).rows).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith(lines().join('\n'));
    expect(result().endsWith('\n')).toBe(false);
  });

  it('the result grows to 12 lines, then scrolls', async () => {
    render(<UuidTool />);
    type('How many', '30');
    expect(lines()).toHaveLength(30);
    expect((screen.getByLabelText('Generated identifiers') as HTMLTextAreaElement).rows).toBe(12);
  });

  it('§4: Generate makes a new batch; Format and Uppercase only rewrite it', async () => {
    render(<UuidTool />);
    const first = result();
    await choose('Format', 'URN');
    expect(result()).toBe(`urn:uuid:${first}`);
    fireEvent.click(screen.getByLabelText('Uppercase'));
    expect(result()).toBe(`urn:uuid:${first.toUpperCase()}`);
    await choose('Format', 'Braces');
    expect(result()).toBe(`{${first.toUpperCase()}}`);
    await choose('Format', 'No hyphens');
    expect(result()).toBe(first.toUpperCase().replaceAll('-', ''));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(result()).not.toBe(first.toUpperCase().replaceAll('-', ''));
    expect(result()).toMatch(/^[0-9A-F]{32}$/);
  });

  it('§6: How many 0, 1001, empty or a fraction says so next to the field; no result', () => {
    render(<UuidTool />);
    for (const bad of ['0', '1001', '', '2.5']) {
      type('How many', bad);
      expect(screen.getByText('How many must be a whole number from 1 to 1,000.')).toBeTruthy();
      expect(result()).toBe('');
      expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true);
    }
    type('How many', '3');
    expect(screen.queryByText('How many must be a whole number from 1 to 1,000.')).toBeNull();
    expect(lines()).toHaveLength(3);
  });

  it('ULID: always uppercase; Format and Uppercase are unavailable', async () => {
    render(<UuidTool />);
    await choose('Type', 'ULID');
    expect(result()).toMatch(ULID);
    expect((screen.getByLabelText('Uppercase') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Format') as HTMLButtonElement).disabled).toBe(true);
  });

  it('§2.3: UUID v5, DNS, www.example.com — then v3; no How many or Generate; the v3 remark', async () => {
    render(<UuidTool />);
    await choose('Type', 'UUID v5 (name, SHA-1)');
    expect(screen.queryByLabelText('How many')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).placeholder).toBe('www.example.com');
    // §6: the empty name is legal.
    await waitFor(() => expect(result()).toBe('4ebd0208-8328-5d69-8c44-ec50939c0967'));
    type('Name', 'www.example.com');
    await waitFor(() => expect(result()).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2'));
    await choose('Type', 'UUID v3 (name, MD5)');
    await waitFor(() => expect(result()).toBe('5df41881-3aed-3515-88a7-2f4a814cf09e'));
    expect(screen.getByText('UUID v5 is preferred over v3 (RFC 9562 §5.3).')).toBeTruthy();
  });

  it('§6: a custom namespace that is empty or not a UUID says so next to the field; no result', async () => {
    render(<UuidTool />);
    await choose('Type', 'UUID v5 (name, SHA-1)');
    await choose('Namespace', 'Custom…');
    expect(screen.getByText('Namespace must be a UUID.')).toBeTruthy();
    expect(result()).toBe('');
    type('Custom namespace', '{6BA7B810-9DAD-11D1-80B4-00C04FD430C8}');
    type('Name', 'www.example.com');
    await waitFor(() => expect(result()).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2'));
    expect(screen.queryByText('Namespace must be a UUID.')).toBeNull();
  });

  it('nil and max, in the chosen notation', async () => {
    render(<UuidTool />);
    await choose('Type', 'Nil UUID');
    expect(result()).toBe('00000000-0000-0000-0000-000000000000');
    await choose('Type', 'Max UUID');
    fireEvent.click(screen.getByLabelText('Uppercase'));
    expect(result()).toBe('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF');
  });

  it('§6: a ULID overflow within one ms is an error, not a carry into the time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1645557742000);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0xff);
      return array;
    });
    render(<UuidTool />);
    await choose('Type', 'ULID');
    expect(result()).toBe('01FWHE4YDGZZZZZZZZZZZZZZZZ');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'ULID random part overflowed within one millisecond. Try again.',
    );
    expect(result()).toBe('');
  });
});

describe('Inspect, with no host', () => {
  it('is only the field with its hint while empty', () => {
    render(<UuidTool />);
    const field = screen.getByLabelText('Paste a UUID or ULID') as HTMLInputElement;
    expect(field.placeholder).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(screen.queryByLabelText('Inspection')).toBeNull();
    type('Paste a UUID or ULID', '   ');
    expect(screen.queryByLabelText('Inspection')).toBeNull();
    expect(screen.queryAllByRole('status').filter(s => s.textContent?.startsWith('Not'))).toEqual([]);
  });

  it('§2.4: a v7 from a log — version, variant, time, as ULID; copies the standard notation', async () => {
    render(<UuidTool input="017F22E2-79B0-7CC3-98C4-DC0C0C07398F" />);
    expect(inspection()).toMatchObject({
      Kind: 'UUID',
      Standard: '017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
      Version: '7 — Unix time-based',
      Variant: 'RFC 9562',
      Time: '2022-02-22T19:22:22Z',
      'As ULID': '01FWHE4YDGFK1SHH6W1G60EECF',
    });
    const time = screen.getByLabelText('Inspection').querySelector('[data-row="Time"] dd')!;
    expect(time.children).toHaveLength(3); // ISO, local, relative
    expect(time.textContent).toMatch(/years ago$/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy standard' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    fireEvent.click(screen.getByRole('button', { name: 'Copy as ULID' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenLastCalledWith('01FWHE4YDGFK1SHH6W1G60EECF');
    fireEvent.click(screen.getByRole('button', { name: 'Copy time' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenLastCalledWith('2022-02-22T19:22:22Z');
  });

  it('§2.5: a ULID — time, as UUID with the remark', () => {
    render(<UuidTool />);
    type('Paste a UUID or ULID', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(inspection()).toMatchObject({
      Kind: 'ULID',
      Time: '2016-07-30T23:54:10.259Z',
      'As UUID': '01563e3a-b5d3-d676-4c61-efb99302bd5b',
    });
    expect(
      screen.getByText('This UUID notation has no RFC 9562 version: ULID bits are not laid out as a UUID.'),
    ).toBeTruthy();
    expect(inspection().Version).toBeUndefined();
  });

  it('§2.6: a v1 — clock sequence and node', () => {
    render(<UuidTool />);
    type('Paste a UUID or ULID', 'C232AB00-9414-11EC-B3C8-9F6BDECED846');
    expect(inspection()).toMatchObject({
      Version: '1 — Gregorian time-based',
      Time: '2022-02-22T19:22:22Z',
      'Clock sequence': '13256 (0x33c8)',
      Node: '9f:6b:de:ce:d8:46',
    });
    expect(screen.getByText('random node (multicast bit set, RFC 9562 §6.10)')).toBeTruthy();
  });

  it('§2.7: braces and uppercase from the Windows registry', () => {
    render(<UuidTool />);
    type('Paste a UUID or ULID', '  {3B2F8C1E-9D4A-4F6B-8A2E-5C7D9E0F1A2B}  ');
    expect(inspection()).toMatchObject({ Standard: '3b2f8c1e-9d4a-4f6b-8a2e-5c7d9e0f1a2b', Version: '4 — Random' });
  });

  it('§2.8 and §6: the error next to the field, in words, with the place', () => {
    render(<UuidTool />);
    const message = () => screen.getByLabelText('Paste a UUID or ULID').getAttribute('aria-describedby');
    type('Paste a UUID or ULID', '017F22E2-79B0-7CC3-98C4-DC0C0C07398');
    expect(document.getElementById(message()!)?.textContent).toBe(
      'Not a UUID or ULID: 35 characters; a UUID has 36 with hyphens or 32 without, a ULID has 26.',
    );
    expect(screen.queryByLabelText('Inspection')).toBeNull();
    type('Paste a UUID or ULID', '017F22E2-79B0-7CC3-98C4-DC0C0C07398G');
    expect(document.getElementById(message()!)?.textContent).toBe('Not a UUID: "G" at position 36 is not a hex digit.');
    type('Paste a UUID or ULID', '00000000-0000-0000-0000-000000000000');
    expect(message()).toBeNull();
    expect(inspection().Kind).toBe('Nil UUID (RFC 9562 §5.9)');
  });

  it('§6: two lines pasted — "Paste one UUID or ULID."', () => {
    render(<UuidTool />);
    const field = screen.getByLabelText('Paste a UUID or ULID');
    fireEvent.paste(field, {
      clipboardData: { getData: () => '017f22e2-79b0-7cc3-98c4-dc0c0c07398f\n01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    });
    expect(screen.getByText('Paste one UUID or ULID.')).toBeTruthy();
  });
});

describe('the UUID / ULID tool’s history', () => {
  const entries = async (host: ToolHost, kind: string) =>
    (await host.history.forOwner('uuid', definition.history!).list({ kinds: [kind] })).entries;

  it('commits each Generate with its identifiers, and opens it again when the host asks', async () => {
    const host = memoryHost();
    const { unmount } = render(<UuidTool host={host} />);
    type('How many', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const shown = result();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, 'generate');
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('UUID v4 · 3 identifiers');
    unmount();

    render(<UuidTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: UUID v4 · 3 identifiers.')).toBeTruthy();
    expect(result()).toBe(shown);
    expect((screen.getByLabelText('How many') as HTMLInputElement).value).toBe('3');
  });

  it('commits what is copied; the initial UUID is not recorded until then', async () => {
    const host = memoryHost();
    render(<UuidTool host={host} />);
    const history = host.history.forOwner('uuid', definition.history!);
    await act(async () => undefined);
    expect((await history.list()).entries).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(async () => expect(await entries(host, 'generate')).toHaveLength(1));
    expect((await entries(host, 'generate'))[0]!.label).toBe(`UUID v4 · ${result()}`);
  });

  it('records an edit of v5 options as a snapshot (change), not at once; opens it back with namespace and name', async () => {
    const host = memoryHost();
    const { unmount } = render(<UuidTool host={host} />);
    await choose('Type', 'UUID v5 (name, SHA-1)');
    type('Name', 'www.example.com');
    await waitFor(() => expect(result()).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2'));
    await act(async () => undefined);
    expect(await entries(host, 'generate')).toHaveLength(0); // a snapshot waits for 3 s of rest or the page leaving
    unmount();
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, 'generate');
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('UUID v5 · DNS · www.example.com');

    render(<UuidTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: UUID v5 · DNS · www.example.com.')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('www.example.com');
    await waitFor(() => expect(result()).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2'));
  });

  it('records an inspected identifier handed over by the start page, and opens it back into Inspect', async () => {
    const host = memoryHost();
    const { unmount } = render(<UuidTool host={host} input="01ARZ3NDEKTSV4RRFFQ69G5FAV" />);
    unmount(); // leaving the page writes the pending snapshot
    let list: Awaited<ReturnType<typeof entries>> = [];
    await waitFor(async () => {
      list = await entries(host, 'inspect');
      expect(list).toHaveLength(1);
    });
    expect(list[0]!.label).toBe('ULID · 01ARZ3NDEKTSV4RRFFQ69G5FAV');

    render(<UuidTool host={host} restore={{ id: list[0]!.id }} />);
    expect(await screen.findByText('Opened from History: ULID · 01ARZ3NDEKTSV4RRFFQ69G5FAV.')).toBeTruthy();
    expect((screen.getByLabelText('Paste a UUID or ULID') as HTMLInputElement).value).toBe(
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(within(screen.getByLabelText('Inspection')).getByText('2016-07-30T23:54:10.259Z')).toBeTruthy();
  });

  it('says why an entry cannot be opened', async () => {
    render(<UuidTool host={memoryHost()} restore={{ id: 'missing' }} />);
    expect(await screen.findByText('This entry could not be opened.')).toBeTruthy();
  });
});

describe('Copy automatically after generating (docs/tools/copying.md)', () => {
  const autoCopyHost = async (on: boolean) => {
    const host = memoryHost();
    await host.settings.setForAll(['password', 'uuid'], { [AUTO_COPY]: on });
    return host;
  };
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('uuid', definition.history!).list({ kinds: ['generate'] })).entries;
  const live = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
  const settle = () => act(async () => undefined);

  it('off (the default): Generate copies nothing; a new batch is still announced', async () => {
    render(<UuidTool host={await autoCopyHost(false)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(live()).toBe('New identifier generated');
  });

  it('on: opening, Type and How many copy nothing; Generate copies the whole batch, recorded once', async () => {
    const host = await autoCopyHost(true);
    render(<UuidTool host={host} />);
    await settle();
    await choose('Type', 'UUID v7 (time-ordered)');
    type('How many', '5');
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(live()).toBe('5 new identifiers generated');

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await settle();
    expect(lines()).toHaveLength(5);
    expect(writeText.mock.calls).toEqual([[result()]]);
    expect(result().endsWith('\n')).toBe(false);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(live()).toBe('5 new identifiers generated and copied');
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    await settle();
    expect(await entries(host)).toHaveLength(1);
  });

  it('on, the browser refuses: one line says so, Copy all still works', async () => {
    render(<UuidTool host={await autoCopyHost(true)} />);
    type('How many', '3');
    writeText.mockImplementationOnce(() =>
      Promise.reject(
        new DOMException("Failed to execute 'writeText' on 'Clipboard': Document is not focused.", 'NotAllowedError'),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await settle();
    expect(screen.getByText(AUTO_COPY_REFUSED).getAttribute('role')).toBeNull();
    expect(live()).toBe('3 new identifiers generated, not copied automatically');
    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(result());
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('on: opening an entry from History copies nothing', async () => {
    const host = await autoCopyHost(false);
    const { unmount } = render(<UuidTool host={host} />);
    type('How many', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(async () => expect(await entries(host)).toHaveLength(1));
    unmount();
    await host.settings.setForAll(['uuid'], { [AUTO_COPY]: true });
    render(<UuidTool host={host} restore={{ id: (await entries(host))[0]!.id }} />);
    expect(await screen.findByText('Opened from History: UUID v4 · 2 identifiers.')).toBeTruthy();
    await settle();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('v5 is computed from its name, not generated on request: typing copies nothing', async () => {
    render(<UuidTool host={await autoCopyHost(true)} />);
    await choose('Type', 'UUID v5 (name, SHA-1)');
    type('Name', 'www.example.com');
    await waitFor(() => expect(result()).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2'));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('the UUID / ULID tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('uuid').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('uuid').save(uuidSettings.schema, values as never);
    await host.settings!.forTool('uuid').flush();
  };
  const shown = (label: string) => screen.getByLabelText(label).textContent;
  const count = () => (screen.getByLabelText('How many') as HTMLInputElement).value;
  const entries = async (host: ToolHost) =>
    (await host.history.forOwner('uuid', definition.history!).list({ kinds: ['generate'] })).entries;
  const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

  it('saves the options the person chose — never a name; reopened, the first batch is made with them', async () => {
    const host = memoryHost();
    const first = render(<UuidTool host={host} />);
    await choose('Type', 'UUID v7 (time-ordered)');
    type('How many', '5');
    await choose('Format', 'Braces');
    fireEvent.click(screen.getByLabelText('Uppercase'));
    type('How many', ''); // being typed: not saved
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { type: 'v7', count: 5, format: 'braces', uppercase: true } });

    const second = render(<UuidTool host={host} />);
    expect(shown('Type')).toBe('UUID v7 (time-ordered)');
    expect(count()).toBe('5');
    expect(lines()).toHaveLength(5);
    for (const line of lines())
      expect(line).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-7[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
    await choose('Type', 'UUID v5 (name, SHA-1)');
    await choose('Namespace', 'Custom…');
    type('Custom namespace', NS.slice(0, 20)); // half pasted: not saved
    type('Custom namespace', NS);
    type('Name', 'www.example.com');
    second.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { type: 'v5', count: 5, format: 'braces', uppercase: true, namespace: 'custom', customNamespace: NS },
    });
    expect(JSON.stringify(savedOf(host))).not.toContain('www.example.com');
    render(<UuidTool host={host} />);
    expect(shown('Namespace')).toBe('Custom…');
    expect((screen.getByLabelText('Custom namespace') as HTMLInputElement).value).toBe(NS);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, {
      type: 'v6',
      count: 5000,
      format: 'urn',
      uppercase: 'yes',
      namespace: 'custom',
      customNamespace: 'not-a-namespace',
    });
    render(<UuidTool host={host} />);
    expect(shown('Type')).toBe('UUID v4 (random)');
    expect(count()).toBe('1');
    expect(lines()).toHaveLength(1);
    expect(result()).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4/);
    await choose('Type', 'UUID v5 (name, SHA-1)');
    expect(shown('Namespace')).toBe('Custom…');
    expect((screen.getByLabelText('Custom namespace') as HTMLInputElement).value).toBe('');
  });

  it('a paste goes to Inspect and an opened entry shows its own options — for the visit; what is saved stays', async () => {
    const host = memoryHost();
    await seed(host, { type: 'ulid', count: 3 });
    const pasted = render(<UuidTool host={host} input="01ARZ3NDEKTSV4RRFFQ69G5FAV" />);
    expect((screen.getByLabelText('Paste a UUID or ULID') as HTMLInputElement).value).toBe(
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(shown('Type')).toBe('ULID');
    expect(lines()).toHaveLength(3);
    for (const line of lines()) expect(line).toMatch(ULID);
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { type: 'ulid', count: 3 } });

    const ids = ['0f0e0d0c-0b0a-4908-8706-050403020100', '00112233-4455-4677-8899-aabbccddeeff'];
    await host.history
      .forOwner('uuid', definition.history!)
      .session()
      .commit({
        kind: 'generate',
        payload: { type: 'v4', count: 2, format: 'standard', uppercase: false, ids },
        label: 'UUID v4 · 2 identifiers',
      });
    const [entry] = await entries(host);
    const opened = render(<UuidTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: UUID v4 · 2 identifiers.')).toBeTruthy();
    expect(shown('Type')).toBe('UUID v4 (random)');
    expect(count()).toBe('2');
    expect(lines()).toEqual(ids);
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { type: 'ulid', count: 3 } });
    render(<UuidTool host={host} />);
    expect(shown('Type')).toBe('ULID');
    expect(count()).toBe('3');
  });

  it('reset puts the options back to the defaults, makes a new batch — not copied, not recorded — and keeps Inspect', async () => {
    const host = memoryHost();
    await seed(host, { type: 'v7', count: 3, uppercase: true });
    render(<UuidTool host={host} />);
    expect(lines()).toHaveLength(3);
    type('Paste a UUID or ULID', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    await act(async () => host.settings!.forTool('uuid').reset());
    expect(shown('Type')).toBe('UUID v4 (random)');
    expect(count()).toBe('1');
    expect(result()).toMatch(V4);
    expect((screen.getByLabelText('Paste a UUID or ULID') as HTMLInputElement).value).toBe(
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(savedOf(host)).toBeUndefined();
    await act(async () => undefined);
    expect(writeText).not.toHaveBeenCalled();
    expect(await entries(host)).toHaveLength(0);
  });
});
