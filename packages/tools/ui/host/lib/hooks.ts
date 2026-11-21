/** Shared hooks of the tool history: one recorder per visit of the tool's page, its status, and restoring an entry. */
import { defaultToolHost } from './host';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { RestoreRequest, ToolHost } from './host';
import type {
  HistoryDeclaration,
  HistoryRecorder,
  OpenedEntry,
  RecordingStatus,
  ToolHistory,
} from '@workspace/tools-shared/history';

/** The owner's status, re-read when the host's switches or the lock change. */
export const useHistoryStatus = (history: ToolHistory): RecordingStatus => {
  const last = useRef<RecordingStatus | null>(null);
  return useSyncExternalStore(
    listener => history.subscribe(listener),
    () => {
      const next = history.status();
      const prev = last.current;
      if (prev && prev.gate === next.gate && prev.secrets === next.secrets && prev.declared === next.declared)
        return prev;
      last.current = next;
      return next;
    },
  );
};

/**
 * The tool's history and a recorder for this visit of its page (one session). Pending changes are written when the
 * page is hidden or left; the session ends when the component goes away.
 */
export const useToolHistory = (
  host: ToolHost | undefined,
  owner: string,
  declaration: HistoryDeclaration,
): { history: ToolHistory; recorder: HistoryRecorder; status: RecordingStatus } => {
  const factory = (host ?? defaultToolHost).history;
  const history = useMemo(() => factory.forOwner(owner, declaration), [factory, owner, declaration]);
  const recorder = useMemo(() => history.session(), [history]);
  useEffect(() => {
    const flush = () => void recorder.flush();
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      void recorder.end();
    };
  }, [recorder]);
  return { history, recorder, status: useHistoryStatus(history) };
};

/** Opens the entry the host asks for and hands it to `apply` (once per request; the latest request wins). */
export const useRestore = (
  history: ToolHistory,
  restore: RestoreRequest | undefined,
  apply: (opened: OpenedEntry) => void,
): void => {
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    if (!restore) return;
    let live = true;
    history.open(restore.id).then(
      opened => {
        if (live) latest.current(opened);
      },
      () => {
        if (live) latest.current({ ok: false, reason: 'damaged' });
      },
    );
    return () => {
      live = false;
    };
  }, [history, restore]);
};
