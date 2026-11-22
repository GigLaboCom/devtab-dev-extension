/** Sizes and the compression ratio as the page writes them (docs/tools/specs/compress.md §5.7). */

const GROUPED = new Intl.NumberFormat('en');
const ONE_DECIMAL = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

export const formatCount = (n: number): string => GROUPED.format(n);

/** `5 bytes`, `1 byte`, `1.2 KB`, `812.6 MB` — base 1 024, as the hash tool writes a file's size. */
export const formatShortSize = (bytes: number): string => {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${formatCount(bytes)} bytes`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${ONE_DECIMAL.format(value)} ${UNITS[unit]}`;
};

/** A size with the exact count when it is rounded: `812.6 MB (852,040,121 bytes)`. */
export const formatSize = (bytes: number): string =>
  bytes < 1024 ? formatShortSize(bytes) : `${formatShortSize(bytes)} (${formatCount(bytes)} bytes)`;

/** `R : 1` where R = original / compressed: two decimals, none above 100 (grouped). Empty compressed data: ''. */
export const formatRatio = (original: number, compressed: number): string => {
  if (compressed <= 0) return '';
  const r = original / compressed;
  const shown =
    r >= 100
      ? GROUPED.format(Math.floor(r))
      : new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r);
  return `${shown} : 1`;
};

/** The facts line: `25 bytes → 5 bytes · ratio 0.20 : 1`, compressed first when decompressing. */
export const sizesLine = (from: number, to: number, direction: 'decompress' | 'compress'): string => {
  const ratio = direction === 'decompress' ? formatRatio(to, from) : formatRatio(from, to);
  return `${formatShortSize(from)} → ${formatShortSize(to)}${ratio ? ` · ratio ${ratio}` : ''}`;
};
