/**
 * Equality of JSON values for `const`, `enum` and `uniqueItems` (docs/tools/specs/json-schema.md §5 п. 17): numbers by
 * value (`1.0` equals `1`), strings after decoding, arrays item by item, objects by names and, at each name, the list of
 * its values in document order (a repeated key is kept, §5 п. 6). Every value gets a canonical text — equal values,
 * equal texts — built with an explicit stack (no recursion), so `uniqueItems` hashes instead of comparing pairs.
 */
import { canonicalNumber } from './decimal';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

const memo = new WeakMap<JsonNode, string>();

export const canonical = (root: JsonNode): string => {
  const known = memo.get(root);
  if (known !== undefined) return known;
  const stack: Array<{ node: JsonNode; done: boolean }> = [{ node: root, done: false }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const node = top.node;
    if (memo.has(node)) {
      stack.pop();
      continue;
    }
    if (node.type === 'array' || node.type === 'object') {
      const children = node.type === 'array' ? node.items : node.entries.map(e => e.value);
      if (!top.done) {
        top.done = true;
        for (let i = children.length - 1; i >= 0; i--)
          if (!memo.has(children[i]!)) stack.push({ node: children[i]!, done: false });
        continue;
      }
      if (node.type === 'array') memo.set(node, `[${node.items.map(i => memo.get(i)!).join(',')}]`);
      else {
        const byName = new Map<string, string[]>();
        for (const e of node.entries) {
          const list = byName.get(e.key);
          if (list) list.push(memo.get(e.value)!);
          else byName.set(e.key, [memo.get(e.value)!]);
        }
        const names = [...byName.keys()].sort();
        memo.set(node, `{${names.map(n => `${JSON.stringify(n)}:${byName.get(n)!.join('|')}`).join(',')}}`);
      }
      stack.pop();
      continue;
    }
    memo.set(
      node,
      node.type === 'string'
        ? JSON.stringify(node.value)
        : node.type === 'number'
          ? `#${canonicalNumber(node.raw)}`
          : node.type === 'boolean'
            ? String(node.value)
            : 'null',
    );
    stack.pop();
  }
  return memo.get(root)!;
};

export const jsonEqual = (a: JsonNode, b: JsonNode): boolean => {
  if (a.type !== b.type) return false;
  if (a.type === 'boolean') return a.value === (b as typeof a).value;
  if (a.type === 'null') return true;
  if (a.type === 'string') return a.value === (b as typeof a).value;
  return canonical(a) === canonical(b);
};
