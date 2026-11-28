/**
 * Files opened from the system on the Projects page (D42; docs/research/open-with.md §3.1, §3.6, §7.2): the list the
 * «Files» group shows, and how a file arrives — by the companion's event `open.requested`, by the address
 * `#/projects/open/<token>` (a new tab the companion started), or waiting since before the page connected
 * (`openFile.pending`). Each token is claimed once; a file of no project then opens on its own address
 * (`#/projects/files/<id>`), a file of an added project as that project's file. Where the file has to wait — no
 * permission, no companion, a companion that does not offer files — the page says so in one sentence; an unknown or
 * expired token is one sentence too. Nothing here logs a token, and nothing is sent to a companion that does not
 * announce the methods.
 *
 * While the companion offers it, the page tells it its visibility and focus (`page.activity`) as soon as it is
 * connected and on every change: the companion hands a file (`open.requested`) only to a page that told it. When a file arrives the page brings its own tab and window forward
 * (`openFiles.bringForward`), or — with `openFiles.reuseTab` off — hands the token to a new tab of its own.
 */
import { errorLine } from './errors';
import { TEXT } from './text';
import { go, routeHash } from '../route';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionStatus, ProjectBackend } from '@src/projects/backend';
import type { OpenFilesBehaviors } from '@src/projects/behaviors';
import type { OpenedAt, OpenedFile, OpenedFiles } from '@src/projects/openFiles/files';
import type { OpenFilesSettings } from '@src/projects/openFiles/settings';

/** Where a token came from: what a failure to claim it says depends on it. */
type Source = 'route' | 'event' | 'pending';

const CONNECTED = new Set(['ready', 'ready-empty', 'not-initialised']);

export interface OpenedFilesView {
  /** The seam, when the section has files opened from the system at all. */
  files: OpenedFiles | null;
  /** The companion is connected and offers them. */
  offered: boolean;
  /** The list (null until read, or where not offered). */
  list: OpenedFile[] | null;
  /** Whether the «Files» group shows: something is listed, or something was opened here before. */
  visible: boolean;
  settings: OpenFilesSettings | null;
  setSettings(change: Partial<OpenFilesSettings>): void;
  /** One sentence about a file arriving, or null. */
  note: { text: string; tone: 'info' | 'error' } | null;
  /** What the page knows of a file: from its claim or the list. */
  known(id: string): OpenedFile | undefined;
  /** Where the caret goes in a file just claimed (taken once). */
  takeAt(id: string): OpenedAt | null;
  reload(): void;
  forget(id: string): Promise<void>;
}

export interface UseOpenedFilesOptions {
  backend: ProjectBackend;
  status: ConnectionStatus;
  /** Bumped when the connection comes back. */
  generation: number;
  demo: boolean;
  behaviors: OpenFilesBehaviors | undefined;
  /** Tokens taken from the address (`#/projects/open/<token>`), oldest first; `take` empties it. */
  arrivals: { take(): string[]; n: number };
}

