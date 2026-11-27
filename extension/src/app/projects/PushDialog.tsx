/**
 * Push (§6.9; IntelliJ's Push Commits window): the current branch to its upstream (set when there is none), the
 * commits that go, Push and Cancel; while it runs, its output and Cancel; each failure with what to do in the terminal.
 */
import { TEXT, formatTime } from './text';
import { isCompanionError } from '@src/projects/types';
import { Button } from '@workspace/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/dialog';
import { useEffect, useRef, useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { Outgoing } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface PushDialogProps {
  workspace: Workspace;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export const PushDialog = ({ workspace, open, onOpenChange }: PushDialogProps): ReactElement => {
  const { backend, project } = workspace;
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string; command?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setOutput([]);
    let live = true;
    backend.call('git.outgoing', { project: project.id }).then(
      next => live && setOutgoing(next),
      (e: unknown) =>
        live && setResult({ tone: 'error', text: TEXT.failed(e instanceof Error ? e.message : String(e)) }),
    );
    return () => {
      live = false;
    };
  }, [backend, open, project.id]);

  const target = outgoing ? (outgoing.upstream ?? `${outgoing.remote ?? 'origin'}/${outgoing.branch ?? ''}`) : '';

  const push = async (): Promise<void> => {
    if (!outgoing?.branch || !workspace.status) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setOutput([]);
    setResult(null);
    try {
      const done = await backend.call(
        'git.push',
        {
          project: project.id,
          expect: { headSha: workspace.status.headSha, remote: outgoing.remote ?? 'origin', branch: outgoing.branch },
        },
        { signal: controller.signal, onStream: line => setOutput(o => [...o, line.text]) },
      );
      setResult({ tone: 'success', text: TEXT.pushed(done.pushed, `${done.remote}/${done.branch}`) });
      setOutgoing(o => (o ? { ...o, commits: [], upstream: `${done.remote}/${done.branch}`, setUpstream: false } : o));
      workspace.refresh();
    } catch (error) {
      if (isCompanionError(error, 'cancelled')) setResult({ tone: 'error', text: TEXT.searchCancelled });
      else if (isCompanionError(error)) {
        const command = typeof error.data?.command === 'string' ? error.data.command : undefined;
        const detail = typeof error.data?.output === 'string' ? error.data.output : undefined;
        setResult({
          tone: 'error',
          text: TEXT.pushErrors[error.code] ?? error.message,
          ...((command ?? detail) ? { command: command ?? detail } : {}),
        });
      } else setResult({ tone: 'error', text: TEXT.failed(String(error)) });
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) abort.current?.abort();
        onOpenChange(next);
      }}>
      <DialogContent className="kit-projects-push">
        <DialogHeader>
          <DialogTitle>{TEXT.pushTitle}</DialogTitle>
          <DialogDescription>
            {outgoing?.branch ? TEXT.pushTarget(outgoing.branch, target) : ''}
            {outgoing?.setUpstream ? ` ${TEXT.pushSetsUpstream}` : ''}
          </DialogDescription>
        </DialogHeader>
        {outgoing && outgoing.commits.length === 0 && !result && (
          <p className="kit-projects-part-hint">{TEXT.pushNothing}</p>
        )}
        {outgoing && outgoing.commits.length > 0 && (
          <ul className="kit-projects-dialog-list" aria-label={TEXT.pushTitle}>
            {outgoing.commits.map(commit => (
              <li key={commit.sha} className="kit-projects-commit-row">
                <code className="kit-projects-command">{commit.short}</code>
                <span className="kit-projects-commit-summary">{commit.summary}</span>
                <span className="kit-projects-item-meta">
                  {commit.author} · {formatTime(commit.timeMs)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {output.length > 0 && <pre className="kit-projects-output">{output.join('\n')}</pre>}
        {result && (
          <p className="kit-projects-note" data-tone={result.tone} role="status">
            {result.text}
            {result.command && (
              <>
                {' '}
                {TEXT.pushCommand} <code className="kit-projects-command">{result.command}</code>
              </>
            )}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (running ? abort.current?.abort() : onOpenChange(false))}>
            {TEXT.cancel}
          </Button>
          <Button disabled={running || !outgoing?.commits.length} onClick={() => void push()}>
            {running ? TEXT.pushing : TEXT.pushRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
