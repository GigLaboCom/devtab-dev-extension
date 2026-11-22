/**
 * The official JSON-Schema-Test-Suite (docs/tools/specs/json-schema.md §10, first two rows; numbers in §15): the
 * directory `test-suite/tests` of this package is `validation/tests` of `json-schema-org/JSON-Schema-Test-Suite` at
 * commit e2a68a15cd490750fd6b95e604e4054d7d978d1f (2026-11-16), MIT (`test-suite/LICENSE`), checked in as data for the
 * tests and never shipped. Every required test of the five drafts is a test here and must pass; the optional ones
 * (`optional/`) and the `format-assertion` ones (run with Check formats on) are counted against the numbers §15 states.
 */
import { DRAFTS } from './drafts';
import { casesOf, runCase } from './suite';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Draft } from './drafts';
import type { SuiteCase } from './suite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../test-suite/tests');
const FILES = [
  ...readdirSync(ROOT).filter(f => f.endsWith('.json')),
  ...readdirSync(join(ROOT, 'optional')).map(f => `optional/${f}`),
].map(file => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));

const casesFor = (draft: Draft): SuiteCase[] => FILES.flatMap(f => casesOf(f.file, f.text, draft));

/** Required tests per draft (the count is part of the claim: a suite that lost files would pass vacuously). */
const REQUIRED: Record<Draft, number> = {
  '2020-12': 1319,
  '2019-09': 1292,
  'draft-07': 972,
  'draft-06': 878,
  'draft-04': 672,
};

/** Optional (`optional/`) and format-assertion tests that pass, per draft, of how many (§15). */
const OPTIONAL: Record<Draft, { optional: [number, number]; format: [number, number] }> = {
  '2020-12': { optional: [206, 206], format: [755, 763] },
  '2019-09': { optional: [187, 187], format: [743, 751] },
  'draft-07': { optional: [148, 152], format: [675, 683] },
  'draft-06': { optional: [112, 112], format: [340, 340] },
  'draft-04': { optional: [107, 107], format: [239, 239] },
};

/**
 * Every optional or format test the tool fails, and why (§15): the Bidi rule of RFC 5893 and the joining-type
 * alternative of the ZERO WIDTH NON-JOINER rule (RFC 5892 A.1) are not applied (§13); `content*` is an annotation only
 * (§5 п. 26), which draft 7 lets a validator choose.
 */
const KNOWN_FAILURES: Record<Draft, string[]> = (() => {
  const idna = [
    'format-hostname.json | validation of A-label (punycode) host names | ZERO WIDTH NON-JOINER not preceded by Virama but matches regexp',
    'format-idn-hostname.json | validation of internationalized host names | a label of only Arabic-Indic digits is invalid',
    'format-idn-hostname.json | validation of internationalized host names | right-to-left label mixing both digit types is invalid',
    'format-idn-hostname.json | validation of internationalized host names | label starting with a digit before a right-to-left letter is invalid',
    'format-idn-hostname.json | validation of internationalized host names | left-to-right label containing a right-to-left letter is invalid',
    'format-idn-hostname.json | validation of internationalized host names | Bidi domain name with a digit-first label is invalid',
    'format-idn-hostname.json | validation of internationalized host names | A-label that decodes to a Bidi rule violation is invalid',
    'format-idn-hostname.json | validation of internationalized host names | ZERO WIDTH NON-JOINER not preceded by Virama but matches regexp',
  ];
  const content = [
    'optional/content.json | validation of string-encoded content based on media type | an invalid JSON document',
    'optional/content.json | validation of binary string-encoding | an invalid base64 string (% is not a valid character)',
    'optional/content.json | validation of binary-encoded media type documents | a validly-encoded invalid JSON document',
    'optional/content.json | validation of binary-encoded media type documents | an invalid base64 string that is valid JSON',
  ];
  return { '2020-12': idna, '2019-09': idna, 'draft-07': [...content, ...idna], 'draft-06': [], 'draft-04': [] };
})();

for (const draft of DRAFTS) {
  describe(`JSON-Schema-Test-Suite, ${draft}`, () => {
    const cases = casesFor(draft);
    const required = cases.filter(c => c.bucket === 'required');

    it(`has ${REQUIRED[draft]} required tests`, () => {
      expect(required.length).toBe(REQUIRED[draft]);
    });

    it('passes every required test', () => {
      const failures = required
        .map(c => ({ c, r: runCase(c, draft, false) }))
        .filter(x => x.r !== true)
        .map(x => `${x.c.file} | ${x.c.group} | ${x.c.test}: ${String(x.r)}`);
      expect(failures).toEqual([]);
    });

    it('passes the optional and format tests §15 counts, and fails only the known ones', () => {
      const optional = cases.filter(c => c.bucket === 'optional');
      const format = cases.filter(c => c.bucket === 'format');
      const failed = (list: SuiteCase[], formats: (c: SuiteCase) => boolean): SuiteCase[] =>
        list.filter(c => runCase(c, draft, formats(c)) !== true);
      const optionalFailed = failed(optional, c => c.assert);
      const formatFailed = failed(format, () => true);
      expect({
        optional: [optional.length - optionalFailed.length, optional.length],
        format: [format.length - formatFailed.length, format.length],
      }).toEqual(OPTIONAL[draft]);
      const names = [...optionalFailed, ...formatFailed].map(c => `${c.file} | ${c.group} | ${c.test}`);
      expect([...new Set(names)].sort()).toEqual([...KNOWN_FAILURES[draft]].sort());
    });
  });
}
