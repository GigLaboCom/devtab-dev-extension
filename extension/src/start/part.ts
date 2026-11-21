/**
 * Seam `StartPart` — what the start page is made of (docs/replaceable-behaviors.md). Every switchable piece of the start
 * page is a definition of this shape, written next to its implementation in `parts/<id>.ts`; the composition root
 * (behaviors.ts) lists them in their default order. The page, the settings and the permission bookkeeping walk that list
 * — none of them names a part.
 *
 * Two kinds, because the pieces are of two kinds:
 *   row     a row of tiles on the page, under the field: it has a TileSource, the user can switch it and move it;
 *   option  changes how the fixed parts behave (web search changes what the field offers, site icons what a tile
 *           shows): it contributes to the page's context and has no place of its own, so it is not orderable.
 * The field itself is not a part: the page always has it.
 */
import { letterIcons } from './siteIcons';
import type { StartSettings, StartState } from './settings';
import type { SiteIcons } from './siteIcons';
import type { TileSource } from './tileSources';
import type { WebSearch } from './webSearch';

/** A permission a part needs, with why — the manifest's comment and the store's justification say the same. */
export interface PartPermission {
  name: string;
  /** Optional: requested when the part is switched on, removed when no switched-on part needs it any more. */
  optional: boolean;
  reason: string;
  /** Chrome's warning for this permission alone, word for word (chrome.management.getPermissionWarningsByManifest);
   *  null: none. */
  warning: string | null;
}

interface PartBase {
  id: string;
  /** The row's heading on the page and the switch's label in settings. */
  title: string;
  /** The line under the switch in settings. */
  description: string;
  defaultOn: boolean;
  permissions: readonly PartPermission[];
  /**
   * What Chrome's prompt says for the part's optional permissions together, word for word — shown in settings where the
   * user switches the part on. Not always one permission's warning: `sessions` alone has none, with `tabs` Chrome words
   * them as one. Present exactly when the part has an optional permission.
   */
  prompt?: string;
  /** For "Your data" in settings: what the part reads and what becomes of it (a part that reads the browser has one). */
  privacy?: string;
}

/** One editable tile: the user's own list (title and address). */
export interface EditableTile {
  id: string;
  title: string;
  url: string;
}

/** For a row the user fills by hand: the list, and how to store it. */
export interface TileEditor {
  items(state: StartState): readonly EditableTile[];
  save(items: readonly EditableTile[]): Promise<void>;
  max: number;
  /** The add tile's label ("Add shortcut"). */
  addLabel: string;
}

export interface RowPart extends PartBase {
  kind: 'row';
  tiles: TileSource;
  /** Said when the source has no tiles. */
  empty: string;
  editor?: TileEditor;
}

/** What the options change on the page; the defaults are what the page does with none of them on. */
export interface PageContext {
  /** Absent: the field only finds our places. */
  webSearch?: WebSearch;
  siteIcons: SiteIcons;
}

export const DEFAULT_CONTEXT: PageContext = { siteIcons: letterIcons };

export interface OptionPart extends PartBase {
  kind: 'option';
  contribute(): Partial<PageContext>;
}

export type StartPart = RowPart | OptionPart;

const optionalOf = (part: StartPart): string[] => part.permissions.filter(p => p.optional).map(p => p.name);

/** The part's switch: what the user chose, or the part's default. */
export const switchedOn = (part: StartPart, settings: StartSettings): boolean =>
  settings.parts[part.id] ?? part.defaultOn;

/**
 * on: switched on and every optional permission held; blocked: switched on but Chrome no longer holds one (removed in
 * chrome://extensions) — it reads nothing and the page says why; off.
 */
export type PartState = 'on' | 'blocked' | 'off';

export const partState = (part: StartPart, settings: StartSettings, held: ReadonlySet<string>): PartState =>
  !switchedOn(part, settings) ? 'off' : optionalOf(part).every(name => held.has(name)) ? 'on' : 'blocked';

/** The rows in the user's order; rows the stored order does not name follow in the default order. */
export const rowsInOrder = (parts: readonly StartPart[], settings: StartSettings): RowPart[] => {
  const rows = parts.filter((p): p is RowPart => p.kind === 'row');
  const known = settings.order.filter(id => rows.some(r => r.id === id));
  return [...known.map(id => rows.find(r => r.id === id)!), ...rows.filter(r => !known.includes(r.id))];
};

/** The order after moving one row up (-1) or down (+1). */
export const moveRow = (parts: readonly StartPart[], settings: StartSettings, id: string, step: -1 | 1): string[] => {
  const order = rowsInOrder(parts, settings).map(r => r.id);
  const from = order.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= order.length) return order;
  [order[from], order[to]] = [order[to], order[from]];
  return order;
};

/** What the options that are on contribute, over the defaults. */
export const pageContext = (
  parts: readonly StartPart[],
  settings: StartSettings,
  held: ReadonlySet<string>,
): PageContext =>
  parts.reduce<PageContext>(
    (context, part) =>
      part.kind === 'option' && partState(part, settings, held) === 'on'
        ? { ...context, ...part.contribute() }
        : context,
    DEFAULT_CONTEXT,
  );

/** Every permission the parts declare: what the manifest must hold (the manifest test holds them together). */
export const declaredPermissions = (parts: readonly StartPart[]): { required: string[]; optional: string[] } => {
  const all = parts.flatMap(p => p.permissions);
  const unique = (names: string[]): string[] => [...new Set(names)];
  return {
    required: unique(all.filter(p => !p.optional).map(p => p.name)),
    optional: unique(all.filter(p => p.optional).map(p => p.name)),
  };
};

/** Every optional permission any part may ask for. */
export const optionalPermissionNames = (parts: readonly StartPart[]): string[] => declaredPermissions(parts).optional;

/** What switching the part on asks Chrome for (in one prompt). */
export const permissionsToRequest = (part: StartPart): string[] => optionalOf(part);

/** What switching the part off gives back: its optional permissions no other switched-on part needs. */
export const permissionsToRelease = (parts: readonly StartPart[], settings: StartSettings, id: string): string[] => {
  const part = parts.find(p => p.id === id);
  if (!part) return [];
  const stillNeeded = new Set(parts.filter(p => p.id !== id && switchedOn(p, settings)).flatMap(p => optionalOf(p)));
  return optionalOf(part).filter(name => !stillNeeded.has(name));
};
