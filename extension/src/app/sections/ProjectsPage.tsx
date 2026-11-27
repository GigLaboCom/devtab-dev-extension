/**
 * «Projects» (D29; the companion's specification §8.4): the developer's local repositories, from the backend the
 * section's composition root names (src/projects/behaviors.ts) — the companion's projects once it is connected, the
 * demo's invented ones before. A chunk of its own, loaded when the section opens (Shell.tsx), so neither the start page
 * nor the shell carries it — and the only place of the extension's Native Messaging code (§8.7: Check 12 of
 * scripts/validate-build.sh finds this chunk by `DEVTAB_PROJECTS_CHUNK`).
 *
 * This file only puts the parts together (src/app/projects/); how an open project's parts are arranged is the seam
 * `WorkspaceLayout` the composition root names (D35: an IDE's side panel with Files and Commit, the editor in the
 * centre, History and Find in files below — src/app/projects/SidePanels.tsx). `#/projects` is the list of projects,
 * the scratch files and the trusted folders.
 *
 * Scratch files (D34; `#/projects/scratches/<id>` opens one) belong to no project: they come from the root's
 * `ScratchStore`, not from the backend, so they are there in every state of the connection — with no permission, no
 * companion, the demo shown, or while it connects — and an open scratch shows neither the demo's notice nor the
 * connection. Whether the section has them is the edition's (`scratches`, src/edition): without them neither the
 * group nor a scratch's address is shown, and what was kept is left as it is.
 */
import { CommitPanel } from '../projects/CommitPanel';
import { ConnectionBar } from '../projects/ConnectionBar';
import { DemoNotice } from '../projects/DemoNotice';
import { EditorPane } from '../projects/EditorPane';
import { HistoryPanel } from '../projects/HistoryPanel';
import { ProjectBar } from '../projects/ProjectBar';
import { ProjectList } from '../projects/ProjectList';
import { ProjectTree } from '../projects/ProjectTree';
import { QuickOpen } from '../projects/QuickOpen';
import { ScratchGroup } from '../projects/ScratchGroup';
import { ScratchView } from '../projects/ScratchView';
import { SearchPanel } from '../projects/SearchPanel';
import { TEXT } from '../projects/text';
import { TrustedFolders } from '../projects/TrustedFolders';
import { useWorkspace } from '../projects/useWorkspace';
import { go, routeHash } from '../route';
import { projectsBehaviors } from '@src/projects/behaviors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../route';
import type { ConnectionStatus, ProjectBackend } from '@src/projects/backend';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { PanelView } from '@src/projects/layout';
import type { ProjectSummary, TrustedLocation } from '@src/projects/types';
import type { FrameKeys } from '@src/shared/keys';
import type { ReactElement } from 'react';

/** The marker by which Check 12 of scripts/validate-build.sh finds this chunk in the build. */
export const DEVTAB_PROJECTS_CHUNK = 'DEVTAB_PROJECTS_CHUNK';

export interface ProjectsPageProps {
  route: Route;
  behaviors: ProjectsBehaviors;
  frameKeys?: FrameKeys;
  /** Whether the edition in force has scratch files (D34); they are where this is not said. */
  scratches?: boolean;
}

interface Lists {
  projects: ProjectSummary[];
  locations: TrustedLocation[];
  /** Whether the backend lists trusted folders (a companion of this stage does not). */
  folders: boolean;
}

const Workspace = ({
  backend,
  project,
  path,
  locations,
  behaviors,
  frameKeys,
  generation,
  onProjectChanged,
}: {
  backend: ProjectBackend;
  project: ProjectSummary;
  path: string | undefined;
  locations: readonly TrustedLocation[];
  behaviors: ProjectsBehaviors;
  frameKeys?: FrameKeys;
  /** Bumped when the connection comes back: everything is read again. */
  generation: number;
  onProjectChanged(): void;
}): ReactElement => {
  const workspace = useWorkspace(backend, project, path, onProjectChanged, generation);
  const [quickOpen, setQuickOpen] = useState(false);
  // A panel's view asked for from a part (a search started, a file's history asked for).
  const [reveal, setReveal] = useState<{ view: PanelView; n: number } | null>(null);
  const ask = (view: PanelView): void => setReveal(r => ({ view, n: (r?.n ?? 0) + 1 }));
  // Asking for a file's history shows the file's, whatever the history showed before.
  const [historyAsked, setHistoryAsked] = useState(0);
  const Layout = behaviors.layout;
  return (
    <>
      <ProjectBar
        workspace={workspace}
        locations={locations}
        onGoToFile={() => setQuickOpen(true)}
        onFindInFiles={() => ask('find')}
        onClassChanged={onProjectChanged}
      />
      {workspace.error && (
        <p className="kit-projects-note" data-tone="error" role="status">
          {workspace.error}
        </p>
      )}
      <Layout
        memory={behaviors.layoutMemory}
        changes={workspace.status ? workspace.status.files.length : null}
        reveal={reveal}
        parts={{
          files: <ProjectTree workspace={workspace} />,
          commit: <CommitPanel workspace={workspace} />,
          editor: (
            <EditorPane
              workspace={workspace}
              frameKeys={frameKeys}
              autosaveDelayMs={behaviors.autosaveDelayMs}
              onShowHistory={() => {
                setHistoryAsked(n => n + 1);
                ask('history');
              }}
            />
          ),
          history: <HistoryPanel key={historyAsked} workspace={workspace} />,
          find: <SearchPanel workspace={workspace} />,
        }}
      />
      <QuickOpen workspace={workspace} open={quickOpen} onOpenChange={setQuickOpen} />
    </>
  );
};

