/**
 * The start page's `detectSubnet` (docs/tools/specs/subnet.md §7), in a module of its own: it needs only the reader of
 * blocks, not the registries or the rest. A CIDR block with `/length` is unmistakable — a column of them too — while a
 * bare address looks like a version number, a time or a MAC address and is left alone.
 */
import { parseEntry } from './block';

export const DETECT_MAX = 64 * 1024;
export const DETECT_LINES = 1_000;

const isCidr = (line: string): boolean => {
  const slash = line.indexOf('/');
  if (slash === -1 || !/^[0-9]{1,3}$/.test(line.slice(slash + 1))) return false;
  const read = parseEntry(line);
  return read.ok && read.entry.kind === 'block' && !read.entry.fromAddress;
};

/** Which task a pasted text opens: one block — Explain, a column of 2 to 1,000 blocks — Summarize. */
export const detectedTask = (text: string): 'explain' | 'summarize' | undefined => {
  if (text.length > DETECT_MAX) return undefined;
  const lines = text
    .trim()
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '');
  if (!lines.length || lines.length > DETECT_LINES) return undefined;
  if (!lines.every(isCidr)) return undefined;
  return lines.length === 1 ? 'explain' : 'summarize';
};

export const detectSubnet = (text: string): boolean => detectedTask(text) !== undefined;
