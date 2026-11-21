/** Hooks over the history host (src/history/behaviors.ts): its settings, the lock, its stats. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HistoryHost } from '@src/history/behaviors';
import type { HistorySettings } from '@src/history/settings';
import type { CipherState, HistoryStats } from '@workspace/tools-shared/history';

export const useHistorySettings = (host: HistoryHost): HistorySettings =>
  useSyncExternalStore(
    l => host.settings.subscribe(l),
    () => host.settings.get(),
  );

export const useVaultState = (host: HistoryHost): CipherState =>
  useSyncExternalStore(
    l => host.vault.subscribe(l),
    () => host.vault.state(),
  );

/** A number that changes whenever the history changed in this page (lists and stats reload on it). */
export const useHistoryVersion = (host: HistoryHost): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => host.onChange(() => setVersion(v => v + 1)), [host]);
  return version;
};

export const useHistoryStats = (host: HistoryHost): HistoryStats | null => {
  const version = useHistoryVersion(host);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  useEffect(() => {
    let live = true;
    host.store.stats().then(
      s => live && setStats(s),
      () => live && setStats(null),
    );
    return () => {
      live = false;
    };
  }, [host, version]);
  return stats;
};

/** Marks activity for the idle lock while the page is used. */
export const useActivity = (host: HistoryHost): void => {
  useEffect(() => {
    const touch = () => host.touch();
    const events = ['pointerdown', 'keydown'] as const;
    for (const e of events) addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) removeEventListener(e, touch);
    };
  }, [host]);
};
