/**
 * JSON Pointer (RFC 6901) and the paths of the tool's violations (docs/tools/specs/json-schema.md §5 п. 28): a path is
 * a linked list of tokens while validating, so stepping into a child costs nothing; it becomes a pointer string only
 * for a violation.
 */
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export interface Path {
  parent: Path | null;
  token: string | number;
}

export const step = (parent: Path | null, token: string | number): Path => ({ parent, token });

const escape = (token: string | number): string =>
  typeof token === 'number' ? String(token) : token.replace(/~/g, '~0').replace(/\//g, '~1');

/** '' for the root, '/a/0/b~1c' otherwise. */
export const pointerOf = (path: Path | null): string => {
  const parts: string[] = [];
  for (let p = path; p; p = p.parent) parts.push(escape(p.token));
  return parts.length === 0 ? '' : `/${parts.reverse().join('/')}`;
};

export const tokensOf = (path: Path | null): Array<string | number> => {
  const parts: Array<string | number> = [];
  for (let p = path; p; p = p.parent) parts.push(p.token);
  return parts.reverse();
};

/** A pointer's tokens, or null when it is not one (it must be empty or start with `/`; `~` only as `~0` or `~1`). */
export const parsePointer = (pointer: string): string[] | null => {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return null;
  const tokens = pointer.slice(1).split('/');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (/~(?![01])/.test(t)) return null;
    tokens[i] = t.replace(/~1/g, '/').replace(/~0/g, '~');
  }
  return tokens;
};

/** The node a pointer's tokens lead to from `root`, or null. An object member — the first with that name. */
export const nodeAt = (root: JsonNode, tokens: readonly string[]): JsonNode | null => {
  let node: JsonNode = root;
  for (const t of tokens) {
    if (node.type === 'object') {
      const entry = node.entries.find(e => e.key === t);
      if (!entry) return null;
      node = entry.value;
    } else if (node.type === 'array') {
      if (!/^(?:0|[1-9][0-9]*)$/.test(t)) return null;
      const item = node.items[Number(t)];
      if (!item) return null;
      node = item;
    } else return null;
  }
  return node;
};

/** A URI fragment (percent-encoded, RFC 6901 §6) as a pointer's text, or null when its encoding is broken. */
export const decodeFragment = (fragment: string): string | null => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null;
  }
};
