/**
 * What kind of range a block is (docs/tools/specs/subnet.md §5 п. 17–19): IANA's registries copied into the package
 * — never fetched — and the IPv4 address embedded in some IPv6 addresses. Read on 2026-11-22: IPv4 and IPv6
 * Special-Purpose Address Space (both updated 2025-10-09, every entry), IPv4 Multicast Address Space (updated
 * 2026-11-06, the block and five of its parts), Internet Protocol Version 6 Address Space (the top-level allocations).
 */
import { formatIPv4, parseIPv4, parseIPv6 } from './address';
import { lastOf } from './block';
import type { Family } from './address';
import type { Block } from './block';

export const REGISTRIES_READ = '2026-11-22';

type RegistryId = 'v4-special' | 'v4-multicast' | 'v6-special' | 'v6-space';

const REGISTRY_TITLE: Record<RegistryId, string> = {
  'v4-special': 'IANA IPv4 Special-Purpose Address Space',
  'v4-multicast': 'IANA IPv4 Multicast Address Space',
  'v6-special': 'IANA IPv6 Special-Purpose Address Space',
  'v6-space': 'IANA IPv6 Address Space',
};

/**
 * One entry: its block, name and RFC as the registry writes them; `reachable` — its «Globally Reachable» column, null
 * where the registry has none for it («N/A», a deprecated entry): a wider entry's column does not apply then either.
 */
export interface Registration {
  block: string;
  name: string;
  rfc: string;
  registry: RegistryId;
  reachable?: boolean | null;
}

const r = (registry: RegistryId, block: string, name: string, rfc: string, reachable?: boolean | null): Registration =>
  reachable === undefined ? { block, name, rfc, registry } : { block, name, rfc, registry, reachable };

// IANA IPv4 Special-Purpose Address Space, every entry in the registry's order; reachable = «Globally Reachable»
// («False [1]» is false; the deprecated 6to4 relay anycast block has no columns).
const V4_SPECIAL: Registration[] = [
  r('v4-special', '0.0.0.0/8', '"This network"', 'RFC 791 §3.2', false),
  r('v4-special', '0.0.0.0/32', '"This host on this network"', 'RFC 1122 §3.2.1.3', false),
  r('v4-special', '10.0.0.0/8', 'Private-Use', 'RFC 1918', false),
  r('v4-special', '100.64.0.0/10', 'Shared Address Space (carrier-grade NAT)', 'RFC 6598', false),
  r('v4-special', '127.0.0.0/8', 'Loopback', 'RFC 1122 §3.2.1.3', false),
  r('v4-special', '169.254.0.0/16', 'Link Local', 'RFC 3927', false),
  r('v4-special', '172.16.0.0/12', 'Private-Use', 'RFC 1918', false),
  r('v4-special', '192.0.0.0/24', 'IETF Protocol Assignments', 'RFC 6890 §2.1', false),
  r('v4-special', '192.0.0.0/29', 'IPv4 Service Continuity Prefix', 'RFC 7335', false),
  r('v4-special', '192.0.0.8/32', 'IPv4 dummy address', 'RFC 7600', false),
  r('v4-special', '192.0.0.9/32', 'Port Control Protocol Anycast', 'RFC 7723', true),
  r('v4-special', '192.0.0.10/32', 'Traversal Using Relays around NAT Anycast', 'RFC 8155', true),
  r('v4-special', '192.0.0.170/32', 'NAT64/DNS64 Discovery', 'RFC 8880, RFC 7050 §2.2', false),
  r('v4-special', '192.0.0.171/32', 'NAT64/DNS64 Discovery', 'RFC 8880, RFC 7050 §2.2', false),
  r('v4-special', '192.0.2.0/24', 'Documentation (TEST-NET-1)', 'RFC 5737', false),
  r('v4-special', '192.31.196.0/24', 'AS112-v4', 'RFC 7535', true),
  r('v4-special', '192.52.193.0/24', 'AMT', 'RFC 7450', true),
  r('v4-special', '192.88.99.0/24', 'Deprecated (6to4 Relay Anycast)', 'RFC 7526', null),
  r('v4-special', '192.88.99.2/32', '6a44-relay anycast address', 'RFC 6751', false),
  r('v4-special', '192.168.0.0/16', 'Private-Use', 'RFC 1918', false),
  r('v4-special', '192.175.48.0/24', 'Direct Delegation AS112 Service', 'RFC 7534', true),
  r('v4-special', '198.18.0.0/15', 'Benchmarking', 'RFC 2544', false),
  r('v4-special', '198.51.100.0/24', 'Documentation (TEST-NET-2)', 'RFC 5737', false),
  r('v4-special', '203.0.113.0/24', 'Documentation (TEST-NET-3)', 'RFC 5737', false),
  r('v4-special', '240.0.0.0/4', 'Reserved', 'RFC 1112 §4', false),
  r('v4-special', '255.255.255.255/32', 'Limited Broadcast', 'RFC 8190, RFC 919 §7', false),
];

