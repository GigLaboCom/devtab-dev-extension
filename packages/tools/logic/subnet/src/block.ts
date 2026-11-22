/**
 * Blocks, ranges and what a line of text says (docs/tools/specs/subnet.md §5 п. 9–12, 14): `address/length`,
 * `address/mask`, `address mask`, one address, `address - address`. Host bits in a block are cleared with a note; a
 * mask is a netmask or a Cisco wildcard mask, never one that is not contiguous.
 */
import {
  BITS,
  describeChar,
  fail,
  formatIPv4,
  formatValue,
  parseAddress,
  parseIPv4,
  parseIPv6,
  smallInt,
} from './address';
import type { Address, Family, TextError } from './address';

export interface Block {
  family: Family;
  network: bigint;
  prefix: number;
}

export interface Range {
  family: Family;
  first: bigint;
  last: bigint;
}

export type NoteKind = 'host-bits' | 'wildcard' | 'mask-zero' | 'mask-ones' | 'port' | 'zone';

export interface Note {
  kind: NoteKind;
  text: string;
}

export type Entry =
  | {
      kind: 'block';
      block: Block;
      /** The address as typed, when it is not just the network address: host bits set, a zone or a port. */
      address?: Address;
      notes: Note[];
      /** Written as one address, with no length and no mask. */
      fromAddress: boolean;
    }
  | { kind: 'range'; range: Range; notes: Note[] };

export type EntryResult = { ok: true; entry: Entry } | { ok: false; error: TextError };

/** The longest text a block, an address or a range is read from (the Block field, a list entry). */
export const MAX_FIELD = 1_000;

export const blockSize = (block: Block): bigint => 1n << BigInt(BITS[block.family] - block.prefix);

export const lastOf = (block: Block): bigint => block.network + blockSize(block) - 1n;

export const maskOf = (family: Family, prefix: number): bigint => {
  const all = (1n << BigInt(BITS[family])) - 1n;
  return all ^ ((1n << BigInt(BITS[family] - prefix)) - 1n);
};

export const formatBlock = (block: Block): string => `${formatValue(block.family, block.network)}/${block.prefix}`;

export const formatRange = (range: Range): string =>
  `${formatValue(range.family, range.first)} – ${formatValue(range.family, range.last)}`;

export const rangeOf = (block: Block): Range => ({ family: block.family, first: block.network, last: lastOf(block) });

const portNote = (port: number): Note => ({
  kind: 'port',
  text: `The port ${port} is not part of the address: ignored.`,
});

const ZONE_NOTE: Note = {
  kind: 'zone',
  text: 'A zone index matters only for scoped addresses such as link-local (fe80::/10).',
};

/** Zones are for link-local (fe80::/10) and multicast (ff00::/8) addresses (RFC 4007 §6). */
const scoped = (value: bigint): boolean => value >> 118n === 0x3fan || value >> 120n === 0xffn;

const bitLength = (n: bigint): number => (n === 0n ? 0 : n.toString(2).length);

/** The prefix of a contiguous IPv4 mask: a netmask (ones then zeros) first, then a wildcard (zeros then ones). */
const readMask = (mask: bigint): { prefix: number; wildcard: boolean } | null => {
  const inverted = mask ^ 0xffffffffn;
  if (((inverted + 1n) & inverted) === 0n) return { prefix: 32 - bitLength(inverted), wildcard: false };
  if (((mask + 1n) & mask) === 0n) return { prefix: 32 - bitLength(mask), wildcard: true };
  return null;
};

/** What separates an address from its mask: spaces and tabs (other invisible characters are refused by name). */
const SPACE = /[ \t]/;

/** Where `text` has leading whitespace, and the text without it on either side. */
const trimmed = (text: string, offset: number): { text: string; at: number } => {
  const start = text.length - text.trimStart().length;
  return { text: text.trim(), at: offset + start };
};

const blockEntry = (
  family: Family,
  value: bigint,
  prefix: number,
  notes: Note[],
  typed: Address,
  fromAddress: boolean,
  port?: number,
): Entry => {
  const network = value & maskOf(family, prefix);
  const block: Block = { family, network, prefix };
  const all = [...notes];
  if (network !== value)
    all.unshift({
      kind: 'host-bits',
      text: `Host bits are set: ${formatValue(family, value)}/${prefix} is the address ${formatValue(family, value)} in the block ${formatBlock(block)}.`,
    });
  if (port !== undefined) all.push(portNote(port));
  if (typed.zone !== undefined && !scoped(value)) all.push(ZONE_NOTE);
  const keep = network !== value || typed.zone !== undefined || port !== undefined;
  return keep
    ? { kind: 'block', block, address: typed, notes: all, fromAddress }
    : { kind: 'block', block, notes: all, fromAddress };
};

