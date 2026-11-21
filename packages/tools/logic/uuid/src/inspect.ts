/**
 * What Inspect shows for a parsed identifier (docs/tools/specs/uuid.md §5.7, §8): rows of a name and a value, in the
 * order of §8, only the rows this kind of identifier has. The texts are the specification's, word for word; the
 * component only lays them out. Times are three lines: ISO 8601 UTC (the shared `formatIsoUtc`), the readable local
 * form and the relative one (@workspace/tools-shared/time).
 */
import {
  encodeUlid,
  formatUuid,
  GREGORIAN_OFFSET,
  gregorianToMs,
  UNKNOWN_VERSION,
  VARIANT_NAMES,
  VERSION_NAMES,
} from './logic';
import { formatIsoUtc, formatReadable, relativeTime } from '@workspace/tools-shared/time';
import type { Parsed } from './logic';

export interface InspectRow {
  label: string;
  /** The value; for a time, its ISO form (the lines follow in `lines`). */
  value: string;
  /** More lines under the value: a time's local and relative forms. */
  lines?: string[];
  /** An identifier, hex or an instant: shown in the code font. */
  code?: boolean;
  /** A copy button with this accessible name. */
  copy?: string;
  /** A muted remark under the value. */
  note?: string;
}

export const NIL_TEXT = 'Nil UUID (RFC 9562 §5.9)';
export const MAX_TEXT = 'Max UUID (RFC 9562 §5.10)';
export const AS_ULID_NOTE = 'Same 128 bits in ULID notation; the time in it is meaningful only for UUID v7.';
export const AS_UUID_NOTE = 'This UUID notation has no RFC 9562 version: ULID bits are not laid out as a UUID.';
export const MULTICAST_NOTE = 'random node (multicast bit set, RFC 9562 §6.10)';
export const COUNTER_NOTE = 'A generator may keep a counter in rand_a and rand_b (RFC 9562 §6.2).';

const FIELDS_TEXT: Readonly<Record<number, string>> = {
  2: 'DCE Security: fields are not decoded.',
  3: "Name-based: the name can't be recovered from the UUID.",
  4: '122 random bits',
  5: "Name-based: the name can't be recovered from the UUID.",
  8: 'Custom layout: only version and variant are defined.',
};

export interface TimeOptions {
  /** The time now, for "3 years ago". */
  nowMs: number;
  /** The readable form's locale and zone; undefined: the browser's. */
  locale?: string;
  timeZone?: string;
}

const timeRow = (epochNs: bigint, epochMs: number, { nowMs, locale, timeZone }: TimeOptions): InspectRow => {
  const local = formatReadable(epochMs, timeZone, locale);
  return {
    label: 'Time',
    value: formatIsoUtc(epochNs),
    code: true,
    lines: [...(local === null ? [] : [local]), relativeTime(epochMs, nowMs)],
    copy: 'Copy time',
  };
};

/** "UUID v7", "UUID", "ULID", "Nil UUID": what an identifier is, in a few words (a History label). */
export const kindLabel = (parsed: Parsed): string =>
  parsed.kind === 'ulid'
    ? 'ULID'
    : parsed.special === 'nil'
      ? 'Nil UUID'
      : parsed.special === 'max'
        ? 'Max UUID'
        : parsed.version !== undefined
          ? `UUID v${parsed.version}`
          : 'UUID';

/** The canonical text of an identifier: a UUID as Standard in lowercase, a ULID in uppercase. */
export const canonical = (parsed: Parsed): string =>
  parsed.kind === 'ulid' ? encodeUlid(parsed.bytes) : formatUuid(parsed.bytes, 'standard', false);

/** The rows of §8 for one parsed identifier. */
export const inspectRows = (parsed: Parsed, time: TimeOptions): InspectRow[] => {
  if (parsed.kind === 'ulid') {
    const asUuid = formatUuid(parsed.bytes, 'standard', false);
    const laidOut = parsed.bytes[6]! >> 4 === 7 && parsed.bytes[8]! >> 6 === 2;
    return [
      { label: 'Kind', value: 'ULID' },
      { label: 'Standard', value: encodeUlid(parsed.bytes), code: true, copy: 'Copy standard' },
      timeRow(BigInt(parsed.timeMs) * 1_000_000n, parsed.timeMs, time),
      { label: 'Random', value: parsed.random, code: true },
      { label: 'As UUID', value: asUuid, code: true, copy: 'Copy as UUID', ...(laidOut ? {} : { note: AS_UUID_NOTE }) },
    ];
  }

  const rows: InspectRow[] = [
    {
      label: 'Kind',
      value: parsed.special === 'nil' ? NIL_TEXT : parsed.special === 'max' ? MAX_TEXT : 'UUID',
    },
    { label: 'Standard', value: formatUuid(parsed.bytes, 'standard', false), code: true, copy: 'Copy standard' },
  ];
  if (!parsed.special) {
    rows.push(
      {
        label: 'Version',
        value:
          parsed.version === undefined
            ? 'Not defined for this variant'
            : `${parsed.version} — ${VERSION_NAMES[parsed.version] ?? UNKNOWN_VERSION}`,
      },
      { label: 'Variant', value: VARIANT_NAMES[parsed.variant] },
    );
    const f = parsed.fields;
    if (f.type === 'gregorian') {
      rows.push(
        timeRow((f.time100ns - GREGORIAN_OFFSET) * 100n, gregorianToMs(f.time100ns), time),
        { label: 'Clock sequence', value: `${f.clockSeq} (0x${f.clockSeq.toString(16)})` },
        { label: 'Node', value: f.node, code: true, ...(f.multicast ? { note: MULTICAST_NOTE } : {}) },
      );
    } else if (f.type === 'unix') {
      rows.push(
        timeRow(BigInt(f.timeMs) * 1_000_000n, f.timeMs, time),
        { label: 'rand_a', value: f.randA, code: true },
        { label: 'rand_b', value: f.randB, code: true, note: COUNTER_NOTE },
      );
    } else if (parsed.version !== undefined && FIELDS_TEXT[parsed.version]) {
      rows.push({ label: 'Fields', value: FIELDS_TEXT[parsed.version]! });
    }
  }
  rows.push({
    label: 'As ULID',
    value: encodeUlid(parsed.bytes),
    code: true,
    copy: 'Copy as ULID',
    note: AS_ULID_NOTE,
  });
  return rows;
};
