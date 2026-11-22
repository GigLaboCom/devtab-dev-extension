// docs/tools/specs/subnet.md: every row of §10, every message of §6 word for word with its place, the notes, §7's
// detect table, and a scan of the sources for floating point on address values.
import {
  detectedTask,
  detectSubnet,
  embeddedIPv4,
  explain,
  formatBlock,
  formatIPv6,
  kindOf,
  matchCopyText,
  matchStatus,
  parseAddress,
  parseEntry,
  planSplit,
  rangeToBlocks,
  runMatch,
  runSummarize,
  splitRows,
  splitSummary,
  splitText,
  subnetAt,
} from './index';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Block, Entry } from './index';

const block = (text: string): Extract<Entry, { kind: 'block' }> => {
  const read = parseEntry(text);
  if (!read.ok) throw new Error(`${text}: ${read.error.message}`);
  if (read.entry.kind !== 'block') throw new Error(`${text}: not a block`);
  return read.entry;
};

const rows = (text: string): Record<string, string> =>
  Object.fromEntries(explain(block(text)).rows.map(r => [r.label, r.value]));

const extras = (text: string): Record<string, string | undefined> =>
  Object.fromEntries(explain(block(text)).rows.map(r => [r.label, r.extra]));

const error = (text: string): { message: string; column: number } => {
  const read = parseEntry(text);
  if (read.ok) throw new Error(`${text} was read`);
  return { message: read.error.message, column: read.error.start + 1 };
};

const notes = (text: string): string[] => block(text).notes.map(n => n.text);

