/*! brotli encoder: Google's brotli (MIT) compiled to JavaScript by the brotli package 2.1.0 (MIT) — licences in the package's licenses/. */
import { compress } from 'brotli/compress';
import type { BrotliCompress } from '@workspace/tool-logic-compress';

export const brotliCompress: BrotliCompress = async (bytes, quality) => {
  const out = await compress(bytes, { quality });
  if (!out) throw new Error('The brotli encoder failed.');
  return out;
};
