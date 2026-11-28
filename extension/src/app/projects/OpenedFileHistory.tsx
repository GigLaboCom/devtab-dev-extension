/**
 * The History panel of a file opened from the computer (D42): one feed, «This file» — the companion's own copies of
 * the file (`openFile.history`, kept before each write), newest first, with their time and size. It is the History
 * panel's rows, «Compare the two selected», restore question and note (./historyParts.tsx) over the seam `OpenedFiles`
 * instead of a project's feeds: no «Project» feed, no «Since your last visit», no deleted files, no clearing — the
 * companion deletes the copies when the file is forgotten.
 *
 * A copy without a text (`content: false`) is listed as «No version kept» and offers nothing. A copy is compared with
 * the current file or with another copy in the file's editor (the view's `onCompare`), and opened in «Compare code»
 * next to the current file, whose side saves back through the companion where the page writes this file
 * (../../compare/handoff.ts `OpenedFileOrigin`; not for a secret). Restoring asks first, with the comparison shown,
 * writes from the version the question was asked over (`openFile.restore {currentHash}`) and offers «Undo restore» —
 * the copy of what it replaced, which the answer names (`before`). Where the page does not write the file (the free
 * edition, a file the companion keeps read only) restoring is inactive with the same quiet reason as writing.
 *
 * Refusals are said in the page's words (./errors.ts); a point or file the companion does not know (`not-found`, which
 * is the same code for both) is told apart by asking the file's history once more: a file it no longer has was
 * forgotten.
 */
import { errorText } from './errors';
import { CompareSelected, HistoryNoteView, HistoryPointRow, RestoreDialog, pickPoint, pointName } from './historyParts';
import { SaidNote } from './SaidNote';
import { TEXT, formatTime, printable } from './text';
import { go, routeHash } from '../route';
import { handToCompare } from '@src/compare/handoff';
import { isCompanionError } from '@src/projects/types';
import { useEffect, useRef, useState } from 'react';
import type { ErrorContext, Said } from './errors';
import type { HistoryNote } from './historyParts';
import type { OpenedFile, OpenedFilePoint, OpenedFiles } from '@src/projects/openFiles/files';
import type { ReactElement } from 'react';

/** What the file's editor is asked to show: a copy next to the current file, or two copies. */
export type OpenedFileComparison =
  { kind: 'point'; point: OpenedFilePoint } | { kind: 'points'; a: OpenedFilePoint; b: OpenedFilePoint };

/**
 * A refusal of a history call in the page's words. `not-found` is said as what it is: the file forgotten (its history
 * is not there either), or the copy gone.
 */
export const historyRefusal = async (
  files: OpenedFiles,
  file: string,
  error: unknown,
  context: ErrorContext,
): Promise<Said> => {
  if (!isCompanionError(error, 'not-found')) return errorText(error, context);
  const known = await files.history(file).then(
    () => true,
    (again: unknown) => !isCompanionError(again, 'not-found'),
  );
  return { text: known ? TEXT.history.pointGone : TEXT.openFiles.missing };
};

export interface OpenedFileHistoryProps {
  files: OpenedFiles;
  file: OpenedFile;
  /** Bumped by every write the page made to the file (a save, a restore): the feed is read again. */
  version: number;
  /** Why restoring is inactive (the same quiet reason as writing); null: it is active. */
  restoreBlocked: string | null;
  /** Whether «Compare code» may save the current file's side back (the page writes this file now). */
  writable: boolean;
  onCompare(comparison: OpenedFileComparison): void;
  /** Writes what the editor holds and waits for it, so the version read next is the one on disk. */
  settle(): Promise<void>;
  /** A restore (or its undo) wrote the file: the editor shows it again. */
  onWritten(): void;
}

interface Asked {
  point: OpenedFilePoint;
  /** The file's version when the question was asked: what the restore expects. */
  currentHash: string;
}

type Note = HistoryNote<{ point: string; hash: string }>;

