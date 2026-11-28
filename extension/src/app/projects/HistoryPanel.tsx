/**
 * The local history (the companion's specification §7.5, §7.6): the open file's points — the server's, the companion's
 * own copies and the commits that changed it — or the project's, page by page, with the files that are gone; what
 * changed since the person last left the project; the stretches the companion did not watch, said as such. A point is
 * compared with the current file, two points with each other, a point opened in «Compare code» next to the current
 * file (whose side saves back into the project, ../../compare/handoff.ts `origin`), and a point restored — after a
 * question, with the comparison in the editor; the version it replaces is kept by the companion («Before restore»), so
 * a restore is undone the same way. A point the companion says keeps no text (`content: false`: `Before create`,
 * `Deleted while away`, a binary or over-limit file's copy, the commit that deleted the file) is listed and offers
 * nothing to open.
 *
 * What the backend does not offer is not asked for: a companion without the feeds shows one sentence; one of stage 6
 * or older (no restore, no clearing) shows the feeds and one sentence, and sends neither. Restoring needs a writable
 * project. Clearing the history is the companion's question to the person (`history.requestPurge`): without its window
 * it answers with the command for Terminal, shown verbatim with Copy. Every refusal is said in the page's own words
 * (./errors.ts).
 */
import { errorText, toneOf } from './errors';
import { SaidNote } from './SaidNote';
import { TEXT, formatSize, formatTime, printable } from './text';
import { routeHash, go } from '../route';
import { handToCompare } from '@src/compare/handoff';
import { isCompanionError } from '@src/projects/types';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { useEffect, useRef, useState } from 'react';
import type { Said } from './errors';
import type { Workspace } from './useWorkspace';
import type { FilePoint, HistoryGap, ProjectPoint } from '@src/projects/types';
import type { ReactElement } from 'react';

/** Points asked for at a time in the project's feed, at most the companion's page (`maxHistoryPage`). */
export const HISTORY_PAGE = 100;
/** The companion's page when it does not announce one (`limits.maxHistoryPage` of its documentation). */
const COMPANION_PAGE = 500;
/** The stretches the companion did not watch, said at most (the newest). */
export const GAPS_SHOWN = 3;
/** How long a request that may wait for the companion's window goes before the page says so. */
const WAIT_SAID_AFTER_MS = 400;

/**
 * A point without a text has nothing to open, compare or restore: the companion says so (`content`). One older than
 * the field is read by its labels of a moment noted without a text (`c:none`).
 */
const WITHOUT_TEXT: ReadonlySet<string> = new Set(['Before create', 'Deleted while away']);
const hasText = (point: FilePoint): boolean =>
  point.content ?? !(point.source === 'companion' && WITHOUT_TEXT.has(point.label));

type Scope = 'file' | 'project' | 'away';
type Point = FilePoint | ProjectPoint;

interface Feed {
  points: Point[];
  /** The project's feed: the cursor of the next page. */
  next: string | null;
  deleted: string[];
  gaps: HistoryGap[];
}

interface Asked {
  point: Point;
  path: string;
  /** The file's version when the question was asked (null: it does not exist): what the restore expects. */
  currentHash: string | null;
}

interface Note {
  said: Said;
  tone: 'info' | 'success' | 'error';
  kind: string;
  undo?: { path: string; point: string; hash: string };
}

