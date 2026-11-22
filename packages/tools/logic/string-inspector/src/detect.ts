/**
 * Does pasted text hide something (docs/tools/specs/string-inspector.md §7)? Yes when it holds a character ordinary text
 * never has and that makes it suspect: U+200B, U+2060, U+FEFF, U+180E, the embeddings and overrides U+202A–U+202E, the
 * isolates U+2066–U+2069, or a lone surrogate. Not an emoji with ZWJ or VS16, not Hebrew or Arabic, not NBSP or a soft
 * hyphen (any text copied from a site has them), not a flag of tag characters. One expression without `g` and without
 * repetition: linear on a megabyte. Written with escapes, so this file stays plain to read.
 */
const SUSPECT =
  /[\u{200B}\u{2060}\u{FEFF}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{180E}]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export const detectStringIssues = (text: string): boolean => SUSPECT.test(text);
