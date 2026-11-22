/**
 * The HTML Preview tool's texts and history helpers (the component's chunk only): the words of
 * docs/tools/specs/html-preview.md §6 and §8, the widths of §4, the history label, search text and payload guard.
 */
import type { HtmlPreviewPayload } from './history';

export const TOO_LARGE = 'HTML is larger than 1 MB. HTML Preview works with up to 1 MB.';
export const TOO_DEEP = 'HTML nests elements more than 512 levels deep. HTML Preview works with up to 512 levels.';
export const PLACEHOLDER = '<p>Paste HTML here</p>';
export const HINT = 'Scripts are not run. Images, fonts and external styles are not loaded. Links open in a new tab.';

export type Width = HtmlPreviewPayload['width'];
/** §4: the widths offered, in this order, with their labels. */
export const WIDTHS: ReadonlyArray<{ value: Width; label: string }> = [
  { value: 'fit', label: 'Fit' },
  { value: '375', label: '375 px' },
  { value: '768', label: '768 px' },
  { value: '1024', label: '1024 px' },
];
export const isWidth = (value: unknown): value is Width => WIDTHS.some(w => w.value === value);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The words of a piece of markup, roughly: tags, comments, styles and scripts out, a few entities decoded. */
const words = (markup: string): string =>
  markup
    .replace(/<!--[^]*?-->|<(style|script|head|title)\b[^]*?<\/\1\s*>|<[^>]*>/gi, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** History's label: the document's title or its first words (up to 60), the size, `HTML copied` for a commit. */
export const entryLabel = (input: string, payload: HtmlPreviewPayload): string => {
  const start = input.slice(0, 2000);
  const title = /<title\b[^>]*>([^<]{1,200})<\/title>/i.exec(start)?.[1];
  const line = words(title ?? start);
  return [
    line.length > 60 ? `${line.slice(0, 59)}…` : line,
    `${input.length.toLocaleString('en-US')} ${input.length === 1 ? 'character' : 'characters'}`,
    payload.action === 'copy' ? 'HTML copied' : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

/** What History's text search looks in: the start of the HTML. */
export const excerpt = (input: string): string => input.slice(0, 2000);

/** A schema 1 payload, or the defaults for anything else. */
export const readPayload = (payload: unknown): HtmlPreviewPayload => {
  const width = (payload as { width?: unknown } | null)?.width;
  return { width: isWidth(width) ? width : 'fit' };
};
