/**
 * A block explained (docs/tools/specs/subnet.md §5 п. 13–16): the rows Explain shows, each with what its copy button
 * copies. Counts are exact — digit groups and the power of two — and from a million on also in words of the short scale,
 * rounded with integer arithmetic.
 */
import {
  BITS,
  binaryOf,
  expandIPv6,
  formatAddress,
  formatIPv4,
  formatIPv6,
  formatValue,
  hexOf,
  reverseName,
} from './address';
import { blockSize, formatBlock, lastOf, maskOf, usableHosts } from './block';
import { embeddedIPv4, kindOf } from './kinds';
import type { Block, Entry, Note } from './block';

export interface Row {
  id: string;
  label: string;
  /** What the page shows. */
  value: string;
  /** What the copy button copies (numbers without digit groups). */
  copy: string;
  /** A second line under the value: the rule, the source. */
  extra?: string;
}

export interface Explanation {
  block: Block;
  rows: Row[];
  /** The binary row's bits and how many of its characters are the network part. */
  binary: { bits: string; networkChars: number; words: string };
  notes: Note[];
}

/** 1234567 → '1,234,567'. */
export const groupDigits = (n: bigint): string => {
  const s = (n < 0n ? -n : n).toString();
  const out: string[] = [];
  for (let end = s.length; end > 0; end -= 3) out.unshift(s.slice(Math.max(0, end - 3), end));
  return (n < 0n ? '-' : '') + out.join(',');
};

const SCALE = [
  '',
  'thousand',
  'million',
  'billion',
  'trillion',
  'quadrillion',
  'quintillion',
  'sextillion',
  'septillion',
  'octillion',
  'nonillion',
  'decillion',
  'undecillion',
];

/** 'about 340.3 undecillion' from a million on (one decimal, half rounded up, integers only); '' below. */
export const inWords = (n: bigint): string => {
  if (n < 1_000_000n) return '';
  let group = Math.floor((n.toString().length - 1) / 3);
  for (;;) {
    let unit = 1n;
    for (let i = 0; i < group; i++) unit *= 1000n;
    const tenths = (n * 20n + unit) / (2n * unit);
    if (tenths >= 10_000n && group + 1 < SCALE.length) {
      group++;
      continue;
    }
    return `about ${tenths / 10n}.${tenths % 10n} ${SCALE[group]}`;
  }
};

const powerOfTwo = (n: bigint): number | null => (n > 0n && (n & (n - 1n)) === 0n ? n.toString(2).length - 1 : null);

/** '1,024 (2^10)', '4,294,967,296 (2^32, about 4.3 billion)', '1,022', '4,294,967,294 (about 4.3 billion)'. */
export const countText = (n: bigint, power = true): string => {
  const k = power ? powerOfTwo(n) : null;
  const words = inWords(n);
  const inside = [k === null ? '' : `2^${k}`, words].filter(Boolean).join(', ');
  return inside ? `${groupDigits(n)} (${inside})` : groupDigits(n);
};

const row = (id: string, label: string, value: string, copy = value, extra?: string): Row =>
  extra === undefined ? { id, label, value, copy } : { id, label, value, copy, extra };

/** The rows of §5 п. 13 for a block read by `parseEntry`. */
export const explain = (entry: Extract<Entry, { kind: 'block' }>): Explanation => {
  const { block } = entry;
  const { family, prefix } = block;
  const bits = BITS[family];
  const last = lastOf(block);
  const size = blockSize(block);
  const hosts = usableHosts(block);
  const mask = maskOf(family, prefix);
  const subject = entry.address?.value ?? block.network;
  const rows: Row[] = [];

  rows.push(row('network', 'Network', formatBlock(block)));
  rows.push(row('netmask', 'Netmask', formatValue(family, mask)));
  if (family === 4) rows.push(row('wildcard', 'Wildcard mask', formatIPv4(mask ^ 0xffffffffn)));
  rows.push(row('prefix', 'Prefix length', String(prefix)));
  rows.push(row('first', 'First address', formatValue(family, block.network)));
  rows.push(row('last', 'Last address', formatValue(family, last)));
  if (family === 4) {
    if (prefix <= 30) rows.push(row('broadcast', 'Broadcast', formatIPv4(last)));
    else
      rows.push(
        row(
          'broadcast',
          'Broadcast',
          prefix === 31 ? 'None: a /31 has no broadcast address (RFC 3021).' : 'None: a /32 is one address.',
          '',
        ),
      );
  }
  const range =
    hosts.first === hosts.last
      ? formatValue(family, hosts.first)
      : `${formatValue(family, hosts.first)} – ${formatValue(family, hosts.last)}`;
  rows.push(row('hosts', 'Usable hosts', range));
  rows.push(row('host-count', 'Usable host count', countText(hosts.count, false), hosts.count.toString(), hosts.rule));
  rows.push(row('addresses', 'Addresses', countText(size), size.toString()));
  if (family === 6 && prefix < 64) {
    const networks = 1n << BigInt(64 - prefix);
    rows.push(row('networks64', '/64 networks', countText(networks), networks.toString()));
  }
  if (entry.address) rows.push(row('address', 'Address', formatAddress({ ...entry.address, zone: undefined })));
  if (entry.address?.zone !== undefined) rows.push(row('zone', 'Zone', entry.address.zone));

  const binary = binaryOf(family, subject);
  const group = family === 4 ? 8 : 16;
  const networkChars = prefix === 0 ? 0 : prefix + Math.floor((prefix - 1) / group);
  const words =
    prefix === 0
      ? `All ${bits} bits are the host.`
      : prefix === bits
        ? `All ${bits} bits are the network.`
        : `The first ${prefix} bits are the network, the last ${bits - prefix} the host.`;
  rows.push(row('binary', 'Binary', binary, binary, words));
  if (family === 6) {
    rows.push(row('canonical', 'Canonical', formatIPv6(subject, entry.address?.zone), undefined, 'RFC 5952'));
    rows.push(row('expanded', 'Expanded', expandIPv6(subject)));
  }
  rows.push(row('integer', 'Integer', subject.toString()));
  rows.push(row('hex', 'Hex', hexOf(family, subject)));
  rows.push(
    row('reverse', 'Reverse DNS name', reverseName(family, subject), undefined, 'The name only: nothing is looked up.'),
  );
  if (family === 6 && prefix === 128) {
    const embedded = embeddedIPv4(subject);
    if (embedded) rows.push(row('embedded', 'Embedded IPv4', embedded));
  }
  const kind = kindOf(block);
  rows.push(row('kind', 'Kind', kind.name, kind.name, kind.detail));
  return { block, rows, binary: { bits: binary, networkChars, words }, notes: entry.notes };
};
