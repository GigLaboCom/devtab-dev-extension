/**
 * A rough, local estimate of a master password's strength — nothing is sent anywhere. The password protects the history
 * against someone who has the profile's files or an export and can try passwords offline, so the floor is high: at least
 * 12 characters and an estimate of at least 60 bits (the pool of the character classes used, to the power of the length;
 * runs and repeats count once). It is an estimate, and the page says so.
 */
export const MIN_LENGTH = 12;
export const MIN_BITS = 60;

export interface Strength {
  bits: number;
  ok: boolean;
  /** Why it is not enough, for the line under the field. */
  problem?: string;
}

const POOLS: Array<[RegExp, number]> = [
  [/[a-z]/, 26],
  [/[A-Z]/, 26],
  [/[0-9]/, 10],
  [/[^a-zA-Z0-9]/, 33],
];

export const passwordStrength = (password: string): Strength => {
  const chars = [...password];
  const pool = POOLS.reduce((n, [re, size]) => (re.test(password) ? n + size : n), 0);
  // Characters that repeat or continue a run (aaaa, abcd, 1234) add little: count them once.
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const prev = chars[i - 1]?.codePointAt(0);
    const cur = chars[i].codePointAt(0)!;
    if (prev !== undefined && (cur === prev || Math.abs(cur - prev) === 1)) effective += 0.25;
    else effective += 1;
  }
  const bits = Math.floor(effective * Math.log2(Math.max(pool, 1)));
  if (chars.length < MIN_LENGTH) return { bits, ok: false, problem: `Use at least ${MIN_LENGTH} characters.` };
  if (bits < MIN_BITS) return { bits, ok: false, problem: 'Too easy to guess: make it longer or less regular.' };
  return { bits, ok: true };
};
