import { DESTINATION, REPLACES_ADDRESS } from './logic';
import { describe, expect, it } from 'vitest';

// docs/tools/specs/text-diff.md §4: the tool has no input, output or computation of its own (§3, §9) — only where it
// leads. The rows of §10 are about the host and «Compare code»: they are tests of the component
// (packages/tools/ui/text-diff), of the host's navigation (extension/src/tools/navigation.test.ts) and of the e2e module
// (scripts/e2e-tools/text-diff.mjs).
describe('text-diff §4', () => {
  it('leads to the host’s comparison of two texts, «Compare code»', () => {
    expect(DESTINATION).toEqual({ part: 'compare' });
  });

  it('replaces its own address instead of adding an entry to the history', () => {
    expect(REPLACES_ADDRESS).toBe(true);
  });
});
