/**
 * A command asked for on one page of ours and carried out by a part that is not there yet: "New scratch file" pressed
 * on the start page or in another section goes to the Projects section, which opens its language popup on arrival.
 * The intent lives in the page's memory, never in the address — an address only shows, it never makes or changes
 * anything (finding F6) — and it is taken once.
 */

let asked: string | null = null;
const listeners = new Set<(id: string) => void>();

/** Asks for a command: the part that carries it out takes it now, if it is there, or when it arrives. */
export const ask = (id: string): void => {
  asked = id;
  for (const listener of [...listeners]) listener(id);
};

/** Takes the command if it was asked for and not taken yet. */
export const take = (id: string): boolean => {
  if (asked !== id) return false;
  asked = null;
  return true;
};

/** Hears every later ask; returns the undo. */
export const onAsk = (listener: (id: string) => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
