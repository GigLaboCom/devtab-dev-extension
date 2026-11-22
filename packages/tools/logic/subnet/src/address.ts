/**
 * Addresses as numbers (docs/tools/specs/subnet.md §5 п. 1–8): strict reading of IPv4 and IPv6 text — every form that
 * different programs read differently is refused with words — and writing them back (RFC 5952 for IPv6). An address is
 * a `bigint` of 32 or 128 bits; no address value ever passes through `number`.
 */

export type Family = 4 | 6;

export const BITS: Record<Family, number> = { 4: 32, 6: 128 };

/** A refusal with the place it is about: UTF-16 offsets into the text given, [start, end). */
export interface TextError {
  message: string;
  start: number;
  end: number;
}

export interface Address {
  family: Family;
  value: bigint;
  /** An IPv6 zone index (RFC 4007 §11), as written (the URI form %25 already decoded). */
  zone?: string;
}

export interface ParsedAddress {
  address: Address;
  /** A port after the address (`[2001:db8::1]:443`, `192.0.2.1:443`): checked and set aside. */
  port?: number;
  bracketed: boolean;
}

export type AddressResult = { ok: true; value: ParsedAddress } | { ok: false; error: TextError };
export type IPv4Result = { ok: true; value: bigint } | { ok: false; error: TextError };
export type IPv6Result = { ok: true; value: bigint; zone?: string } | { ok: false; error: TextError };

export const fail = (message: string, start: number, end = start + 1): { ok: false; error: TextError } => ({
  ok: false,
  error: { message, start, end },
});

/** `"x"` for a visible character, `U+00A0 (an invisible character)` for one that would not show. */
export const describeChar = (ch: string): string =>
  /^[\p{Cc}\p{Cf}\p{Z}\p{Co}\p{Cn}\p{Cs}]$/u.test(ch) && ch !== ' '
    ? `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} (an invisible character)`
    : `"${ch}"`;

const charAt = (text: string, i: number): string => String.fromCodePoint(text.codePointAt(i)!);

const isSpace = (ch: string): boolean => /^\s$/u.test(ch);

const DIGITS = /^[0-9]+$/;
const HEX_PART = /^0[xX][0-9a-fA-F]+$/;
const OCTAL_DIGITS = /^[0-7]+$/;

const V4_WORDS = 'an IPv4 address is four decimal numbers separated by dots.';
const V6_WORDS = 'an IPv6 address is hex digits (0-9, a-f) in groups separated by colons.';

/** What `inet_aton` makes of 2 or 3 decimal parts (the last fills the remaining bits), when every part reads. */
const filledIn = (parts: string[]): string | null => {
  if (parts.some(p => !DIGITS.test(p) || (p.length > 1 && p.startsWith('0')) || p.length > 10)) return null;
  const values = parts.map(p => BigInt(p));
  const lastBits = BigInt(8 * (5 - parts.length));
  if (values.slice(0, -1).some(v => v > 255n) || values[values.length - 1]! >= 1n << lastBits) return null;
  let value = 0n;
  values.slice(0, -1).forEach((v, i) => (value |= v << BigInt(24 - 8 * i)));
  value |= values[values.length - 1]!;
  return formatIPv4(value);
};

