/**
 * The commit part, structured as IntelliJ's Commit window (Р27, §6.0, §8.4): a toolbar (refresh, rollback, show diff,
 * expand / collapse, group by folder); the tree of changes with checkboxes — «Changes» and «Unversioned Files», files
 * and their chunks (what is checked is committed, from HEAD; the person's index is not touched); the message with its
 * history; «Run Git hooks» when the project has hooks, on again for every commit; the branch, its upstream and the
 * author; Commit and «Commit and Push…». No confirmation before a commit (§6.2): it can be undone while not pushed.
 */
import { PushDialog } from './PushDialog';
import { RollbackDialog } from './RollbackDialog';
import { TEXT } from './text';
import { isCompanionError } from '@src/projects/types';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FileDiffIcon,
  FolderTreeIcon,
  RefreshCwIcon,
  Undo2Icon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { CommitSelection, FileHunks, GitIdentity, Outgoing, StatusFile } from '@src/projects/types';
import type { ReactElement } from 'react';

/** A file's checks: the whole file, or some of its chunks (by index). */
type Check = 'all' | ReadonlySet<number>;

type Note = { tone: 'info' | 'success' | 'error'; text: string; detail?: string };

const checkable = (file: StatusFile): boolean => file.change !== 'conflicted';

/** The checkbox's state for a file. */
const stateOf = (check: Check | undefined): boolean | 'indeterminate' =>
  check === undefined ? false : check === 'all' ? true : check.size ? 'indeterminate' : false;

const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const changeLabel = (file: StatusFile): string =>
  file.change === 'renamed' && file.renamedFrom ? `renamed from ${file.renamedFrom}` : file.change;

export interface CommitPanelProps {
  workspace: Workspace;
}

