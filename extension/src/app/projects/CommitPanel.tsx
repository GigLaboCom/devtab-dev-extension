/**
 * The commit part, structured as IntelliJ's Commit window (Р27, §6.0, §8.4): a toolbar (refresh, rollback, show diff,
 * expand / collapse, group by folder); the tree of changes with checkboxes — «Changes» and «Unversioned Files», files
 * and their chunks (what is checked is committed, from HEAD; the person's index is not touched); the message with its
 * history; «Run Git hooks» when the project has hooks, on again for every commit; the branch, its upstream and the
 * author; Commit and «Commit and Push…». No confirmation before a commit (§6.2): it can be undone while not pushed.
 * A project that cannot commit (read only, or a companion that does not offer it) shows its changes, their diffs and
 * chunks, and one line saying why there is nothing more: no checkboxes, no message, no buttons that would fail (D35).
 *
 * What is checked goes to the companion with what the page showed (`expect`: HEAD and each file's version — the text's
 * hash, or the bytes' for a binary file), so a file that changed since is refused (`stale-selection`) rather than
 * committed unseen. The output of git and the hooks streams into a live region as it comes; every refusal is said in
 * the page's words with what to do (./errors.ts), the message and the checks stay. «Undo last commit» is offered for
 * a commit the companion may undo — one this page made while it is still HEAD, or one waiting to be pushed — and goes
 * away when the companion answers that it cannot. Keys (D38): Commit while the keyboard is in this view, Undo last
 * commit while it is offered.
 */
import { errorText, toneOf } from './errors';
import { PushDialog } from './PushDialog';
import { RollbackDialog } from './RollbackDialog';
import { SaidNote } from './SaidNote';
import { TEXT, printable, terminalText } from './text';
import { hintOf, useOffer } from '../shell/sectionKeys';
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
import type { SectionKeys } from '../shell/sectionKeys';
import type { Said } from './errors';
import type { Workspace } from './useWorkspace';
import type { CommitSelection, FileHunks, GitIdentity, Outgoing, StatusFile } from '@src/projects/types';
import type { ReactElement } from 'react';

/** A file's checks: the whole file, or some of its chunks (by index). */
type Check = 'all' | ReadonlySet<number>;

type Note = { tone: 'info' | 'success' | 'error'; said: Said; kind: string; retry?: boolean; capture?: boolean };

const checkable = (file: StatusFile): boolean => file.change !== 'conflicted';

/** The checkbox's state for a file. */
const stateOf = (check: Check | undefined): boolean | 'indeterminate' =>
  check === undefined ? false : check === 'all' ? true : check.size ? 'indeterminate' : false;

const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const changeLabel = (file: StatusFile): string =>
  file.change === 'renamed' && file.renamedFrom ? `renamed from ${printable(file.renamedFrom)}` : file.change;

export interface CommitPanelProps {
  workspace: Workspace;
  /** The user's shortcuts as the section gets them; absent: no keys. */
  keys?: SectionKeys;
}

/** The paths a result names, shown as text. */
const pathList = (paths: readonly string[]): string => paths.map(printable).join(', ');

