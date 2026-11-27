/**
 * The project's tree (§8.4 «Дерево»): folders read as they are opened, ignored entries dimmed (Р18), secrets marked read
 * only (Р19), files that run code marked (Р25), a link that leads out of the project shown and never followed. A
 * folder is read again when the project's files change.
 */
import { TEXT, printable } from './text';
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, LinkIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { TreeEntry, TreeListing } from '@src/projects/types';
import type { ReactElement } from 'react';

type Folder = { state: 'loading' } | { state: 'ready'; listing: TreeListing } | { state: 'failed'; message: string };

const Marks = ({ entry }: { entry: TreeEntry }): ReactElement => (
  <>
    {entry.secret && (
      <span className="kit-projects-mark" data-mark="secret" title={TEXT.markSecret}>
        {TEXT.markSecret}
      </span>
    )}
    {entry.protected && (
      <span className="kit-projects-mark" data-mark="runs-code" title={TEXT.runsCode}>
        {TEXT.markRunsCode}
      </span>
    )}
    {entry.link === 'outside' && (
      <span className="kit-projects-mark" data-mark="link" title={TEXT.markLinkOutside}>
        {TEXT.markLinkOutside}
      </span>
    )}
  </>
);

export const ProjectTree = ({ workspace }: { workspace: Workspace }): ReactElement => {
  const { backend, project, version, path: current, open } = workspace;
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));

  const load = useCallback(
    (path: string) => {
      setFolders(f => (f[path]?.state === 'ready' ? f : { ...f, [path]: { state: 'loading' } }));
      backend.call('tree.list', { project: project.id, path }).then(
        listing => setFolders(f => ({ ...f, [path]: { state: 'ready', listing } })),
        (e: unknown) =>
          setFolders(f => ({ ...f, [path]: { state: 'failed', message: e instanceof Error ? e.message : String(e) } })),
      );
    },
    [backend, project.id],
  );

  // Every open folder again after a change; a folder that went away is closed.
  useEffect(() => {
    for (const path of expanded) load(path);
    // `expanded` is read, not followed: opening a folder loads it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, version]);

  // The open file's folders are opened, so the file is in view.
  useEffect(() => {
    if (!current) return;
    const parts = current.split('/').slice(0, -1);
    const chain = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    setExpanded(e => {
      const missing = chain.filter(p => !e.has(p));
      if (!missing.length) return e;
      for (const p of missing) load(p);
      return new Set([...e, ...missing]);
    });
  }, [current, load]);

  const toggle = (path: string): void =>
    setExpanded(e => {
      const next = new Set(e);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        load(path);
      }
      return next;
    });

  const renderFolder = (path: string): ReactElement => {
    const folder = folders[path];
    if (!folder || folder.state === 'loading') return <li className="kit-projects-tree-note">{TEXT.loading}</li>;
    if (folder.state === 'failed')
      return (
        <li className="kit-projects-tree-note" data-tone="error">
          {folder.message}
        </li>
      );
    const { entries, truncated } = folder.listing;
    return (
      <>
        {entries.length === 0 && <li className="kit-projects-tree-note">{TEXT.emptyFolder}</li>}
        {entries.map(entry => {
          const isDir = entry.kind === 'dir';
          const isOpen = isDir && expanded.has(entry.path);
          const Icon = isDir ? FolderIcon : entry.kind === 'symlink' ? LinkIcon : FileIcon;
          const Chevron = isOpen ? ChevronDownIcon : ChevronRightIcon;
          return (
            <li
              key={entry.path}
              className="kit-projects-node"
              role="treeitem"
              aria-expanded={isDir ? isOpen : undefined}
              aria-selected={entry.path === current}>
              <button
                type="button"
                className="kit-projects-row"
                data-path={entry.path}
                data-ignored={entry.ignored ? '' : undefined}
                aria-current={entry.path === current ? 'true' : undefined}
                title={entry.ignored ? TEXT.markIgnored : undefined}
                disabled={entry.link === 'outside'}
                onClick={() => (isDir ? toggle(entry.path) : open(entry.path))}>
                {isDir ? <Chevron aria-hidden="true" /> : <span className="kit-projects-row-gap" />}
                <Icon aria-hidden="true" />
                {/* The marks give way to a long name; the whole name is the name's tooltip. */}
                <span className="kit-projects-row-name" title={printable(entry.name)}>
                  {printable(entry.name)}
                </span>
                <Marks entry={entry} />
              </button>
              {isOpen && (
                <ul className="kit-projects-tree-group" role="group">
                  {renderFolder(entry.path)}
                </ul>
              )}
            </li>
          );
        })}
        {truncated && <li className="kit-projects-tree-note">{TEXT.truncated}</li>}
      </>
    );
  };

  return (
    <nav className="kit-projects-tree-frame" aria-label={TEXT.treeLabel}>
      <ul className="kit-projects-tree" role="tree" aria-label={TEXT.treeLabel}>
        {renderFolder('')}
      </ul>
    </nav>
  );
};
