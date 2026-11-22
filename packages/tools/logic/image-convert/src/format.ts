/** Numbers as the page writes them (docs/tools/specs/image-convert.md §5.4, §8): en-US digits, KiB and MiB. */
import type { Size } from './types';

export const count = (n: number): string => n.toLocaleString('en-US');

/** '78 bytes', '1 byte', '96,432 bytes (94.2 KiB)', '3,214,000 bytes (3.1 MiB)'. */
export const formatBytes = (bytes: number): string => {
  const plain = `${count(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024) return plain;
  if (bytes < 1024 * 1024) return `${plain} (${(bytes / 1024).toFixed(1)} KiB)`;
  if (bytes < 1024 * 1024 * 1024) return `${plain} (${(bytes / 1024 / 1024).toFixed(1)} MiB)`;
  return `${plain} (${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB)`;
};

/** The size in MiB with one decimal, for refusals: '300.0 MiB'. */
export const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** '3% of the original', '<1% of the original', '112% of the original'. */
export const ratioText = (out: number, source: number): string => {
  if (source <= 0) return '';
  const exact = (100 * out) / source;
  return exact < 1 ? '<1% of the original' : `${count(Math.round(exact))}% of the original`;
};

/** '2,880 × 1,800'. */
export const sizeText = (size: Size): string => `${count(size.width)} × ${count(size.height)}`;

/** Megapixels, rounded to a whole number when large and to one decimal when small: '900', '0.3'. */
export const megapixels = (size: Size): string => {
  const mp = (size.width * size.height) / 1_000_000;
  return mp >= 10 ? count(Math.round(mp)) : String(Math.round(mp * 10) / 10);
};
