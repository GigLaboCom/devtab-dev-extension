/**
 * The start page's state in React: the settings, shortcuts and recent routes (from the localStorage copy at once, then
 * live from chrome.storage), the optional permissions held, and the bookkeeping of the page — the visited route and
 * the tab's title.
 */
import { isNewTabLoad } from './route';
import { createDebug } from '@extension/logger';
import { isNewTabPage } from '@src/newTab/override';
import { initialState, readCache, recordVisit, watchStart } from '@src/start/store';
import { useEffect, useState } from 'react';
import type { Route } from './route';
import type { StartBehaviors } from '@src/start/behaviors';
import type { StartState } from '@src/start/settings';
import type { StartStoreDeps } from '@src/start/store';

const debug = createDebug('extension:start');

interface PermissionsEvent {
  addListener(callback: () => void): void;
  removeListener(callback: () => void): void;
}

/** chrome.permissions as the pages use it (@types/chrome 0.0.287 leaves `removeListener` off its two events). */
export type PermissionsApi = Pick<typeof chrome.permissions, 'contains' | 'request' | 'remove'> & {
  onAdded: PermissionsEvent;
  onRemoved: PermissionsEvent;
};

/** The state, and whether it has come from chrome.storage yet (before that it is the localStorage copy). */
export const useStartState = (deps: StartStoreDeps): { state: StartState; loaded: boolean } => {
  const [current, setCurrent] = useState(() => ({ state: initialState(deps.win), loaded: false }));
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    watchStart(deps, state => setCurrent({ state, loaded: true }))
      .then(unsubscribe => (cancelled ? unsubscribe() : (stop = unsubscribe)))
      .catch(e => debug.warn('watch the start settings', e));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [deps]);
  return current;
};

/** Which of these optional permissions Chrome holds now, kept current when it grants or removes one. */
export const useHeldPermissions = (permissions: PermissionsApi, names: readonly string[]): ReadonlySet<string> => {
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const key = names.join(' ');
  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split(' ') : [];
    const refresh = (): void => {
      Promise.all(list.map(name => permissions.contains({ permissions: [name] })))
        .then(answers => !cancelled && setHeld(new Set(list.filter((_, i) => answers[i]))))
        .catch(e => debug.warn('read the optional permissions', e));
    };
    refresh();
    permissions.onAdded.addListener(refresh);
    permissions.onRemoved.addListener(refresh);
    return () => {
      cancelled = true;
      permissions.onAdded.removeListener(refresh);
      permissions.onRemoved.removeListener(refresh);
    };
  }, [permissions, key]);
  return held;
};

/**
 * When the page opened with no route and the localStorage copy was missing, route-boot.js could not apply the user's
 * choice before the first paint; apply it once chrome.storage answers (the only case where the start page shows
 * first). Only where a new tab is ours (src/newTab): otherwise there is no choice to apply.
 */
export const useLateNewTabChoice = (
  deps: StartStoreDeps,
  behaviors: StartBehaviors,
  { state, loaded }: { state: StartState; loaded: boolean },
): void => {
  const [late] = useState(
    () => isNewTabPage(behaviors.newTab) && readCache(deps.win) === null && isNewTabLoad(window.location),
  );
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!late || done || !loaded) return;
    setDone(true);
    const hash = behaviors.newTabPage[state.settings.newTab].initialHash(state.recent);
    if (!window.location.hash && hash !== behaviors.newTabPage.start.initialHash(state.recent))
      window.location.replace(hash);
  }, [late, done, loaded, state, behaviors]);
};

/** Remembers each section or tool the user opens (for "the last opened tool" and the order of the Tools tiles). */
export const useRecordVisit = (deps: StartStoreDeps, hash: string, route: Route): void => {
  useEffect(() => {
    if (route.section === 'start' || route.section === 'settings') return;
    recordVisit(deps.area, hash).catch(e => debug.warn('remember the visit', e));
  }, [deps, hash, route.section]);
};
