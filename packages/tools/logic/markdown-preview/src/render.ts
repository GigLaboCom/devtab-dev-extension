/**
 * Markdown → HTML (docs/tools/specs/markdown-preview.md §5.1–§5.5): markdown-it with the specification's options and
 * three rules of its own — task lists (§5.3), alignment as classes instead of `style` (§5.6), images that are never
 * images (§5.5). The output is markdown-it's HTML string, before the allowlist (allowlist.ts) rebuilds it as nodes.
 * Pure: runs in Node and in a page alike, no DOM.
 */
import markdownit from 'markdown-it';
import type { MarkdownIt, RendererRule, StateCore, Token } from 'markdown-it';

/** `[ ] `, `[x] `, `[X] ` at the very start of a list item's first paragraph (§5.3): four characters. */
const TASK_MARKER = /^\[([ xX])\] /;
const TASK_MARKER_LENGTH = 4;
const ALIGNMENT = /^text-align:(left|center|right)$/;

/**
 * §5.3: a list item whose first child is a paragraph starting with a task marker loses the marker and gets a disabled
 * checkbox in front of its text, and the class `task-list-item`. Runs after `inline`, so the paragraph's children are
 * there; the marker is in the first text child (markdown-it gathers the brackets and the text into one pending text).
 */
const taskLists = (state: StateCore): void => {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i]!.type !== 'list_item_open') continue;
    const paragraph = tokens[i + 1]!;
    const inline = tokens[i + 2]!;
    if (paragraph.type !== 'paragraph_open' || inline.type !== 'inline') continue;
    const first = inline.children?.[0];
    const marker = first?.type === 'text' ? TASK_MARKER.exec(first.content) : null;
    if (!first || !marker || !inline.children) continue;
    first.content = first.content.slice(TASK_MARKER_LENGTH);
    const box = new state.Token('task_checkbox', 'input', 0);
    box.meta = { checked: marker[1] !== ' ' };
    inline.children.unshift(box);
    inline.content = inline.content.slice(TASK_MARKER_LENGTH);
    tokens[i]!.attrJoin('class', 'task-list-item');
  }
};

const taskCheckbox: RendererRule = (tokens, idx) =>
  `<input type="checkbox" disabled=""${(tokens[idx]!.meta as { checked: boolean }).checked ? ' checked=""' : ''}>`;

/** markdown-it writes a column's alignment as `style="text-align:…"`; the page's policy would refuse it. A class. */
const alignedCell: RendererRule = (tokens, idx, options, _env, self) => {
  const token: Token = tokens[idx]!;
  const style = token.attrGet('style');
  const align = typeof style === 'string' ? ALIGNMENT.exec(style)?.[1] : undefined;
  if (token.attrs) token.attrs = token.attrs.filter(([name]) => name !== 'style');
  if (token.attrs?.length === 0) token.attrs = null;
  if (align) token.attrJoin('class', `md-align-${align}`);
  return self.renderToken(tokens, idx, options);
};

/** §5.5: no `<img>` at all — a frame with the alternative text and, on hover, the address that was not loaded. */
const notAnImage =
  (escape: (s: string) => string): RendererRule =>
  (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const src = String(token.attrGet('src') ?? '');
    const alt = self.renderInlineAsText(token.children ?? [], options, env);
    return `<span class="md-image" title="Image not loaded: ${escape(src)}">${escape(alt === '' ? 'image' : alt)}</span>`;
  };

/** markdown-it with the options of §5.1 and the rules of §5.3–5.5 (task lists, alignment classes, images). */
export const createRenderer = (): MarkdownIt => {
  const md = markdownit('default', { html: false, linkify: true, typographer: false, breaks: false });
  // §5.1: links on bare addresses need a scheme (`www.example.com` stays text), mail addresses are links.
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: true });
  md.core.ruler.after('inline', 'task_lists', taskLists);
  md.renderer.rules.task_checkbox = taskCheckbox;
  md.renderer.rules.th_open = alignedCell;
  md.renderer.rules.td_open = alignedCell;
  md.renderer.rules.image = notAnImage(md.utils.escapeHtml);
  return md;
};

let shared: MarkdownIt | undefined;

/** Markdown → HTML string (markdown-it's output, before the allowlist). Pure, runs in Node. */
export const renderMarkdown = (source: string): string => (shared ??= createRenderer()).render(source);
