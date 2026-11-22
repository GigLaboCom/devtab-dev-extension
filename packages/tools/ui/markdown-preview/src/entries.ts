/**
 * The Markdown Preview tool's texts and history helpers (the component's chunk only): the words of
 * docs/tools/specs/markdown-preview.md §6 and §8, the history label and search text.
 */
import type { MarkdownPreviewPayload } from './history';

export const TOO_LARGE = 'Text is larger than 1 MB. Markdown Preview works with up to 1 MB.';
export const EMPTY_PREVIEW = 'The preview appears here.';
export const PLACEHOLDER = '# Paste Markdown here';

/** The first line with words in it, without its Markdown marks, as History's label starts: `Project · 1,234 characters`. */
const firstLine = (input: string): string => {
  const line = input
    .slice(0, 2000)
    .split('\n')
    .map(l => l.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, '').trim())
    .find(l => l !== '' && !/^[-=*_|:\s`~]+$/.test(l));
  if (line === undefined) return '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

export const entryLabel = (input: string, payload: MarkdownPreviewPayload): string =>
  [
    firstLine(input),
    `${input.length.toLocaleString('en-US')} ${input.length === 1 ? 'character' : 'characters'}`,
    payload.action === 'copy' ? 'HTML copied' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the Markdown. */
export const excerpt = (input: string): string => input.slice(0, 2000);