/** Reads exactly a dotted-decimal IPv4 address (§5 п. 3); `offset` is where `text` starts in the field. */
export const parseIPv4 = (text: string, offset = 0): IPv4Result => {
  if (text === '') return fail('An IPv4 address is missing.', offset, offset);
  for (let i = 0; i < text.length; i++) {
    const ch = charAt(text, i);
    if (/^[0-9.]$/.test(ch)) continue;
    if (isSpace(ch)) {
      if (ch === ' ' || ch === '\t') return fail('Spaces inside an address are not allowed.', offset + i);
      return fail(`Unexpected ${describeChar(ch)}: ${V4_WORDS}`, offset + i, offset + i + ch.length);
    }
    // A hexadecimal part (0x0a) gets its own words: inet_aton reads it, inet_pton does not.
    const start = text.lastIndexOf('.', i) + 1;
    const endDot = text.indexOf('.', i);
    const part = text.slice(start, endDot === -1 ? text.length : endDot);
    if (HEX_PART.test(part)) {
      const value = BigInt(part);
      return fail(
        `Part ${text.slice(0, start).split('.').length} "${part}" is hexadecimal, which only some programs accept here: write it in decimal (${value}).`,
        offset + start,
        offset + start + part.length,
      );
    }
    return fail(`Unexpected ${describeChar(ch)}: ${V4_WORDS}`, offset + i, offset + i + ch.length);
  }
  if (text.startsWith('.')) return fail('An IPv4 address does not start with a dot.', offset);
  if (text.endsWith('.')) return fail('An IPv4 address does not end with a dot.', offset + text.length - 1);
  const twice = text.indexOf('..');
  if (twice !== -1)
    return fail(
      `Two dots in a row: part ${text.slice(0, twice + 1).split('.').length} is empty.`,
      offset + twice,
      offset + twice + 2,
    );
  const parts = text.split('.');
  if (parts.length === 1) {
    const plain = !(text.length > 1 && text.startsWith('0'));
    const value = BigInt(text);
    const reading = plain && value < 1n << 32n ? ` (some programs read ${text} as ${formatIPv4(value)})` : '';
    return fail(
      `A single number is not read as an IPv4 address${reading}: write four parts.`,
      offset,
      offset + text.length,
    );
  }
  if (parts.length < 4) {
    const reading = filledIn(parts);
    const advice = reading
      ? ` Some programs fill in zeros and read ${reading}: write all four parts.`
      : ' Write all four parts.';
    return fail(
      `An IPv4 address has four parts; "${text}" has ${parts.length}.${advice}`,
      offset,
      offset + text.length,
    );
  }
  if (parts.length > 4)
    return fail(`An IPv4 address has four parts; this has ${parts.length}.`, offset, offset + text.length);
  let value = 0n;
  let at = offset;
  for (let k = 0; k < 4; k++) {
    const part = parts[k]!;
    if (part.length > 1 && part.startsWith('0')) {
      const bare = part.replace(/^0+(?=.)/, '');
      const octal = OCTAL_DIGITS.test(part) ? `, or as ${BigInt(`0o${part}`)} if octal was meant` : '';
      return fail(
        `Part ${k + 1} "${part}" has a leading zero, which some programs read as octal: write it without the zero (${bare})${octal}.`,
        at,
        at + part.length,
      );
    }
    const n = BigInt(part);
    if (n > 255n) return fail(`Part ${k + 1} is ${part}: each part is 0 to 255.`, at, at + part.length);
    value = (value << 8n) | n;
    at += part.length + 1;
  }
  return { ok: true, value };
};

/** Reads an IPv6 address as RFC 4291 §2.2 writes it, with an optional zone (RFC 4007 §11) after `%`. */
export const parseIPv6 = (text: string, offset = 0): IPv6Result => {
  let body = text;
  let zone: string | undefined;
  const percent = text.indexOf('%');
  if (percent !== -1) {
    body = text.slice(0, percent);
    zone = text.slice(percent + 1);
    if (zone === '') return fail('The zone index after "%" is empty.', offset + percent);
    for (let i = 0; i < zone.length; i++) {
      const ch = charAt(zone, i);
      if (isSpace(ch) || '/%[]'.includes(ch))
        return fail(
          isSpace(ch) && (ch === ' ' || ch === '\t')
            ? 'Spaces inside an address are not allowed.'
            : `Unexpected ${describeChar(ch)} in the zone index.`,
          offset + percent + 1 + i,
        );
    }
  }
  if (body === '') return fail('An IPv6 address is missing.', offset, offset);
  for (let i = 0; i < body.length; i++) {
    const ch = charAt(body, i);
    if (/^[0-9a-fA-F:.]$/.test(ch)) continue;
    if (ch === ' ' || ch === '\t') return fail('Spaces inside an address are not allowed.', offset + i);
    return fail(`Unexpected ${describeChar(ch)}: ${V6_WORDS}`, offset + i, offset + i + ch.length);
  }
  const triple = body.indexOf(':::');
  if (triple !== -1) return fail('":::" is not allowed.', offset + triple, offset + triple + 3);
  const first = body.indexOf('::');
  const second = first === -1 ? -1 : body.indexOf('::', first + 2);
  if (second !== -1) return fail('"::" may appear only once.', offset + second, offset + second + 2);
  if (body.startsWith(':') && first !== 0)
    return fail('An address cannot start with a single ":" (write "::" for leading zeros).', offset);
  if (body.endsWith(':') && first !== body.length - 2)
    return fail('An address cannot end with a single ":" (write "::" for trailing zeros).', offset + body.length - 1);

  // Groups of each side of "::", with where each starts in the field.
  const sides: { text: string; at: number }[][] = [];
  const split = (part: string, at: number): { text: string; at: number }[] => {
    if (part === '') return [];
    const out: { text: string; at: number }[] = [];
    let pos = at;
    for (const g of part.split(':')) {
      out.push({ text: g, at: pos });
      pos += g.length + 1;
    }
    return out;
  };
  if (first === -1) sides.push(split(body, offset));
  else sides.push(split(body.slice(0, first), offset), split(body.slice(first + 2), offset + first + 2));

  const all = sides.flat();
  const last = all[all.length - 1];
  let groups = 0;
  const values: bigint[][] = sides.map(() => []);
  for (let s = 0; s < sides.length; s++) {
    for (const g of sides[s]!) {
      if (g.text.includes('.')) {
        if (g !== last || (first !== -1 && s === 0))
          return fail('An embedded IPv4 address comes last (::ffff:192.0.2.1).', g.at, g.at + g.text.length);
        const v4 = parseIPv4(g.text, g.at);
        if (!v4.ok)
          return { ok: false, error: { ...v4.error, message: `In the embedded IPv4 address: ${v4.error.message}` } };
        values[s]!.push(v4.value >> 16n, v4.value & 0xffffn);
        groups += 2;
        continue;
      }
      if (g.text.length > 4)
        return fail(`A group has at most 4 hex digits; "${g.text}" has ${g.text.length}.`, g.at, g.at + g.text.length);
      values[s]!.push(BigInt(`0x${g.text}`));
      groups++;
    }
  }
  const whole = { start: offset, end: offset + body.length };
  if (first === -1) {
    if (groups > 8) return fail(`An IPv6 address has 8 groups; this has ${groups}.`, whole.start, whole.end);
    if (groups < 8)
      return fail(`An IPv6 address has 8 groups; this has ${groups} and no "::".`, whole.start, whole.end);
  } else if (groups > 7) {
    return fail(`With "::" an address has at most 7 groups; this has ${groups}.`, whole.start, whole.end);
  }
  const head = values[0]!;
  const tail = values[1] ?? [];
  const full = [...head, ...Array<bigint>(8 - head.length - tail.length).fill(0n), ...tail];
  let value = 0n;
  for (const g of full) value = (value << 16n) | g;
  return zone === undefined ? { ok: true, value } : { ok: true, value, zone };
};

