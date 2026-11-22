// The logic against an independent implementation already on this machine (docs/tools/specs/subnet.md §10, §15):
// Python's `ipaddress` (3.13 or newer — its special-purpose tables were rewritten from the IANA registries in 3.13).
// Thousands of generated blocks, addresses and ranges of both families; every result the two share is compared, and a
// difference fails the run unless it is one of the explained classes below (each counted and printed). Not part of
// `pnpm check`: it needs python3, installs nothing and skips without it.
// Run: pnpm --filter @workspace/tool-logic-subnet exec vitest run --config scripts/cross-check.config.mjs
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  BITS,
  embeddedIPv4,
  expandIPv6,
  formatBlock,
  formatIPv4,
  formatIPv6,
  formatValue,
  kindOf,
  lastOf,
  maskOf,
  matchAddresses,
  parseEntry,
  rangeToBlocks,
  registrations,
  reverseName,
  splitRows,
  summarize,
  usableHosts,
} from '../src/index.ts';

const version = spawnSync(
  'python3',
  ['-I', '-c', 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'],
  {
    encoding: 'utf8',
  },
);
const PYTHON = version.status === 0 && Number(version.stdout.trim()) >= 313;

const seeded = seed => () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), seed);
const next = seeded(0xc1d2);
const below = n => next() % n;
const bits = n => {
  let v = 0n;
  for (let i = 0; i < n; i += 32) v = (v << 32n) | BigInt(next());
  return v & ((1n << BigInt(n)) - 1n);
};
const max = family => (1n << BigInt(BITS[family])) - 1n;
const fam = () => (below(2) ? 4 : 6);
/** An address: random, or inside a random registry entry (so every special range is visited). */
const address = family => {
  const entries = registrations().filter(p => p.family === family);
  if (below(3) === 0) return bits(BITS[family]);
  const p = entries[below(entries.length)];
  const span = p.last - p.first;
  return p.first + (span === 0n ? 0n : bits(BITS[family]) % (span + 1n));
};
const blockAround = family => {
  const prefix = below(BITS[family] + 1);
  const value = address(family);
  return { family, network: value & maskOf(family, prefix), prefix, value };
};

const PY = String.raw`
import ipaddress as ip, json, sys, itertools
data = json.load(sys.stdin)
A = ip.ip_address; N = lambda s: ip.ip_network(s, strict=False)
out = {}
def flags(a):
    r = {'multicast': a.is_multicast, 'loopback': a.is_loopback, 'link_local': a.is_link_local,
         'unspecified': a.is_unspecified, 'reserved': a.is_reserved, 'global': a.is_global}
    if a.version == 6:
        r['site_local'] = a.is_site_local
        r['mapped'] = str(a.ipv4_mapped) if a.ipv4_mapped else None
        r['sixtofour'] = str(a.sixtofour) if a.sixtofour else None
        r['teredo'] = [str(x) for x in a.teredo] if a.teredo else None
        r['text'] = str(a); r['exploded'] = a.exploded
    r['reverse'] = a.reverse_pointer
    return r
res = []
for b in data['blocks']:
    n = N(b)
    r = {'network': str(n.network_address), 'prefix': n.prefixlen, 'last': str(n.broadcast_address),
         'netmask': str(n.netmask), 'hostmask': str(n.hostmask), 'num': str(n.num_addresses)}
    g = n.hosts()
    first = next(iter(g), None)
    r['first_host'] = str(first) if first is not None else None
    if n.num_addresses <= 65536:
        hs = list(n.hosts()); r['hosts'] = [len(hs), str(hs[0]), str(hs[-1])]
    res.append(r)
out['blocks'] = res
out['flags'] = [flags(A(a)) for a in data['addresses']]
out['member'] = [A(a) in N(b) for a, b in data['pairs']]
sub = []
for b, q in data['subnets']:
    g = N(b).subnets(new_prefix=q)
    sub.append([str(x) for x in itertools.islice(g, 0, 1024)])
out['subnets'] = sub
out['ranges'] = [[str(x) for x in ip.summarize_address_range(A(a), A(z))] for a, z in data['ranges']]
out['collapse'] = [[str(x) for x in ip.collapse_addresses([N(x) for x in lst])] for lst in data['collapse']]
json.dump(out, sys.stdout)
`;

const counts = {};
const count = name => (counts[name] = (counts[name] ?? 0) + 1);
const explained = {};
const explain = (why, example) => {
  explained[why] ??= { n: 0, example };
  explained[why].n++;
};

