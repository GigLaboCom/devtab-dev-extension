// The CommonMark specification's own examples (commonmark-spec 0.31.2: CommonMark 0.31.2, 652 examples — a test
// fixture only, nothing of it ships) through this tool's renderer (§5.1). Every example either renders exactly as the
// specification says, or fails for a reason this tool chose, each reason proved by a renderer that differs from ours in
// that one choice alone:
//   html     raw HTML inside Markdown is text (§5.2: `html: false`) — the HTML blocks and raw HTML sections and every
//            example with a tag in it;
//   image    an image is never an <img> (§5.5) — the images section and images inside links;
//   linkify  addresses with a scheme and mail addresses become links (§5.1, GFM's autolinks) — CommonMark keeps them as
//            text;
// and three where markdown-it 15.0.3 itself differs in white space only (an empty block quote is
// `<blockquote></blockquote>`, the specification puts a line break inside) — its own preset does the same.
import { createRenderer } from './render';
import markdownit from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { MarkdownIt } from 'markdown-it';

interface Example {
  markdown: string;
  html: string;
  section: string;
  number: number;
}

const { tests } = createRequire(import.meta.url)('commonmark-spec') as { tests: Example[] };

/** The specification writes a tab as →; this tool writes void elements as `<br>`, the specification as `<br />`. */
const tabs = (s: string): string => s.replace(/→/g, '\t');
const expected = (e: Example): string => tabs(e.html).replace(/<(hr|br|img)([^>]*) \/>/g, '<$1$2>');

const ours = createRenderer();
const differingIn = (change: (md: MarkdownIt) => void): MarkdownIt => {
  const md = createRenderer();
  change(md);
  return md;
};
const reasons: Record<string, MarkdownIt> = {
  html: differingIn(md => md.set({ html: true })),
  image: differingIn(md => (md.renderer.rules.image = markdownit().renderer.rules.image)),
  linkify: differingIn(md => md.set({ linkify: false })),
};
const whiteSpace = (s: string): string => s.replace(/>\s+</g, '><');

const outcome = (e: Example): string => {
  const source = tabs(e.markdown);
  const want = expected(e);
  if (ours.render(source) === want) return 'pass';
  for (const [reason, md] of Object.entries(reasons)) if (md.render(source) === want) return reason;
  if (whiteSpace(ours.render(source)) === whiteSpace(want)) return 'white space';
  return 'unexplained';
};

const by = (reason: string): number[] => tests.filter(e => outcome(e) === reason).map(e => e.number);
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('the CommonMark 0.31.2 examples through this configuration', () => {
  it('are all there', () => {
    expect(tests).toHaveLength(652);
  });

  it('551 render exactly as the specification says', () => {
    expect(by('pass')).toHaveLength(551);
  });

  it('72 differ because raw HTML is text (§5.2)', () => {
    expect(by('html')).toEqual([
      21,
      31,
      ...range(148, 191),
      201,
      308,
      309,
      344,
      475,
      476,
      477,
      491,
      494,
      524,
      536,
      613,
      614,
      615,
      616,
      617,
      623,
      ...range(625, 631),
      642,
      643,
    ]);
  });

  it('22 differ because an image is never an <img> (§5.5)', () => {
    expect(by('image')).toEqual([517, 520, 531, ...range(572, 589), 591]);
  });

  it('4 differ because addresses and mail addresses become links (§5.1)', () => {
    expect(by('linkify')).toEqual([602, 608, 611, 612]);
  });

  it('3 differ in white space only (markdown-it’s empty block quote), none is unexplained', () => {
    expect(by('white space')).toEqual([218, 239, 240]);
    expect(by('unexplained')).toEqual([]);
  });
});
