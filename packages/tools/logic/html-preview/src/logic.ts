/**
 * The HTML Preview tool's logic (docs/tools/specs/html-preview.md §9): the limits (§6, §12), the line «Not shown»
 * (§5.5), the rule for links (§5.2 step 7), the detection (§7), and — in their own modules — the check of the pasted
 * document (sanitize.ts, §5.2), its CSS (css.ts), the frame's half (render.ts, §5.3) and Copy HTML (serialize.ts, §5.6).
 * The DOM only through parameters (D14): a Document whose window parses the input, the frame's document to draw in.
 */
export { cleanCss } from './css';
export { MAX_DEPTH, nestingDepth } from './depth';
export { renderInto, BASE_CSS, WIDE_TABLE_COLUMNS } from './render';
export { sanitizeHtml } from './sanitize';
export { serializeSanitized } from './serialize';
export type { CleanCss } from './css';

export interface RemovedCounts {
  scripts: number;
  handlers: number;
  images: number;
  /** <link rel="stylesheet"> */
  stylesheets: number;
  imports: number;
  frames: number;
  media: number;
  inactiveLinks: number;
  /**
   * Declarations, rules and attributes cut from the CSS because they would load something (`url()`, `image-set()`, …;
   * §15): counted for the tests and the e2e report, not part of the line «Not shown».
   */
  styleUrls: number;
}

export interface SanitizedHtml {
  /** The parsed document's <body> after §5.2; its nodes are imported into the frame. */
  body: HTMLElement;
  htmlAttrs: Array<[string, string]>;
  bodyAttrs: Array<[string, string]>;
  /** Texts of the <style> elements, @import (and anything else that loads) removed, in document order. */
  sheets: string[];
  /** style attribute values by data-preview-style number (anything that loads removed). */
  inline: string[];
  counts: RemovedCounts;
}

/** Up to this many characters the preview follows every edit (§6, §12). */
export const LIVE_INPUT = 256 * 1024;
/** Above this many characters the tool refuses (§6, §12): 1 Mi = 1 048 576. */
export const MAX_INPUT = 1024 * 1024;
/** Between LIVE_INPUT and MAX_INPUT the preview is drawn this long after the last edit (§12). */
export const SETTLE_MS = 300;
/** What the frame may do (§5.1): the kit's FramedDocument sandbox — open a link in a new tab, nothing runs. */
export const FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';
/**
 * The frame's own policy (§5.1, §15): nothing may load at all — not even a file of the extension. Its look is adopted
 * constructed sheets and CSSOM, which a policy does not govern (verified in the built extension).
 */
export const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export const emptyCounts = (): RemovedCounts => ({
  scripts: 0,
  handlers: 0,
  images: 0,
  stylesheets: 0,
  imports: 0,
  frames: 0,
  media: 0,
  inactiveLinks: 0,
  styleUrls: 0,
});

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** §5.5; '' when nothing was removed. */
export const removedText = (counts: RemovedCounts): string => {
  const parts = [
    counts.scripts && plural(counts.scripts, 'script', 'scripts'),
    counts.handlers && plural(counts.handlers, 'event handler', 'event handlers'),
    counts.images && plural(counts.images, 'image', 'images'),
    counts.stylesheets + counts.imports &&
      plural(counts.stylesheets + counts.imports, 'external stylesheet', 'external stylesheets'),
    counts.frames && plural(counts.frames, 'embedded frame or object', 'embedded frames or objects'),
    counts.media && plural(counts.media, 'media source', 'media sources'),
    counts.inactiveLinks && plural(counts.inactiveLinks, 'link that would not open', 'links that would not open'),
  ].filter(Boolean);
  return parts.length === 0 ? '' : `Not shown: ${parts.join(', ')}.`;
};

/** ASCII whitespace at the edges, as the browser strips it from an address. */
const trimAscii = (s: string): string => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');

/**
 * §5.2 step 7 (the rule of markdown-preview §5.4): after trimming the edges, `http:`, `https:` or `mailto:` at the
 * start, any case, and no control character or space left anywhere (nothing hidden in the address).
 */
export const isOpenableHref = (href: string): boolean => {
  const trimmed = trimAscii(href);
  // eslint-disable-next-line no-control-regex -- a control character or a space anywhere: not a link we open
  return /^(?:https?|mailto):/i.test(trimmed) && !/[\u0000- \u007f]/.test(trimmed);
};

/** The address a link opens, as it is set on the link: its edges trimmed. */
export const openedHref = (href: string): string => trimAscii(href);

/** At most this many characters of the start of a text are looked at by `detect` (§7: it reads the start only). */
const DETECT_PREFIX = 1024;

/** §7: after trimming, `<!doctype html` or `<html` followed by a space, `>` or the end. Cheap: the start only. */
export const detectHtmlDocument = (text: string): boolean =>
  /^<(?:!doctype\s+html|html)(?:\s|>|$)/i.test(text.slice(0, DETECT_PREFIX).trim());