describe('Explain (§10)', () => {
  it('10.0.12.5/22', () => {
    const r = rows('10.0.12.5/22');
    expect(r).toMatchObject({
      Network: '10.0.12.0/22',
      Netmask: '255.255.252.0',
      'Wildcard mask': '0.0.3.255',
      'Prefix length': '22',
      'First address': '10.0.12.0',
      'Last address': '10.0.15.255',
      Broadcast: '10.0.15.255',
      'Usable hosts': '10.0.12.1 – 10.0.15.254',
      'Usable host count': '1,022',
      Addresses: '1,024 (2^10)',
      Address: '10.0.12.5',
      Binary: '00001010.00000000.00001100.00000101',
      Integer: '167775237',
      Hex: '0x0a000c05',
      'Reverse DNS name': '5.12.0.10.in-addr.arpa',
      Kind: 'Private-Use',
    });
    expect(extras('10.0.12.5/22')['Usable host count']).toBe('All but the network and broadcast addresses.');
    expect(extras('10.0.12.5/22').Kind).toBe(
      'RFC 1918 · IANA IPv4 Special-Purpose Address Space: 10.0.0.0/8 · globally reachable: no',
    );
    expect(extras('10.0.12.5/22').Binary).toBe('The first 22 bits are the network, the last 10 the host.');
    expect(notes('10.0.12.5/22')).toEqual([
      'Host bits are set: 10.0.12.5/22 is the address 10.0.12.5 in the block 10.0.12.0/22.',
    ]);
    const copy = Object.fromEntries(explain(block('10.0.12.5/22')).rows.map(r => [r.label, r.copy]));
    expect(copy['Usable host count']).toBe('1022');
    expect(copy.Addresses).toBe('1024');
    const ex = explain(block('10.0.12.5/22'));
    expect(ex.binary.bits.slice(0, ex.binary.networkChars)).toBe('00001010.00000000.000011');
  });

  it('netmask, wildcard mask and the slash form of a mask give the same block', () => {
    for (const text of [
      '10.0.12.0 255.255.252.0',
      '10.0.12.0/255.255.252.0',
      '10.0.12.0 0.0.3.255',
      '10.0.12.0\t 0.0.3.255',
    ])
      expect(formatBlock(block(text).block)).toBe('10.0.12.0/22');
    expect(notes('10.0.12.0 255.255.252.0')).toEqual([]);
    expect(notes('10.0.12.0 0.0.3.255')).toEqual(['0.0.3.255 is a wildcard mask: the block is /22.']);
  });

  it('0.0.0.0 and 255.255.255.255 read as netmasks, with a note', () => {
    expect(formatBlock(block('10.0.0.0 0.0.0.0').block)).toBe('0.0.0.0/0');
    expect(notes('10.0.0.0 0.0.0.0')).toEqual([
      'Host bits are set: 10.0.0.0/0 is the address 10.0.0.0 in the block 0.0.0.0/0.',
      '0.0.0.0 is read as a netmask (/0). As a wildcard mask (Cisco) it would mean one address: write /32 for that.',
    ]);
    expect(formatBlock(block('10.0.0.0 255.255.255.255').block)).toBe('10.0.0.0/32');
    expect(notes('10.0.0.0 255.255.255.255')).toEqual([
      '255.255.255.255 is read as a netmask (/32). As a wildcard mask it would mean every address: write /0 for that.',
    ]);
  });

  it('192.168.1.0/24', () => {
    expect(rows('192.168.1.0/24')).toMatchObject({
      Broadcast: '192.168.1.255',
      'Usable host count': '254',
      Kind: 'Private-Use',
    });
  });

  it('/31 and /32 (RFC 3021)', () => {
    expect(rows('10.0.0.0/31')).toMatchObject({
      'Usable hosts': '10.0.0.0 – 10.0.0.1',
      'Usable host count': '2',
      Broadcast: 'None: a /31 has no broadcast address (RFC 3021).',
    });
    expect(extras('10.0.0.0/31')['Usable host count']).toBe(
      'Both addresses: a /31 is a point-to-point link (RFC 3021).',
    );
    expect(rows('10.0.0.7/32')).toMatchObject({
      'Usable hosts': '10.0.0.7',
      'Usable host count': '1',
      Broadcast: 'None: a /32 is one address.',
    });
    expect(extras('10.0.0.7/32')['Usable host count']).toBe('The one address.');
  });

  it('0.0.0.0/0', () => {
    const r = rows('0.0.0.0/0');
    expect(r.Addresses).toBe('4,294,967,296 (2^32, about 4.3 billion)');
    expect(r['Usable host count']).toBe('4,294,967,294 (about 4.3 billion)');
    expect(r.Kind).toBe('Mixed');
    expect(extras('0.0.0.0/0').Binary).toBe('All 32 bits are the host.');
    expect(extras('10.0.0.7/32').Binary).toBe('All 32 bits are the network.');
  });

  it('2001:db8::/48', () => {
    const r = rows('2001:db8::/48');
    expect(r).toMatchObject({
      Network: '2001:db8::/48',
      Netmask: 'ffff:ffff:ffff::',
      'First address': '2001:db8::',
      'Last address': '2001:db8:0:ffff:ffff:ffff:ffff:ffff',
      'Usable host count': '1,208,925,819,614,629,174,706,175 (about 1.2 septillion)',
      Addresses: '1,208,925,819,614,629,174,706,176 (2^80, about 1.2 septillion)',
      '/64 networks': '65,536 (2^16)',
      Kind: 'Documentation',
    });
    expect(r.Broadcast).toBeUndefined();
    expect(r['Wildcard mask']).toBeUndefined();
    expect(extras('2001:db8::/48')['Usable host count']).toBe(
      'All but the first, the Subnet-Router anycast address (RFC 4291 §2.6.1). IPv6 has no broadcast.',
    );
  });

  it('::/0', () => {
    const r = rows('::/0');
    expect(r.Addresses).toBe('340,282,366,920,938,463,463,374,607,431,768,211,456 (2^128, about 340.3 undecillion)');
    expect(r['Usable host count']).toBe(
      '340,282,366,920,938,463,463,374,607,431,768,211,455 (about 340.3 undecillion)',
    );
    expect(r['/64 networks']).toBe('18,446,744,073,709,551,616 (2^64, about 18.4 quintillion)');
  });

  it('::/127, ::/128, ::/126', () => {
    expect(rows('::/127')['Usable hosts']).toBe(':: – ::1');
    expect(extras('::/127')['Usable host count']).toBe('Both addresses: a /127 is a point-to-point link (RFC 6164).');
    expect(rows('::/128')['Usable hosts']).toBe('::');
    expect(rows('::/126')['Usable hosts']).toBe('::1 – ::3');
    expect(rows('::/126')['Usable host count']).toBe('3');
  });

  it('a bare address is a block of one; zone and port show as rows and notes', () => {
    expect(formatBlock(block('10.0.12.5').block)).toBe('10.0.12.5/32');
    expect(rows('10.0.12.5').Address).toBeUndefined();
    const z = rows('fe80::1%eth0');
    expect(z.Network).toBe('fe80::1/128');
    expect(z.Zone).toBe('eth0');
    expect(z.Canonical).toBe('fe80::1%eth0');
    expect(rows('fe80::1%eth0/64')).toMatchObject({ Network: 'fe80::/64', Address: 'fe80::1', Zone: 'eth0' });
    expect(notes('2001:db8::1%eth0')).toEqual([
      'A zone index matters only for scoped addresses such as link-local (fe80::/10).',
    ]);
    expect(notes('ff02::1%eth0')).toEqual([]);
    expect(rows('[fe80::1%25eth0]').Zone).toBe('eth0');
    expect(rows('fe80::1%25eth0').Zone).toBe('25eth0');
    expect(notes('[2001:db8::1]:443')).toEqual(['The port 443 is not part of the address: ignored.']);
    expect(notes('192.0.2.1:443')).toEqual(['The port 443 is not part of the address: ignored.']);
    expect(rows('192.0.2.1:443').Address).toBe('192.0.2.1');
  });

  it('Reverse DNS name of 2001:db8::1', () => {
    expect(rows('2001:db8::1')['Reverse DNS name']).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
    expect(rows('2001:db8::1').Expanded).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(rows('2001:db8::1').Hex).toBe('0x20010db8000000000000000000000001');
  });
});