export const CommitPanel = ({ workspace, keys }: CommitPanelProps): ReactElement => {
  const { backend, project, status, state, version, path: openPath, can } = workspace;
  // What is written needs a writable project and a backend that offers the write: otherwise inactive, with why.
  const commits = can('git.commit');
  const mine = project.class === 'mine' && commits;
  // A project that cannot commit shows its changes and their diffs; what only serves a commit is not drawn (D35).
  const readOnly = !mine;
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
  // The commit this page made last (it may be undone while it is HEAD), and the HEADs the companion would not undo.
  const [lastCommit, setLastCommit] = useState<string | null>(null);
  const [notUndoable, setNotUndoable] = useState<ReadonlySet<string>>(new Set());
  // The keyboard is in this view: Commit's key is offered only then, as in an IDE's commit window.
  const [focused, setFocused] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // A note that appears is brought into view, to its end: in a short panel it may land below the fold.
  const noteFrame = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (note) noteFrame.current?.scrollIntoView?.({ block: 'nearest' });
  }, [note]);

  const files = useMemo(() => status?.files ?? [], [status]);
  const fileOf = (path: string): StatusFile | undefined => files.find(f => f.path === path);

  useEffect(() => {
    let live = true;
    Promise.all([
      backend.call('git.identity', { project: project.id }),
      can('git.messages') ? backend.call('git.messages', { project: project.id }) : { messages: [] },
      can('git.outgoing') ? backend.call('git.outgoing', { project: project.id }) : null,
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
    // `can` follows the backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, project.id, version]);

  // New changes are checked as IntelliJ checks its default list: tracked ones on, unversioned ones off; what the
  // person checked or unchecked stays while the file is changed. Nothing is checked where nothing can be committed.
  useEffect(() => {
    setChecks(previous => {
      const next = new Map<string, Check>();
      for (const file of files) {
        const kept = previous.get(file.path);
        if (kept !== undefined) next.set(file.path, kept);
        else if (mine && !seen.current.has(file.path) && file.group === 'changes' && checkable(file))
          next.set(file.path, 'all');
        seen.current.add(file.path);
      }
      for (const path of [...seen.current]) if (!files.some(f => f.path === path)) seen.current.delete(path);
      return next;
    });
  }, [files, mine]);

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
  // The last commit may be undone when the companion says so beforehand (`git.status.headUndoable`, stage 7); an older
  // companion does not, and the page guesses: it waits to be pushed (a companion that lists those), or this page made
  // it and it is still HEAD. Either way the companion has the last word, and once it says no, the action goes for that
  // HEAD (a HEAD that moved, another git operation running).
  const head = status?.headSha ?? null;
  const waitingToPush = outgoing ? outgoing.commits.length > 0 : false;
  const told = typeof status?.headUndoable === 'boolean';
  const undoable =
    can('git.undoCommit') &&
    head !== null &&
    !notUndoable.has(head) &&
    (told
      ? status!.headUndoable
      : waitingToPush || lastCommit === head || (!outgoing && !!state?.upstream && (state.ahead ?? 0) > 0));
  // Why not, said quietly where the person would look for it: after a commit made here, or with commits not pushed.
  const undoReason =
    told && !undoable && mine && can('git.undoCommit') && (lastCommit === head || (state?.ahead ?? 0) > 0)
      ? headUndoText(status!.headUndoReason ?? null)
      : null;
  const branchLine = `${
    state?.branch
      ? TEXT.branchLine(printable(state.branch), state.upstream == null ? null : printable(state.upstream), state.ahead)
      : ''
  }${identity?.email ? ` · ${printable(identity.name ?? '')} <${printable(identity.email)}>` : ''}`;

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
    setNote({ tone: 'info', kind: 'committing', said: { text: TEXT.committing } });
    try {
      const done = await backend.call(
        'git.commit',
        {
          project: project.id,
          message,
          selection,
          runHooks: hooksShown ? runHooks : true,
          expect: { headSha: status.headSha, files: checkedFiles.map(expected) },
        },
        { signal: controller.signal, onStream: part => setOutput(o => [...o, part.text]) },
      );
      const said = [
        TEXT.committed(selection.length, done.sha.slice(0, 7)),
        done.hooksSkipped?.length ? TEXT.hooksWereSkipped(pathList(done.hooksSkipped)) : null,
        done.indexKept.length ? TEXT.indexKept(pathList(done.indexKept)) : null,
        done.hookChangedCommit.length ? TEXT.hookChangedCommit(pathList(done.hookChangedCommit)) : null,
        done.changedAfter.length ? TEXT.changedAfter(pathList(done.changedAfter)) : null,
      ];
      setNote({ tone: 'success', kind: 'committed', said: { text: said.filter(Boolean).join(' ') } });
      setLastCommit(done.sha);
      // The committed files' checks go: what is left of them are other hunks now, with other numbers.
      setChecks(previous => {
        const next = new Map(previous);
        for (const { path } of selection) next.delete(path);
        return next;
      });
      setMessage('');
      setRunHooks(true);
      setSelected(null);
      workspace.refresh();
      if (andPush) setPushOpen(true);
    } catch (error) {
      setNote(commitNote(error, project.id));
      if (isCompanionError(error, 'stale-selection') || isCompanionError(error, 'undo-unavailable'))
        workspace.refresh();
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const undo = async (): Promise<void> => {
    if (!status?.headSha) return;
    const undoing = status.headSha;
    try {
      const done = await backend.call('git.undoCommit', { project: project.id, headSha: undoing });
      setMessage(done.message);
      setLastCommit(null);
      setNote({ tone: 'success', kind: 'undone', said: { text: TEXT.undone } });
      workspace.refresh();
    } catch (error) {
      if (isCompanionError(error, 'undo-unavailable')) setNotUndoable(s => new Set([...s, undoing]));
      setNote({ tone: 'error', kind: 'undo', said: errorText(error, 'undo', project.id) });
      workspace.refresh();
    }
  };
  /** The companion's window may capture the environment again; without one it says the command. */
  const capture = async (): Promise<void> => {
    try {
      await backend.call('env.requestCapture', {});
      setNote({ tone: 'success', kind: 'captured', said: { text: TEXT.retry } });
    } catch (error) {
      setNote({ tone: toneOf(error), kind: 'capture', said: errorText(error, 'capture', project.id) });
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
        expect: {
          files: rollbackPaths.map(path => {
            const file = fileOf(path);
            return file ? expected(file) : { path, diskHash: null };
          }),
        },
      });
      setRolledBack(done.rolledBack);
      setNote({
        tone: 'success',
        kind: 'rolled-back',
        said: { text: TEXT.rolledBack(done.rolledBack.length + done.trashed.length) },
      });
      workspace.refresh();
    } catch (error) {
      setNote({ tone: 'error', kind: 'rollback', said: errorText(error, 'rollback', project.id) });
      if (isCompanionError(error, 'stale-selection')) workspace.refresh();
    }
  };
  // «Undo rollback»: each file's «Before rollback» point (the newest), restored (§6.8); a refusal stops and is said.
  const undoRollback = async (): Promise<void> => {
    const left = [...rolledBack];
    try {
      while (left.length) {
        const path = left[0]!;
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
        left.shift();
      }
      setNote(null);
    } catch (error) {
      setNote({ tone: 'error', kind: 'undo-rollback', said: errorText(error, 'restore', project.id) });
    }
    setRolledBack(left);
    workspace.refresh();
  };

  useOffer(keys, {
    'projects:commit-checked': focused && canCommit && (() => void commit(false)),
    'projects:undo-commit': undoable && !busy && (() => void undo()),
  });

  const groups = [
    { id: 'changes', title: TEXT.changes, files: files.filter(f => f.group === 'changes') },
    { id: 'unversioned', title: TEXT.unversioned, files: files.filter(f => f.group === 'unversioned') },
  ].filter(g => g.files.length > 0);
  const folders = [...new Set(files.map(f => folderOf(f.path)))];

  const fileRow = (file: StatusFile): ReactElement => (
    <li key={file.path} className="kit-projects-change" data-change={file.change}>
      {!readOnly && (
        <Checkbox
          aria-label={file.path}
          checked={stateOf(checks.get(file.path))}
          disabled={!checkable(file)}
          onCheckedChange={() => toggleFile(file)}
        />
      )}
      <button
        type="button"
        className="kit-projects-row"
        aria-current={file.path === (selected ?? openPath) ? 'true' : undefined}
        title={file.change === 'conflicted' ? TEXT.conflicted : undefined}
        onClick={() => select(file)}>
        <span className="kit-projects-row-name" title={printable(file.path)}>
          {printable(byFolder ? file.path.slice(file.path.lastIndexOf('/') + 1) : file.path)}
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
    <section
      className="kit-projects-commit"
      aria-labelledby="projects-commit-title"
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}>
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
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={TEXT.rollback}
              title={TEXT.rollback}
              disabled={!can('git.rollback') || rollbackPaths.length === 0}
              onClick={() => setRollbackOpen(true)}>
              <Undo2Icon aria-hidden="true" />
            </Button>
          )}
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
                {!readOnly && (
                  <Checkbox
                    aria-label={group.title}
                    checked={all ? true : some ? 'indeterminate' : false}
                    disabled={on.length === 0}
                    onCheckedChange={() => toggleGroup(group.files)}
                  />
                )}
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
                            <span className="kit-projects-row-name">{printable(folder) || '/'}</span>
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
          {/* A companion of stage 7 says a new file is whole itself (`reason: new-file`); for an older one the page does. */}
          {!hunks.chunkable || (!told && wholeOnly(fileOf(selected))) ? (
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
                    {!readOnly && (
                      <Checkbox
                        aria-label={TEXT.chunk(hunk.index, hunk.start, hunk.lines)}
                        checked={on}
                        onCheckedChange={() => toggleChunk(hunk.index)}
                      />
                    )}
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

      <p className="kit-projects-commit-line">{branchLine}</p>
      {readOnly ? (
        <p className="kit-projects-note" data-read-only="">
          {project.class !== 'mine' ? TEXT.commitReadOnly : TEXT.commitNotOffered}
        </p>
      ) : (
        <>
          {identity && !identity.email && (
            <SaidNote said={{ text: TEXT.noIdentity, command: TEXT.noIdentityCommand }} kind="identity" />
          )}
          <div className="kit-projects-message">
            <Label htmlFor="projects-commit-message" className="sr-only">
              {TEXT.message}
            </Label>
            <Textarea
              id="projects-commit-message"
              placeholder={TEXT.message}
              value={message}
              disabled={busy}
              onChange={e => setMessage(e.target.value)}
            />
            {messages.length > 0 && (
              <Select value="" onValueChange={value => setMessage(value)} disabled={busy}>
                <SelectTrigger size="sm" aria-label={TEXT.recentMessages}>
                  <SelectValue placeholder={TEXT.recentMessages} />
                </SelectTrigger>
                <SelectContent>
                  {messages.map(m => (
                    <SelectItem key={m} value={m}>
                      {printable(m.split('\n')[0] ?? '')}
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
                disabled={busy}
                onCheckedChange={v => setRunHooks(v === true)}
              />
              <Label htmlFor="projects-run-hooks">{TEXT.runHooks}</Label>
              {!runHooks && <span className="kit-projects-part-hint">{TEXT.hooksSkipped}</span>}
            </div>
          )}
          {hooksShown && runHooks && (
            <p className="kit-projects-part-hint" data-hooks="">
              {TEXT.hooksWillRun((state?.hooks ?? []).map(printable).join(', '))}
            </p>
          )}
          <p className="kit-projects-part-hint">{TEXT.checked(checkedFiles.length, chunkCount)}</p>
          <div className="kit-projects-commit-actions">
            <Button
              disabled={!canCommit}
              onClick={() => void commit(false)}
              {...hintOf(keys, 'projects:commit-checked', TEXT.commit)}>
              {TEXT.commit}
            </Button>
            <Button
              variant="outline"
              disabled={!canCommit || !can('git.push')}
              title={can('git.push') ? undefined : TEXT.pushNotOffered}
              onClick={() => void commit(true)}>
              {TEXT.commitAndPush}
            </Button>
            {busy && (
              <Button variant="ghost" onClick={() => abort.current?.abort()}>
                {TEXT.cancel}
              </Button>
            )}
          </div>
          {(busy || output.length > 0) && (
            <pre
              className="kit-projects-output"
              role="log"
              aria-live="polite"
              aria-label={TEXT.hookOutput}
              data-output="">
              {terminalText(output.join(''))}
            </pre>
          )}
          {note && (
            <SaidNote
              said={output.length > 0 && note.said.output ? { ...note.said, output: undefined } : note.said}
              tone={note.tone}
              kind={note.kind}>
              {note.retry && (
                <Button size="sm" variant="outline" disabled={!canCommit} onClick={() => void commit(false)}>
                  {TEXT.retry}
                </Button>
              )}
              {note.capture && can('env.requestCapture') && (
                <Button size="sm" variant="ghost" onClick={() => void capture()}>
                  {TEXT.captureAgain}
                </Button>
              )}
            </SaidNote>
          )}
          {undoReason && (
            <p className="kit-projects-note" data-undo-reason={status?.headUndoReason ?? ''}>
              {undoReason}
            </p>
          )}
          {(undoable || rolledBack.length > 0) && (
            <div className="kit-projects-commit-actions">
              {undoable && !busy && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void undo()}
                  {...hintOf(keys, 'projects:undo-commit', TEXT.undoCommitTitle)}>
                  {TEXT.undoCommit}
                </Button>
              )}
              {can('history.restore') && rolledBack.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => void undoRollback()}>
                  {TEXT.undoRollback}
                </Button>
              )}
              {waitingToPush && can('git.push') && (
                <Button variant="ghost" size="sm" onClick={() => setPushOpen(true)}>
                  {TEXT.pushRun}…
                </Button>
              )}
            </div>
          )}
          {/* The end of what was said: brought into view when a note appears. */}
          <div ref={noteFrame} />
        </>
      )}

      <RollbackDialog
        paths={rollbackPaths}
        trash={workspace.trash}
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        onRollback={deleteAdded => void rollback(deleteAdded)}
      />
      <PushDialog workspace={workspace} open={pushOpen} onOpenChange={setPushOpen} />
    </section>
  );
};

