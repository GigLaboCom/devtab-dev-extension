/**
 * When the shell builds the page's host (src/history/behaviors.ts): once the edition source knows the edition in force
 * (`ready`), or after two seconds — a source that cannot read its place does not hold the page back; the host is then
 * built with `unknown`, as the free edition, and follows the source when its state arrives.
 */
import type { EditionSource } from '@src/edition/source';

/** The longest the shell waits for the edition in force before it builds the host. */
export const EDITION_WAIT_MS = 2_000;

/** `ready`, or nothing after `ms`. */
export const readyWithin = (ready: Promise<unknown>, ms: number): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    ready.then(
      () => (clearTimeout(timer), resolve()),
      () => (clearTimeout(timer), resolve()),
    );
  });

/** `build(source)` once the source is ready, or after `ms`. */
export const whenEditionKnown = async <T>(
  source: EditionSource,
  build: (source: EditionSource) => T,
  ms: number = EDITION_WAIT_MS,
): Promise<T> => {
  await readyWithin(source.ready, ms);
  return build(source);
};