describe('IPv6 text (RFC 5952)', () => {
  const canon = (text: string): string => {
    const read = parseAddress(text);
    if (!read.ok) throw new Error(read.error.message);
    return formatIPv6(read.value.address.value);
  };
  it.each([
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['2001:db8::0:1', '2001:db8::1'],
    ['2001:0:0:1:0:0:0:1', '2001:0:0:1::1'],
    ['0:0:1:0:0:0:0:0', '0:0:1::'],
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    ['::', '::'],
    ['::1', '::1'],
    ['1::', '1::'],
    ['2001:0db8:aaaa:bbbb:cccc:dddd:eeee:0001', '2001:db8:aaaa:bbbb:cccc:dddd:eeee:1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['::ffff:192.0.2.1', '::ffff:192.0.2.1'],
    ['::FFFF:C000:0201', '::ffff:192.0.2.1'],
    ['::ffff:0:192.0.2.1', '::ffff:0:192.0.2.1'],
    ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],
    ['::192.0.2.1', '::c000:201'],
    ['1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:102:304'],
  ])('%s → %s', (text, want) => expect(canon(text)).toBe(want));
});

describe('strict reading: every message of §6 with its column', () => {
  it.each([
    [
      '010.0.0.1',
      1,
      'Part 1 "010" has a leading zero, which some programs read as octal: write it without the zero (10), or as 8 if octal was meant.',
    ],
    [
      '10.0.0.08',
      8,
      'Part 4 "08" has a leading zero, which some programs read as octal: write it without the zero (8).',
    ],
    ['0x0a.0.0.1', 1, 'Part 1 "0x0a" is hexadecimal, which only some programs accept here: write it in decimal (10).'],
    [
      '10.1',
      1,
      'An IPv4 address has four parts; "10.1" has 2. Some programs fill in zeros and read 10.0.0.1: write all four parts.',
    ],
    [
      '10.0.1',
      1,
      'An IPv4 address has four parts; "10.0.1" has 3. Some programs fill in zeros and read 10.0.0.1: write all four parts.',
    ],
    [
      '10.300',
      1,
      'An IPv4 address has four parts; "10.300" has 2. Some programs fill in zeros and read 10.0.1.44: write all four parts.',
    ],
    ['010.1', 1, 'An IPv4 address has four parts; "010.1" has 2. Write all four parts.'],
    [
      '167772161',
      1,
      'A single number is not read as an IPv4 address (some programs read 167772161 as 10.0.0.1): write four parts.',
    ],
    ['1.2.3.4.5', 1, 'An IPv4 address has four parts; this has 5.'],
    ['256.0.0.1', 1, 'Part 1 is 256: each part is 0 to 255.'],
    ['10.0.0.1000', 8, 'Part 4 is 1000: each part is 0 to 255.'],
    ['10..0.1', 3, 'Two dots in a row: part 2 is empty.'],
    ['.10.0.0.1', 1, 'An IPv4 address does not start with a dot.'],
    ['10.0.0.1.', 9, 'An IPv4 address does not end with a dot.'],
    ['10. 0.0.1', 4, 'Spaces inside an address are not allowed.'],
    ['10.0.0.a', 8, 'Unexpected "a": an IPv4 address is four decimal numbers separated by dots.'],
    [
      '10.0.0.\u{a0}1',
      8,
      'Unexpected U+00A0 (an invisible character): an IPv4 address is four decimal numbers separated by dots.',
    ],
    ['10.0.0.\u{ff11}', 8, 'Unexpected "\u{ff11}": an IPv4 address is four decimal numbers separated by dots.'],
    ['10.0.0.1\u{1f600}', 9, 'Unexpected "\u{1f600}": an IPv4 address is four decimal numbers separated by dots.'],
    ['10.0.0.0/', 9, 'The prefix length is missing after "/".'],
    ['10.0.0.0/33', 10, 'An IPv4 prefix length is 0 to 32; this is 33.'],
    ['2001:db8::/129', 12, 'An IPv6 prefix length is 0 to 128; this is 129.'],
    ['10.0.0.0/024', 10, 'Write the prefix length without leading zeros: /24.'],
    ['10.0.0.0/2x', 11, 'Unexpected "x" in the prefix length.'],
    ['10.0.0.0/+8', 10, 'Unexpected "+" in the prefix length.'],
    ['10.0.0.0/8/9', 11, 'Only one "/" is allowed.'],
    [
      '10.0.0.0 255.0.255.0',
      10,
      'The mask 255.0.255.0 is not contiguous: a netmask is ones then zeros (255.255.0.0), a wildcard mask zeros then ones (0.0.255.255).',
    ],
    [
      '10.0.0.0 0.255.0.255',
      10,
      'The mask 0.255.0.255 is not contiguous: a netmask is ones then zeros (255.255.0.0), a wildcard mask zeros then ones (0.0.255.255).',
    ],
    [
      '10.0.0.0 255.255.0',
      10,
      'Mask: An IPv4 address has four parts; "255.255.0" has 3. Some programs fill in zeros and read 255.255.0.0: write all four parts.',
    ],
    ['2001:db8:: ffff:ffff::', 12, 'An IPv6 block takes a prefix length (/48), not a mask.'],
    ['2001:db8::/ffff::', 12, 'An IPv6 block takes a prefix length (/48), not a mask.'],
    ['10.0.0.0 255.0.0.0 x', 20, 'Unexpected "x" after the mask.'],
    ['2001:db8::g', 11, 'Unexpected "g": an IPv6 address is hex digits (0-9, a-f) in groups separated by colons.'],
    ['2001:db8::12345', 11, 'A group has at most 4 hex digits; "12345" has 5.'],
    ['1::2::3', 5, '"::" may appear only once.'],
    ['1:::2', 2, '":::" is not allowed.'],
    [':1:2:3:4:5:6:7', 1, 'An address cannot start with a single ":" (write "::" for leading zeros).'],
    ['1:2:3:4:5:6:7:', 14, 'An address cannot end with a single ":" (write "::" for trailing zeros).'],
    ['1:2:3:4:5:6:7:8:9', 1, 'An IPv6 address has 8 groups; this has 9.'],
    ['1:2:3', 1, 'An IPv6 address has 8 groups; this has 3 and no "::".'],
    ['1:2:3:4::5:6:7:8', 1, 'With "::" an address has at most 7 groups; this has 8.'],
    ['::1.2.3.4:5', 3, 'An embedded IPv4 address comes last (::ffff:192.0.2.1).'],
    ['1.2.3.4::', 1, 'An embedded IPv4 address comes last (::ffff:192.0.2.1).'],
    [
      '::ffff:010.0.0.1',
      8,
      'In the embedded IPv4 address: Part 1 "010" has a leading zero, which some programs read as octal: write it without the zero (10), or as 8 if octal was meant.',
    ],
    ['fe80::1%', 8, 'The zone index after "%" is empty.'],
    ['fe80::/64%eth0', 10, 'The zone index comes before the prefix length (fe80::1%eth0/64).'],
    ['10.0.0.1%eth0', 9, 'A zone index belongs to IPv6 addresses.'],
    ['10.0.0.0%eth0/8', 9, 'A zone index belongs to IPv6 addresses.'],
    ['[2001:db8::1', 13, '"]" is missing.'],
    ['[2001:db8::/32]', 1, 'Brackets hold one address (as in a URL), not a block.'],
    ['[10.0.0.1]', 1, 'Brackets are for IPv6 addresses.'],
    ['[2001:db8::1]x', 14, 'After "]" only a port may follow (:443).'],
    ['[2001:db8::1]:', 14, 'The port is missing after ":".'],
    ['[2001:db8::1]:70000', 15, 'A port is 0 to 65535; this is 70000.'],
    ['192.0.2.1:0443', 11, 'Write the port without leading zeros: 443.'],
    ['192.0.2.1:4a', 12, 'Unexpected "a" in the port.'],
    ['10.0.0.5 - 2001:db8::1', 1, 'Both ends of a range are of one family (IPv4 or IPv6).'],
    ['10.0.0.9 - 10.0.0.1', 1, 'The range ends before it starts: write the smaller address first.'],
    ['10.0.0.0/24 - 10.0.1.0', 1, 'The ends of a range are addresses, not blocks.'],
    ['10.0.0.1 -', 10, 'The range has no end after "-".'],
    ['- 10.0.0.1', 1, 'The range has no start before "-".'],
    ['fe80::1%a - fe80::2', 1, 'A zone index is not used in a range.'],
    [
      '  010.0.0.1',
      3,
      'Part 1 "010" has a leading zero, which some programs read as octal: write it without the zero (10), or as 8 if octal was meant.',
    ],
  ])('%s', (text, column, message) => expect(error(text)).toEqual({ message, column }));

  it('a block over 1,000 characters has no place', () => {
    const read = parseEntry(`10.0.0.0/8${' '.repeat(0)}${'0'.repeat(1_000)}`);
    expect(read.ok).toBe(false);
    if (!read.ok)
      expect(read.error).toEqual({ message: 'The block is longer than 1,000 characters.', start: -1, end: -1 });
  });

  it('reads what RFC 4291 allows: compression anywhere, leading zeros, upper case', () => {
    for (const text of [
      '::',
      '::1',
      '1::',
      '1::8',
      '1:2::7:8',
      '0001:0002:0003:0004:0005:0006:0007:0008',
      'ABCD::EF',
      '::ffff:1.2.3.4',
      '1:2:3:4:5:6:7::',
      '::2:3:4:5:6:7:8',
    ])
      expect(parseAddress(text).ok, text).toBe(true);
    expect(parseEntry('fe80::1%veth-1').ok).toBe(true);
  });

  it('ranges with a hyphen or an en dash, spaces or none', () => {
    for (const text of [
      '10.0.0.1-10.0.0.9',
      '10.0.0.1 – 10.0.0.9',
      '10.0.0.1 -10.0.0.9',
      '[2001:db8::1]:80 - 2001:db8::9',
    ]) {
      const read = parseEntry(text);
      expect(read.ok && read.entry.kind === 'range', text).toBe(true);
    }
  });
});

