/**
 * «Add project…» (§3.6, §4.6 `project.requestAdd`): the full path of a repository's folder, asked for in a dialog — the
 * one place the page sends an absolute path. Inside a writable trusted folder the companion adds it at once, writable;
 * elsewhere only after its own window: the dialog says to confirm there and Cancel closes that window (`cancel`). A
 * companion without a window answers with the command for Terminal (`cd … && devtab add`), shown verbatim; every
 * refusal of the folder is one `not-found` (S7: the answer does not tell whether a path exists), said as one sentence.
 *
 * The address never adds anything (F6): only the dialog's button does. Key (D38): «Add project» while the list shows.
 */
import { PathDialog } from './PathDialog';
import { TEXT } from './text';
import { hintOf, useOffer } from '../shell/sectionKeys';
import { Button } from '@workspace/ui/button';
import { FolderPlusIcon } from 'lucide-react';
import { useState } from 'react';
import type { SectionKeys } from '../shell/sectionKeys';
import type { ProjectBackend } from '@src/projects/backend';
import type { ProjectId } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface AddProjectProps {
  backend: ProjectBackend;
  keys?: SectionKeys;
  onAdded(id: ProjectId, writable: boolean): void;
}

/** An absolute POSIX path, as the companion takes it (no `~`: it is not expanded). */
const absolute = (value: string): string | null => (value.startsWith('/') ? null : TEXT.addProjectAbsolute);

export const AddProject = ({ backend, keys, onAdded }: AddProjectProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const offered = backend.capabilities().methods.includes('project.requestAdd');
  useOffer(keys, { 'projects:add-project': offered && !open && (() => setOpen(true)) });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        disabled={!offered}
        {...(offered ? hintOf(keys, 'projects:add-project', TEXT.addProjectTitle) : { title: TEXT.notOffered })}
        onClick={() => setOpen(true)}>
        <FolderPlusIcon aria-hidden="true" />
        {TEXT.addProject}
      </Button>
      <PathDialog
        open={open}
        onOpenChange={setOpen}
        title={TEXT.addProjectTitle}
        description={TEXT.addProjectBody}
        label={TEXT.addProjectPath}
        placeholder={TEXT.addProjectPlaceholder}
        initial=""
        action={TEXT.addProjectRun}
        context="add"
        waiting={TEXT.awaiting}
        validate={absolute}
        run={async (path, signal) => {
          const added = await backend.call('project.requestAdd', { path }, { signal });
          onAdded(added.id, added.class === 'mine');
        }}
      />
    </>
  );
};
