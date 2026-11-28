/**
 * A project's bar: which project (and a way back to all of them), where it is, its branch, its class (§8.4 «Класс
 * проекта») and where the class came from — a trusted folder by its name, the terminal, the companion's window, the
 * person — with the way to change it, «Remove…», «Go to file» and «Find in files…» (it opens the panel find lives in).
 *
 * Making a project writable asks the companion: inside a writable trusted folder it is at once; outside, only after the
 * companion's own window — while it waits the bar says so and offers Cancel (`cancel` closes the window, §4.9). A
 * companion without a window answers with the command to run in Terminal instead, shown verbatim with one sentence;
 * a decline, a window already open, a request too soon after a decline — each said in the page's words (./errors.ts).
 * Making it read only is at once. Removing asks here first (the project leaves the list; its folder and history stay).
 */
import { errorText, toneOf } from './errors';
import { RemoveProjectDialog } from './RemoveProjectDialog';
import { SaidNote } from './SaidNote';
import { TEXT, printable } from './text';
import { go, routeHash } from '../route';
import { Button } from '@workspace/ui/button';
import { SearchIcon, TextSearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyHint } from '../shell/sectionKeys';
import type { Said } from './errors';
import type { Workspace } from './useWorkspace';
import type { ProjectSummary, TrustedLocation } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface ProjectBarProps {
  workspace: Workspace;
  locations: readonly TrustedLocation[];
  onGoToFile(): void;
  /** Starts a search: the panel with find in files opens, its field focused. */
  onFindInFiles(): void;
  onClassChanged(): void;
  /** The tooltips of «Go to file» and «Find in files…» with their keys now. */
  goToFileHint?: KeyHint;
  findHint?: KeyHint;
}

/** Where the class came from, in words; null when the class says it all. */
export const viaText = (project: ProjectSummary, location: TrustedLocation | undefined): string | null => {
  const named = project.locationName ?? location?.name ?? null;
  switch (project.via) {
    case 'location':
      if (project.class === 'mine' && (named || project.location))
        return TEXT.viaFolder(printable(named ?? project.location ?? ''));
      // A project made writable by a trusted folder that was removed since: read only again, and why.
      return project.class === 'view' && !project.location ? TEXT.viaFolderGone : null;
    case 'terminal':
      return TEXT.viaTerminal;
    case 'dialog':
      return TEXT.viaDialog;
    case 'person':
      return TEXT.viaPerson;
    default:
      return null;
  }
};

type Request = { state: 'idle' } | { state: 'busy' | 'awaiting'; abort: AbortController };

export const ProjectBar = ({
  workspace,
  locations,
  onGoToFile,
  onFindInFiles,
  onClassChanged,
  goToFileHint,
  findHint,
}: ProjectBarProps): ReactElement => {
  const { project, state, backend } = workspace;
  const [request, setRequest] = useState<Request>({ state: 'idle' });
  const [said, setSaid] = useState<{ said: Said; tone: 'error' | 'success' | 'info'; kind: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const location = locations.find(l => l.displayPath === project.location);
  const mine = project.class === 'mine';
  // A companion that does not change classes: the button stays, inactive, and says why.
  const offered = workspace.can(mine ? 'project.setView' : 'project.requestMine');
  const via = viaText(project, location);
  // The cancel of a request still waiting when the bar goes (another project, the section left).
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const change = async (): Promise<void> => {
    const abort = new AbortController();
    pending.current = abort;
    setSaid(null);
    // Making writable may wait for the companion's window: say so at once rather than after a delay.
    setRequest({ state: mine ? 'busy' : 'awaiting', abort });
    try {
      if (mine) await backend.call('project.setView', { project: project.id });
      else await backend.call('project.requestMine', { project: project.id }, { signal: abort.signal });
      if (!live.current) return;
      setSaid({ said: { text: mine ? TEXT.madeView : TEXT.madeMine }, tone: 'success', kind: 'class' });
      onClassChanged();
    } catch (error) {
      if (!live.current) return;
      setSaid({ said: errorText(error, 'class', project.id), tone: toneOf(error), kind: 'class' });
    } finally {
      if (pending.current === abort) pending.current = null;
      if (live.current) setRequest({ state: 'idle' });
    }
  };

  return (
    <header className="kit-projects-bar-frame">
      <div className="kit-projects-bar">
        <a className="kit-projects-bar-back" href={routeHash({ section: 'projects' })}>
          {TEXT.allProjects}
        </a>
        <h1 className="kit-projects-bar-title">{printable(project.name)}</h1>
        <span className="kit-projects-bar-path">{printable(project.displayPath)}</span>
        {state?.branch && <span className="kit-projects-bar-branch">{printable(state.branch)}</span>}
        <span className="kit-projects-class" data-class={project.class} data-via={project.via}>
          {mine ? TEXT.classMine : TEXT.classView}
          {via && <span className="kit-projects-class-via">{via}</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={request.state !== 'idle' || !offered}
          title={offered ? undefined : TEXT.notOffered}
          onClick={() => void change()}>
          {mine ? TEXT.makeView : TEXT.makeMine}
        </Button>
        {!offered && (
          <span className="kit-projects-note" data-offered="no">
            {TEXT.notOffered}
          </span>
        )}
        {request.state === 'awaiting' && (
          <span className="kit-projects-note" data-request="awaiting-confirmation" role="status">
            {TEXT.awaiting}
            <Button variant="outline" size="sm" onClick={() => request.abort.abort()}>
              {TEXT.cancel}
            </Button>
          </span>
        )}
        <div className="kit-projects-bar-actions">
          <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={onGoToFile} {...goToFileHint}>
            <SearchIcon aria-hidden="true" />
            {TEXT.goToFile}
          </Button>
          <Button variant="outline" size="sm" onClick={onFindInFiles} {...findHint}>
            <TextSearchIcon aria-hidden="true" />
            {TEXT.findInFiles}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            disabled={!workspace.can('project.remove')}
            title={workspace.can('project.remove') ? undefined : TEXT.notOffered}
            onClick={() => setRemoving(true)}>
            {TEXT.removeProject}
          </Button>
        </div>
      </div>
      {said && <SaidNote said={said.said} tone={said.tone} kind={said.kind} />}
      <RemoveProjectDialog
        name={printable(project.name)}
        open={removing}
        onOpenChange={setRemoving}
        onRemove={async () => {
          await backend.call('project.remove', { project: project.id });
          onClassChanged();
          go(routeHash({ section: 'projects' }));
        }}
      />
    </header>
  );
};
