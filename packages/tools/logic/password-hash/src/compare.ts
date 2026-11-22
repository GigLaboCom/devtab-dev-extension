/**
 * The comparison of a computed hash with a stored one (docs/tools/specs/password-hash.md §5.8), in the tool's own code
 * and in constant time: every pair of bytes is looked at, with no early exit. The length is not secret (it is visible in
 * the stored string), so different lengths answer false at once.
 *
 * Why it matters little here: a timing attack needs someone who asks somebody else's check many times and measures the
 * answers; here a person checks on their own machine and holds both inputs, and the hash itself takes milliseconds to
 * seconds against nanoseconds for the comparison. It is done anyway: it is the right habit for code that checks
 * passwords, and this logic may run in another host (D14) where it sits closer to a server's role.
 */
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
};
