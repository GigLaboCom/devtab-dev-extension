/**
 * The shell's settings in React (src/shell/store.ts): from the localStorage copy in the first render, then live from
 * chrome.storage — a group opened in one tab opens in the others.
 */
import { createDebug } from '@extension/logger';
import { withBreadcrumb, withGroup } from '@src/shell/settings';
import { initialShell, saveShell, watchShell } from '@src/shell/store';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShellSettings } from '@src/shell/settings';
import type { ShellStoreDeps } from '@src/shell/store';

const debug = createDebug('extension:shell');

export const useShellSettings = (
  deps: ShellStoreDeps,
): {
  settings: ShellSettings;
  setGroup: (id: string, open: boolean) => void;
  setBreadcrumb: (on: boolean) => void;
} => {
  const [settings, setSettings] = useState(() => initialShell(deps.win));
  const latest = useRef(settings);
  latest.current = settings;
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    watchShell(deps, setSettings)
      .then(unsubscribe => (cancelled ? unsubscribe() : (stop = unsubscribe)))
      .catch(e => debug.warn('watch the shell settings', e));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [deps]);
  const put = useCallback(
    (next: ShellSettings) => {
      setSettings(next);
      saveShell(deps.area, next).catch(e => debug.warn('save the shell settings', e));
    },
    [deps],
  );
  const setGroup = useCallback((id: string, open: boolean) => put(withGroup(latest.current, id, open)), [put]);
  const setBreadcrumb = useCallback((on: boolean) => put(withBreadcrumb(latest.current, on)), [put]);
  return { settings, setGroup, setBreadcrumb };
};