/** A short run of decimal digits (a port, a prefix length) as a number — never an address value. */
export const smallInt = (digits: string): number => {
  let n = 0;
  for (const d of digits) n = n * 10 + (d.charCodeAt(0) - 48);
  return n;
};

const parsePort = (text: string, at: number): { ok: true; port: number } | { ok: false; error: TextError } => {
  if (text === '') return fail('The port is missing after ":".', at - 1);
  for (let i = 0; i < text.length; i++)
    if (!/[0-9]/.test(text[i]!)) {
      const ch = charAt(text, i);
      return fail(`Unexpected ${describeChar(ch)} in the port.`, at + i, at + i + ch.length);
    }
  if (text.length > 1 && text.startsWith('0'))
    return fail(`Write the port without leading zeros: ${text.replace(/^0+(?=.)/, '')}.`, at, at + text.length);
  const port = text.length > 5 ? Infinity : smallInt(text);
  if (port > 65535) return fail(`A port is 0 to 65535; this is ${text}.`, at, at + text.length);
  return { ok: true, port };
};

/**
 * Reads an address where one is expected (§5 п. 4–6): IPv4, IPv6 with a zone, an IPv6 address in brackets with or
 * without a port, IPv4 with a port. The port is checked and returned apart: it is not part of the address.
 */
export const parseAddress = (text: string, offset = 0): AddressResult => {
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close === -1) return fail('"]" is missing.', offset + text.length, offset + text.length);
    const inside = text.slice(1, close);
    if (inside.includes('/'))
      return fail('Brackets hold one address (as in a URL), not a block.', offset, offset + close + 1);
    if (!inside.includes(':')) return fail('Brackets are for IPv6 addresses.', offset, offset + close + 1);
    // RFC 6874: inside brackets the zone is written %25<zone> (the percent sign percent-encoded).
    const percent = inside.indexOf('%');
    const decoded =
      percent !== -1 && inside.slice(percent + 1, percent + 3) === '25' && inside.length > percent + 3
        ? { text: inside.slice(0, percent + 1) + inside.slice(percent + 3), shift: 2 }
        : { text: inside, shift: 0 };
    const v6 = parseIPv6(decoded.text, offset + 1);
    if (!v6.ok) {
      const e = v6.error;
      const moved = decoded.shift && e.start > offset + 1 + percent ? decoded.shift : 0;
      return { ok: false, error: { ...e, start: e.start + moved, end: e.end + moved } };
    }
    const rest = text.slice(close + 1);
    const address: Address =
      v6.zone === undefined ? { family: 6, value: v6.value } : { family: 6, value: v6.value, zone: v6.zone };
    if (rest === '') return { ok: true, value: { address, bracketed: true } };
    if (!rest.startsWith(':')) return fail('After "]" only a port may follow (:443).', offset + close + 1);
    const port = parsePort(rest.slice(1), offset + close + 2);
    if (!port.ok) return port;
    return { ok: true, value: { address, port: port.port, bracketed: true } };
  }
  const colons = text.split(':').length - 1;
  // IPv4 with a port: one colon after something with a dot (`192.0.2.1:443`). IPv6 never has a single colon.
  if (colons === 1 && text.indexOf('.') !== -1 && text.indexOf('.') < text.indexOf(':')) {
    const colon = text.indexOf(':');
    const v4 = parseIPv4(text.slice(0, colon), offset);
    if (!v4.ok) return v4;
    const port = parsePort(text.slice(colon + 1), offset + colon + 1);
    if (!port.ok) return port;
    return { ok: true, value: { address: { family: 4, value: v4.value }, port: port.port, bracketed: false } };
  }
  if (colons > 0 || text.includes('%')) {
    if (colons === 0) {
      const v4 = parseIPv4(text.slice(0, text.indexOf('%')), offset);
      if (v4.ok) return fail('A zone index belongs to IPv6 addresses.', offset + text.indexOf('%'));
      return v4;
    }
    const v6 = parseIPv6(text, offset);
    if (!v6.ok) return v6;
    const address: Address =
      v6.zone === undefined ? { family: 6, value: v6.value } : { family: 6, value: v6.value, zone: v6.zone };
    return { ok: true, value: { address, bracketed: false } };
  }
  const v4 = parseIPv4(text, offset);
  if (!v4.ok) return v4;
  return { ok: true, value: { address: { family: 4, value: v4.value }, bracketed: false } };
};