describe('Kind (§5 п. 17–19, the registries)', () => {
  const kind = (text: string) => kindOf(block(text).block);
  it.each([
    ['100.64.0.1', 'Shared Address Space (carrier-grade NAT)', false],
    ['192.0.0.9', 'Port Control Protocol Anycast', true],
    ['169.254.1.1', 'Link Local', false],
    ['127.0.0.1', 'Loopback', false],
    ['224.0.0.251', 'Local Network Control Block', undefined],
    ['8.8.8.8', 'Global unicast', true],
    ['fd00::1', 'Unique-Local', false],
    ['ff02::1', 'Multicast', undefined],
    ['2001:db8::1', 'Documentation', false],
    ['3fff::1', 'Documentation', false],
    ['2001::1', 'TEREDO', undefined],
    ['4000::1', 'Reserved by IETF', undefined],
    ['2606:4700::1111', 'Global Unicast', true],
    ['192.88.99.1', 'Deprecated (6to4 Relay Anycast)', undefined],
  ])('%s', (text, name, reachable) => {
    expect(kind(text).name).toBe(name);
    expect(kind(text).reachable).toBe(reachable);
  });

  it('says where, what holds it, the scope of multicast', () => {
    expect(kind('192.0.0.9').detail).toBe(
      'RFC 7723 · IANA IPv4 Special-Purpose Address Space: 192.0.0.9/32 · in 192.0.0.0/24 IETF Protocol Assignments · globally reachable: yes',
    );
    expect(kind('224.0.0.251').detail).toBe(
      'RFC 5771 · IANA IPv4 Multicast Address Space: 224.0.0.0/24 · in 224.0.0.0/4 Multicast',
    );
    expect(kind('ff02::1').detail).toBe('RFC 4291 · IANA IPv6 Address Space: ff00::/8 · scope: link-local (2)');
    expect(kind('8.8.8.8').detail).toBe('In no special-purpose range · globally reachable: yes');
    expect(kind('192.0.0.0/16').name).toBe('Mixed');
    expect(kind('192.0.0.0/16').detail).toBe(
      'Holds 192.0.0.0/24 IETF Protocol Assignments, 192.0.0.0/29 IPv4 Service Continuity Prefix, 192.0.0.8/32 IPv4 dummy address, 192.0.0.9/32 Port Control Protocol Anycast, 192.0.0.10/32 Traversal Using Relays around NAT Anycast and 3 more',
    );
  });

  it('embedded IPv4', () => {
    const value = (text: string): bigint => {
      const read = parseAddress(text);
      if (!read.ok) throw new Error(read.error.message);
      return read.value.address.value;
    };
    expect(embeddedIPv4(value('2001:0:4136:e378:8000:63bf:3fff:fdd2'))).toBe(
      'server 65.54.227.120, client 192.0.2.45 (Teredo, RFC 4380)',
    );
    expect(embeddedIPv4(value('::ffff:192.0.2.1'))).toBe('192.0.2.1 (IPv4-mapped, RFC 4291)');
    expect(embeddedIPv4(value('64:ff9b::192.0.2.33'))).toBe('192.0.2.33 (NAT64 well-known prefix, RFC 6052)');
    expect(embeddedIPv4(value('2002:c000:201::1'))).toBe('192.0.2.1 (6to4, RFC 3056)');
    expect(embeddedIPv4(value('2001:db8::1'))).toBeNull();
    expect(rows('::ffff:192.0.2.1')['Embedded IPv4']).toBe('192.0.2.1 (IPv4-mapped, RFC 4291)');
  });
});

