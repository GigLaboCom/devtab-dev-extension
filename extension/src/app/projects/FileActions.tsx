/**
 * The Files view's actions (§4.6 «Записи файлов»): a new file, a new folder, a new name for the open file, and its
 * deletion — as an IDE's project view has them. Each asks for a path in the project (./PathDialog.tsx) and goes to the
 * companion, whose write policy has the last word; a refusal is said in the page's words. A new file opens at once.
 *
 * In a read-only project, or with a companion that does not offer the write, the action is inactive with why. Deleting
 * goes to the Trash or does not happen: a companion without a Trash does not offer `file.delete`, and the action then
 * says so plainly — delete the file in Finder or the terminal — rather than failing.
 */
import { errorText } from './errors';
import { PathDialog } from './PathDialog';
import { SaidNote } from './SaidNote';
import { TEXT, printable } from './text';
import { go, routeHash } from '../route';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import { FilePlusIcon, FolderPlusIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import type { Said } from './errors';
import type { Workspace } from './useWorkspace';
import type { Method } from '@src/projects/types';
import type { ReactElement } from 'react';

type Asking = 'file' | 'folder' | 'rename' | 'delete' | null;

const folderOf = (path: string | undefined): string =>
  path && path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : '';

export const FileActions = ({ workspace }: { workspace: Workspace }): ReactElement => {
  const { backend, project, path, can } = workspace;
  const [asking, setAsking] = useState<Asking>(null);
  const [said, setSaid] = useState<{ said: Said; tone: 'success' | 'error' | 'info' } | null>(null);
  const mine = project.class === 'mine';
  /** Why an action is inactive, or null when it is not. */
  const why = (method: Method): string | null => (!mine ? TEXT.writeReadOnly : can(method) ? null : TEXT.notOffered);

  const action = (
    method: Method,
    label: string,
    Icon: typeof FilePlusIcon,
    open: () => void,
    needsFile = false,
  ): ReactElement => {
    const reason = why(method) ?? (needsFile && !path ? TEXT.noOpenFile : null);
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={reason ? `${label} — ${reason}` : label}
        aria-haspopup="dialog"
        disabled={reason !== null}
        onClick={open}>
        <Icon aria-hidden="true" />
      </Button>
    );
  };

  const done = (text: string): void => {
    setSaid({ said: { text }, tone: 'success' });
    workspace.refresh();
  };

  // Deleting: offered by a companion with a Trash; otherwise the button says why when pressed.
  const trash = can('file.delete');
  const deleteReason = !mine ? TEXT.writeReadOnly : !path ? TEXT.noOpenFile : null;

  return (
    <div className="kit-projects-file-actions">
      <div className="kit-projects-commit-tools" role="toolbar" aria-label={TEXT.fileActions}>
        {action('file.create', TEXT.newFile, FilePlusIcon, () => setAsking('file'))}
        {action('folder.create', TEXT.newFolder, FolderPlusIcon, () => setAsking('folder'))}
        {action('file.rename', TEXT.renameFile, PencilIcon, () => setAsking('rename'), true)}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={TEXT.deleteFile}
          title={deleteReason ? `${TEXT.deleteFile} — ${deleteReason}` : trash ? TEXT.deleteFile : TEXT.noTrash}
          disabled={deleteReason !== null}
          data-trash={trash ? '' : undefined}
          onClick={() => (trash ? setAsking('delete') : setSaid({ said: { text: TEXT.noTrash }, tone: 'info' }))}>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      {said && <SaidNote said={said.said} tone={said.tone} kind="files" />}

      <PathDialog
        open={asking === 'file'}
        onOpenChange={open => setAsking(open ? 'file' : null)}
        title={TEXT.newFileTitle}
        label={TEXT.pathInProject}
        initial={folderOf(path)}
        action={TEXT.create}
        run={async target => {
          await backend.call('file.create', { project: project.id, path: target, text: '' });
          done(TEXT.created(printable(target)));
          workspace.open(target);
        }}
      />
      <PathDialog
        open={asking === 'folder'}
        onOpenChange={open => setAsking(open ? 'folder' : null)}
        title={TEXT.newFolderTitle}
        label={TEXT.pathInProject}
        initial={folderOf(path)}
        action={TEXT.create}
        run={async target => {
          await backend.call('folder.create', { project: project.id, path: target.replace(/\/+$/, '') });
          done(TEXT.created(printable(target)));
        }}
      />
      {path && (
        <PathDialog
          open={asking === 'rename'}
          onOpenChange={open => setAsking(open ? 'rename' : null)}
          title={TEXT.renameTitle(printable(path))}
          label={TEXT.pathInProject}
          initial={path}
          action={TEXT.renameRun}
          run={async target => {
            if (target === path) return;
            await backend.call('file.rename', { project: project.id, from: path, to: target });
            done(TEXT.renamed(printable(path), printable(target)));
            go(routeHash({ section: 'projects', project: project.id, path: target }));
          }}
        />
      )}
      {path && trash && (
        <DeleteFileDialog
          path={path}
          open={asking === 'delete'}
          onOpenChange={open => setAsking(open ? 'delete' : null)}
          onDelete={async () => {
            await backend.call('file.delete', { project: project.id, path });
            done(TEXT.deleted(printable(path)));
            go(routeHash({ section: 'projects', project: project.id }));
          }}
        />
      )}
    </div>
  );
};

const DeleteFileDialog = ({
  path,
  open,
  onOpenChange,
  onDelete,
}: {
  path: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): Promise<void>;
}): ReactElement => {
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
          <DialogTitle>{TEXT.deleteFileTitle(printable(path))}</DialogTitle>
          <DialogDescription>{TEXT.deleteFileBody}</DialogDescription>
        </DialogHeader>
        {problem && <SaidNote said={problem} kind="delete" />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {TEXT.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              onDelete().then(
                () => onOpenChange(false),
                (error: unknown) => setProblem(errorText(error, 'write')),
              )
            }>
            {TEXT.deleteRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