// IANA IPv4 Multicast Address Space: the block and the parts named in the specification.
const V4_MULTICAST: Registration[] = [
  r('v4-multicast', '224.0.0.0/4', 'Multicast', 'RFC 5771'),
  r('v4-multicast', '224.0.0.0/24', 'Local Network Control Block', 'RFC 5771'),
  r('v4-multicast', '224.0.1.0/24', 'Internetwork Control Block', 'RFC 5771'),
  r('v4-multicast', '232.0.0.0/8', 'Source-Specific Multicast', 'RFC 4607'),
  r('v4-multicast', '233.0.0.0/8', 'GLOP', 'RFC 3180'),
  r('v4-multicast', '239.0.0.0/8', 'Administratively Scoped', 'RFC 2365'),
];

// IANA IPv6 Special-Purpose Address Space, every entry («N/A» and the deprecated ORCHID block have no reachability).
const V6_SPECIAL: Registration[] = [
  r('v6-special', '::1/128', 'Loopback Address', 'RFC 4291', false),
  r('v6-special', '::/128', 'Unspecified Address', 'RFC 4291', false),
  r('v6-special', '::ffff:0:0/96', 'IPv4-mapped Address', 'RFC 4291', false),
  r('v6-special', '64:ff9b::/96', 'IPv4-IPv6 Translation', 'RFC 6052', true),
  r('v6-special', '64:ff9b:1::/48', 'IPv4-IPv6 Translation', 'RFC 8215', false),
  r('v6-special', '100::/64', 'Discard-Only Address Block', 'RFC 6666', false),
  r('v6-special', '100:0:0:1::/64', 'Dummy IPv6 Prefix', 'RFC 9780', false),
  r('v6-special', '2001::/23', 'IETF Protocol Assignments', 'RFC 2928', false),
  r('v6-special', '2001::/32', 'TEREDO', 'RFC 4380, RFC 8190', null),
  r('v6-special', '2001:1::1/128', 'Port Control Protocol Anycast', 'RFC 7723', true),
  r('v6-special', '2001:1::2/128', 'Traversal Using Relays around NAT Anycast', 'RFC 8155', true),
  r('v6-special', '2001:1::3/128', 'DNS-SD Service Registration Protocol Anycast', 'RFC 9665', true),
  r('v6-special', '2001:2::/48', 'Benchmarking', 'RFC 5180', false),
  r('v6-special', '2001:3::/32', 'AMT', 'RFC 7450', true),
  r('v6-special', '2001:4:112::/48', 'AS112-v6', 'RFC 7535', true),
  r('v6-special', '2001:10::/28', 'Deprecated (previously ORCHID)', 'RFC 4843', null),
  r('v6-special', '2001:20::/28', 'ORCHIDv2', 'RFC 7343', true),
  r('v6-special', '2001:30::/28', 'Drone Remote ID Protocol Entity Tags (DETs) Prefix', 'RFC 9374', true),
  r('v6-special', '2001:db8::/32', 'Documentation', 'RFC 3849', false),
  r('v6-special', '2002::/16', '6to4', 'RFC 3056', null),
  r('v6-special', '2620:4f:8000::/48', 'Direct Delegation AS112 Service', 'RFC 7534', true),
  r('v6-special', '3fff::/20', 'Documentation', 'RFC 9637', false),
  r('v6-special', '5f00::/16', 'Segment Routing (SRv6) SIDs', 'RFC 9602', false),
  r('v6-special', 'fc00::/7', 'Unique-Local', 'RFC 4193, RFC 8190', false),
  r('v6-special', 'fe80::/10', 'Link-Local Unicast', 'RFC 4291', false),
];

// IANA Internet Protocol Version 6 Address Space: what is not Reserved by IETF, the two former prefixes the
// registry notes, and the reserved blocks themselves.
const V6_SPACE: Registration[] = [
  r('v6-space', '::/96', 'IPv4-compatible (deprecated)', 'RFC 4291 §2.5.5.1'),
  r('v6-space', '2000::/3', 'Global Unicast', 'RFC 4291', true),
  r('v6-space', 'fc00::/7', 'Unique Local Unicast', 'RFC 4193'),
  r('v6-space', 'fe80::/10', 'Link-Scoped Unicast', 'RFC 4291'),
  r('v6-space', 'fec0::/10', 'Site-Local (deprecated)', 'RFC 3879'),
  r('v6-space', 'ff00::/8', 'Multicast', 'RFC 4291'),
  ...[
    '::/8',
    '100::/8',
    '200::/7',
    '400::/6',
    '800::/5',
    '1000::/4',
    '4000::/3',
    '6000::/3',
    '8000::/3',
    'a000::/3',
    'c000::/3',
    'e000::/4',
    'f000::/5',
    'f800::/6',
    'fe00::/9',
  ].map(b => r('v6-space', b, 'Reserved by IETF', 'RFC 4291')),
];

