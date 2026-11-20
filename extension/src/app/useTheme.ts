import { createDebug } from '@extension/logger';
import { DEFAULT_PREF } from '@extension/theme';
import { applyTheme, savePref, watchTheme } from '@src/shared/theme/store';
import { useCallback, useEffect, useState } from 'react';
import type { ThemePref } from '@extension/theme';

const debug = createDebug('extension:theme');

export interface ThemeDeps {
  area: Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  onChanged: Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;
  win: Pick<Window, 'localStorage' | 'matchMedia'>;
  root: HTMLElement;
}

/** The page's theme: follows chrome.storage (and the system), paints <html>, and saves the user's pick. */
export const useTheme = (deps: ThemeDeps): [ThemePref, (pref: ThemePref) => void] => {
  const [pref, setPref] = useState<ThemePref>(DEFAULT_PREF);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    watchTheme(deps, ({ pref: next, theme }) => {
      applyTheme(deps.root, theme);
      setPref(next);
    })
      .then(unsubscribe => (cancelled ? unsubscribe() : (stop = unsubscribe)))
      .catch(e => debug.warn('watch the theme', e));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [deps]);

  const change = useCallback(
    (next: ThemePref) => {
      setPref(next);
      savePref(deps.area, deps.win, next).catch(e => debug.warn('save the theme', e));
    },
    [deps],
  );

  return [pref, change];
};
