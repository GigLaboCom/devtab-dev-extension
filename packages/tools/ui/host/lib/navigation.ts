/**
 * Sending the person elsewhere in the host (`ToolHost.navigation`): a tool asks to go to another place — another tool,
 * or a part of the host such as its comparison of two texts — and may hand that place what it should start with. The
 * tool never imports the host's router or addresses; it names the place, the host decides whether it has it:
 *
 *   const went = await navigationOf(host).go({ part: 'compare' }, { replace: true });
 *   await navigationOf(host).go({ tool: 'json' }, { payload: { texts: [{ text: value }] } });
 *   if (!went) …                       // no such place here, or no host at all: say so, stay
 *
 * What is handed over travels in memory: never in the address, never in storage; the place takes it once. A tool
 * rendered with no host gets `noNavigation`, which goes nowhere and says so.
 */

/**
 * A place of the host. `{ tool }` — another tool, by its id. `{ part }` — a part of the host by a name hosts share:
 * 'compare' — the comparison of two texts. A host that has no such place refuses it.
 */
export type HostPlace = { tool: string } | { part: string };

/** One text handed to a place. A name (a file's) tells the place what the text is, its language for one. */
export interface HandedText {
  text: string;
  name?: string;
}

/**
 * What a place starts with. Texts in order: a tool takes the first as its input; the comparison takes two, the
 * original and then the changed text.
 */
export interface Handover {
  texts: readonly HandedText[];
}

export interface GoOptions {
  /** What the place starts with, kept in memory until it takes it. A place that takes nothing ignores it. */
  payload?: Handover;
  /**
   * Take the place of the current entry of the host's history instead of adding one — for a page that only leads
   * elsewhere: Back then returns to where the person was before it.
   */
  replace?: boolean;
}

/** Seam `ToolNavigation`: going to another place of the host. */
export interface ToolNavigation {
  /** Resolves true when the host went there; false when it cannot (it has no such place, or there is no host). */
  go(place: HostPlace, options?: GoOptions): Promise<boolean>;
}

/** The default that needs no host: there is nowhere to go, and it says so. */
export const noNavigation: ToolNavigation = { go: () => Promise.resolve(false) };

/** The host's navigation, or the default when the host has none (or there is no host). */
export const navigationOf = (host?: { navigation?: ToolNavigation }): ToolNavigation =>
  host?.navigation ?? noNavigation;