describe.runIf(PYTHON)('Python ipaddress', () => {
  it('agrees on every shared result, or the difference is explained', () => {
    const blocks = [];
    for (let i = 0; i < 3_000; i++) blocks.push(blockAround(fam()));
    blocks.push(
      { family: 4, network: 0n, prefix: 0, value: 0n },
      { family: 6, network: 0n, prefix: 0, value: 0n },
      { family: 4, network: max(4), prefix: 32, value: max(4) },
      { family: 6, network: max(6), prefix: 128, value: max(6) },
    );
    const addresses = [];
    for (let i = 0; i < 4_000; i++) {
      const family = fam();
      addresses.push({ family, value: address(family) });
    }
    // Every special address the registries name, and the IPv4-in-IPv6 forms.
    addresses.push(
      ...[
        '::ffff:192.0.2.1',
        '::ffff:0:192.0.2.1',
        '64:ff9b::192.0.2.33',
        '2002:c000:201::1',
        '2001:0:4136:e378:8000:63bf:3fff:fdd2',
        '::192.0.2.1',
      ].map(t => {
        const e = parseEntry(t);
        return { family: 6, value: e.entry.block.network };
      }),
    );
    const pairs = [];
    for (let i = 0; i < 4_000; i++) {
      const b = blocks[below(blocks.length)];
      const v = below(2) ? b.network + (bits(BITS[b.family]) % (lastOf(b) - b.network + 2n)) : address(b.family);
      pairs.push({ b, value: v > max(b.family) ? max(b.family) : v });
    }
    const subnets = [];
    for (let i = 0; i < 600; i++) {
      const b = blocks[below(blocks.length)];
      const q = Math.min(BITS[b.family], b.prefix + below(11));
      subnets.push({ b, q });
    }
    const ranges = [];
    for (let i = 0; i < 3_000; i++) {
      const family = fam();
      let a = address(family);
      let z = below(2) ? a + bits(below(BITS[family])) : address(family);
      if (z > max(family)) z = max(family);
      if (z < a) [a, z] = [z, a];
      ranges.push({ family, first: a, last: z });
    }
    const collapse = [];
    for (let i = 0; i < 500; i++) {
      const family = fam();
      const lst = [];
      const base = blockAround(family);
      for (let k = 0, n = 1 + below(40); k < n; k++) {
        const prefix = Math.min(BITS[family], base.prefix + below(9));
        const v = base.network + (bits(BITS[family]) % (lastOf(base) - base.network + 1n));
        lst.push({ family, network: v & maskOf(family, prefix), prefix });
      }
      collapse.push(lst);
    }

    const text = (family, v) => formatValue(family, v);
    const input = {
      blocks: blocks.map(b => `${text(b.family, b.value)}/${b.prefix}`),
      addresses: addresses.map(a => text(a.family, a.value)),
      pairs: pairs.map(p => [text(p.b.family, p.value), formatBlock(p.b)]),
      subnets: subnets.map(s => [formatBlock(s.b), s.q]),
      ranges: ranges.map(r => [text(r.family, r.first), text(r.family, r.last)]),
      collapse: collapse.map(l => l.map(formatBlock)),
    };
    const run = spawnSync('python3', ['-I', '-c', PY], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
    expect(run.status, run.stderr).toBe(0);
    const py = JSON.parse(run.stdout);

    // Blocks, read from text with host bits.
    blocks.forEach((b, i) => {
      const read = parseEntry(input.blocks[i]);
      expect(read.ok).toBe(true);
      const block = read.entry.block;
      const p = py.blocks[i];
      const same = (name, ours, theirs) => {
        count(name);
        expect(ours, `${name} of ${input.blocks[i]}`).toBe(theirs);
      };
      same('network', text(block.family, block.network), p.network);
      same('prefix', block.prefix, p.prefix);
      same('last / broadcast', text(block.family, lastOf(block)), p.last);
      same('netmask', text(block.family, maskOf(block.family, block.prefix)), p.netmask);
      same('hostmask', text(block.family, maskOf(block.family, block.prefix) ^ max(block.family)), p.hostmask);
      same('number of addresses', (lastOf(block) - block.network + 1n).toString(), p.num);
      const hosts = usableHosts(block);
      same('first host', text(block.family, hosts.first), p.first_host);
      if (p.hosts) {
        same('host count', hosts.count.toString(), String(p.hosts[0]));
        same('last host', text(block.family, hosts.last), p.hosts[2]);
      }
    });

    // Flags and text of addresses.
    const ourFlags = (family, value) => {
      const kind = kindOf({ family, network: value, prefix: BITS[family] });
      const inside = name => kind.within.some(e => e.name === name);
      return {
        kind,
        multicast: inside('Multicast'),
        loopback: inside('Loopback') || inside('Loopback Address'),
        link_local: inside('Link Local') || inside('Link-Local Unicast'),
        unspecified: family === 4 ? value === 0n : inside('Unspecified Address'),
        reserved: family === 4 ? inside('Reserved') : inside('Reserved by IETF'),
        global: kind.reachable,
      };
    };
    addresses.forEach((a, i) => {
      const p = py.flags[i];
      // Python 3.13+ answers the flags of an IPv4-mapped address for the IPv4 address inside; this tool calls it IPv6
      // (§5 п. 2). Compared, then, with this tool's flags of that IPv4 address.
      const mapped = a.family === 6 && a.value >> 32n === 0xffffn;
      const f = mapped ? ourFlags(4, a.value & 0xffffffffn) : ourFlags(a.family, a.value);
      if (mapped)
        explain(
          'IPv4-mapped: Python answers the flags for the IPv4 address inside (compared with ours of it)',
          input.addresses[i],
        );
      const kind = f.kind;
      const label = `${input.addresses[i]} (${kind.name})`;
      const flag = name => {
        count(`flag ${name}`);
        expect(f[name], `${name} of ${label}`).toBe(p[name]);
      };
      for (const name of ['multicast', 'loopback', 'link_local', 'unspecified', 'reserved']) flag(name);
      count('reverse DNS name');
      expect(reverseName(a.family, a.value)).toBe(p.reverse);
      // Globally reachable: compared where the registries state it.
      count('flag global');
      const ours = f.global;
      if (ours !== p.global) {
        const why =
          ours === undefined
            ? `${kind.name}: the registries state no reachability (Python: ${p.global})`
            : `${kind.name}: registry says ${ours}, Python ${p.global}`;
        explain(why, label);
      }
      if (a.family === 6) {
        count('flag site_local');
        expect(
          kindOf({ family: 6, network: a.value, prefix: 128 }).within.some(e => e.name === 'Site-Local (deprecated)'),
        ).toBe(p.site_local);
        const embedded = embeddedIPv4(a.value);
        count('IPv4-mapped / 6to4 / Teredo');
        if (p.mapped) expect(embedded).toBe(`${p.mapped} (IPv4-mapped, RFC 4291)`);
        else if (p.teredo) expect(embedded).toBe(`server ${p.teredo[0]}, client ${p.teredo[1]} (Teredo, RFC 4380)`);
        else if (p.sixtofour) expect(embedded).toBe(`${p.sixtofour} (6to4, RFC 3056)`);
        else if (embedded)
          explain(`embedded IPv4 Python does not name: ${embedded.replace(/^.*\(/, '(')}`, input.addresses[i]);
        count('canonical IPv6 text');
        const canonical = formatIPv6(a.value);
        if (canonical !== p.text) {
          expect(a.value >> 32n, `canonical text of ${p.text}: ${canonical}`).toBe(0xffff0000n);
          explain(
            'IPv4-translated ::ffff:0:0:0/96 written mixed by RFC 5952 §5 (Python: hex)',
            `${canonical} / ${p.text}`,
          );
        }
        count('expanded IPv6 text');
        const expanded = expandIPv6(a.value);
        if (expanded !== p.exploded) {
          expect(a.value >> 32n, `expanded text of ${p.text}`).toBe(0xffffn);
          explain('IPv4-mapped expanded: all hex here, Python keeps the dotted tail', `${expanded} / ${p.exploded}`);
        }
      }
    });

    // Membership.
    const byBlock = matchAddresses(
      pairs.map(p => ({ family: p.b.family, value: p.value })),
      [],
    );
    expect(byBlock).toHaveLength(pairs.length);
    pairs.forEach((p, i) => {
      count('membership');
      const row = matchAddresses(
        [{ family: p.b.family, value: p.value }],
        [{ family: p.b.family, first: p.b.network, last: lastOf(p.b) }],
      )[0];
      expect(row.count === 1, `${input.pairs[i]}`).toBe(py.member[i]);
    });

    // Subnets (the first 1,024 of each split).
    subnets.forEach((s, i) => {
      count('subnets');
      const total = 1n << BigInt(s.q - s.b.prefix);
      expect(
        splitRows(s.b, s.q, 0n, 1_024, total).map(r => r.subnet),
        `${input.subnets[i]}`,
      ).toEqual(py.subnets[i]);
    });

    // summarize_address_range and collapse_addresses.
    ranges.forEach((r, i) => {
      count('summarize_address_range');
      expect(rangeToBlocks(r).map(formatBlock), `${input.ranges[i]}`).toEqual(py.ranges[i]);
    });
    collapse.forEach((lst, i) => {
      count('collapse_addresses');
      const ours = summarize(lst.map(b => ({ family: b.family, first: b.network, last: lastOf(b) }))).blocks.map(
        formatBlock,
      );
      expect(ours, `${input.collapse[i]}`).toEqual(py.collapse[i]);
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const lines = [
      `Python ${version.stdout.trim()}: ${total} comparisons`,
      ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`),
      'explained differences:',
      ...Object.entries(explained).map(([k, v]) => `  ${v.n} × ${k} — e.g. ${v.example}`),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    expect(formatIPv4(0n)).toBe('0.0.0.0');
  });
});
