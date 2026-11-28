/**
 * Forgetting a file opened from the system asks first (D42): the companion deletes the copies it kept of the file along
 * with the page's right to it, so the question says so plainly; the file itself is not touched.
 */
import { TEXT, printable } from './text';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import type { OpenedFile } from '@src/projects/openFiles/files';
import type { ReactElement } from 'react';

export interface ForgetFileDialogProps {
  /** The file asked about; null: the dialog is closed. */
  file: OpenedFile | null;
  onCancel(): void;
  onForget(file: OpenedFile): void;
}

export const ForgetFileDialog = ({ file, onCancel, onForget }: ForgetFileDialogProps): ReactElement => (
  <Dialog open={file !== null} onOpenChange={open => !open && onCancel()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{file ? TEXT.openFiles.forgetConfirm(printable(file.name)) : ''}</DialogTitle>
        <DialogDescription>{TEXT.openFiles.forgetBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {TEXT.cancel}
        </Button>
        <Button variant="destructive" onClick={() => file && onForget(file)}>
          {TEXT.openFiles.forgetRun}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
