/**
 * The Compress / Decompress tool as a host lists it (docs/tools/specs/compress.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { compressHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'compress',
  title: 'Compress / Decompress',
  summary: 'Decompress gzip, zlib, deflate, zstd or brotli from Base64, hex or a file, and compress text or files.',
  keywords: ['gzip', 'gunzip', 'zlib', 'deflate', 'inflate', 'decompress', 'compress', 'zstd', 'brotli'],
  order: 37,
  history: compressHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./CompressTool'),
};
