/**
 * The parts of the History panel that do not know whose history they show: one point's row (picked for «Compare the two
 * selected», compared with the current file, opened in «Compare code», restored), «Compare the two selected», the
 * question before a restore, and what the panel says after an action with «Undo restore». ./HistoryPanel.tsx puts them
 * together over a project's feeds and ./OpenedFileHistory.tsx over the copies of a file opened from the computer; each
 * makes its own calls, the parts draw the same panel for both.
 */
import { SaidNote } from './SaidNote';
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
import type { Said } from './errors';
import type { ReactElement } from 'react';

/** What a row shows of a point, whoever's it is. */
export interface ShownPoint {
  point: string;
  label: string;
  timeMs: number;
  source: string;
}

/** How a point is named where one line names it: its label and its time. */
export const pointName = (point: Pick<ShownPoint, 'label' | 'timeMs'>): string =>
  `${printable(point.label)} ${formatTime(point.timeMs)}`;

export interface HistoryPointRowProps {
  point: ShownPoint;
  /** Whether the companion kept its text: a point without one is listed, offers nothing and says so. */
  text: boolean;
  /** The size shown; null: none (a commit's point has no size of its own). */
  size: number | null;
  /** A mark before the label (a commit's). */
  mark?: string;
  /** The file the point is of, where the feed is a project's. */
  path?: string;
  /** Picked for «Compare the two selected»; absent: the feed has no picking. */
  pick?: { checked: boolean; onChange(on: boolean): void };
  onCompare(): void;
  /** «Open in Compare code»; absent: not offered for this point. */
  onOpenInCompare?: () => void;
  /** «Restore…»; absent: not offered. `why`: inactive, and why (its tooltip). */
  restore?: { run(): void; why?: string | null };
}

export const HistoryPointRow = ({
  point,
  text,
  size,
  mark,
  path,
  pick,
  onCompare,
  onOpenInCompare,
  restore,
}: HistoryPointRowProps): ReactElement => (
  <li className="kit-projects-point" data-source={point.source} data-text={text ? undefined : 'none'}>
    {pick && (
      <Checkbox
        aria-label={pointName(point)}
        disabled={!text}
        checked={pick.checked}
        onCheckedChange={on => pick.onChange(on === true)}
      />
    )}
    <span className="kit-projects-point-time">{formatTime(point.timeMs)}</span>
    {mark && <span className="kit-projects-mark">{mark}</span>}
    <span className="kit-projects-point-label">{printable(point.label)}</span>
    {path !== undefined && <span className="kit-projects-point-path">{printable(path)}</span>}
    {size !== null && text && <span className="kit-projects-item-meta">{formatSize(size)}</span>}
    {!text && (
      <span className="kit-projects-item-meta" title={TEXT.history.noContentTitle}>
        {TEXT.history.noContent}
      </span>
    )}
    {text && (
      <span className="kit-projects-point-actions">
        <Button size="sm" variant="ghost" onClick={onCompare}>
          {TEXT.compareWithCurrent}
        </Button>
        {onOpenInCompare && (
          <Button size="sm" variant="ghost" onClick={onOpenInCompare}>
            {TEXT.history.openInCompare}
          </Button>
        )}
        {restore && (
          <Button
            size="sm"
            variant="ghost"
            aria-haspopup="dialog"
            disabled={!!restore.why}
            title={restore.why ?? undefined}
            onClick={restore.run}>
            {TEXT.restore}
          </Button>
        )}
      </span>
    )}
  </li>
);

/** «Compare the two selected»: active with two points picked, which it gives older first. */
export const CompareSelected = <P extends { timeMs: number }>({
  picked,
  onCompare,
}: {
  picked: readonly P[];
  onCompare(older: P, newer: P): void;
}): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    disabled={picked.length !== 2}
    onClick={() => {
      const [a, b] = [...picked].sort((x, y) => x.timeMs - y.timeMs);
      onCompare(a!, b!);
    }}>
    {TEXT.compareSelected}
  </Button>
);

/** Two points picked at most: picking a third lets the oldest pick go. */
export const pickPoint = <P extends { point: string }>(picked: readonly P[], point: P, on: boolean): P[] =>
  on ? [...picked, point].slice(-2) : picked.filter(p => p.point !== point.point);

/** What the panel says after an action; a restore that kept the version it replaced offers to undo it. */
export interface HistoryNote<U> {
  said: Said;
  tone: 'info' | 'success' | 'error';
  kind: string;
  undo?: U;
}

export const HistoryNoteView = <U,>({
  note,
  onUndo,
}: {
  note: HistoryNote<U>;
  onUndo(undo: U): void;
}): ReactElement => (
  <SaidNote said={note.said} tone={note.tone} kind={note.kind}>
    {note.undo !== undefined && (
      <Button size="sm" variant="outline" onClick={() => onUndo(note.undo!)}>
        {TEXT.undoRestore}
      </Button>
    )}
  </SaidNote>
);

/** The question before a restore: what is written over what (`body`); closed when `body` is null. */
export const RestoreDialog = ({
  body,
  onCancel,
  onRestore,
}: {
  body: string | null;
  onCancel(): void;
  onRestore(): void;
}): ReactElement => (
  <Dialog open={body !== null} onOpenChange={open => !open && onCancel()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{TEXT.restoreTitle}</DialogTitle>
        <DialogDescription>{body ?? ''}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {TEXT.cancel}
        </Button>
        <Button onClick={onRestore}>{TEXT.restoreRun}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