export interface HistoryPanelProps {
  workspace: Workspace;
  /** When the person last left this project (ms), or null: never, or not known. */
  lastVisit?: number | null;
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export const HistoryPanel = ({ workspace, lastVisit = null }: HistoryPanelProps): ReactElement => {
  const { backend, project, path, version, state } = workspace;
  const offers = {
    file: workspace.can('history.file'),
    project: workspace.can('history.project'),
    restore: workspace.can('history.restore'),
    purge: workspace.can('history.requestPurge'),
  };
  const companionPage = backend.capabilities().historyPage ?? COMPANION_PAGE;
  const page = Math.min(HISTORY_PAGE, companionPage);
  const [scope, setScope] = useState<Scope>(offers.file ? 'file' : 'project');
  // Whose history the file scope shows: the open file, or a deleted one picked from the project's list.
  const [deletedSubject, setDeletedSubject] = useState<string | null>(null);
  const subject = deletedSubject ?? path;
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState<Said | null>(null);
  const [pages, setPages] = useState(1);
  const [awayFiles, setAwayFiles] = useState<number | null>(null);
  const [picked, setPicked] = useState<FilePoint[]>([]);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [purging, setPurging] = useState<{ abort: AbortController; waiting: boolean } | null>(null);
  const live = useRef(true);
  // The clearing still waiting for the companion's window when the panel goes: its question is closed.
  const purgingRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      live.current = false;
      purgingRef.current?.abort();
    },
    [],
  );

  const mine = project.class === 'mine';
  const canRestore = mine && offers.restore;
  const away = offers.project && lastVisit !== null;
  const fileScope = scope === 'file';

  // Another file opened: its history, not a deleted one picked before (opening that deleted one keeps it so).
  useEffect(() => setDeletedSubject(d => (d === path ? d : null)), [path]);
  useEffect(() => {
    setPicked([]);
    setPages(1);
  }, [subject, scope]);

  // The feed shown: read again on every event of the project and every write the page made (`version`). Another
  // feed (scope, file, since) is not shown until it is read: the old one goes at once rather than standing for it.
  const shown = useRef('');
  useEffect(() => {
    const key = `${scope}\u0000${subject ?? ''}\u0000${lastVisit ?? ''}`;
    if (shown.current !== key) {
      shown.current = key;
      setFeed(null);
    }
    if (fileScope ? !offers.file || !subject : !offers.project || (scope === 'away' && lastVisit === null)) {
      setFeed(null);
      return;
    }
    let ok = true;
    const load: Promise<Feed> = fileScope
      ? backend
          .call('history.file', { project: project.id, path: subject! })
          .then(r => ({ points: r.points, next: null, deleted: [], gaps: r.gaps ?? [] }))
      : backend
          .call('history.project', {
            project: project.id,
            // The pages already shown stay shown when the feed is read again.
            limit: Math.min(page * pages, companionPage),
            ...(scope === 'away' && { since: lastVisit }),
          })
          .then(r => ({ points: r.points, next: r.next ?? null, deleted: r.deleted ?? [], gaps: [] }));
    load.then(
      next => {
        if (!ok) return;
        setFeed(next);
        setFailed(null);
      },
      (error: unknown) => {
        if (!ok) return;
        setFeed({ points: [], next: null, deleted: [], gaps: [] });
        // A file the history does not know (a link, a folder, a companion that serves no deleted file) has none.
        setFailed(isCompanionError(error, 'not-found') ? null : errorText(error, 'read', project.id));
      },
    );
    return () => {
      ok = false;
    };
    // `pages` is read with the rest: a page more is asked for by `more`, not by reading everything again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, project.id, subject, scope, version, lastVisit, fileScope, offers.file, offers.project, companionPage]);

  // How many files changed since the last visit, for the scope's switch.
  useEffect(() => {
    if (!away) return setAwayFiles(null);
    let ok = true;
    backend.call('history.project', { project: project.id, since: lastVisit, limit: companionPage }).then(
      r => ok && setAwayFiles(new Set(r.points.map(p => p.path)).size),
      () => ok && setAwayFiles(null),
    );
    return () => {
      ok = false;
    };
  }, [away, backend, project.id, lastVisit, version, companionPage]);

  const more = async (): Promise<void> => {
    if (!feed?.next) return;
    try {
      const r = await backend.call('history.project', {
        project: project.id,
        cursor: feed.next,
        limit: page,
        ...(scope === 'away' && { since: lastVisit }),
      });
      if (!live.current) return;
      setFeed(f => f && { ...f, points: [...f.points, ...r.points], next: r.next ?? null });
      setPages(n => n + 1);
    } catch (error) {
      if (live.current) setFailed(errorText(error, 'read', project.id));
    }
  };

  const pathOf = (point: Point): string => ('path' in point ? point.path : subject!);
  const label = (point: Point): string => printable(point.label);
  const named = (point: Point): string => `${label(point)} ${formatTime(point.timeMs)}`;
  const gone = (target: string): boolean =>
    fileScope ? deletedSubject !== null : feed?.deleted.includes(target) === true;

  const compare = (point: Point): void =>
    workspace.open(pathOf(point), { kind: 'point', point: point.point, label: named(point) });

  const openInCompare = async (point: Point): Promise<void> => {
    const target = pathOf(point);
    try {
      const [version, current] = await Promise.all([
        backend.call('history.content', { project: project.id, point: point.point }),
        backend.call('file.read', { project: project.id, path: target }),
      ]);
      // The current file's side saves back into the project only where the page may write it.
      const writable = mine && !current.secret && workspace.can('file.save');
      handToCompare([
        { text: version.text, name: `${baseName(target)} (${named(point)})` },
        {
          text: current.text,
          name: baseName(target),
          ...(writable && {
            origin: { project: project.id, path: target, baseHash: current.hash, backend: backend.name },
          }),
        },
      ]);
      go(routeHash({ section: 'compare' }));
    } catch (error) {
      if (live.current) setNote({ said: errorText(error, 'read', project.id), tone: 'error', kind: 'compare' });
    }
  };

  const ask = async (point: Point): Promise<void> => {
    const target = pathOf(point);
    setNote(null);
    compare(point);
    try {
      const current = await backend.call('file.read', { project: project.id, path: target }).then(
        file => file.hash,
        (error: unknown) => {
          if (isCompanionError(error, 'not-found')) return null;
          throw error;
        },
      );
      if (live.current) setAsked({ point, path: target, currentHash: current });
    } catch (error) {
      if (live.current) setNote({ said: errorText(error, 'restore', project.id), tone: 'error', kind: 'restore' });
    }
  };

  const restore = async ({ point, path: target, currentHash }: Asked): Promise<void> => {
    setAsked(null);
    try {
      const done = await backend.call('history.restore', {
        project: project.id,
        path: target,
        point: point.point,
        currentHash,
      });
      if (!live.current) return;
      setNote({
        said: { text: currentHash === null ? TEXT.history.restoredDeleted : TEXT.restored },
        tone: 'success',
        kind: 'restored',
        ...(done.before && { undo: { path: target, point: done.before, hash: done.hash } }),
      });
      if (currentHash === null) setDeletedSubject(null);
      workspace.open(target, { kind: 'file' });
      workspace.refresh();
    } catch (error) {
      if (!live.current) return;
      setNote({ said: errorText(error, 'restore', project.id), tone: 'error', kind: 'restore' });
      if (isCompanionError(error, 'conflict')) workspace.refresh();
    }
  };

  // Undoing a restore restores the copy the companion kept of what it replaced, from the version the restore wrote.
  const undo = async ({ path: target, point, hash }: NonNullable<Note['undo']>): Promise<void> => {
    try {
      await backend.call('history.restore', { project: project.id, path: target, point, currentHash: hash });
      if (!live.current) return;
      setNote({ said: { text: TEXT.history.undone }, tone: 'success', kind: 'undone' });
      workspace.refresh();
    } catch (error) {
      if (live.current) setNote({ said: errorText(error, 'restore', project.id), tone: 'error', kind: 'restore' });
    }
  };

  const purge = async (): Promise<void> => {
    const abort = new AbortController();
    purgingRef.current = abort;
    setNote(null);
    setPurging({ abort, waiting: false });
    const said = setTimeout(
      () => live.current && setPurging(p => (p?.abort === abort ? { abort, waiting: true } : p)),
      WAIT_SAID_AFTER_MS,
    );
    try {
      await backend.call('history.requestPurge', { project: project.id }, { signal: abort.signal });
      if (!live.current) return;
      setNote({ said: { text: TEXT.history.cleared }, tone: 'success', kind: 'purged' });
      workspace.refresh();
    } catch (error) {
      if (live.current) setNote({ said: errorText(error, 'purge', project.id), tone: toneOf(error), kind: 'purge' });
    } finally {
      clearTimeout(said);
      if (purgingRef.current === abort) purgingRef.current = null;
      if (live.current) setPurging(null);
    }
  };

  // The stretches the companion did not watch: the file's, or the project's; since the last visit, only those after it.
  const gaps = (fileScope ? (feed?.gaps ?? []) : (state?.historyGaps ?? []))
    .filter(g => scope !== 'away' || lastVisit === null || g.to >= lastVisit)
    .sort((a, b) => b.to - a.to)
    .slice(0, GAPS_SHOWN);

  if (!offers.file && !offers.project)
    return (
      <section className="kit-projects-history" aria-label={TEXT.historyLabel}>
        <p className="kit-projects-tree-note" data-history="not-offered">
          {TEXT.history.notOffered}
        </p>
      </section>
    );

  const quiet =
    !offers.restore && !offers.purge
      ? TEXT.history.readOnlyCompanion
      : offers.restore && !mine
        ? TEXT.history.viewProject
        : null;
  const points = feed?.points ?? [];

  return (
    <section className="kit-projects-history" aria-label={TEXT.historyLabel}>
      <div className="kit-projects-history-bar">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={scope}
          aria-label={TEXT.historyLabel}
          onValueChange={value => {
            if (value === 'file' || value === 'project' || value === 'away') setScope(value);
          }}>
          {offers.file && <ToggleGroupItem value="file">{TEXT.historyFile}</ToggleGroupItem>}
          {offers.project && <ToggleGroupItem value="project">{TEXT.historyProject}</ToggleGroupItem>}
          {away && (
            <ToggleGroupItem value="away" data-away={awayFiles ?? undefined}>
              {awayFiles ? TEXT.history.sinceVisitCount(awayFiles) : TEXT.history.sinceVisit}
            </ToggleGroupItem>
          )}
        </ToggleGroup>
        {fileScope && (
          <Button
            size="sm"
            variant="outline"
            disabled={picked.length !== 2}
            onClick={() => {
              const [a, b] = [...picked].sort((x, y) => x.timeMs - y.timeMs);
              workspace.open(subject!, { kind: 'points', a: a!, b: b! });
            }}>
            {TEXT.compareSelected}
          </Button>
        )}
        {!fileScope && offers.purge && (
          <Button size="sm" variant="ghost" disabled={purging !== null} onClick={() => void purge()}>
            {TEXT.history.clear}
          </Button>
        )}
        {purging?.waiting && (
          <span className="kit-projects-note" data-request="awaiting-confirmation" role="status">
            {TEXT.awaiting}
            <Button variant="outline" size="sm" onClick={() => purging.abort.abort()}>
              {TEXT.cancel}
            </Button>
          </span>
        )}
        {quiet && (
          <span className="kit-projects-note" data-history="quiet">
            {quiet}
          </span>
        )}
      </div>
      {note && (
        <SaidNote said={note.said} tone={note.tone} kind={note.kind}>
          {note.undo && (
            <Button size="sm" variant="outline" onClick={() => void undo(note.undo!)}>
              {TEXT.undoRestore}
            </Button>
          )}
        </SaidNote>
      )}
      {failed && <SaidNote said={failed} tone="error" kind="history" />}
      {gaps.map(g => (
        <p key={`${g.from}-${g.to}`} className="kit-projects-note" data-gap="">
          {TEXT.history.gap(formatTime(g.from), formatTime(g.to))}
        </p>
      ))}
      {scope === 'away' && lastVisit !== null && (
        <p className="kit-projects-note">{TEXT.history.sinceVisitFrom(formatTime(lastVisit))}</p>
      )}
      {fileScope && deletedSubject && (
        <p className="kit-projects-note" data-deleted-subject="">
          {TEXT.history.deletedSubject(printable(deletedSubject))}
          {path && (
            <Button size="sm" variant="ghost" onClick={() => setDeletedSubject(null)}>
              {TEXT.history.backToOpenFile}
            </Button>
          )}
        </p>
      )}
      {fileScope && !subject ? (
        <p className="kit-projects-tree-note">{TEXT.historyNoFile}</p>
      ) : feed && points.length === 0 ? (
        <p className="kit-projects-tree-note">{scope === 'away' ? TEXT.history.sinceVisitEmpty : TEXT.historyEmpty}</p>
      ) : (
        <ul className="kit-projects-points">
          {points.map(point => {
            const target = pathOf(point);
            const text = hasText(point);
            return (
              <li
                key={point.point}
                className="kit-projects-point"
                data-source={point.source}
                data-text={text ? undefined : 'none'}>
                {fileScope && (
                  <Checkbox
                    aria-label={named(point)}
                    disabled={!text}
                    checked={picked.some(p => p.point === point.point)}
                    onCheckedChange={on =>
                      setPicked(p => (on === true ? [...p, point].slice(-2) : p.filter(x => x.point !== point.point)))
                    }
                  />
                )}
                <span className="kit-projects-point-time">{formatTime(point.timeMs)}</span>
                {point.source === 'commit' && <span className="kit-projects-mark">{TEXT.history.sourceCommit}</span>}
                <span className="kit-projects-point-label">{label(point)}</span>
                {'path' in point && <span className="kit-projects-point-path">{printable(point.path)}</span>}
                {/* A commit's point has no size of its own (the companion sends 0), nor has a moment without a text. */}
                {point.source !== 'commit' && text && (
                  <span className="kit-projects-item-meta">{formatSize(point.size)}</span>
                )}
                {!text && (
                  <span className="kit-projects-item-meta" title={TEXT.history.noContentTitle}>
                    {TEXT.history.noContent}
                  </span>
                )}
                {text && (
                  <span className="kit-projects-point-actions">
                    <Button size="sm" variant="ghost" onClick={() => compare(point)}>
                      {TEXT.compareWithCurrent}
                    </Button>
                    {!gone(target) && (
                      <Button size="sm" variant="ghost" onClick={() => void openInCompare(point)}>
                        {TEXT.history.openInCompare}
                      </Button>
                    )}
                    {canRestore && (
                      <Button size="sm" variant="ghost" aria-haspopup="dialog" onClick={() => void ask(point)}>
                        {TEXT.restore}
                      </Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!fileScope && feed?.next && (
        <Button size="sm" variant="ghost" className="kit-projects-history-more" onClick={() => void more()}>
          {TEXT.history.showMore}
        </Button>
      )}
      {scope === 'project' && feed && feed.deleted.length > 0 && (
        <div className="kit-projects-history-deleted" role="group" aria-label={TEXT.history.deletedTitle}>
          <h3 className="kit-projects-history-title">{TEXT.history.deletedTitle}</h3>
          <ul className="kit-projects-points">
            {feed.deleted.map(gonePath => (
              <li key={gonePath} className="kit-projects-point" data-deleted="">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!offers.file}
                  aria-label={TEXT.history.deletedOf(printable(gonePath))}
                  onClick={() => {
                    setDeletedSubject(gonePath);
                    setScope('file');
                  }}>
                  <span className="kit-projects-point-path">{printable(gonePath)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog open={asked !== null} onOpenChange={open => !open && setAsked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{TEXT.restoreTitle}</DialogTitle>
            <DialogDescription>
              {asked
                ? asked.currentHash === null
                  ? TEXT.history.restoreDeletedBody(printable(asked.path), formatTime(asked.point.timeMs))
                  : TEXT.restoreBody(printable(asked.path), formatTime(asked.point.timeMs))
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsked(null)}>
              {TEXT.cancel}
            </Button>
            <Button onClick={() => asked && void restore(asked)}>{TEXT.restoreRun}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
