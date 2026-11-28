/**
 * Rollback (§6.8; IntelliJ's Rollback window): the files to bring back to HEAD and «Delete local copies of added files»,
 * off by default; added files then go to the Trash. Undone by restoring each file's «Before rollback» point. Where the
 * companion has no Trash (it does not offer `file.delete`), the box is not there and one line says added files stay.
 */
import { TEXT, printable } from './text';
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
import { Label } from '@workspace/ui/label';
import { useState } from 'react';
import type { ReactElement } from 'react';

export interface RollbackDialogProps {
  paths: readonly string[];
  /** Whether added files can go to the Trash. */
  trash: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRollback(deleteAdded: boolean): void;
}

export const RollbackDialog = ({ paths, trash, open, onOpenChange, onRollback }: RollbackDialogProps): ReactElement => {
  const [deleteAdded, setDeleteAdded] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) setDeleteAdded(false);
        onOpenChange(next);
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TEXT.rollbackTitle}</DialogTitle>
          <DialogDescription>{TEXT.rollbackSummary}</DialogDescription>
        </DialogHeader>
        <ul className="kit-projects-dialog-list">
          {paths.map(path => (
            <li key={path}>{printable(path)}</li>
          ))}
        </ul>
        {trash ? (
          <div className="kit-projects-check">
            <Checkbox
              id="rollback-delete-added"
              checked={deleteAdded}
              onCheckedChange={v => setDeleteAdded(v === true)}
            />
            <Label htmlFor="rollback-delete-added">{TEXT.rollbackDeleteAdded}</Label>
          </div>
        ) : (
          <p className="kit-projects-part-hint" data-no-trash="">
            {TEXT.rollbackNoTrash}
          </p>
        )}
        {trash && deleteAdded && <p className="kit-projects-part-hint">{TEXT.rollbackTrash}</p>}
        <p className="kit-projects-part-hint">{TEXT.rollbackBefore}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {TEXT.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onRollback(trash && deleteAdded);
              setDeleteAdded(false);
            }}>
            {TEXT.rollbackRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