export const CommitPanel = ({ workspace }: CommitPanelProps): ReactElement => {
  const { backend, project, status, state, version, path: openPath } = workspace;
  const mine = project.class === 'mine';
  const [identity, setIdentity] = useState<GitIdentity | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [checks, setChecks] = useState<ReadonlyMap<string, Check>>(new Map());
  const seen = useRef(new Set<string>());
  const [selected, setSelected] = useState<string | null>(null);
  const [hunks, setHunks] = useState<FileHunks | null>(null);
  const [byFolder, setByFolder] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const [runHooks, setRunHooks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rolledBack, setRolledBack] = useState<string[]>([]);
  const [pushOpen, setPushOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const files = useMemo(() => status?.files ?? [], [status]);
  const fileOf = (path: string): StatusFile | undefined => files.find(f => f.path === path);

  useEffect(() => {
    let live = true;
    Promise.all([
      backend.call('git.identity', { project: project.id }),
      backend.call('git.messages', { project: project.id }),
      backend.call('git.outgoing', { project: project.id }),
    ]).then(
      ([nextIdentity, nextMessages, nextOutgoing]) => {
        if (!live) return;
        setIdentity(nextIdentity);
        setMessages(nextMessages.messages);
        setOutgoing(nextOutgoing);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [backend, project.id, version]);

  // New changes are checked as IntelliJ checks its default list: tracked ones on, unversioned ones off; what the
  // person checked or unchecked stays while the file is changed.
  useEffect(() => {
    setChecks(previous => {
      const next = new Map<string, Check>();
      for (const file of files) {
        const kept = previous.get(file.path);
        if (kept !== undefined) next.set(file.path, kept);
        else if (!seen.current.has(file.path) && file.group === 'changes' && checkable(file))
          next.set(file.path, 'all');
        seen.current.add(file.path);
      }
      for (const path of [...seen.current]) if (!files.some(f => f.path === path)) seen.current.delete(path);
      return next;
    });
  }, [files]);

  // The chunks of the selected file, read again when the files change.
  useEffect(() => {
    if (!selected || !fileOf(selected)) {
      setHunks(null);
      return;
    }
    let live = true;
    backend.call('git.hunks', { project: project.id, path: selected }).then(
      next => live && setHunks(next),
      () => live && setHunks(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, project.id, selected, version]);

  const setCheck = (path: string, check: Check | undefined): void =>
    setChecks(previous => {
      const next = new Map(previous);
      if (check === undefined || (check !== 'all' && check.size === 0)) next.delete(path);
      else next.set(path, check);
      return next;
    });
  const toggleFile = (file: StatusFile): void =>
    setCheck(file.path, checks.get(file.path) === 'all' ? undefined : 'all');
  const toggleGroup = (group: StatusFile[]): void => {
    const on = group.filter(checkable).every(f => checks.get(f.path) === 'all');
    for (const file of group.filter(checkable)) setCheck(file.path, on ? undefined : 'all');
  };
  const toggleChunk = (index: number): void => {
    if (!selected || !hunks) return;
    const all = hunks.hunks.map(h => h.index);
    const current = checks.get(selected);
    const set = new Set(current === 'all' ? all : current ? [...current] : []);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    setCheck(selected, set.size === all.length ? 'all' : set);
  };

  const select = (file: StatusFile): void => {
    setSelected(file.path);
    workspace.open(file.path, { kind: 'diff' });
  };

  const checkedFiles = files.filter(f => checks.has(f.path) && checkable(f));
  const chunkCount = checkedFiles.reduce((n, f) => {
    const check = checks.get(f.path);
    return n + (check && check !== 'all' ? check.size : 0);
  }, 0);
  const hooksShown = (state?.hooks ?? []).some(h => h === 'pre-commit' || h === 'commit-msg');
  const canCommit = mine && !busy && checkedFiles.length > 0 && message.trim().length > 0 && !!identity?.email;

  const commit = async (andPush: boolean): Promise<void> => {
    if (!status || !canCommit) return;
    const selection: CommitSelection[] = checkedFiles.map(file => {
      const check = checks.get(file.path)!;
      return check === 'all' ? { path: file.path } : { path: file.path, chunks: [...check].sort((a, b) => a - b) };
    });
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setOutput([]);
    setNote({ tone: 'info', text: TEXT.committing });
    try {
      const done = await backend.call(
        'git.commit',
        {
          project: project.id,
          message,
          selection,
          runHooks: hooksShown ? runHooks : true,
          expect: { headSha: status.headSha, files: checkedFiles.map(f => ({ path: f.path, diskHash: f.diskHash })) },
        },
        { signal: controller.signal, onStream: line => setOutput(o => [...o, line.text]) },
      );
      setNote({ tone: 'success', text: TEXT.committed(selection.length, done.sha.slice(0, 7)) });
      setMessage('');
      setRunHooks(true);
      setSelected(null);
      workspace.refresh();
      if (andPush) setPushOpen(true);
    } catch (error) {
      setNote(commitError(error));
      if (isCompanionError(error, 'stale-selection')) workspace.refresh();
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const undo = async (): Promise<void> => {
    if (!status) return;
    try {
      const done = await backend.call('git.undoCommit', { project: project.id, headSha: status.headSha });
      setMessage(done.message);
      setNote({ tone: 'success', text: TEXT.undone });
      workspace.refresh();
    } catch (error) {
      setNote({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const rollbackPaths = checkedFiles.length ? checkedFiles.map(f => f.path) : selected ? [selected] : [];
  const rollback = async (deleteAdded: boolean): Promise<void> => {
    setRollbackOpen(false);
    try {
      const done = await backend.call('git.rollback', {
        project: project.id,
        paths: rollbackPaths,
        deleteAdded,
        expect: { files: rollbackPaths.map(path => ({ path, diskHash: fileOf(path)?.diskHash ?? null })) },
      });
      setRolledBack(done.rolledBack);
      setNote({ tone: 'success', text: TEXT.rolledBack(done.rolledBack.length + done.trashed.length) });
      workspace.refresh();
    } catch (error) {
      setNote({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };
  // «Undo rollback»: each file's «Before rollback» point, restored (§6.8).
  const undoRollback = async (): Promise<void> => {
    for (const path of rolledBack) {
      const [{ points }, file] = await Promise.all([
        backend.call('history.file', { project: project.id, path }),
        backend.call('file.read', { project: project.id, path }).catch(() => null),
      ]);
      const before = points.find(p => p.label === 'Before rollback');
      if (before)
        await backend.call('history.restore', {
          project: project.id,
          path,
          point: before.point,
          currentHash: file?.hash ?? null,
        });
    }
    setRolledBack([]);
    setNote(null);
    workspace.refresh();
  };

  const groups = [
    { id: 'changes', title: TEXT.changes, files: files.filter(f => f.group === 'changes') },
    { id: 'unversioned', title: TEXT.unversioned, files: files.filter(f => f.group === 'unversioned') },
  ].filter(g => g.files.length > 0);
  const folders = [...new Set(files.map(f => folderOf(f.path)))];

  const fileRow = (file: StatusFile): ReactElement => (
    <li key={file.path} className="kit-projects-change" data-change={file.change}>
      <Checkbox
        aria-label={file.path}
        checked={stateOf(checks.get(file.path))}
        disabled={!checkable(file) || !mine}
        onCheckedChange={() => toggleFile(file)}
      />
      <button
        type="button"
        className="kit-projects-row"
        aria-current={file.path === (selected ?? openPath) ? 'true' : undefined}
        title={file.change === 'conflicted' ? TEXT.conflicted : undefined}
        onClick={() => select(file)}>
        <span className="kit-projects-row-name">
          {byFolder ? file.path.slice(file.path.lastIndexOf('/') + 1) : file.path}
        </span>
        <span className="kit-projects-change-kind">{changeLabel(file)}</span>
        {file.stagedOutside && (
          <span className="kit-projects-mark" data-mark="staged">
            {TEXT.stagedOutside}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <section className="kit-projects-commit" aria-labelledby="projects-commit-title">
      <div className="kit-projects-commit-head">
        <h2 id="projects-commit-title" className="kit-projects-part-title">
          {TEXT.commitTitle}
        </h2>
        <div className="kit-projects-commit-tools" role="toolbar" aria-label={TEXT.commitTitle}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={TEXT.refresh}
            title={TEXT.refresh}
            onClick={workspace.refresh}>
            <RefreshCwIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={TEXT.rollback}
            title={TEXT.rollback}
            disabled={!mine || rollbackPaths.length === 0}
            onClick={() => setRollbackOpen(true)}>
            <Undo2Icon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={TEXT.showDiff}
            title={TEXT.showDiff}
            disabled={!selected}
            onClick={() => selected && workspace.open(selected, { kind: 'diff' })}>
            <FileDiffIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={TEXT.expandAll}
            title={TEXT.expandAll}
            disabled={!byFolder}
            onClick={() => setCollapsed(new Set())}>
            <ChevronsUpDownIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={TEXT.collapseAll}
            title={TEXT.collapseAll}
            disabled={!byFolder}
            onClick={() => setCollapsed(new Set(folders))}>
            <ChevronsDownUpIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={TEXT.groupByFolder}
            title={TEXT.groupByFolder}
            aria-pressed={byFolder}
            data-pressed={byFolder ? '' : undefined}
            onClick={() => setByFolder(b => !b)}>
            <FolderTreeIcon aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="kit-projects-changes">
        {status && groups.length === 0 && <p className="kit-projects-tree-note">{TEXT.clean}</p>}
        {groups.map(group => {
          const on = group.files.filter(checkable);
          const all = on.length > 0 && on.every(f => checks.get(f.path) === 'all');
          const some = on.some(f => checks.has(f.path));
          return (
            <div key={group.id} className="kit-projects-change-group" role="group" aria-label={group.title}>
              <div className="kit-projects-change-group-head">
                <Checkbox
                  aria-label={group.title}
                  checked={all ? true : some ? 'indeterminate' : false}
                  disabled={!mine || on.length === 0}
                  onCheckedChange={() => toggleGroup(group.files)}
                />
                <span className="kit-projects-change-group-title">{group.title}</span>
                <span className="kit-projects-item-meta">{group.files.length}</span>
              </div>
              <ul className="kit-projects-change-list">
                {byFolder
                  ? folders
                      .filter(folder => group.files.some(f => folderOf(f.path) === folder))
                      .map(folder => (
                        <li key={folder} className="kit-projects-change-folder">
                          <button
                            type="button"
                            className="kit-projects-row"
                            aria-expanded={!collapsed.has(folder)}
                            onClick={() =>
                              setCollapsed(c => {
                                const next = new Set(c);
                                if (next.has(folder)) next.delete(folder);
                                else next.add(folder);
                                return next;
                              })
                            }>
                            <span className="kit-projects-row-name">{folder || '/'}</span>
                          </button>
                          {!collapsed.has(folder) && (
                            <ul className="kit-projects-tree-group">
                              {group.files.filter(f => folderOf(f.path) === folder).map(fileRow)}
                            </ul>
                          )}
                        </li>
                      ))
                  : group.files.map(fileRow)}
              </ul>
            </div>
          );
        })}
      </div>

      {selected && hunks && (
        <div className="kit-projects-chunks" role="group" aria-label={TEXT.chunksOf(selected)}>
          <div className="kit-projects-change-group-title">{TEXT.chunksOf(selected)}</div>
          {!hunks.chunkable ? (
            <p className="kit-projects-tree-note">
              {hunks.reason === 'conflicted' ? TEXT.conflicted : TEXT.wholeFileOnly}
            </p>
          ) : (
            <ul className="kit-projects-change-list">
              {hunks.hunks.map(hunk => {
                const check = checks.get(selected);
                const on = check === 'all' || (check !== undefined && check.has(hunk.index));
                return (
                  <li key={hunk.index} className="kit-projects-chunk">
                    <Checkbox
                      aria-label={TEXT.chunk(hunk.index, hunk.start, hunk.lines)}
                      checked={on}
                      disabled={!mine}
                      onCheckedChange={() => toggleChunk(hunk.index)}
                    />
                    <button type="button" className="kit-projects-row" onClick={() => workspace.revealHunk(hunk.index)}>
                      <span className="kit-projects-row-name">{TEXT.chunk(hunk.index, hunk.start, hunk.lines)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="kit-projects-message">
        <Label htmlFor="projects-commit-message" className="sr-only">
          {TEXT.message}
        </Label>
        <Textarea
          id="projects-commit-message"
          placeholder={TEXT.message}
          value={message}
          disabled={!mine || busy}
          onChange={e => setMessage(e.target.value)}
        />
        {messages.length > 0 && (
          <Select value="" onValueChange={value => setMessage(value)} disabled={!mine || busy}>
            <SelectTrigger size="sm" aria-label={TEXT.recentMessages}>
              <SelectValue placeholder={TEXT.recentMessages} />
            </SelectTrigger>
            <SelectContent>
              {messages.map(m => (
                <SelectItem key={m} value={m}>
                  {m.split('\n')[0]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {hooksShown && (
        <div className="kit-projects-check">
          <Checkbox
            id="projects-run-hooks"
            checked={runHooks}
            disabled={!mine || busy}
            onCheckedChange={v => setRunHooks(v === true)}
          />
          <Label htmlFor="projects-run-hooks">{TEXT.runHooks}</Label>
          {!runHooks && <span className="kit-projects-part-hint">{TEXT.hooksSkipped}</span>}
        </div>
      )}

      <p className="kit-projects-commit-line">
        {state?.branch ? TEXT.branchLine(state.branch, state.upstream, state.ahead) : ''}
        {identity?.email ? ` · ${identity.name ?? ''} <${identity.email}>` : ''}
      </p>
      {identity && !identity.email && (
        <p className="kit-projects-note" data-tone="error">
          {TEXT.noIdentity} <code className="kit-projects-command">{TEXT.noIdentityCommand}</code>
        </p>
      )}
      {!mine && <p className="kit-projects-note">{TEXT.viewExplained}</p>}
      <p className="kit-projects-part-hint">{TEXT.checked(checkedFiles.length, chunkCount)}</p>

      <div className="kit-projects-commit-actions">
        <Button disabled={!canCommit} onClick={() => void commit(false)}>
          {TEXT.commit}
        </Button>
        <Button variant="outline" disabled={!canCommit} onClick={() => void commit(true)}>
          {TEXT.commitAndPush}
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            {TEXT.cancel}
          </Button>
        )}
      </div>

      {output.length > 0 && <pre className="kit-projects-output">{output.join('\n')}</pre>}
      {note && (
        <p className="kit-projects-note" data-tone={note.tone} role="status">
          {note.text}
          {note.detail && <code className="kit-projects-command">{note.detail}</code>}
        </p>
      )}
      <div className="kit-projects-commit-actions">
        {mine && !busy && (outgoing?.commits.length ?? 0) > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void undo()}>
            {TEXT.undoCommit}
          </Button>
        )}
        {mine && rolledBack.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void undoRollback()}>
            {TEXT.undoRollback}
          </Button>
        )}
        {mine && (outgoing?.commits.length ?? 0) > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setPushOpen(true)}>
            {TEXT.pushRun}…
          </Button>
        )}
      </div>

      <RollbackDialog
        paths={rollbackPaths}
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        onRollback={deleteAdded => void rollback(deleteAdded)}
      />
      <PushDialog workspace={workspace} open={pushOpen} onOpenChange={setPushOpen} />
    </section>
  );
};

const commitError = (error: unknown): Note => {
  if (!isCompanionError(error)) return { tone: 'error', text: TEXT.failed(String(error)) };
  const data = error.data ?? {};
  switch (error.code) {
    case 'stale-selection':
      return { tone: 'error', text: TEXT.staleSelection };
    case 'hook-failed':
      return { tone: 'error', text: TEXT.hookFailed(String(data.hook ?? 'A hook')) };
    case 'hook-tool-missing':
      return { tone: 'error', text: TEXT.hookToolMissing(String(data.tool ?? 'a tool')) };
    case 'hook-timeout':
      return { tone: 'error', text: TEXT.hookTimeout };
    case 'cancelled':
      return { tone: 'error', text: TEXT.commitCancelled };
    case 'identity-missing':
      return { tone: 'error', text: TEXT.noIdentity, detail: TEXT.noIdentityCommand };
    default:
      return { tone: 'error', text: TEXT.failed(error.message) };
  }
};