describe('Summarize (§10)', () => {
  const summary = (text: string): string[] => runSummarize(text).text.split('\n');
  it('a range → its blocks', () => {
    expect(summary('192.168.0.5 - 192.168.0.20')).toEqual([
      '192.168.0.5/32',
      '192.168.0.6/31',
      '192.168.0.8/29',
      '192.168.0.16/30',
      '192.168.0.20/32',
    ]);
    expect(summary('0.0.0.1 - 255.255.255.254')).toHaveLength(62);
    expect(summary('2001:db8:: - 2001:db8::ffff')).toEqual(['2001:db8::/112']);
    expect(summary('2001:db8::1 - 2001:db8::10')).toHaveLength(5);
    expect(rangeToBlocks({ family: 6, first: 0n, last: (1n << 128n) - 1n }).map(formatBlock)).toEqual(['::/0']);
  });
  it('a list → the fewest blocks', () => {
    const r = runSummarize('10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/23\n10.0.4.0/24');
    expect(r.text).toBe('10.0.0.0/22\n10.0.4.0/24');
    expect(r.status).toBe('4 entries → 2 blocks · 1,280 addresses');
  });
  it('both families, commas, comments, errors left out with a line', () => {
    const r = runSummarize('10.0.0.0/25, 10.0.0.128/25 # two halves\n2001:db8::/64\n010.0.0.1\n\n2001:db8:0:1::/64');
    expect(r.text).toBe('10.0.0.0/24\n2001:db8::/63');
    expect(r.status).toBe('4 entries → 2 blocks · 256 IPv4 and 36,893,488,147,419,103,232 IPv6 addresses');
    expect(r.skipped).toBe(1);
    expect(r.list.error).toBe(
      'Line 3: Part 1 "010" has a leading zero, which some programs read as octal: write it without the zero (10), or as 8 if octal was meant.',
    );
  });
  it('host bits in a list: read, with one note for all such lines', () => {
    const r = runSummarize('10.0.12.5/22\n10.1.0.1/16\n10.2.0.1/16');
    expect(r.list.notes).toEqual(['Line 1: host bits are set, read as 10.0.12.0/22 (and 2 more lines like it).']);
  });
});

