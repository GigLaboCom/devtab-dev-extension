/**
 * «Projects» (D29; the companion's specification §8.4): the developer's local repositories, from the backend the
 * section's composition root names (src/projects/behaviors.ts) — the demo's invented projects until the companion
 * exists. A chunk of its own, loaded when the section opens (Shell.tsx), so neither the start page nor the shell carries
 * it.
 *
 * This file only arranges the parts (src/app/projects/); the look is the owner's to choose (Р4), and the
 * specification's layouts are other arrangements of the same parts. This one is the first it lists (§8.4, variant 1):
 * the project's tree on the left, the file in the middle, the Commit window as a column on the right, a panel below
 * with Find and History. `#/projects` is the list of projects and the trusted folders.
 */
import { CommitPanel } from '../projects/CommitPanel';
import { DemoNotice } from '../projects/DemoNotice';
import { EditorPane } from '../projects/EditorPane';
import { HistoryPanel } from '../projects/HistoryPanel';
import { ProjectBar } from '../projects/ProjectBar';
import { ProjectList } from '../projects/ProjectList';
import { ProjectTree } from '../projects/ProjectTree';
import { QuickOpen } from '../projects/QuickOpen';
import { SearchPanel } from '../projects/SearchPanel';
import { TEXT } from '../projects/text';
import { TrustedFolders } from '../projects/TrustedFolders';
import { useWorkspace } from '../projects/useWorkspace';
import { projectsBehaviors } from '@src/projects/behaviors';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Route } from '../route';
import type { ConnectionState, ProjectBackend } from '@src/projects/backend';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { ProjectSummary, TrustedLocation } from '@src/projects/types';
import type { FrameKeys } from '@src/shared/keys';
import type { ReactElement } from 'react';

export interface ProjectsPageProps {
  route: Route;
  behaviors: ProjectsBehaviors;
  frameKeys?: FrameKeys;
}

interface Lists {
  projects: ProjectSummary[];
  locations: TrustedLocation[];
}

const Workspace = ({
  backend,
  project,
  path,
  locations,
  behaviors,
  frameKeys,
  onProjectChanged,
}: {
  backend: ProjectBackend;
  project: ProjectSummary;
  path: string | undefined;
  locations: readonly TrustedLocation[];
  behaviors: ProjectsBehaviors;
  frameKeys?: FrameKeys;
  onProjectChanged(): void;
}): ReactElement => {
  const workspace = useWorkspace(backend, project, path, onProjectChanged);
  const [quickOpen, setQuickOpen] = useState(false);
  const [panel, setPanel] = useState<'find' | 'history'>('history');
  return (
    <>
      <ProjectBar
        workspace={workspace}
        locations={locations}
        onGoToFile={() => setQuickOpen(true)}
        onClassChanged={onProjectChanged}
      />
      {workspace.error && (
        <p className="kit-projects-note" data-tone="error" role="status">
          {workspace.error}
        </p>
      )}
      <div className="kit-projects-workspace">
        <ProjectTree workspace={workspace} />
        <EditorPane workspace={workspace} frameKeys={frameKeys} autosaveDelayMs={behaviors.autosaveDelayMs} />
        <CommitPanel workspace={workspace} />
      </div>
      <div className="kit-projects-panel">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={panel}
          aria-label={TEXT.title}
          onValueChange={value => (value === 'find' || value === 'history') && setPanel(value)}>
          <ToggleGroupItem value="history">{TEXT.historyLabel}</ToggleGroupItem>
          <ToggleGroupItem value="find">{TEXT.searchLabel}</ToggleGroupItem>
        </ToggleGroup>
        <div className="kit-projects-panel-body">
          {panel === 'find' ? <SearchPanel workspace={workspace} /> : <HistoryPanel workspace={workspace} />}
        </div>
      </div>
      <QuickOpen workspace={workspace} open={quickOpen} onOpenChange={setQuickOpen} />
    </>
  );
};

export const ProjectsPage = ({ route, behaviors, frameKeys }: ProjectsPageProps): ReactElement => {
  // One backend for the page's life in the section; let go when the section closes (§8.2).
  const backend = useMemo(() => behaviors.backend(), [behaviors]);
  useEffect(() => () => backend.dispose(), [backend]);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([backend.call('projects.list', {}), backend.call('locations.list', {})]).then(
      ([projects, locations]) => setLists({ projects, locations }),
      (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
    );
  }, [backend]);

  useEffect(() => {
    let live = true;
    void backend.connect().then(c => live && setConnection(c.state));
    const undo = backend.onState(state => setConnection(state));
    reload();
    return () => {
      live = false;
      undo();
    };
  }, [backend, reload]);

  const project = route.project ? lists?.projects.find(p => p.id === route.project) : undefined;
  const demo = backend.capabilities().demo;

  return (
    <section
      className="kit-projects"
      aria-labelledby={project ? undefined : 'projects-title'}
      aria-label={project ? project.name : undefined}
      data-connection={connection ?? 'connecting'}>
      <DemoNotice demo={demo} state={connection ?? 'ready'} />
      {failed && (
        <p className="kit-projects-note" data-tone="error" role="status">
          {TEXT.failed(failed)}
        </p>
      )}
      {project ? (
        <Workspace
          key={project.id}
          backend={backend}
          project={project}
          path={route.path}
          locations={lists?.locations ?? []}
          behaviors={behaviors}
          frameKeys={frameKeys}
          onProjectChanged={reload}
        />
      ) : (
        <>
          <header className="kit-section-head">
            <div>
              <h1 id="projects-title" className="kit-section-title">
                {TEXT.title}
              </h1>
              <p className="kit-section-hint">{TEXT.hint}</p>
            </div>
          </header>
          {lists && (
            <div className="kit-projects-home">
              <ProjectList projects={lists.projects} locations={lists.locations} />
              <TrustedFolders locations={lists.locations} />
            </div>
          )}
        </>
      )}
    </section>
  );
};

/** The section as the shell loads it: the composition root's behaviors, made once. */
const ProjectsSection = ({ route, frameKeys }: { route: Route; frameKeys?: FrameKeys }): ReactElement => {
  const behaviors = useMemo(() => projectsBehaviors(), []);
  return <ProjectsPage route={route} behaviors={behaviors} frameKeys={frameKeys} />;
};

export default ProjectsSection;
