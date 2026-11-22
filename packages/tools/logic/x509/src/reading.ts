/**
 * Everything the page shows from one input (docs/tools/specs/x509.md §3, §6, §8): the certificates that were read —
 * at most twenty, in the order given — and the messages under the field, each with its place when the input has
 * several blocks. Pure: the component only draws it.
 */
import { parseCertificate } from './certificate';
import { blockNotes, readInput } from './input';
import type { Certificate } from './certificate';
import type { InputBlock } from './input';

export interface Reading {
  certificates: Certificate[];
  /** Under the field: errors (a block that could not be read, a private key) and notes (a block skipped, bytes left). */
  messages: Array<{ tone: 'error' | 'note'; text: string }>;
}

const placed = (blocks: InputBlock[], block: InputBlock, text: string): string =>
  blocks.length > 1 ? `Line ${block.line}: ${text}` : text;

export const readCertificates = (input: { text: string } | { bytes: Uint8Array }): Reading => {
  const read = readInput(input);
  const certificates: Certificate[] = [];
  const messages: Reading['messages'] = [];
  for (const block of read.blocks) {
    if (block.kind === 'skipped')
      messages.push({
        tone: block.reason === 'other' ? 'note' : 'error',
        text: placed(read.blocks, block, block.message),
      });
    else if (block.kind === 'error') messages.push({ tone: 'error', text: placed(read.blocks, block, block.message) });
    else {
      const parsed = parseCertificate(block.der);
      if (!parsed.ok) messages.push({ tone: 'error', text: placed(read.blocks, block, parsed.message) });
      else certificates.push(parsed.certificate);
      for (const note of blockNotes(block)) messages.push({ tone: 'note', text: placed(read.blocks, block, note) });
    }
  }
  if (read.message) messages.push({ tone: certificates.length > 0 ? 'note' : 'error', text: read.message });
  return { certificates, messages };
};

const SIZE = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** A file's size under the field (§3, as `hash` §8): `703 bytes`, `1.2 KB`, `1 MB` (1 KB = 1 024 bytes). */
export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
    : bytes < 1024 * 1024
      ? `${SIZE.format(bytes / 1024)} KB`
      : `${SIZE.format(bytes / (1024 * 1024))} MB`;