const parseRange = (text: string, at: number, dash: number): EntryResult => {
  const left = trimmed(text.slice(0, dash), at);
  const right = trimmed(text.slice(dash + 1), at + dash + 1);
  if (left.text === '') return fail('The range has no start before "-".', at + dash);
  if (right.text === '') return fail('The range has no end after "-".', at + dash);
  for (const side of [left, right]) {
    const slash = side.text.indexOf('/');
    const space = side.text.search(SPACE);
    if (slash !== -1 || (space !== -1 && !side.text.startsWith('[')))
      return fail('The ends of a range are addresses, not blocks.', side.at, side.at + side.text.length);
  }
  const a = parseAddress(left.text, left.at);
  if (!a.ok) return a;
  const b = parseAddress(right.text, right.at);
  if (!b.ok) return b;
  if (a.value.address.zone !== undefined || b.value.address.zone !== undefined)
    return fail('A zone index is not used in a range.', at, at + text.length);
  if (a.value.address.family !== b.value.address.family)
    return fail('Both ends of a range are of one family (IPv4 or IPv6).', at, at + text.length);
  if (a.value.address.value > b.value.address.value)
    return fail('The range ends before it starts: write the smaller address first.', at, at + text.length);
  const notes: Note[] = [];
  for (const end of [a.value, b.value]) if (end.port !== undefined) notes.push(portNote(end.port));
  return {
    ok: true,
    entry: {
      kind: 'range',
      range: { family: a.value.address.family, first: a.value.address.value, last: b.value.address.value },
      notes,
    },
  };
};

const parsePrefix = (
  text: string,
  at: number,
  family: Family,
): { ok: true; prefix: number } | { ok: false; error: TextError } => {
  if (text === '') return fail('The prefix length is missing after "/".', at - 1);
  for (let i = 0; i < text.length; i++)
    if (!/[0-9]/.test(text[i]!)) {
      const ch = String.fromCodePoint(text.codePointAt(i)!);
      return fail(`Unexpected ${describeChar(ch)} in the prefix length.`, at + i, at + i + ch.length);
    }
  if (text.length > 1 && text.startsWith('0'))
    return fail(
      `Write the prefix length without leading zeros: /${text.replace(/^0+(?=.)/, '')}.`,
      at,
      at + text.length,
    );
  const prefix = text.length > 3 ? Infinity : smallInt(text);
  if (prefix > BITS[family])
    return fail(`An IPv${family} prefix length is 0 to ${BITS[family]}; this is ${text}.`, at, at + text.length);
  return { ok: true, prefix };
};

/** The dash of a range: `-` or `–` that is not inside a zone index (`fe80::1%veth-1`). */
const rangeDash = (text: string): number => {
  let inZone = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '%') inZone = true;
    else if (ch === ' ' || ch === '\t' || ch === '/' || ch === ']') inZone = false;
    else if ((ch === '-' || ch === '–') && !inZone) return i;
  }
  return -1;
};

const V6_MASK = 'An IPv6 block takes a prefix length (/48), not a mask.';

