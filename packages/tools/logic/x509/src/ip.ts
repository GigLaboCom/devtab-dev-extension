/** IP addresses of GeneralName `[7]` (RFC 5280 §4.2.1.6, §4.2.1.10), IPv6 written by RFC 5952. */

export const formatIPv4 = (bytes: Uint8Array): string => Array.from(bytes).join('.');

/**
 * RFC 5952 §4: lowercase, no leading zeros in a group, the longest run of two or more zero groups (the first of equal
 * runs) as `::`, a single zero group kept; an IPv4-mapped address as `::ffff:192.0.2.1` (§5).
 */
export const formatIPv6 = (bytes: Uint8Array): string => {
  if (bytes.length !== 16) return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.subarray(0, 10).every(b => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff)
    return `::ffff:${formatIPv4(bytes.subarray(12))}`;
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i]! << 8) | bytes[i + 1]!);
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map(g => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
};

/** An address of a GeneralName: 4 bytes IPv4, 16 bytes IPv6; in name constraints 8 / 32 bytes, `address/mask`. */
export const formatIp = (bytes: Uint8Array, constraint: boolean): string => {
  if (bytes.length === 4) return formatIPv4(bytes);
  if (bytes.length === 16) return formatIPv6(bytes);
  if (constraint && bytes.length === 8) return `${formatIPv4(bytes.subarray(0, 4))}/${formatIPv4(bytes.subarray(4))}`;
  if (constraint && bytes.length === 32)
    return `${formatIPv6(bytes.subarray(0, 16))}/${formatIPv6(bytes.subarray(16))}`;
  return `${Array.from(bytes, b => b.toString(16).toUpperCase().padStart(2, '0')).join(':')} (${bytes.length} bytes, not an address)`;
};