export const OpenedFileHistory = ({
  files,
  file,
  version,
  restoreBlocked,
  writable,
  onCompare,
  settle,
  onWritten,
}: OpenedFileHistoryProps): ReactElement => {
  const [points, setPoints] = useState<OpenedFilePoint[] | null>(null);
  const [failed, setFailed] = useState<Said | null>(null);
  const [picked, setPicked] = useState<OpenedFilePoint[]>([]);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  // A refusal that changed what the companion holds (a conflict): the feed is read again.
  const [reread, setReread] = useState(0);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const id = file.id;
  const restores = files.can('restore');

  useEffect(() => {
    let ok = true;
    files.history(id).then(
      next => {
        if (!ok) return;
        setPoints(next);
        setFailed(null);
        // A picked copy the companion no longer lists is not picked.
        setPicked(p => p.filter(x => next.some(n => n.point === x.point)));
      },
      (error: unknown) => {
        if (!ok) return;
        setPoints([]);
        // The history of a file the companion does not know: it was forgotten.
        setFailed(isCompanionError(error, 'not-found') ? { text: TEXT.openFiles.missing } : errorText(error, 'read'));
      },
    );
    return () => {
      ok = false;
    };
  }, [files, id, version, reread]);

  const refused = async (error: unknown, context: ErrorContext, kind: string): Promise<void> => {
    const said = await historyRefusal(files, id, error, context);
    if (live.current) setNote({ said, tone: 'error', kind });
  };

  const openInCompare = async (point: OpenedFilePoint): Promise<void> => {
    try {
      // The current file as it is on disk, with what the editor held written first.
      await settle();
      const [kept, current] = await Promise.all([files.historyContent(id, point.point), files.read(id)]);
      // The current file's side saves back only where the page writes it, and never a secret.
      const save = writable && !current.secret && !kept.secret;
      handToCompare([
        { text: kept.text, name: `${file.name} (${pointName(point)})` },
        {
          text: current.text,
          name: file.name,
          ...(save && {
            origin: {
              file: id,
              name: file.name,
              displayPath: file.displayPath,
              baseHash: current.hash,
              backend: 'companion' as const,
            },
          }),
        },
      ]);
      go(routeHash({ section: 'compare' }));
    } catch (error) {
      await refused(error, 'read', 'compare');
    }
  };

  const ask = async (point: OpenedFilePoint): Promise<void> => {
    setNote(null);
    onCompare({ kind: 'point', point });
    try {
      await settle();
      const current = await files.read(id);
      if (live.current) setAsked({ point, currentHash: current.hash });
    } catch (error) {
      await refused(error, 'restore', 'restore');
    }
  };

  const restore = async ({ point, currentHash }: Asked): Promise<void> => {
    setAsked(null);
    try {
      const done = await files.restore(id, point.point, currentHash);
      if (!live.current) return;
      setNote({
        said: { text: TEXT.restored },
        tone: 'success',
        kind: 'restored',
        ...(done.before && { undo: { point: done.before, hash: done.hash } }),
      });
      onWritten();
    } catch (error) {
      await refused(error, 'restore', 'restore');
      if (isCompanionError(error, 'conflict')) setReread(n => n + 1);
    }
  };

  // Undoing a restore restores the copy the companion kept of what it replaced, from the version the restore wrote.
  const undo = async ({ point, hash }: NonNullable<Note['undo']>): Promise<void> => {
    try {
      await files.restore(id, point, hash);
      if (!live.current) return;
      setNote({ said: { text: TEXT.history.undone }, tone: 'success', kind: 'undone' });
      onWritten();
    } catch (error) {
      await refused(error, 'restore', 'restore');
    }
  };

  const quiet = !restores ? TEXT.openFiles.historyNoRestore : restoreBlocked;
  const shown = points ?? [];

  return (
    <section className="kit-projects-history" aria-label={TEXT.historyLabel} data-history-of="opened-file">
      <div className="kit-projects-history-bar">
        <h3 className="kit-projects-history-title">{TEXT.historyFile}</h3>
        <CompareSelected picked={picked} onCompare={(a, b) => onCompare({ kind: 'points', a, b })} />
        {quiet && (
          <span className="kit-projects-note" data-history="quiet">
            {quiet}
          </span>
        )}
      </div>
      {note && <HistoryNoteView note={note} onUndo={next => void undo(next)} />}
      {failed && <SaidNote said={failed} tone="error" kind="history" />}
      {points && shown.length === 0 && !failed ? (
        <p className="kit-projects-tree-note">{TEXT.historyEmpty}</p>
      ) : (
        <ul className="kit-projects-points">
          {shown.map(point => (
            <HistoryPointRow
              key={point.point}
              point={{ ...point, source: 'companion' }}
              text={point.content}
              size={point.size}
              pick={{
                checked: picked.some(p => p.point === point.point),
                onChange: on => setPicked(p => pickPoint(p, point, on)),
              }}
              onCompare={() => onCompare({ kind: 'point', point })}
              onOpenInCompare={() => void openInCompare(point)}
              {...(restores && { restore: { run: () => void ask(point), why: restoreBlocked } })}
            />
          ))}
        </ul>
      )}
      <RestoreDialog
        body={asked ? TEXT.restoreBody(printable(file.name), formatTime(asked.point.timeMs)) : null}
        onCancel={() => setAsked(null)}
        onRestore={() => asked && void restore(asked)}
      />
    </section>
  );
};