interface Placed {
  entry: Registration;
  family: Family;
  first: bigint;
  last: bigint;
  prefix: number;
}

let placed: Placed[] | null = null;

const place = (entry: Registration): Placed => {
  const [text, length] = entry.block.split('/') as [string, string];
  const family: Family = text.includes(':') ? 6 : 4;
  const parsed = family === 4 ? parseIPv4(text) : parseIPv6(text);
  if (!parsed.ok) throw new Error(`bad registry entry ${entry.block}`);
  let prefix = 0;
  for (const d of length) prefix = prefix * 10 + (d.charCodeAt(0) - 48);
  const block: Block = { family, network: parsed.value, prefix };
  return { entry, family, first: parsed.value, last: lastOf(block), prefix };
};

/** Every entry of the four registries, ready to compare (built once, on first use). */
export const registrations = (): readonly Placed[] =>
  (placed ??= [...V4_SPECIAL, ...V4_MULTICAST, ...V6_SPECIAL, ...V6_SPACE].map(place));

export interface Kind {
  name: string;
  detail: string;
  /** «Globally reachable» of the narrowest entry that states it; undefined when none does. */
  reachable?: boolean;
  /** Entries that hold the whole block, narrowest first. */
  within: Registration[];
  /** Entries the block holds or touches without lying inside them. */
  holds: Registration[];
}

/** IPv6 multicast scopes by the fourth hex digit (RFC 4291 §2.7, RFC 7346). */
const SCOPES: Record<string, string> = {
  '1': 'interface-local',
  '2': 'link-local',
  '3': 'realm-local',
  '4': 'admin-local',
  '5': 'site-local',
  '8': 'organization-local',
  e: 'global',
};

const listed = (entries: Registration[]): string => {
  const shown = entries.slice(0, 5).map(e => `${e.block} ${e.name}`);
  return entries.length > 5 ? `${shown.join(', ')} and ${entries.length - 5} more` : shown.join(', ');
};

/** The narrowest registry entry that holds the whole block, and what that means (§5 п. 18). */
export const kindOf = (block: Block): Kind => {
  const first = block.network;
  const last = lastOf(block);
  const mine = registrations().filter(p => p.family === block.family);
  const within = mine
    .filter(p => p.first <= first && last <= p.last)
    .sort((a, b) => b.prefix - a.prefix)
    .map(p => p.entry);
  const holds = mine
    .filter(p => p.first <= last && first <= p.last && !(p.first <= first && last <= p.last))
    .filter(p => !(block.family === 6 && p.entry.registry === 'v6-space' && p.entry.name === 'Reserved by IETF'))
    .sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : a.prefix - b.prefix))
    .map(p => p.entry);
  const reachable = within.find(e => e.reachable !== undefined)?.reachable ?? undefined;
  const yesNo = (v: boolean | undefined): string =>
    v === undefined ? '' : ` · globally reachable: ${v ? 'yes' : 'no'}`;
  const holding = holds.length ? ` · holds ${listed(holds)}` : '';

  if (within.length === 0) {
    if (holds.length) return { name: 'Mixed', detail: `Holds ${listed(holds)}`, within, holds };
    return {
      name: 'Global unicast',
      detail: 'In no special-purpose range · globally reachable: yes',
      reachable: true,
      within,
      holds,
    };
  }
  const top = within[0]!;
  const parents = within
    .slice(1)
    .map(e => ` · in ${e.block} ${e.name}`)
    .join('');
  let scope = '';
  if (block.family === 6 && top.block === 'ff00::/8' && block.prefix >= 16) {
    const nibble = ((block.network >> 112n) & 0xfn).toString(16);
    scope = ` · scope: ${SCOPES[nibble] ?? 'reserved or unassigned'} (${nibble})`;
  }
  return {
    name: top.name,
    detail: `${top.rfc} · ${REGISTRY_TITLE[top.registry]}: ${top.block}${parents}${scope}${yesNo(reachable)}${holding}`,
    ...(reachable === undefined ? {} : { reachable }),
    within,
    holds,
  };
};

const v4 = (value: bigint): string => formatIPv4(value & 0xffffffffn);

/** The IPv4 address an IPv6 address carries (§5 п. 19), with the prefix that says so; null when it carries none. */
export const embeddedIPv4 = (value: bigint): string | null => {
  if (value >> 32n === 0xffffn) return `${v4(value)} (IPv4-mapped, RFC 4291)`;
  if (value >> 32n === 0xffff0000n) return `${v4(value)} (IPv4-translated, RFC 2765)`;
  if (value >> 32n === 0x64ff9b0000000000000000n) return `${v4(value)} (NAT64 well-known prefix, RFC 6052)`;
  if (value >> 112n === 0x2002n) return `${v4(value >> 80n)} (6to4, RFC 3056)`;
  if (value >> 96n === 0x20010000n) return `server ${v4(value >> 64n)}, client ${v4(~value)} (Teredo, RFC 4380)`;
  return null;
};