/** Why HEAD cannot be undone, in the page's words (`git.status.headUndoReason`); null: nothing worth saying. */
const headUndoText = (reason: string | null): string | null =>
  reason === null || reason === 'not-mine'
    ? null
    : reason === 'unknown'
      ? TEXT.headUndo.unknown
      : (TEXT.errors.undoUnavailable[reason] ?? TEXT.errors.undoUnavailableOther);

/** A new file is committed whole (the companion takes no chunks of it). */
const wholeOnly = (file: StatusFile | undefined): boolean => file?.change === 'untracked' || file?.change === 'added';

/** What a file's version was when it was shown: the text's hash, or the bytes' for a binary or very large file. */
const expected = (file: StatusFile): { path: string; diskHash: string | null; diskBytesHash?: string | null } => ({
  path: file.path,
  diskHash: file.diskHash ?? null,
  ...(file.diskBytesHash != null && { diskBytesHash: file.diskBytesHash }),
});

/** A failed commit, said: the page's words by the code, what to do, the hook's output when none was streamed. */
const commitNote = (error: unknown, project: string): Note => {
  const said = errorText(error, 'commit', project);
  const code = isCompanionError(error) ? error.code : 'failed';
  return {
    tone: code === 'cancelled' ? 'info' : 'error',
    kind: code,
    said,
    retry: code === 'hook-failed' || code === 'hook-tool-missing' || code === 'hook-timeout' || code === 'index-locked',
    capture: code === 'hook-tool-missing',
  };
};
