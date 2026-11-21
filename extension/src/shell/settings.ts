/**
 * What the shell keeps: which groups of the sidebar the user opened or closed (Tools, and any place that comes to have
 * places under it, shared/destinations.ts `parent`), and whether the toolbar shows the breadcrumb. Settings, stored in
 * chrome.storage.local like the start page's (store.ts); a group the user never touched is closed, unless the page
 * shows one of its places; the breadcrumb is on until the user turns it off (the field is absent until then).
 */

export interface ShellSettings {
  version: 1;
  /** The user's choice per group, by the id of the place the group stands under (`tools`). */
  open: Record<string, boolean>;
  /** The breadcrumb in the toolbar (Settings → Appearance). */
  breadcrumb: boolean;
}

/** chrome.storage.local key (the source of truth). */
export const SHELL_KEY = 'shellSettings';
/** localStorage key of the copy the shell reads in its first render, so a group does not open a frame late. */
export const SHELL_CACHE_KEY = 'shell-cache';

export const DEFAULT_SHELL: ShellSettings = { version: 1, open: {}, breadcrumb: true };

const GROUP_ID = /^[a-z][a-z0-9-]*$/;

export const normalizeShell = (raw: unknown): ShellSettings => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const open = source.open && typeof source.open === 'object' ? (source.open as Record<string, unknown>) : {};
  return {
    version: 1,
    open: Object.fromEntries(
      Object.entries(open).filter((e): e is [string, boolean] => GROUP_ID.test(e[0]) && typeof e[1] === 'boolean'),
    ),
    breadcrumb: source.breadcrumb !== false,
  };
};

/** The settings with the user's choice for one group. */
export const withGroup = (settings: ShellSettings, id: string, open: boolean): ShellSettings => ({
  ...settings,
  open: { ...settings.open, [id]: open },
});

export const withBreadcrumb = (settings: ShellSettings, breadcrumb: boolean): ShellSettings => ({
  ...settings,
  breadcrumb,
});
