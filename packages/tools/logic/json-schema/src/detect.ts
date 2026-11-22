/**
 * Does pasted text look like a JSON Schema (docs/tools/specs/json-schema.md §7)? Only a JSON object whose root names a
 * json-schema.org draft in `$schema`: any other JSON belongs to the JSON tool. Cheap first: the first meaningful
 * character is `{` and `"$schema"` appears in the first 4 Ki; only then is the text read (at most 1 Mi characters).
 */
import { parseJsonTree } from '@workspace/tools-shared/json-scan';

export const DETECT_MAX = 1024 * 1024;
const PREFIX = 4096;
const DRAFT_HOST = /^https?:\/\/json-schema\.org\//;

export const detectJsonSchema = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > DETECT_MAX || trimmed.charCodeAt(0) !== 123) return false;
  if (!trimmed.slice(0, PREFIX).includes('"$schema"')) return false;
  const read = parseJsonTree(trimmed);
  if (!read.ok || read.tree.type !== 'object') return false;
  const entry = read.tree.entries.find(e => e.key === '$schema');
  return entry?.value.type === 'string' && DRAFT_HOST.test(entry.value.value);
};
