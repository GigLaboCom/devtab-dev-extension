/**
 * What the start page keeps: the user's settings (what a new tab opens, which parts the start page shows), the
 * shortcuts they add, and which sections and tools they opened last. All three are settings, stored in
 * chrome.storage.local (store.ts). What the user types into the start page's field is never part of them.
 */

/** General → "A new tab opens": names the NewTabPage implementation behaviors.ts picks. */
export type NewTabChoice = 'start' | 'last';

/**
 * The stored settings. `parts` holds only what the user switched (a part not named takes its default from its
 * definition, parts/*.ts); `order` the rows in the user's order (empty: the default order of behaviors.ts). The ids are
 * the parts' ids — this module knows none of them except in the migration of version 1.
 */
export interface StartSettings {
  version: 2;
  newTab: NewTabChoice;
  parts: Record<string, boolean>;
  order: string[];
}

export interface Shortcut {
  id: string;
  title: string;
  /** An http(s) address, normalized by normalizeUrl. */
  url: string;
}

export interface Recent {
  /** The route hash of the section or tool opened last (`#/tools/json`), or null. */
  last: string | null;
  /** Route hashes, most recently opened first. */
  used: string[];
}

export interface StartState {
  settings: StartSettings;
  shortcuts: Shortcut[];
  recent: Recent;
}

/** chrome.storage.local keys (the source of truth). */
export const SETTINGS_KEY = 'startSettings';
export const SHORTCUTS_KEY = 'shortcuts';
export const RECENT_KEY = 'recent';
/** localStorage key of the copy public/route-boot.js reads before the first paint (as theme-boot.js does). */
export const START_CACHE_KEY = 'start-cache';

export const MAX_SHORTCUTS = 12;
export const MAX_RECENT = 12;

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: StartSettings = { version: 2, newTab: 'start', parts: {}, order: [] };

export const DEFAULT_STATE: StartState = {
  settings: DEFAULT_SETTINGS,
  shortcuts: [],
  recent: { last: null, used: [] },
};

const isRecord = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object';

/** The routes a new tab may reopen: a section or a tool — never the start page or the settings. */
export const REOPENABLE = /^#\/(?:compare|projects|tools(?:\/[a-z0-9-]+)?)$/;

/**
 * Version 1 (no `version`; 2026-11-20, before the parts were definitions) stored all six switches by name; the history
 * row was `recentSites`. Its switches are kept as the user set them; only that name changes.
 */
const RENAMED_IN_V2: Record<string, string> = { recentSites: 'recentlyOpened' };

export const migrateSettings = (raw: Record<string, unknown>): Record<string, unknown> => {
  if (raw.version === SETTINGS_VERSION) return raw;
  const parts = isRecord(raw.parts) ? raw.parts : {};
  return {
    ...raw,
    version: SETTINGS_VERSION,
    parts: Object.fromEntries(Object.entries(parts).map(([id, on]) => [RENAMED_IN_V2[id] ?? id, on])),
    order: [],
  };
};

const PART_ID = /^[a-z][a-zA-Z0-9]*$/;

export const normalizeSettings = (raw: unknown): StartSettings => {
  const source = migrateSettings(isRecord(raw) ? raw : {});
  const parts = isRecord(source.parts) ? source.parts : {};
  const order = Array.isArray(source.order) ? source.order : [];
  return {
    version: 2,
    newTab: source.newTab === 'last' ? 'last' : 'start',
    parts: Object.fromEntries(
      Object.entries(parts).filter((e): e is [string, boolean] => PART_ID.test(e[0]) && typeof e[1] === 'boolean'),
    ),
    order: [...new Set(order.filter((id): id is string => typeof id === 'string' && PART_ID.test(id)))],
  };
};

/** A web address the user typed → an http(s) URL, or null. A bare host gets `https://`. */
export const normalizeUrl = (input: string): string | null => {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
};

export const normalizeShortcuts = (raw: unknown): Shortcut[] => {
  if (!Array.isArray(raw)) return [];
  const out: Shortcut[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    const url = normalizeUrl(item.url);
    if (!url || out.some(s => s.id === item.id)) continue;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : new URL(url).hostname;
    out.push({ id: item.id, title, url });
  }
  return out.slice(0, MAX_SHORTCUTS);
};

export const normalizeRecent = (raw: unknown): Recent => {
  const source = isRecord(raw) ? raw : {};
  const used = Array.isArray(source.used)
    ? [...new Set(source.used.filter((h): h is string => typeof h === 'string' && REOPENABLE.test(h)))]
    : [];
  const last = typeof source.last === 'string' && REOPENABLE.test(source.last) ? source.last : null;
  return { last, used: used.slice(0, MAX_RECENT) };
};

export const normalizeState = (raw: unknown): StartState => {
  const source = isRecord(raw) ? raw : {};
  return {
    settings: normalizeSettings(source.settings),
    shortcuts: normalizeShortcuts(source.shortcuts),
    recent: normalizeRecent(source.recent),
  };
};

/** The recent list after opening `hash`: it moves to the front and becomes the last one. */
export const visit = (recent: Recent, hash: string): Recent =>
  REOPENABLE.test(hash)
    ? { last: hash, used: [hash, ...recent.used.filter(h => h !== hash)].slice(0, MAX_RECENT) }
    : recent;