describe('Split (§10)', () => {
  const b = (text: string): Block => block(text).block;
  it('10.0.0.0/24 by prefix 26', () => {
    const plan = planSplit(b('10.0.0.0/24'), { by: 'prefix', prefix: 26 });
    expect(plan).toEqual({ ok: true, prefix: 26, count: 4n });
    expect(splitText(b('10.0.0.0/24'), 26, false)).toBe('10.0.0.0/26\n10.0.0.64/26\n10.0.0.128/26\n10.0.0.192/26');
    expect(splitText(b('10.0.0.0/24'), 26, true)!.split('\n')[1]).toBe('10.0.0.0/26\t10.0.0.0\t10.0.0.63');
    if (plan.ok)
      expect(splitSummary(b('10.0.0.0/24'), plan)).toBe('4 subnets /26 · 64 addresses each · 62 usable hosts each');
  });
  it('10.0.0.0/24 by number 3', () => {
    const plan = planSplit(b('10.0.0.0/24'), { by: 'count', count: 3n });
    expect(plan).toEqual({ ok: true, prefix: 26, count: 4n, asked: 3n });
    if (plan.ok)
      expect(splitSummary(b('10.0.0.0/24'), plan)).toBe(
        '3 subnets asked: /26 gives 4 subnets of 64 addresses (1 spare).',
      );
    expect(planSplit(b('10.0.0.0/24'), { by: 'count', count: 1n })).toEqual({
      ok: true,
      prefix: 24,
      count: 1n,
      asked: 1n,
    });
    expect(planSplit(b('10.0.0.0/24'), { by: 'count', count: 256n })).toEqual({
      ok: true,
      prefix: 32,
      count: 256n,
      asked: 256n,
    });
  });
  it('10.0.0.0/8 into /24 and /32', () => {
    expect(planSplit(b('10.0.0.0/8'), { by: 'prefix', prefix: 24 })).toEqual({ ok: true, prefix: 24, count: 65_536n });
    expect(formatBlock(subnetAt(b('10.0.0.0/8'), 24, 65_535n))).toBe('10.255.255.0/24');
    expect(splitText(b('10.0.0.0/8'), 24, false)!.split('\n')).toHaveLength(65_536);
    expect(splitText(b('10.0.0.0/8'), 32, false)).toBeNull();
  });
  it('2001:db8::/48 into /64 and ::/0 into /128', () => {
    expect(formatBlock(subnetAt(b('2001:db8::/48'), 64, 65_535n))).toBe('2001:db8:0:ffff::/64');
    const total = 1n << 128n;
    const last = splitRows(b('::/0'), 128, total - 1n, 1_000, total);
    expect(last).toHaveLength(1);
    expect(last[0]!.subnet).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128');
    expect(last[0]!.index).toBe(total - 1n);
  });
  it('refusals', () => {
    expect(planSplit(b('10.0.12.0/22'), { by: 'prefix', prefix: 20 })).toEqual({
      ok: false,
      message: 'A /20 is larger than the block /22: choose 22 to 32.',
    });
    expect(planSplit(b('10.0.0.0/22'), { by: 'prefix', prefix: 33 })).toEqual({
      ok: false,
      message: 'An IPv4 prefix length is 0 to 32; this is 33.',
    });
    expect(planSplit(b('10.0.0.0/30'), { by: 'count', count: 5n })).toEqual({
      ok: false,
      message: 'A /30 has 4 addresses: it cannot be split into 5 subnets.',
    });
    expect(planSplit(b('10.0.0.0/30'), { by: 'count', count: 0n })).toEqual({
      ok: false,
      message: 'Choose at least 1 subnet.',
    });
  });
});