export const useOpenedFiles = ({
  backend,
  status,
  generation,
  demo,
  behaviors,
  arrivals,
}: UseOpenedFilesOptions): OpenedFilesView => {
  // The seam only closes over the backend (no subscription, nothing sent): made while rendering.
  const files = useMemo<OpenedFiles | null>(() => (behaviors ? behaviors.files(backend) : null), [behaviors, backend]);
  const connected = !status.connecting && CONNECTED.has(status.state) && !demo;
  const offered = !!files && connected && files.offered();

  const [list, setList] = useState<OpenedFile[] | null>(null);
  const [settings, setSettingsState] = useState<OpenFilesSettings | null>(null);
  const [note, setNote] = useState<OpenedFilesView['note']>(null);
  const claimed = useRef(new Map<string, { file: OpenedFile; at: OpenedAt | null }>());
  const waiting = useRef<{ token: string; source: Source }[]>([]);
  const handled = useRef(new Set<string>());
  const [waitingN, setWaitingN] = useState(0);
  const settingsRef = useRef<OpenFilesSettings | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    let live = true;
    behaviors?.settings.get().then(s => live && setSettingsState(s));
    return () => {
      live = false;
    };
  }, [behaviors]);

  const setSettings = useCallback(
    (change: Partial<OpenFilesSettings>) => {
      setSettingsState(s => (s ? { ...s, ...change } : s));
      void behaviors?.settings.set(change);
    },
    [behaviors],
  );

  // A new connection: what was said about an earlier arrival no longer holds.
  useEffect(() => setNote(null), [generation]);

  const reload = useCallback(() => {
    if (!files || !offered) return setList(null);
    files.list().then(
      next => setList(next),
      () => setList(l => l ?? []),
    );
  }, [files, offered]);
  useEffect(reload, [reload, generation]);

  const enqueue = useCallback((tokens: string[], source: Source) => {
    const fresh = tokens.filter(t => !handled.current.has(t) && !waiting.current.some(w => w.token === t));
    if (!fresh.length) return;
    waiting.current.push(...fresh.map(token => ({ token, source })));
    setWaitingN(n => n + 1);
  }, []);

  // Tokens from the address.
  useEffect(() => {
    const tokens = arrivals.take();
    if (tokens.length) enqueue(tokens, 'route');
  }, [arrivals, arrivals.n, enqueue]);

  // A file the companion hands to this page while it is connected.
  useEffect(() => {
    if (!files || !offered) return;
    return files.onRequested(token => {
      if (settingsRef.current && !settingsRef.current.reuseTab) {
        handled.current.add(token);
        void behaviors?.tab.openTab(`#/projects/open/${token}`);
        return;
      }
      enqueue([token], 'event');
    });
  }, [files, offered, demo, behaviors, enqueue]);

  // Files that waited for a page to connect.
  useEffect(() => {
    if (!files || !offered) return;
    let live = true;
    files.pending().then(
      tokens => live && enqueue(tokens, 'pending'),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [files, offered, generation, enqueue]);

  // Claiming what waits, or saying why it waits.
  const claiming = useRef(false);
  useEffect(() => {
    if (!waiting.current.length || claiming.current) return;
    if (!connected) {
      if (status.connecting && status.state !== 'no-permission')
        return setNote({ text: TEXT.openFiles.opening, tone: 'info' });
      setNote({
        text: status.state === 'no-permission' ? TEXT.openFiles.waitingConnect : TEXT.openFiles.waitingCompanion,
        tone: 'info',
      });
      return;
    }
    if (!files || !offered) {
      // This companion cannot hand files over: what waits is the companion's, not this page's to keep.
      for (const w of waiting.current) handled.current.add(w.token);
      waiting.current = [];
      setNote({ text: TEXT.openFiles.notOffered, tone: 'info' });
      return;
    }
    claiming.current = true;
    setNote({ text: TEXT.openFiles.opening, tone: 'info' });
    void (async () => {
      let opened: (() => void) | null = null;
      let failed: string | null = null;
      let forward = false;
      while (waiting.current.length) {
        const { token, source } = waiting.current.shift()!;
        handled.current.add(token);
        try {
          const claim = await files.claim(token);
          forward ||= source !== 'route';
          if (claim.kind === 'file') {
            claimed.current.set(claim.file.id, { file: claim.file, at: claim.at });
            const id = claim.file.id;
            opened = () => go(routeHash({ section: 'projects', file: id }));
          } else {
            const { project, path } = claim;
            opened = () => go(routeHash({ section: 'projects', project, ...(path && { path }) }));
          }
        } catch (error) {
          // Another tab of this profile may have claimed a waiting one first: only what this page was sent is said.
          if (source !== 'pending') failed = errorLine(error, 'claim');
        }
      }
      claiming.current = false;
      setNote(failed ? { text: failed, tone: 'error' } : null);
      if (opened) {
        void behaviors?.settings.set({ opened: true });
        setSettingsState(s => (s ? { ...s, opened: true } : s));
        reload();
        opened();
        if (forward && (settingsRef.current?.bringForward ?? true)) void behaviors?.tab.bringForward();
      }
      if (waiting.current.length) setWaitingN(n => n + 1);
    })();
  }, [waitingN, connected, offered, files, status.state, status.connecting, behaviors, reload]);

  // The page's visibility and focus, while the companion wants to know.
  useEffect(() => {
    if (!files || !offered || !files.can('activity')) return;
    // Never focused yet: 0, the earliest time (the contract's `focusedAt` is a time, never absent).
    let focusedAt = document.hasFocus() ? Date.now() : 0;
    let said = '';
    const tell = (): void => {
      const visible = document.visibilityState === 'visible';
      const now = JSON.stringify([visible, focusedAt]);
      if (now === said) return;
      said = now;
      files.activity(visible, focusedAt).catch(() => undefined);
    };
    const focused = (): void => {
      focusedAt = Date.now();
      tell();
    };
    tell();
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', tell);
    return () => {
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', tell);
    };
  }, [files, offered]);

  const known = useCallback((id: string) => list?.find(f => f.id === id) ?? claimed.current.get(id)?.file, [list]);
  const takeAt = useCallback((id: string) => {
    const entry = claimed.current.get(id);
    if (!entry?.at) return null;
    const at = entry.at;
    claimed.current.set(id, { ...entry, at: null });
    return at;
  }, []);
  const forget = useCallback(
    async (id: string) => {
      if (!files) return;
      await files.forget(id);
      claimed.current.delete(id);
      reload();
    },
    [files, reload],
  );

  return {
    files,
    offered,
    list: offered ? list : null,
    visible: offered && list !== null && (list.length > 0 || settings?.opened === true),
    settings,
    setSettings,
    note,
    known,
    takeAt,
    reload,
    forget,
  };
};