export const ProjectsPage = ({
  route,
  behaviors,
  frameKeys,
  scratches = true,
}: ProjectsPageProps): ReactElement | null => {
  // One backend for the page's life in the section, holding the one port; let go when the section closes (§8.2).
  // Made in an effect, not during render: what the effect's cleanup disposed is never used again.
  const [backend, setBackend] = useState<ProjectBackend | null>(null);
  useEffect(() => {
    const made = behaviors.backend();
    setBackend(made);
    return () => made.dispose();
  }, [behaviors]);
  return backend ? (
    <Projects route={route} behaviors={behaviors} frameKeys={frameKeys} scratches={scratches} backend={backend} />
  ) : null;
};

const Projects = ({
  route,
  behaviors,
  frameKeys,
  scratches,
  backend,
}: ProjectsPageProps & { backend: ProjectBackend }): ReactElement => {
  const [status, setStatus] = useState<ConnectionStatus>(() => backend.status());
  const [lists, setLists] = useState<Lists | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Which backend the lists came from and how often the connection came back: a change reads everything again.
  const demo = backend.capabilities().demo;
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(() => {
    const folders = backend.capabilities().methods.includes('locations.list');
    Promise.all([backend.call('projects.list', {}), folders ? backend.call('locations.list', {}) : []]).then(
      ([projects, locations]) => {
        setFailed(null);
        setLists({ projects, locations, folders });
      },
      (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
    );
  }, [backend]);

  useEffect(() => {
    let previous = backend.status().state;
    const undo = backend.onState(() => {
      const next = backend.status();
      setStatus(next);
      // Back from a lost port or a restarted server, or now connected: read everything again.
      if ((next.state === 'ready' || next.state === 'ready-empty') && previous !== next.state) {
        setGeneration(g => g + 1);
      }
      previous = next.state;
    });
    void backend.connect().then(() => setStatus(backend.status()));
    return undo;
  }, [backend]);

  useEffect(() => {
    if (status.connecting) return;
    reload();
  }, [reload, demo, generation, status.connecting]);

  const project = route.project ? lists?.projects.find(p => p.id === route.project) : undefined;
  const scratch = scratches ? route.scratch : undefined;
  // The scratch just made: it opens with the keyboard in the editor.
  const made = useRef<string | null>(null);

  return (
    <section
      className="kit-projects"
      aria-labelledby={project || scratch ? undefined : 'projects-title'}
      aria-label={project ? project.name : scratch ? TEXT.scratchesTitle : undefined}
      data-connection={status.connecting && status.state !== 'reconnecting' ? 'connecting' : status.state}
      data-backend={demo ? 'demo' : 'companion'}>
      {!scratch && <DemoNotice demo={demo} state={status.state} />}
      {!scratch && <ConnectionBar backend={backend} status={status} />}
      {failed && !scratch && (
        <p className="kit-projects-note" data-tone="error" role="status">
          {TEXT.failed(failed)}
        </p>
      )}
      {scratch ? (
        <ScratchView
          key={scratch}
          id={scratch}
          store={behaviors.scratchStore}
          saver={behaviors.scratchSaver}
          frameKeys={frameKeys}
          autosaveDelayMs={behaviors.autosaveDelayMs}
          focus={made.current === scratch}
        />
      ) : project ? (
        <Workspace
          key={`${demo ? 'demo' : 'companion'}:${project.id}`}
          backend={backend}
          project={project}
          path={route.path}
          locations={lists?.locations ?? []}
          behaviors={behaviors}
          frameKeys={frameKeys}
          generation={generation}
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
          {(lists || scratches) && (
            <div className="kit-projects-home">
              {lists && <ProjectList projects={lists.projects} locations={lists.locations} />}
              {scratches && (
                <ScratchGroup
                  store={behaviors.scratchStore}
                  onCreated={created => {
                    made.current = created.id;
                    go(routeHash({ section: 'projects', scratch: created.id }));
                  }}
                />
              )}
              {lists && <TrustedFolders locations={lists.locations} offered={lists.folders} />}
            </div>
          )}
        </>
      )}
    </section>
  );
};

/** The section as the shell loads it: the composition root's behaviors, made once. */
const ProjectsSection = ({
  route,
  frameKeys,
  scratches,
}: {
  route: Route;
  frameKeys?: FrameKeys;
  scratches?: boolean;
}): ReactElement => {
  const behaviors = useMemo(() => projectsBehaviors(), []);
  return <ProjectsPage route={route} behaviors={behaviors} frameKeys={frameKeys} scratches={scratches} />;
};

export default ProjectsSection;