describe('Match (§10)', () => {
  it('three addresses, three blocks', () => {
    const r = runMatch('10.0.12.77\n192.168.1.10\n2001:db8::1', '10.0.0.0/8\n10.0.12.0/22\n2001:db8::/32');
    expect(r.rows).toEqual([
      { address: '10.0.12.77', block: '10.0.12.0/22', count: 2 },
      { address: '192.168.1.10', block: null, count: 0 },
      { address: '2001:db8::1', block: '2001:db8::/32', count: 1 },
    ]);
    expect(matchStatus(r.inside, r.rows.length)).toBe('2 of 3 addresses are in a block.');
    expect(matchCopyText(r.rows, 'outside')).toBe('192.168.1.10');
    expect(matchCopyText(r.rows, 'inside')).toBe('10.0.12.77\n2001:db8::1');
    expect(matchCopyText(r.rows, 'table')).toBe(
      'Address\tBlock\tIn blocks\n10.0.12.77\t10.0.12.0/22\t2\n192.168.1.10\t\t0\n2001:db8::1\t2001:db8::/32\t1',
    );
  });
  it('a mapped address is IPv6; ranges and ties', () => {
    expect(runMatch('::ffff:10.0.0.1', '10.0.0.0/8').rows[0]).toEqual({
      address: '::ffff:10.0.0.1',
      block: null,
      count: 0,
    });
    const r = runMatch('192.168.0.15', '192.168.0.10-192.168.0.20\n192.168.0.0/28\n192.168.0.8/29');
    expect(r.rows[0]).toEqual({ address: '192.168.0.15', block: '192.168.0.8/29', count: 3 });
    expect(runMatch('10.0.0.1', '10.0.0.0/31\n10.0.0.0/31').rows[0]!.block).toBe('10.0.0.0/31');
  });
  it('a block in Addresses is an error of its line', () => {
    const r = runMatch('10.0.0.1\n10.0.0.0/24\n10.0.0.1 - 10.0.0.2', '10.0.0.0/8');
    expect(r.addresses.error).toBe(
      'Line 2: A block, not an address: blocks go in the Blocks list. (and 1 more line that could not be read)',
    );
    expect(r.rows).toHaveLength(1);
    expect(matchStatus(1, 1)).toBe('1 of 1 address is in a block.');
    expect(matchStatus(0, 3)).toBe('No address is in a block.');
  });
});

