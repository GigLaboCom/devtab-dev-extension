/**
 * Seam `PaletteSource` — what the shell's palette offers (docs/replaceable-behaviors.md). The palette asks it for rows
 * on every query; before anything is typed it shows what the source offers for the empty query. Asynchronous (a later
 * source may ask the companion: repositories, files), but a source that already knows its rows answers with
 * `settled(…)`, which React's `use()` reads without suspending, so the palette draws them in the same frame.
 *
 * What the palette does with pasted text is not the source's: the `PasteRecogniser` recognises it (tools/recogniser.ts),
 * as on the start page — one finder, not two.
 *
 * Besides the places, a query finds the commands of a section that have a target now (`PaletteContext.commands`,
 * D38: "New scratch file" wherever the edition has scratch files, the panels of an open project, the open scratch's
 * actions), ranked with the places by the same matcher — the IDEs' "search everywhere". Before anything is typed the
 * palette shows the places only, as it did.
 */
import { matchDestinations } from '@src/shared/fuzzy';
import { settled } from '@src/start/tileSources';
import type { Destination } from '@src/shared/destinations';
import type { FieldResult, FinderGroup } from '@src/shared/finder';

/** A command the palette can run (src/shortcuts/actions.ts, `ShortcutAction.command`). */
export interface PaletteCommand {
  id: string;
  title: string;
  keywords?: readonly string[];
}

export interface PaletteContext {
  /** Route hashes of the places opened last, most recent first (the start page's recent list). */
  recent: readonly string[];
  /** The commands that have a target now. */
  commands?: readonly PaletteCommand[];
}

export interface PaletteSource {
  /** The rows for a query (an empty one included), in groups, best first. */
  offer(query: string, context: PaletteContext): Promise<readonly FinderGroup[]>;
}

/** The hash prefix that marks a command among the places matched. */
const COMMAND = 'command:';

/** Rows of recent places shown before anything is typed. */
export const MAX_RECENT_ROWS = 5;

const open = (destination: Destination): FieldResult => ({ kind: 'open', destination });

/**
 * Our places, from their definitions (shared/destinations.ts): a query finds them by title and keywords, as the start
 * page's field does (fuzzy, shared/fuzzy.ts), with no limit of rows (the palette's list scrolls); among equal matches
 * the places opened last first. Before anything is typed: the places opened
 * last, then the menu as the sidebar has it — the top-level places, then each one's places under its title (Tools).
 */
export const placesPalette = (destinations: readonly Destination[]): PaletteSource => ({
  offer(query, { recent, commands = [] }) {
    if (query.trim()) {
      // A command is matched as a place would be: by its title and its words; the hash only tells them apart.
      const asPlaces = commands.map((c): Destination => ({
        id: c.id,
        kind: 'section',
        title: c.title,
        keywords: c.keywords ?? [],
        hash: `${COMMAND}${c.id}`,
      }));
      const all = [...destinations, ...asPlaces];
      const found = matchDestinations(query, all, all.length, recent);
      const results = found.map(({ destination, match }): FieldResult => {
        const command = destination.hash.startsWith(COMMAND) ? destination.id : null;
        return command
          ? { kind: 'command', id: command, title: destination.title, match }
          : { kind: 'open', destination, match };
      });
      return settled(results.length ? [{ id: 'found', results }] : []);
    }
    const recentPlaces = recent
      .map(hash => destinations.find(d => d.hash === hash))
      .filter((d): d is Destination => d !== undefined)
      .slice(0, MAX_RECENT_ROWS);
    const top = destinations.filter(d => d.parent === undefined);
    const groups: FinderGroup[] = [
      ...(recentPlaces.length ? [{ id: 'recent', label: 'Recent', results: recentPlaces.map(open) }] : []),
      { id: 'places', label: 'Go to', results: top.map(open) },
      ...top.flatMap(parent => {
        const children = destinations.filter(d => d.parent === parent.id);
        return children.length ? [{ id: parent.id, label: parent.title, results: children.map(open) }] : [];
      }),
    ];
    return settled(groups);
  },
});
