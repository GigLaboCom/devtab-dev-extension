/**
 * Seam `StartPart` — what the start page is made of (docs/replaceable-behaviors.md). Every switchable piece of the start
 * page is a definition of this shape in `parts/<id>.ts`; the composition root (parts/index.ts) lists them in their
 * default order. The page, the settings and the permission bookkeeping walk that list — none of them names a part.
 *
 * A part is two modules (D16, docs/research/start-route-budget.md): its **definition** — id, title, description,
 * permissions, when it loads: data, small, always on the page, because the settings and the manifest read it — and its
 * **code**, `parts/<id>.run.ts`, which `load()` brings only while the part is switched on. A part that is off costs the
 * page its definition and nothing else. While the code of a part that is on is on its way, the page keeps the part's
 * place (a row: exactly the room its tiles will take, when the state says how many) and stands in for what an option
 * changes (below), so nothing jumps or flashes; a part whose code fails to load says so in one quiet line.
 *
 * Two kinds, because the pieces are of two kinds:
 *   row     a row of tiles on the page, under the field: its code gives a TileSource, the user can switch it and move it;
 *   option  changes how the fixed parts behave — what the field offers (web search, fuzzy matching, recognising pasted
 *           text), what a tile shows (site icons): its code gives part of the page's context, and it has no place of its
 *           own, so it is not orderable.
 * The field itself is not a part: the page always has it.
 *
 * Only relative imports of plain modules, here and in every part's modules (definitions and code): manifest.config.ts
 * and scripts/permissions.mjs load the definitions outside the app.
 */
import { letterIcons, waitingIcons } from './siteIcons';
import { strictMatcher } from '../shared/finder';
import { deferredRecogniser, recognisesNothing } from '../tools/recogniser';
import type { PlaceMatcher } from '../shared/finder';
import type { PasteRecogniser } from '../tools/recogniser';
import type { PartDeps, Place } from './parts/deps';
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
  /**
   * When the page loads the part's code while the part is on: `start` — at once, with the page (what the first frames
   * show: the rows, the options the field and the tiles show); `idle` — after the first paint, when the page is idle
   * (what only a later keystroke or paste uses), or at that first use if it comes sooner.
   */
  loadAt: 'start' | 'idle';
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

/** What a row's code gives the page. */
export interface RowCode {
  tiles: TileSource;
  editor?: TileEditor;
}

/** What an option's code gives the page: its part of the context, the same objects every time. */
export interface OptionCode {
  context: Partial<PageContext>;
}

export interface RowPart extends PartBase {
  kind: 'row';
  /** Said when the source has no tiles. */
  empty: string;
  /**
   * How many tiles the row will show, when the state alone says it: the page keeps exactly that room while the code
   * arrives, so the tiles land in place. Absent (a row that reads the browser): one row's height.
   */
  reserve?: (state: StartState, places: readonly Place[]) => number;
  load(): Promise<{ create(deps: PartDeps): RowCode }>;
}

/** What the options change on the page; the defaults are what the page does with none of them on. */
export interface PageContext {
  /** Absent: the field only finds our places. */
  webSearch?: WebSearch;
  siteIcons: SiteIcons;
  /** How the field matches our places (seam `PlaceMatcher`): strict unless an option brings another. */
  matcher: PlaceMatcher;
  /** Absent: pasted text is text — no tool is opened with it. */
  recognise?: PasteRecogniser;
}

export const DEFAULT_CONTEXT: PageContext = { siteIcons: letterIcons, matcher: strictMatcher };

export interface OptionPart extends PartBase {
  kind: 'option';
  /** Which members of the page's context its code sets: the page stands in for them until the code has arrived. */
  provides: readonly (keyof PageContext)[];
  load(): Promise<{ create(deps: PartDeps): OptionCode }>;
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

type CodeOf<P extends StartPart> = P extends RowPart ? RowCode : OptionCode;

/** The parts' code on one page: each part's loaded once, on first ask; what has arrived is known synchronously. */
export interface PartCode {
  load<P extends StartPart>(part: P): Promise<CodeOf<P>>;
  /** The code, when it has arrived. */
  loaded<P extends StartPart>(part: P): CodeOf<P> | undefined;
  /** Its load failed (the page says so quietly; an option leaves the page as it is without it). */
  failed(part: StartPart): boolean;
}

export const partCode = (deps: PartDeps): PartCode => {
  const loading = new Map<string, Promise<RowCode | OptionCode>>();
  const done = new Map<string, RowCode | OptionCode>();
  const failed = new Set<string>();
  const load = (part: StartPart): Promise<RowCode | OptionCode> => {
    let promise = loading.get(part.id);
    if (!promise) {
      promise = (part.load() as Promise<{ create(deps: PartDeps): RowCode | OptionCode }>).then(
        m => {
          const code = m.create(deps);
          done.set(part.id, code);
          // When the part's code arrived (the e2e check times it against the first paint).
          globalThis.performance?.mark?.(`start-part-${part.id}`);
          return code;
        },
        e => {
          failed.add(part.id);
          throw e;
        },
      );
      loading.set(part.id, promise);
    }
    return promise;
  };
  return {
    load: part => load(part) as never,
    loaded: part => done.get(part.id) as never,
    failed: part => failed.has(part.id),
  };
};

/** The parts whose code the page wants now: switched on with their permissions, and due (`start`, or `idle` too). */
export const partsToLoad = (
  parts: readonly StartPart[],
  settings: StartSettings,
  held: ReadonlySet<string>,
  idle: boolean,
): StartPart[] => parts.filter(p => partState(p, settings, held) === 'on' && (idle || p.loadAt === 'start'));

/**
 * What stands for a member of the context while the option that sets it is on and its code is on its way: the field
 * already offers the web search (Enter waits for the code), a tile keeps its icon's place empty instead of showing a
 * letter that a moment later becomes an icon, a paste waits for the tools' `detect`. The matcher needs none: the strict
 * one is the default.
 */
const STAND_INS: { [K in keyof PageContext]?: (later: () => Promise<PageContext[K] | undefined>) => PageContext[K] } = {
  webSearch: later => ({ search: text => later().then(w => w?.search(text)) }),
  siteIcons: () => waitingIcons,
  recognise: later => deferredRecogniser(() => later().then(r => r ?? recognisesNothing)),
};

const standIn = <K extends keyof PageContext>(key: K, code: () => Promise<OptionCode>): Partial<PageContext> => {
  const make = STAND_INS[key];
  return make ? { [key]: make(() => code().then(c => c.context[key] as PageContext[K] | undefined)) } : {};
};

/**
 * What the options that are on contribute, over the defaults: their code's context once it has arrived, a stand-in
 * until then (none when there is no `code`: the settings, a test). An option whose code failed changes nothing.
 */
export const pageContext = (
  parts: readonly StartPart[],
  settings: StartSettings,
  held: ReadonlySet<string>,
  code?: PartCode,
): PageContext =>
  parts.reduce<PageContext>((context, part) => {
    if (part.kind !== 'option' || partState(part, settings, held) !== 'on' || !code || code.failed(part))
      return context;
    const loaded = code.loaded(part);
    if (loaded) return { ...context, ...loaded.context };
    const standIns = part.provides.map(key => standIn(key, () => code.load(part)));
    return Object.assign({ ...context }, ...standIns) as PageContext;
  }, DEFAULT_CONTEXT);

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
