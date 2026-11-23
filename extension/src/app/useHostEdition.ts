/**
 * What the edition in force says to the pages, followed while the page is open: whether the history is part of it and
 * whether automatic copying exists (HistoryHost `included`, `automaticCopying`). A page reads them here, never once at
 * mount: when the edition changes (`onEdition`), every place re-renders with the new values.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { HistoryHost } from '@src/history/behaviors';

/** `included` and `automaticCopying` as they are now; re-renders on every change. */
export const useHostEdition = (
  host: HistoryHost,
): { readonly included: boolean; readonly automaticCopying: boolean } => {
  const subscribe = useCallback((listener: () => void) => host.onEdition(listener), [host]);
  const included = useSyncExternalStore(
    subscribe,
    useCallback(() => host.included, [host]),
  );
  const automaticCopying = useSyncExternalStore(
    subscribe,
    useCallback(() => host.automaticCopying, [host]),
  );
  return { included, automaticCopying };
};
