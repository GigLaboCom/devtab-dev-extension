/**
 * `detectNumberBase` (docs/tools/specs/number-base.md §7) in a module of its own: the ui package's `./detect` re-exports
 * it, and a host loads every tool's `detect` together, lazily, when pasted text needs them. It imports nothing.
 */

/** A sign, then 0x / 0b / 0o and at least one digit of that base; `_` between digits. */
const PREFIXED = /^[+-]?(?:0[xX][0-9a-fA-F][0-9a-fA-F_]*|0[bB][01][01_]*|0[oO][0-7][0-7_]*)$/;
/** 10,000 digits with a sign and a prefix (§7). */
const MAX_DETECT = 10_004;

/**
 * Does pasted text look like this tool's input (§7)? Only a number with its base's prefix: a bare `1700000000` is more
 * likely a Unix time and `deadbeef` bytes or a hash. Length first, then one anchored expression with no nested
 * repetition, so a long paste costs one linear pass.
 */
export const detectNumberBase = (text: string): boolean => {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_DETECT && PREFIXED.test(t);
};

/**
 * Which field a handed text opens in: the field of its prefix (after an optional sign), else Decimal. An addition to
 * §9 — the component puts text from the start page into this field.
 */
export const fieldOfText = (text: string): 2 | 8 | 10 | 16 => {
  const m = /^\s*[+-]?0([xXbBoO])/.exec(text);
  const letter = m?.[1]?.toLowerCase();
  return letter === 'x' ? 16 : letter === 'b' ? 2 : letter === 'o' ? 8 : 10;
};
