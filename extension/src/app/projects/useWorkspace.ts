/**
 * One open project: its state and status, the file the address names and how the editor shows it, and the events
 * that make the parts read again. The parts take what they need from it; none of them talks to another.
 */
import { go, routeHash } from '../route';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectBackend } from '@src/projects/backend';
import type {
  FilePoint,
  GitStatus,
  HistoryPoint,
  Method,
  ProjectState,
  ProjectSummary,
  TreeEntry,
} from '@src/projects/types';

/** How the editor shows the open file. */
export type EditorView =
  /** The file itself: editable in a writable project. */
  | { kind: 'file' }
  /** HEAD on the left, the file on disk on the right. */
  | { kind: 'diff' }
  /** A point of the file's history on the left, the file on disk on the right. */
  | { kind: 'point'; point: HistoryPoint; label: string }
  /** Two points of the history. */
  | { kind: 'points'; a: FilePoint; b: FilePoint };

export interface Reveal {
  line?: number;
  column?: number;
  hunk?: number;
  /** A new number for each request, so the same line can be revealed twice. */
  n: number;
}

export interface Workspace {
  backend: ProjectBackend;
  project: ProjectSummary;
  state: ProjectState | null;
  status: GitStatus | null;
  /** Bumped by every event of the project and every write the page made: parts read again. */
  version: number;
  /** The paths the last `files.changed` named, with its number. */
  changed: { paths: string[]; n: number };
  path: string | undefined;
  view: EditorView;
  reveal: Reveal | null;
  open(path: string, view?: EditorView, reveal?: Omit<Reveal, 'n'>): void;
  setView(view: EditorView): void;
  revealHunk(index: number): void;
  refresh(): void;
  /** Whether the backend offers the method: an action whose method it does not offer is inactive, with why. */
  can(method: Method): boolean;
  /**
   * Whether deleting goes to the Trash: the companion offers `file.delete` and its `companion.state.deletePolicy` is
   * not `unavailable` (an older companion says `trash` without one; for it the offer alone decides).
   */
  trash: boolean;
  /** Something failed: said once, in the page's status line. */
  error: string | null;
  setError(message: string | null): void;
  /** The project's root folder as the Files tree last listed it; null before it did (nothing reads it for this). */
  root: readonly TreeEntry[] | null;
  noteRoot(entries: readonly TreeEntry[]): void;
}

export const useWorkspace = (
  backend: ProjectBackend,
  project: ProjectSummary,
  path: string | undefined,
  onProjectChanged: () => void,
  generation = 0,
): Workspace => {
  const [state, setState] = useState<ProjectState | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [version, setVersion] = useState(0);
  const [changed, setChanged] = useState<{ paths: string[]; n: number }>({ paths: [], n: 0 });
  const [view, setView] = useState<EditorView>({ kind: 'file' });
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState<readonly TreeEntry[] | null>(null);
  const [deletePolicy, setDeletePolicy] = useState<string | null>(null);
  const counter = useRef(0);
  const nextView = useRef<{ path: string; view: EditorView; reveal?: Omit<Reveal, 'n'> } | null>(null);
  const changedRef = useRef(onProjectChanged);
  changedRef.current = onProjectChanged;

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  // The address names the file; how it is shown comes with the request that opened it, else the file itself.
  useEffect(() => {
    const wanted = nextView.current;
    nextView.current = null;
    if (wanted && wanted.path === path) {
      setView(wanted.view);
      setReveal(wanted.reveal ? { ...wanted.reveal, n: ++counter.current } : null);
    } else {
      setView({ kind: 'file' });
      setReveal(null);
    }
  }, [path]);

  useEffect(() => {
    let live = true;
    Promise.all([
      backend.call('project.state', { project: project.id }),
      backend.call('git.status', { project: project.id }),
    ]).then(
      ([nextState, nextStatus]) => {
        if (!live) return;
        setState(nextState);
        setStatus(nextStatus);
        setError(null);
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [backend, project.id, project.class, version, generation]);

  useEffect(() => {
    void backend.call('events.subscribe', { project: project.id }).catch(() => undefined);
    const undo = backend.subscribe(project.id, event => {
      if (event.name === 'files.changed') setChanged(c => ({ paths: event.data.paths, n: c.n + 1 }));
      if (event.name === 'project.changed') changedRef.current();
      if (event.name !== 'history.appeared') setVersion(v => v + 1);
    });
    return () => {
      undo();
      void backend.call('events.unsubscribe', { project: project.id }).catch(() => undefined);
    };
  }, [backend, project.id]);

  // Where deletions go: read once per connection, only from a backend that can delete at all.
  const deletes = backend.capabilities().methods.includes('file.delete');
  useEffect(() => {
    if (!deletes || !backend.capabilities().methods.includes('companion.state')) return setDeletePolicy(null);
    let live = true;
    backend.call('companion.state', {}).then(
      s => live && setDeletePolicy(s.deletePolicy ?? null),
      () => live && setDeletePolicy(null),
    );
    return () => {
      live = false;
    };
  }, [backend, deletes, generation]);

  // The connection came back: every part reads again (the backend says the subscriptions again itself).
  useEffect(() => {
    if (generation) setVersion(v => v + 1);
  }, [generation]);

  const open = useCallback(
    (target: string, nextKind: EditorView = { kind: 'file' }, nextReveal?: Omit<Reveal, 'n'>) => {
      if (target === path) {
        setView(nextKind);
        setReveal(nextReveal ? { ...nextReveal, n: ++counter.current } : null);
        return;
      }
      nextView.current = { path: target, view: nextKind, ...(nextReveal && { reveal: nextReveal }) };
      go(routeHash({ section: 'projects', project: project.id, path: target }));
    },
    [path, project.id],
  );

  return {
    backend,
    project,
    state,
    status,
    version,
    changed,
    path,
    view,
    reveal,
    open,
    setView,
    revealHunk: index => setReveal({ hunk: index, n: ++counter.current }),
    refresh,
    can: method => backend.capabilities().methods.includes(method),
    trash: deletes && deletePolicy !== 'unavailable',
    error,
    setError,
    root,
    noteRoot: setRoot,
  };
};