describe('detect (§7)', () => {
  it.each([
    ['10.0.0.0/8', 'explain'],
    ['192.168.1.0/24', 'explain'],
    ['10.0.12.5/22', 'explain'],
    ['0.0.0.0/0', 'explain'],
    ['2001:db8::/32', 'explain'],
    ['::/0', 'explain'],
    ['fe80::1%eth0/64', 'explain'],
    ['  10.0.0.0/8\n', 'explain'],
    ['10.0.0.0/8\n172.16.0.0/12\n192.168.0.0/16', 'summarize'],
  ])('%s → %s', (text, task) => {
    expect(detectedTask(text)).toBe(task);
    expect(detectSubnet(text)).toBe(true);
  });
  it.each([
    '1.2.3.4',
    '::1',
    '2001:db8::1',
    '10.0.0.0 255.0.0.0',
    '10.0.0.0/255.0.0.0',
    '10.0.0.1 - 10.0.0.9',
    '010.0.0.0/8',
    '10.0.0.0/33',
    '1.2.3/24',
    '10.0.0.0/8 x',
    '12:34:56',
    'aa:bb:cc:dd:ee:ff',
    '1.2.3',
    '3/4',
    '1/2/2024',
    'https://10.0.0.1/8',
    'a/b',
    '10.0.0.0/8\nhello',
    '',
  ])('%s → no', text => expect(detectSubnet(text)).toBe(false));
  it('more than 1,000 lines or 64 Ki characters → no', () => {
    expect(detectSubnet(Array(1_001).fill('10.0.0.0/8').join('\n'))).toBe(false);
    expect(detectSubnet(Array(1_000).fill('10.0.0.0/8').join('\n'))).toBe(true);
  });
});

describe('no floating point on address values', () => {
  it('the logic’s sources use no Number(, parseInt, parseFloat, Math.pow, ** or toFixed', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(8);
    for (const file of sources) {
      const code = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const banned of [
        /\bNumber\s*\(/,
        /\bparseInt\b/,
        /\bparseFloat\b/,
        /Math\.(pow|round|ceil|log|log2|sqrt|exp|trunc)\b/,
        /\*\*/,
        /\btoFixed\b/,
        /\bMath\.random\b/,
        /\bconsole\./,
      ])
        expect(banned.test(code), `${file}: ${banned}`).toBe(false);
    }
  });
});
