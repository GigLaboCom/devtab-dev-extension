/**
 * Removing a project asks first: the project leaves the companion's list; nothing in its folder changes and its history
 * stays, so adding the folder again brings it back (§4.6 `project.remove`). A refusal is said in the dialog.
 */
import { errorText } from './errors';
import { SaidNote } from './SaidNote';
import { TEXT } from './text';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import { useState } from 'react';
import type { Said } from './errors';
import type { ReactElement } from 'react';

export interface RemoveProjectDialogProps {
  /** The project's name, printable. */
  name: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRemove(): Promise<void>;
}

export const RemoveProjectDialog = ({ name, open, onOpenChange, onRemove }: RemoveProjectDialogProps): ReactElement => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Said | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) setProblem(null);
        onOpenChange(next);
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TEXT.removeProjectTitle(name)}</DialogTitle>
          <DialogDescription>{TEXT.removeProjectBody}</DialogDescription>
        </DialogHeader>
        {problem && <SaidNote said={problem} kind="remove" />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {TEXT.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem(null);
              onRemove().then(
                () => {
                  setBusy(false);
                  onOpenChange(false);
                },
                (error: unknown) => {
                  setBusy(false);
                  setProblem(errorText(error, 'remove'));
                },
              );
            }}>
            {TEXT.removeProjectRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
