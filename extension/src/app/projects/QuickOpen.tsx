/**
 * Quick open (§8.4 «Быстрый переход»): a few letters of a path, the companion's matches, ignored ones dimmed; Enter or
 * a click opens the file.
 */
import { TEXT, printable } from './text';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/dialog';
import { Input } from '@workspace/ui/input';
import { useEffect, useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { FoundFile } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface QuickOpenProps {
  workspace: Workspace;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export const QuickOpen = ({ workspace, open, onOpenChange }: QuickOpenProps): ReactElement => {
  const { backend, project } = workspace;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundFile[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    backend.call('files.find', { project: project.id, query, limit: 30 }).then(
      files => live && setFound(files),
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [backend, project.id, query, open]);

  const choose = (path: string): void => {
    onOpenChange(false);
    setQuery('');
    workspace.open(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kit-projects-quick" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{TEXT.quickOpenTitle}</DialogTitle>
        </DialogHeader>
        <Input
          aria-label={TEXT.quickOpenPlaceholder}
          placeholder={TEXT.quickOpenPlaceholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && found?.[0]) choose(found[0].path);
          }}
        />
        <ul className="kit-projects-quick-list">
          {found?.length === 0 && <li className="kit-projects-tree-note">{TEXT.noMatches}</li>}
          {found?.map(file => (
            <li key={file.path}>
              <button
                type="button"
                className="kit-projects-row"
                data-ignored={file.ignored ? '' : undefined}
                onClick={() => choose(file.path)}>
                <span className="kit-projects-row-name">{printable(file.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
};
