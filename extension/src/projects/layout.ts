/**
 * The Projects section's panels (D35): what is open, which view each panel shows and how big it is — the state the
 * workspace's arrangement keeps, its defaults and limits. Plain data and pure functions; the arrangement itself is the
 * `WorkspaceLayout` seam (src/app/projects/workspaceLayout.ts), and where the state is remembered is `LayoutMemory`
 * (./layoutMemory.ts), both chosen in the section's composition root (./behaviors.ts).
 *
 * Sizes are CSS pixels. One layout for the extension, not one per project: like an IDE's tool windows, the panels stay
 * where the person put them whichever project is open.
 */

/** The side panel's views: the project's files, or the Commit window (IntelliJ's Project and Commit tool windows). */
export type SideView = 'files' | 'commit';
/** The bottom panel's views: the local history, or find in files. */
export type BottomView = 'history' | 'find';
/** Any view of either panel. */
export type PanelView = SideView | BottomView;

export interface ProjectsLayout {
  version: 1;
  side: { open: boolean; view: SideView; width: number };
  bottom: { open: boolean; view: BottomView; height: number };
}

/** The side panel's width when nothing is remembered, and its limits. */
export const SIDE_WIDTH = 288;
export const SIDE_MIN = 200;
export const SIDE_MAX = 640;
/** The bottom panel's height when nothing is remembered, and its limits. */
export const BOTTOM_HEIGHT = 240;
export const BOTTOM_MIN = 120;
export const BOTTOM_MAX = 640;
/** The editor keeps at least this much: a panel never grows over it. */
export const EDITOR_MIN_WIDTH = 320;
export const EDITOR_MIN_HEIGHT = 160;
/** A workspace narrower than this at the start opens with the side panel collapsed instead of squeezing the editor. */
export const NARROW_BELOW = 720;
/** One arrow key on a border moves it this far; with Shift, `RESIZE_STEP_LARGE`. */
export const RESIZE_STEP = 16;
export const RESIZE_STEP_LARGE = 64;

/** Files open on the left, the bottom panel collapsed on History (D35). */
export const DEFAULT_LAYOUT: ProjectsLayout = {
  version: 1,
  side: { open: true, view: 'files', width: SIDE_WIDTH },
  bottom: { open: false, view: 'history', height: BOTTOM_HEIGHT },
};

export const SIDE_VIEWS: readonly SideView[] = ['files', 'commit'];
export const BOTTOM_VIEWS: readonly BottomView[] = ['history', 'find'];

export const isSideView = (view: PanelView): view is SideView => (SIDE_VIEWS as readonly string[]).includes(view);

export const clamp = (value: number, min: number, max: number): number =>
  Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

/**
 * The largest the side panel may be in a workspace this wide (0: not measured yet), so the editor keeps its minimum.
 */
export const sideMax = (workspaceWidth: number): number =>
  workspaceWidth > 0 ? Math.max(SIDE_MIN, Math.min(SIDE_MAX, workspaceWidth - EDITOR_MIN_WIDTH)) : SIDE_MAX;

/** The largest the bottom panel may be under an editor column this tall (0: not measured yet). */
export const bottomMax = (columnHeight: number): number =>
  columnHeight > 0 ? Math.max(BOTTOM_MIN, Math.min(BOTTOM_MAX, columnHeight - EDITOR_MIN_HEIGHT)) : BOTTOM_MAX;

const size = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;

/** A stored layout made safe: unknown fields dropped, sizes within their limits, defaults for what is missing. */
export const normalizeLayout = (raw: unknown): ProjectsLayout => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const side = source.side && typeof source.side === 'object' ? (source.side as Record<string, unknown>) : {};
  const bottom = source.bottom && typeof source.bottom === 'object' ? (source.bottom as Record<string, unknown>) : {};
  const d = DEFAULT_LAYOUT;
  return {
    version: 1,
    side: {
      open: typeof side.open === 'boolean' ? side.open : d.side.open,
      view: SIDE_VIEWS.includes(side.view as SideView) ? (side.view as SideView) : d.side.view,
      width: size(side.width, d.side.width, SIDE_MIN, SIDE_MAX),
    },
    bottom: {
      open: typeof bottom.open === 'boolean' ? bottom.open : d.bottom.open,
      view: BOTTOM_VIEWS.includes(bottom.view as BottomView) ? (bottom.view as BottomView) : d.bottom.view,
      height: size(bottom.height, d.bottom.height, BOTTOM_MIN, BOTTOM_MAX),
    },
  };
};

/**
 * A view's switch pressed: the view shows, its panel opening; the view already showing collapses its panel (both
 * IntelliJ's stripe buttons and VS Code's activity bar do this).
 */
export const pressView = (layout: ProjectsLayout, view: PanelView): ProjectsLayout =>
  isSideView(view)
    ? {
        ...layout,
        side: { ...layout.side, view, open: !(layout.side.open && layout.side.view === view) },
      }
    : {
        ...layout,
        bottom: { ...layout.bottom, view, open: !(layout.bottom.open && layout.bottom.view === view) },
      };

/** A view asked for (a search started, a file's history asked for): it shows, its panel open, never collapsing. */
export const revealView = (layout: ProjectsLayout, view: PanelView): ProjectsLayout =>
  isSideView(view)
    ? { ...layout, side: { ...layout.side, view, open: true } }
    : { ...layout, bottom: { ...layout.bottom, view, open: true } };