export const formatIPv4 = (value: bigint): string =>
  [24n, 16n, 8n, 0n].map(s => ((value >> s) & 255n).toString()).join('.');

/** Hex groups with the longest run of two or more zero groups as "::" (the first of equal runs) — RFC 5952 §4.2. */
const compress = (groups: string[]): string => {
  let best = -1;
  let bestLength = 1;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === '0') j++;
    if (j - i > bestLength) {
      best = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (best === -1) return groups.join(':');
  return `${groups.slice(0, best).join(':')}::${groups.slice(best + bestLength).join(':')}`;
};

/** The eight groups as lowercase hex without leading zeros (one conversion to text, then slices: fast for tables). */
const groupsOf = (value: bigint): string[] => {
  const hex = value.toString(16).padStart(32, '0');
  const out: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    let k = i;
    while (k < i + 3 && hex.charCodeAt(k) === 48) k++;
    out.push(hex.slice(k, i + 4));
  }
  return out;
};

/** The prefixes RFC 5952 §5 writes with the last 32 bits in dotted decimal: IPv4-mapped and IPv4-translated. */
export const isMixed = (value: bigint): boolean => value >> 32n === 0xffffn || value >> 32n === 0xffff0000n;

/** RFC 5952 text: lowercase, no leading zeros, "::" for the longest zero run; dotted tail for §5's prefixes. */
export const formatIPv6 = (value: bigint, zone?: string): string => {
  const groups = groupsOf(value);
  let text: string;
  if (isMixed(value)) {
    const hex = compress(groups.slice(0, 6));
    const v4 = formatIPv4(value & 0xffffffffn);
    text = hex.endsWith('::') ? hex + v4 : `${hex}:${v4}`;
  } else {
    text = compress(groups);
  }
  return zone === undefined ? text : `${text}%${zone}`;
};

export const formatAddress = (address: Address): string =>
  address.family === 4 ? formatIPv4(address.value) : formatIPv6(address.value, address.zone);

export const formatValue = (family: Family, value: bigint): string =>
  family === 4 ? formatIPv4(value) : formatIPv6(value);

/** All eight groups of four hex digits, lowercase (an embedded IPv4 stays hex). */
export const expandIPv6 = (value: bigint): string =>
  value
    .toString(16)
    .padStart(32, '0')
    .replace(/(.{4})(?!$)/g, '$1:');

/** Bits by 8 with dots (IPv4) or by 16 with colons (IPv6). */
export const binaryOf = (family: Family, value: bigint): string => {
  const bits = value.toString(2).padStart(BITS[family], '0');
  const size = family === 4 ? 8 : 16;
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += size) out.push(bits.slice(i, i + size));
  return out.join(family === 4 ? '.' : ':');
};

/** The reverse DNS name (RFC 1035 §3.5, RFC 3596 §2.5) — the name only: nothing is looked up. */
export const reverseName = (family: Family, value: bigint): string => {
  if (family === 4) return `${[0n, 8n, 16n, 24n].map(s => ((value >> s) & 255n).toString()).join('.')}.in-addr.arpa`;
  const nibbles = value.toString(16).padStart(32, '0');
  return `${[...nibbles].reverse().join('.')}.ip6.arpa`;
};

export const hexOf = (family: Family, value: bigint): string =>
  `0x${value.toString(16).padStart(BITS[family] / 4, '0')}`;
