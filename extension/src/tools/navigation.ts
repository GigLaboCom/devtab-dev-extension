/**
 * The tools' navigation in this host (`ToolHost.navigation`, @workspace/tools-host): a tool names a place, this page
 * goes there by its address — a hash change in the same tab, so what is handed over stays in this document's memory.
 *
 *   { tool: id }    `#/tools/<id>` of a tool the registry has; the first handed text becomes its input (app/handoff.ts)
 *   { part: name }  a section of the page: `#/compare`, `#/settings`, …; «Compare code» takes the handed texts as the
 *                   original and the changed text (compare/handoff.ts); the other sections take nothing
 *
 * `replace` swaps the current entry of the tab's history for the place (`location.replace`): Back returns to where the
 * person was before. Texts never go into the address or into storage. ToolsPage puts this into every tool's host.
 */
import { clearHandoff, handOff } from '@src/app/handoff';
import { parseRoute, routeHash } from '@src/app/route';
import { clearHandedTexts, handToCompare } from '@src/compare/handoff';
import { toolById } from '@src/tools/registry';
import type { HandedCompareText } from '@src/compare/handoff';
import type { HostPlace, ToolNavigation } from '@workspace/tools-host';

export interface NavigationDeps {
  location: Pick<Location, 'hash' | 'replace'>;
  hasTool: (id: string) => boolean;
  /** Text for a tool to start with (its `input`). */
  handToTool: (id: string, text: string) => void;
  /** The original and the changed text for «Compare code». */
  handToCompare: (texts: readonly HandedCompareText[]) => void;
  /** Drops whatever an earlier going handed over and nobody took. */
  clear: () => void;
}

/** The address of a place this page has, or null. A part is a section's own address, never a tool's. */
export const addressOf = (place: HostPlace, hasTool: (id: string) => boolean): string | null => {
  if ('tool' in place) return hasTool(place.tool) ? routeHash({ section: 'tools', tool: place.tool }) : null;
  const hash = `#/${place.part}`;
  return !place.part.includes('/') && routeHash(parseRoute(hash)) === hash ? hash : null;
};

export const hashNavigation = (deps: NavigationDeps): ToolNavigation => ({
  go: (place, options = {}) => {
    const hash = addressOf(place, deps.hasTool);
    if (!hash) return Promise.resolve(false);
    deps.clear();
    const texts = options.payload?.texts ?? [];
    if (texts.length && 'tool' in place) deps.handToTool(place.tool, texts[0]!.text);
    if (texts.length && 'part' in place && place.part === 'compare')
      deps.handToCompare(texts.slice(0, 2).map(t => ({ text: t.text, name: t.name ?? null })));
    if (options.replace) deps.location.replace(hash);
    else deps.location.hash = hash;
    return Promise.resolve(true);
  },
});

/** This page's navigation: its own address, its tools, its hand-offs. */
export const pageNavigation = (win: Pick<Window, 'location'>): ToolNavigation =>
  hashNavigation({
    location: win.location,
    hasTool: id => toolById(id) !== undefined,
    handToTool: handOff,
    handToCompare,
    clear: () => {
      clearHandoff();
      clearHandedTexts();
    },
  });
