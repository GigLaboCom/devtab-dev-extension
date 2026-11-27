/**
 * The local history (§7.5, §7.6): the open file's points (saves of one session as one row) or the project's; a point
 * compared with the current file, two points compared, and a point restored — after a question, with the comparison in
 * the editor; the version it replaces stays in the history, so a restore is undone the same way.
 */
import { TEXT, formatSize, formatTime, printable } from './text';
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
import { useEffect, useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { FilePoint, ProjectPoint } from '@src/projects/types';
import type { ReactElement } from 'react';

type Scope = 'file' | 'project';

export const HistoryPanel = ({ workspace }: { workspace: Workspace }): ReactElement => {
  const { backend, project, path, version } = workspace;
  const [scope, setScope] = useState<Scope>('file');
  const [points, setPoints] = useState<(FilePoint | ProjectPoint)[] | null>(null);
  const [picked, setPicked] = useState<FilePoint[]>([]);
  const [restoring, setRestoring] = useState<FilePoint | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: { point: string } } | null>(null);
  // Restoring writes: only in a writable project of a backend that restores.
  const mine = project.class === 'mine' && workspace.can('history.restore');

  useEffect(() => {
    if (scope === 'file' && !path) {
      setPoints(null);
      return;
    }
    let live = true;
    const load =
      scope === 'file'
        ? backend.call('history.file', { project: project.id, path: path! }).then(r => r.points)
        : backend.call('history.project', { project: project.id, limit: 100 }).then(r => r.points);
    load.then(
      next => live && setPoints(next),
      () => live && setPoints([]),
    );
    return () => {
      live = false;
    };
  }, [backend, project.id, path, scope, version]);

  useEffect(() => setPicked([]), [path, scope]);

  const pathOf = (point: FilePoint | ProjectPoint): string => ('path' in point ? point.path : path!);
  const label = (point: FilePoint): string => printable(point.label);

  const compare = (point: FilePoint | ProjectPoint): void =>
    workspace.open(pathOf(point), {
      kind: 'point',
      point: point.point,
      label: `${label(point)} ${formatTime(point.timeMs)}`,
    });

  const ask = (point: FilePoint | ProjectPoint): void => {
    compare(point);
    setRestoring(point);
  };

  const restore = async (point: FilePoint | ProjectPoint): Promise<void> => {
    setRestoring(null);
    const target = pathOf(point);
    try {
      const current = await backend.call('file.read', { project: project.id, path: target }).catch(() => null);
      const done = await backend.call('history.restore', {
        project: project.id,
        path: target,
        point: point.point,
        currentHash: current?.hash ?? null,
      });
      setNote({ text: TEXT.restored, ...(done.before && { undo: { point: done.before } }) });
      workspace.open(target, { kind: 'file' });
      workspace.refresh();
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error) });
    }
  };

  const undo = async (point: string): Promise<void> => {
    if (!path) return;
    const current = await backend.call('file.read', { project: project.id, path }).catch(() => null);
    await backend.call('history.restore', { project: project.id, path, point, currentHash: current?.hash ?? null });
    setNote(null);
    workspace.refresh();
  };

  return (
    <section className="kit-projects-history" aria-label={TEXT.historyLabel}>
      <div className="kit-projects-history-bar">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={scope}
          aria-label={TEXT.historyLabel}
          onValueChange={value => (value === 'file' || value === 'project') && setScope(value)}>
          <ToggleGroupItem value="file">{TEXT.historyFile}</ToggleGroupItem>
          <ToggleGroupItem value="project">{TEXT.historyProject}</ToggleGroupItem>
        </ToggleGroup>
        {scope === 'file' && (
          <Button
            size="sm"
            variant="outline"
            disabled={picked.length !== 2}
            onClick={() => {
              const [a, b] = [...picked].sort((x, y) => x.timeMs - y.timeMs);
              workspace.open(path!, { kind: 'points', a: a!, b: b! });
            }}>
            {TEXT.compareSelected}
          </Button>
        )}
        {note && (
          <span className="kit-projects-note" role="status">
            {note.text}
            {note.undo && (
              <Button size="sm" variant="ghost" onClick={() => void undo(note.undo!.point)}>
                {TEXT.undoRestore}
              </Button>
            )}
          </span>
        )}
      </div>
      {scope === 'file' && !path ? (
        <p className="kit-projects-tree-note">{TEXT.historyNoFile}</p>
      ) : points?.length === 0 ? (
        <p className="kit-projects-tree-note">{TEXT.historyEmpty}</p>
      ) : (
        <ul className="kit-projects-points">
          {points?.map(point => (
            <li key={point.point} className="kit-projects-point" data-source={point.source}>
              {scope === 'file' && (
                <Checkbox
                  aria-label={`${label(point)} ${formatTime(point.timeMs)}`}
                  checked={picked.some(p => p.point === point.point)}
                  onCheckedChange={on =>
                    setPicked(p => (on === true ? [...p, point].slice(-2) : p.filter(x => x.point !== point.point)))
                  }
                />
              )}
              <span className="kit-projects-point-time">{formatTime(point.timeMs)}</span>
              <span className="kit-projects-point-label">{label(point)}</span>
              {'path' in point && <span className="kit-projects-point-path">{printable(point.path)}</span>}
              {/* A commit's point has no size of its own (the companion sends 0). */}
              {point.source !== 'commit' && <span className="kit-projects-item-meta">{formatSize(point.size)}</span>}
              <span className="kit-projects-point-actions">
                <Button size="sm" variant="ghost" onClick={() => compare(point)}>
                  {TEXT.compareWithCurrent}
                </Button>
                {mine && (
                  <Button size="sm" variant="ghost" onClick={() => ask(point)}>
                    {TEXT.restore}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={restoring !== null} onOpenChange={open => !open && setRestoring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{TEXT.restoreTitle}</DialogTitle>
            <DialogDescription>
              {restoring ? TEXT.restoreBody(pathOf(restoring), formatTime(restoring.timeMs)) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoring(null)}>
              {TEXT.cancel}
            </Button>
            <Button onClick={() => restoring && void restore(restoring)}>{TEXT.restoreRun}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
