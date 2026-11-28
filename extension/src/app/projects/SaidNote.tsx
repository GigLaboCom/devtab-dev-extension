/**
 * One thing said on the page (./errors.ts `Said`): a sentence, the commands that go with it — shown verbatim, each with
 * a Copy button — and the output of git or a hook, monospaced. Text only: what came from the companion was made
 * printable before it got here. A live region (`role="status"`, or `alert` for an error that stops what was asked) so
 * a screen reader hears it when it appears.
 */
import { TEXT } from './text';
import { CopyButton } from '@workspace/ui/copy-button';
import type { Said } from './errors';
import type { ReactElement, ReactNode } from 'react';

const Command = ({ command }: { command: string }): ReactElement => (
  <span className="kit-projects-said-command">
    <code className="kit-projects-command" aria-label={TEXT.terminalCommand} data-command="">
      {command}
    </code>
    <CopyButton value={command} icon size="icon-sm" label={TEXT.copyCommand(command)} resetAfterMs={1500} />
  </span>
);

export interface SaidNoteProps {
  said: Said;
  tone?: 'info' | 'success' | 'error';
  /** What the note is about, for tests and styling (`data-said`). */
  kind?: string;
  children?: ReactNode;
}

export const SaidNote = ({ said, tone = 'error', kind, children }: SaidNoteProps): ReactElement => {
  const commands = [...(said.command ? [said.command] : []), ...(said.commands ?? [])];
  return (
    <div className="kit-projects-said" data-tone={tone} data-said={kind} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="kit-projects-said-text">{said.text}</p>
      {commands.map(command => (
        <Command key={command} command={command} />
      ))}
      {said.output && <pre className="kit-projects-output">{said.output}</pre>}
      {children && <div className="kit-projects-commit-actions">{children}</div>}
    </div>
  );
};
