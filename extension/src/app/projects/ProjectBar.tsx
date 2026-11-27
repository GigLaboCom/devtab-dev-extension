/**
 * A project's bar: which project (and a way back to all of them), where it is, its branch, its class (§8.4 «Класс
 * проекта») with the way to change it, and «Go to file». Making a project writable asks the companion: inside a
 * trusted folder it is at once, outside only after the companion's own window — which the demo does not have.
 */
import { TEXT } from './text';
import { routeHash } from '../route';
import { isCompanionError } from '@src/projects/types';
import { Button } from '@workspace/ui/button';
import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { TrustedLocation } from '@src/projects/types';
import type { ReactElement } from 'react';

export interface ProjectBarProps {
  workspace: Workspace;
  locations: readonly TrustedLocation[];
  onGoToFile(): void;
  onClassChanged(): void;
}

export const ProjectBar = ({ workspace, locations, onGoToFile, onClassChanged }: ProjectBarProps): ReactElement => {
  const { project, state, backend } = workspace;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const location = locations.find(l => l.displayPath === project.location);
  const mine = project.class === 'mine';

  const change = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      if (mine) await backend.call('project.setView', { project: project.id });
      else await backend.call('project.requestMine', { project: project.id });
      onClassChanged();
    } catch (error) {
      setProblem(
        isCompanionError(error, 'confirmation-unavailable')
          ? `${error.message}. ${TEXT.makeMineCommand}`
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="kit-projects-bar">
      <a className="kit-projects-bar-back" href={routeHash({ section: 'projects' })}>
        {TEXT.allProjects}
      </a>
      <h1 className="kit-projects-bar-title">{project.name}</h1>
      <span className="kit-projects-bar-path">{project.displayPath}</span>
      {state?.branch && <span className="kit-projects-bar-branch">{state.branch}</span>}
      <span className="kit-projects-class" data-class={project.class}>
        {mine ? TEXT.classMine : TEXT.classView}
        {mine && project.via === 'location' && location && (
          <span className="kit-projects-class-via">{TEXT.viaFolder(location.name)}</span>
        )}
      </span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void change()}>
        {mine ? TEXT.makeView : TEXT.makeMine}
      </Button>
      {problem && (
        <span className="kit-projects-note" data-tone="error" role="status">
          {problem}
        </span>
      )}
      <div className="kit-projects-bar-actions">
        <Button variant="outline" size="sm" onClick={onGoToFile}>
          <SearchIcon aria-hidden="true" />
          {TEXT.goToFile}
        </Button>
      </div>
    </header>
  );
};
