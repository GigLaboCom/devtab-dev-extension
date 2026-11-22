/**
 * Printing a value of the document (docs/tools/specs/json-query.md §5 п. 26): literals and names exactly as written —
 * `1.0`, `1e400`, `12345678901234567890`, `"é"` stay themselves — only the whitespace between tokens is the
 * printer's. Minified (a result row) or indented by 2 (a copy, as the JSON tool's Format). An explicit stack, no
 * recursion; with a limit it stops soon after passing it, so a row never prints a large value whole.
 */
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export const PREVIEW_CHARS = 200;

const indents: string[] = [''];
const indent = (level: number): string => {
  while (indents.length <= level) indents.push(`${indents[indents.length - 1]}  `);
  return indents[level]!;
};

const scalar = (node: JsonNode): string | null => {
  switch (node.type) {
    case 'string':
    case 'number':
      return node.raw;
    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'array':
      return node.items.length === 0 ? '[]' : null;
    case 'object':
      return node.entries.length === 0 ? '{}' : null;
  }
};

interface Frame {
  node: Extract<JsonNode, { type: 'array' | 'object' }>;
  next: number;
  level: number;
}

/**
 * The value as text: `layout` 2 — indented by two spaces per level, starting at `base` levels (a member of a printed
 * array); 'minify' — no whitespace. Past `limit` characters the text is cut there (the caller marks it).
 */
export const printValue = (node: JsonNode, layout: 2 | 'minify', limit = Infinity, base = 0): string => {
  const pretty = layout === 2;
  let out = '';
  const stack: Frame[] = [];
  const open = (value: JsonNode, level: number): void => {
    const s = scalar(value);
    if (s !== null) {
      out += s;
      return;
    }
    const container = value as Frame['node'];
    out += container.type === 'array' ? '[' : '{';
    stack.push({ node: container, next: 0, level });
  };
  open(node, base);
  while (stack.length > 0 && out.length <= limit) {
    const top = stack[stack.length - 1]!;
    const size = top.node.type === 'array' ? top.node.items.length : top.node.entries.length;
    if (top.next < size) {
      const k = top.next++;
      if (k > 0) out += ',';
      if (pretty) out += `\n${indent(top.level + 1)}`;
      if (top.node.type === 'array') open(top.node.items[k]!, top.level + 1);
      else {
        const entry = top.node.entries[k]!;
        out += pretty ? `${entry.raw}: ` : `${entry.raw}:`;
        open(entry.value, top.level + 1);
      }
      continue;
    }
    if (pretty) out += `\n${indent(top.level)}`;
    out += top.node.type === 'array' ? ']' : '}';
    stack.pop();
  }
  return out.length > limit ? out.slice(0, limit) : out;
};

/** A result row's value: minified, cut to 200 characters with «…» (never between the halves of a pair). */
export const previewValue = (node: JsonNode): string => {
  const text = printValue(node, 'minify', PREVIEW_CHARS + 1);
  if (text.length <= PREVIEW_CHARS) return text;
  let cut = PREVIEW_CHARS - 1;
  const c = text.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut--;
  return `${text.slice(0, cut)}…`;
};
