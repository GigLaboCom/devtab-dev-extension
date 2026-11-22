/**
 * Running the official JSON-Schema-Test-Suite (docs/tools/specs/json-schema.md §10, first two rows), shared by its test
 * and the counts in §15. The files are read by the shared scanner, never `JSON.parse`, so the suite's numbers reach the
 * validator as written (`optional/bignum.json`). Test-only: nothing of the tool imports this module.
 */
import { checkDocument } from './check';
import { compileParsed } from './compile';
import { member } from './registry';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import type { Draft } from './drafts';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export const SUITE_VERSIONS: Readonly<Record<Draft, number>> = {
  'draft-04': 4,
  'draft-06': 6,
  'draft-07': 7,
  '2019-09': 2019,
  '2020-12': 2020,
};

/** The suite's `compatibility` rule, as its README writes it. */
export const isCompatible = (compatibility: string | undefined, version: number): boolean => {
  if (!compatibility) return true;
  let valid = true;
  for (const part of compatibility.split(',')) {
    const m = /^(<=|=)?(\d+)$/.exec(part.trim());
    if (!m) return false;
    const op = m[1] ?? '';
    const v = Number(m[2]);
    valid = op === '' ? version >= v : op === '<=' ? version <= v : version === v;
    if (version <= v) break;
  }
  return valid;
};

export type Bucket = 'required' | 'optional' | 'format';

export interface SuiteCase {
  file: string;
  group: string;
  test: string;
  bucket: Bucket;
  /** Tagged `format-assertion`: run with Check formats on. */
  assert: boolean;
  schema: JsonNode;
  data: JsonNode;
  valid: boolean;
  external: Array<{ uri: string; tree: JsonNode }>;
}

const str = (n: JsonNode | undefined): string | undefined => (n?.type === 'string' ? n.value : undefined);

/** Every test of one file that applies to the draft. */
export const casesOf = (file: string, text: string, draft: Draft): SuiteCase[] => {
  const read = parseJsonTree(text);
  if (!read.ok) throw new Error(`${file}: ${read.error.message}`);
  const tests = member(read.tree, 'tests');
  if (tests?.type !== 'array') return [];
  const out: SuiteCase[] = [];
  for (const group of tests.items) {
    if (!isCompatible(str(member(group, 'compatibility')), SUITE_VERSIONS[draft])) continue;
    const tags = member(group, 'tags');
    const tagged =
      tags?.type === 'array' && tags.items.some(t => t.type === 'string' && t.value === 'format-assertion');
    const bucket: Bucket = file.startsWith('optional/') ? 'optional' : tagged ? 'format' : 'required';
    const externalNode = member(group, 'externalSchemas');
    const external =
      externalNode?.type === 'object' ? externalNode.entries.map(e => ({ uri: e.key, tree: e.value })) : [];
    const list = member(group, 'tests');
    if (list?.type !== 'array') continue;
    for (const t of list.items) {
      const valid = member(t, 'valid');
      out.push({
        file,
        group: str(member(group, 'description')) ?? '',
        test: str(member(t, 'description')) ?? '',
        bucket,
        assert: tagged,
        schema: member(group, 'schema')!,
        data: member(t, 'data')!,
        valid: valid?.type === 'boolean' && valid.value,
        external,
      });
    }
  }
  return out;
};

/** Runs one test: true when the tool's answer is the suite's, or the reason it is not. */
export const runCase = (c: SuiteCase, draft: Draft, formats: boolean): true | string => {
  const compiled = compileParsed(
    c.schema,
    [],
    c.external.map(e => ({ tree: e.tree, uri: e.uri })),
    draft,
  );
  if (compiled.problems.length > 0) return `schema refused: ${compiled.problems[0]!.message}`;
  const r = checkDocument(compiled.compiled, c.data, '', { formats, maxViolations: 10, maxCauses: 10 });
  if (!r.ok) return `stopped: ${r.message}`;
  if (r.valid === c.valid) return true;
  return r.valid
    ? 'valid, expected invalid'
    : `invalid (${r.violations[0]?.message ?? 'no violation'}), expected valid`;
};
