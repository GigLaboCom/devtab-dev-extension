import { AS_ULID_NOTE, AS_UUID_NOTE, COUNTER_NOTE, inspectRows, kindLabel, MULTICAST_NOTE } from './inspect';
import { parseId } from './logic';
import { describe, expect, it } from 'vitest';
import type { InspectRow } from './inspect';

// docs/tools/specs/uuid.md §2 scenarios 4–7, §5.7 and §8: the rows Inspect shows, texts word for word.
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const time = { nowMs: NOW, locale: 'en-US', timeZone: 'UTC' };
const rows = (text: string): InspectRow[] => {
  const r = parseId(text);
  if (!r.ok) throw new Error(r.message);
  return inspectRows(r.value, time);
};
const table = (text: string) => Object.fromEntries(rows(text).map(r => [r.label, r.value]));
const row = (text: string, label: string) => rows(text).find(r => r.label === label);

describe('Inspect rows', () => {
  it('§2.4: a v7 from a log', () => {
    expect(table('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toEqual({
      Kind: 'UUID',
      Standard: '017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
      Version: '7 — Unix time-based',
      Variant: 'RFC 9562',
      Time: '2022-02-22T19:22:22Z',
      rand_a: 'cc3',
      rand_b: '18c4dc0c0c07398f',
      'As ULID': '01FWHE4YDGFK1SHH6W1G60EECF',
    });
    expect(row('017F22E2-79B0-7CC3-98C4-DC0C0C07398F', 'Time')?.lines).toEqual([
      'Feb 22, 2022, 7:22:22 PM UTC',
      '4 years ago',
    ]);
    expect(row('017F22E2-79B0-7CC3-98C4-DC0C0C07398F', 'rand_b')?.note).toBe(COUNTER_NOTE);
    expect(row('017F22E2-79B0-7CC3-98C4-DC0C0C07398F', 'As ULID')?.note).toBe(AS_ULID_NOTE);
  });

  it('§2.5: a ULID — its UUID notation has no RFC version', () => {
    expect(table('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toEqual({
      Kind: 'ULID',
      Standard: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      Time: '2016-07-30T23:54:10.259Z',
      Random: 'd6764c61efb99302bd5b',
      'As UUID': '01563e3a-b5d3-d676-4c61-efb99302bd5b',
    });
    expect(row('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'As UUID')?.note).toBe(AS_UUID_NOTE);
  });

  it('a ULID made from a v7’s bits has a UUID notation with version 7: no remark', () => {
    expect(row('01FWHE4YDGFK1SHH6W1G60EECF', 'As UUID')).toMatchObject({
      value: '017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
    });
    expect(row('01FWHE4YDGFK1SHH6W1G60EECF', 'As UUID')?.note).toBeUndefined();
  });

  it('§2.6: a v1 — time, clock sequence, node with the multicast remark', () => {
    const t = table('C232AB00-9414-11EC-B3C8-9F6BDECED846');
    expect(t).toMatchObject({
      Version: '1 — Gregorian time-based',
      Time: '2022-02-22T19:22:22Z',
      'Clock sequence': '13256 (0x33c8)',
      Node: '9f:6b:de:ce:d8:46',
    });
    expect(row('C232AB00-9414-11EC-B3C8-9F6BDECED846', 'Node')?.note).toBe(MULTICAST_NOTE);
    expect(row('C232AB00-9414-11EC-B3C8-9E6BDECED846', 'Node')?.note).toBeUndefined();
  });

  it('a v6 shows the time and fields of the v1', () => {
    expect(table('1EC9414C-232A-6B00-B3C8-9F6BDECED846')).toMatchObject({
      Version: '6 — Reordered Gregorian time-based',
      Time: '2022-02-22T19:22:22Z',
      'Clock sequence': '13256 (0x33c8)',
    });
  });

  it.each([
    ['3b2f8c1e-9d4a-4f6b-8a2e-5c7d9e0f1a2b', '4 — Random', '122 random bits'],
    [
      '5df41881-3aed-3515-88a7-2f4a814cf09e',
      '3 — Name-based (MD5)',
      "Name-based: the name can't be recovered from the UUID.",
    ],
    [
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
      '5 — Name-based (SHA-1)',
      "Name-based: the name can't be recovered from the UUID.",
    ],
    ['000003e8-1234-21ec-8000-000000000000', '2 — DCE Security', 'DCE Security: fields are not decoded.'],
    ['017f22e2-79b0-8cc3-98c4-dc0c0c07398f', '8 — Custom', 'Custom layout: only version and variant are defined.'],
  ])('%s: %s — %s', (text, version, fields) => {
    expect(table(text)).toMatchObject({ Version: version, Fields: fields });
    expect(table(text).Time).toBeUndefined();
  });

  it('§6: version 0 and 9–15 are unknown; another variant has no version', () => {
    expect(table('017f22e2-79b0-0cc3-98c4-dc0c0c07398f').Version).toBe('0 — Unknown (not defined by RFC 9562)');
    expect(table('017f22e2-79b0-fcc3-98c4-dc0c0c07398f').Version).toBe('15 — Unknown (not defined by RFC 9562)');
    expect(table('017f22e2-79b0-7cc3-08c4-dc0c0c07398f')).toMatchObject({
      Version: 'Not defined for this variant',
      Variant: 'NCS (reserved)',
    });
    expect(table('017f22e2-79b0-7cc3-c8c4-dc0c0c07398f').Variant).toBe('Microsoft (reserved)');
    expect(table('017f22e2-79b0-7cc3-e8c4-dc0c0c07398f').Variant).toBe('Reserved for future use');
  });

  it('nil and max: no version, no variant', () => {
    expect(table('00000000-0000-0000-0000-000000000000')).toEqual({
      Kind: 'Nil UUID (RFC 9562 §5.9)',
      Standard: '00000000-0000-0000-0000-000000000000',
      'As ULID': '00000000000000000000000000',
    });
    expect(table('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF').Kind).toBe('Max UUID (RFC 9562 §5.10)');
  });

  it('the largest ULID: the extended year in ISO, the local and relative lines', () => {
    const t = row('7ZZZZZZZZZZZZZZZZZZZZZZZZZ', 'Time');
    expect(t?.value).toBe('+010889-08-02T05:31:50.655Z');
    expect(t?.lines?.[1]).toBe('in 8,868 years'); // years of 365 days (the shared relativeTime)
  });

  it('copy buttons on the values worth copying (§3): standard, the other notation, ISO time', () => {
    const copied = (text: string) =>
      rows(text)
        .filter(r => r.copy)
        .map(r => r.label);
    expect(copied('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toEqual(['Standard', 'Time', 'As ULID']);
    expect(copied('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toEqual(['Standard', 'Time', 'As UUID']);
  });

  it('a short label for History', () => {
    const label = (text: string) => {
      const r = parseId(text);
      return r.ok ? kindLabel(r.value) : '';
    };
    expect(label('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toBe('UUID v7');
    expect(label('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('ULID');
    expect(label('00000000-0000-0000-0000-000000000000')).toBe('Nil UUID');
    expect(label('017f22e2-79b0-7cc3-08c4-dc0c0c07398f')).toBe('UUID');
  });
});
