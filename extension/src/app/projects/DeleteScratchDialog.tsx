/**
 * Deleting a scratch file asks first (D34), as IntelliJ and VS Code ask before deleting a file: the name, that the text
 * leaves the browser, and that a download keeps a copy; Delete is the destructive button.
 */
import { TEXT, printable } from './text';
import { fileName } from '@src/projects/scratch/store';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import type { ScratchInfo } from '@src/projects/scratch/store';
import type { ReactElement } from 'react';

export interface DeleteScratchDialogProps {
  /** The scratch asked about; null: the dialog is closed. */
  scratch: ScratchInfo | null;
  onCancel(): void;
  onDelete(scratch: ScratchInfo): void;
}

export const DeleteScratchDialog = ({ scratch, onCancel, onDelete }: DeleteScratchDialogProps): ReactElement => (
  <Dialog open={scratch !== null} onOpenChange={open => !open && onCancel()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{scratch ? TEXT.deleteScratchTitle(printable(fileName(scratch))) : ''}</DialogTitle>
        <DialogDescription>{TEXT.deleteScratchBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {TEXT.cancel}
        </Button>
        <Button variant="destructive" onClick={() => scratch && onDelete(scratch)}>
          {TEXT.deleteScratchRun}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
