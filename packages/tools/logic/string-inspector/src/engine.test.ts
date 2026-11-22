/**
 * Where the answer depends on the engine's Unicode data (docs/tools/specs/string-inspector.md §15 item 1): what Node
 * 22.20 (Unicode 16.0, ICU 77.1) gives, pinned here, with what Chrome 159 (Unicode 17) gives for the same input —
 * measured by the e2e module (scripts/e2e-tools/string-inspector.mjs, its list EXPECTED_DIFFERENCES) and by a probe of
 * every code point. The tool shows what the browser makes of the text; these tests make a Node upgrade fail loudly
 * here rather than quietly change the others.
 */
import {
  categoryOf,
  inspect,
  rows,
  summarize,
  unicodeVersion,
  visibleParts,
  partsText,
  warningLines,
} from './index.ts';
import { describe, expect, it } from 'vitest';

describe('the engine the unit tests run on', () => {
  it('is Node with Unicode 16.0 (the e2e module checks Chrome 159: 17.0 or later)', () => {
    expect(process.versions.unicode).toBe('16.0');
    expect(unicodeVersion()).toBe('16.0');
  });
});

describe('Node 22.20 against Chrome 159, input by input', () => {
  it('e-mail a@b.com: 4 words here; Chrome ends a word at a full stop between letters and counts 5', () => {
    expect(summarize('e-mail a@b.com').words).toBe(4);
  });

  it('p\u{430}ypal.com: one word here, quoted whole; Chrome quotes "p\u{430}ypal"', () => {
    expect(warningLines(inspect('p\u{430}ypal.com').warnings)).toEqual([
      'Mixed scripts in 1 word: "p\u{430}ypal.com" (Cyrillic, Latin).',
    ]);
  });

  it('\u{2605} + VS16: U+2605 is Extended_Pictographic here, so VS16 is part of it; Chrome marks VS16', () => {
    expect(partsText(visibleParts('\u{2605}\u{FE0F}'))).toBe('\u{2605}\u{FE0F}');
  });

  it('Khmer coeng \u{1780}\u{17D2}\u{1780}: two graphemes here, one in Chrome (Unicode 17)', () => {
    expect(summarize('\u{1780}\u{17D2}\u{1780}').graphemes).toBe(2);
  });

  it('U+20C1 SAUDI RIYAL SIGN: unassigned here (a warning), Sc Currency Symbol in Chrome', () => {
    expect(categoryOf(0x20c1)).toBe('Cn');
    expect(warningLines(inspect('\u{20C1}').warnings)).toEqual([
      '1 code point is private-use, unassigned or noncharacters: U+20C1.',
    ]);
  });

  it('U+A7F1: unassigned here; in Chrome a modifier letter that NFKC and NFKD change, and a word', () => {
    const r = inspect('\u{A7F1}');
    expect([r.summary.words, r.forms?.map(f => f.changes)]).toEqual([0, [false, false, false, false]]);
  });

  it('U+0295: Ll here, Lo in Chrome', () => {
    expect(rows('\u{295}')[0]!.category).toBe('Ll');
  });
});
