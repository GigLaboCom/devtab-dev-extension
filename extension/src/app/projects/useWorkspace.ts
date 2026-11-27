/**
 * One open project: its state and status, the file the address names and how the editor shows it, and the events
 * that make the parts read again. The parts take what they need from it; none of them talks to another.
 */
import { go, routeHash } from '../route';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectBackend } from '@src/projects/backend';
import type { FilePoint, GitStatus, HistoryPoint, ProjectState, ProjectSummary } from '@src/projects/types';

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
  /** Something failed: said once, in the page's status line. */
  error: string | null;
  setError(message: string | null): void;
}

export const useWorkspace = (
  backend: ProjectBackend,
  project: ProjectSummary,
  path: string | undefined,
  onProjectChanged: () => void,
): Workspace => {
  const [state, setState] = useState<ProjectState | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [version, setVersion] = useState(0);
  const [changed, setChanged] = useState<{ paths: string[]; n: number }>({ paths: [], n: 0 });
  const [view, setView] = useState<EditorView>({ kind: 'file' });
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [backend, project.id, project.class, version]);

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
    error,
    setError,
  };
};