/** One block, address or range (§5 п. 9–12); `offset` is where `raw` starts in the field. */
export const parseEntry = (raw: string, offset = 0): EntryResult => {
  const { text, at } = trimmed(raw, offset);
  if (text === '') return fail('Nothing to read.', at, at);
  if (text.length > MAX_FIELD) return fail('The block is longer than 1,000 characters.', -1, -1);

  const dash = rangeDash(text);
  if (dash !== -1) return parseRange(text, at, dash);

  const slash = text.indexOf('/');
  if (slash !== -1) {
    const again = text.indexOf('/', slash + 1);
    if (again !== -1) return fail('Only one "/" is allowed.', at + again);
    const head = text.slice(0, slash);
    const tail = text.slice(slash + 1);
    if (head.startsWith('[') || tail.includes(']'))
      return fail('Brackets hold one address (as in a URL), not a block.', at, at + text.length);
    const space = head.search(SPACE);
    if (space !== -1) return fail('Spaces inside an address are not allowed.', at + space);
    const tailSpace = tail.search(SPACE);
    if (tailSpace !== -1) {
      const ch = tail[tailSpace]!;
      return ch === ' ' || ch === '\t'
        ? fail('Spaces inside an address are not allowed.', at + slash + 1 + tailSpace)
        : fail(`Unexpected ${describeChar(ch)} in the prefix length.`, at + slash + 1 + tailSpace);
    }
    const v6 = head.includes(':') || head.includes('%');
    if (v6) {
      if (tail.includes('%') && !head.includes('%'))
        return fail(
          'The zone index comes before the prefix length (fe80::1%eth0/64).',
          at + slash + 1 + tail.indexOf('%'),
        );
      if (tail.includes(':') || tail.includes('.')) return fail(V6_MASK, at + slash + 1, at + text.length);
      if (!head.includes(':')) {
        const v4 = parseIPv4(head.slice(0, head.indexOf('%')), at);
        return v4.ok ? fail('A zone index belongs to IPv6 addresses.', at + head.indexOf('%')) : v4;
      }
      const address = parseIPv6(head, at);
      if (!address.ok) return address;
      const prefix = parsePrefix(tail, at + slash + 1, 6);
      if (!prefix.ok) return prefix;
      const typed: Address =
        address.zone === undefined
          ? { family: 6, value: address.value }
          : { family: 6, value: address.value, zone: address.zone };
      return { ok: true, entry: blockEntry(6, address.value, prefix.prefix, [], typed, false) };
    }
    const address = parseIPv4(head, at);
    if (!address.ok) return address;
    if (tail.includes('.')) return maskEntry(address.value, tail, at + slash + 1);
    const prefix = parsePrefix(tail, at + slash + 1, 4);
    if (!prefix.ok) return prefix;
    return {
      ok: true,
      entry: blockEntry(4, address.value, prefix.prefix, [], { family: 4, value: address.value }, false),
    };
  }

  const space = text.search(SPACE);
  if (space !== -1) {
    // `address mask`: one run of spaces between the two.
    const head = text.slice(0, space);
    const rest = trimmed(text.slice(space), at + space);
    const next = rest.text.search(SPACE);
    const mask = next === -1 ? rest.text : rest.text.slice(0, next);
    const address = parseAddress(head, at);
    if (!address.ok) {
      // `10. 0.0.1`: a space inside one address, not an address and a mask.
      if (parseAddress(text.replace(/[ \t]+/g, ''), at).ok || head.endsWith('.') || mask.startsWith('.'))
        return fail('Spaces inside an address are not allowed.', at + space);
      return address;
    }
    if (address.value.address.family === 6) return fail(V6_MASK, rest.at, rest.at + mask.length);
    if (address.value.port !== undefined) return fail(`Unexpected ${describeChar(mask[0]!)} after the port.`, rest.at);
    if (next !== -1) {
      const after = trimmed(rest.text.slice(next), rest.at + next);
      return fail(
        `Unexpected ${describeChar(String.fromCodePoint(after.text.codePointAt(0)!))} after the mask.`,
        after.at,
      );
    }
    return maskEntry(address.value.address.value, mask, rest.at);
  }

  const address = parseAddress(text, at);
  if (!address.ok) return address;
  const { address: typed, port } = address.value;
  return {
    ok: true,
    entry: blockEntry(typed.family, typed.value, BITS[typed.family], [], typed, true, port),
  };
};

const maskEntry = (value: bigint, maskText: string, at: number): EntryResult => {
  if (maskText.includes(':')) return fail('Unexpected ":" in the mask.', at + maskText.indexOf(':'));
  const mask = parseIPv4(maskText, at);
  if (!mask.ok) return { ok: false, error: { ...mask.error, message: `Mask: ${mask.error.message}` } };
  const read = readMask(mask.value);
  if (!read)
    return fail(
      `The mask ${formatIPv4(mask.value)} is not contiguous: a netmask is ones then zeros (255.255.0.0), a wildcard mask zeros then ones (0.0.255.255).`,
      at,
      at + maskText.length,
    );
  const notes: Note[] = [];
  if (mask.value === 0n)
    notes.push({
      kind: 'mask-zero',
      text: '0.0.0.0 is read as a netmask (/0). As a wildcard mask (Cisco) it would mean one address: write /32 for that.',
    });
  else if (mask.value === 0xffffffffn)
    notes.push({
      kind: 'mask-ones',
      text: '255.255.255.255 is read as a netmask (/32). As a wildcard mask it would mean every address: write /0 for that.',
    });
  else if (read.wildcard)
    notes.push({
      kind: 'wildcard',
      text: `${formatIPv4(mask.value)} is a wildcard mask: the block is /${read.prefix}.`,
    });
  return { ok: true, entry: blockEntry(4, value, read.prefix, notes, { family: 4, value }, false) };
};

export interface Hosts {
  first: bigint;
  last: bigint;
  count: bigint;
  rule: string;
}

/** The addresses a host may take (§5 п. 14) — the rule of Python's `hosts()`, said in words. */
export const usableHosts = (block: Block): Hosts => {
  const first = block.network;
  const last = lastOf(block);
  const bits = BITS[block.family];
  if (block.prefix === bits) return { first, last, count: 1n, rule: 'The one address.' };
  if (block.prefix === bits - 1)
    return {
      first,
      last,
      count: 2n,
      rule:
        block.family === 4
          ? 'Both addresses: a /31 is a point-to-point link (RFC 3021).'
          : 'Both addresses: a /127 is a point-to-point link (RFC 6164).',
    };
  if (block.family === 4)
    return {
      first: first + 1n,
      last: last - 1n,
      count: blockSize(block) - 2n,
      rule: 'All but the network and broadcast addresses.',
    };
  return {
    first: first + 1n,
    last,
    count: blockSize(block) - 1n,
    rule: 'All but the first, the Subnet-Router anycast address (RFC 4291 §2.6.1). IPv6 has no broadcast.',
  };
};
