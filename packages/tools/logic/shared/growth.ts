/**
 * A test of an algorithm's shape, not of milliseconds. Tests that bound the time of a large input in milliseconds, or
 * the ratio of two runs measured one after the other, fail when other builds share the machine. `growth` answers "how
 * much more does one run on an input `factor` times larger cost than runs on `factor` small inputs of the same total
 * size": about 1 for linear work, about `factor` for quadratic work, whatever the machine's load.
 *
 * - Equal amounts of work are compared: `factor` different small inputs, each run once, against the large input run
 *   once. Both measurements are about as long, so a busy machine stretches them alike; and both read as much memory,
 *   so neither profits from a cache the other cannot use (one small input run eight times would stay in the cache
 *   while the large one streams from memory — under load that alone measured 8–11 for linear work).
 * - They are timed in alternation, round after round, so a burst of load falls on both.
 * - The fastest of `rounds` is kept for each: a collector's pause or another process lengthens a run, never shortens
 *   it.
 *
 * With `factor` 8, linear work measures about 1 (n log n about 1.2–1.5) and quadratic work about 8:
 * `toBeLessThan(GROWTH_BOUND)` (3) sits between them with room on both sides. Choose a size at which one small run
 * takes a millisecond or more, so the work, not the call, is measured. Pure: no DOM, no Node API.
 */

/** Between linear (about 1) and quadratic (about `factor`, 8 by default) growth, with room for noise on both sides. */
export const GROWTH_BOUND = 3;

export interface GrowthOptions {
  /** How much larger the large input is; 8 by default. */
  factor?: number;
  /** How many alternating rounds; the fastest of each side is kept. 5 by default. */
  rounds?: number;
}

/**
 * The cost of `run` on `make(size × factor)` over its cost on `factor` inputs `make(size)` — see the module's comment.
 * Every input is built before any timing.
 */
export const growth = <T>(
  run: (input: T) => unknown,
  make: (size: number) => T,
  size: number,
  { factor = 8, rounds = 5 }: GrowthOptions = {},
): number => {
  const smalls = Array.from({ length: factor }, () => make(size));
  const large = make(size * factor);
  // Warm-up: the first runs compile the code.
  run(smalls[0]!);
  run(large);
  let bestSmall = Infinity;
  let bestLarge = Infinity;
  for (let round = 0; round < rounds; round++) {
    let started = performance.now();
    for (const small of smalls) run(small);
    bestSmall = Math.min(bestSmall, performance.now() - started);
    started = performance.now();
    run(large);
    bestLarge = Math.min(bestLarge, performance.now() - started);
  }
  return bestLarge / Math.max(bestSmall, 0.001);
};
