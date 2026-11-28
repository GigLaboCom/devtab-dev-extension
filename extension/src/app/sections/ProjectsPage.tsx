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
 *
 * Keys (D38): the page offers the shell the commands it has a target for (`keys`, app/shell/sectionKeys.ts) — an open
 * scratch its actions (ScratchView.tsx), an open project its panels, quick open and changes (below and
 * EditorPane.tsx). "New scratch file" is asked for from any page (src/shortcuts/intent.ts: in the page's memory, never
 * the address): the page's language popup opens at once here, or as the section arrives.
 */
import { AddProject } from '../projects/AddProject';
import { CommitPanel } from '../projects/CommitPanel';
import { ConnectionBar } from '../projects/ConnectionBar';
import { DemoNotice } from '../projects/DemoNotice';
import { EditorPane } from '../projects/EditorPane';
import { HistoryPanel } from '../projects/HistoryPanel';
import { LanguagePicker } from '../projects/LanguagePicker';
import { ProjectBar } from '../projects/ProjectBar';
import { ProjectList } from '../projects/ProjectList';
import { ProjectTree } from '../projects/ProjectTree';
import { QuickOpen } from '../projects/QuickOpen';
import { ScratchGroup } from '../projects/ScratchGroup';
import { ScratchView } from '../projects/ScratchView';
import { SearchPanel } from '../projects/SearchPanel';
import { TEXT, scratchRefusal } from '../projects/text';
import { TrustedFolders } from '../projects/TrustedFolders';
import { useWorkspace } from '../projects/useWorkspace';
import { go, routeHash } from '../route';
import { hintOf, useOffer } from '../shell/sectionKeys';
import { projectsBehaviors } from '@src/projects/behaviors';
import { onAsk, take } from '@src/shortcuts/intent';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../route';
import type { SectionKeys } from '../shell/sectionKeys';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
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
  /** The user's shortcuts as the section gets them (the shell's); absent: no keys. */
  keys?: SectionKeys;
  /** The editor's settings (the shell's composition root, D39); absent: the editors keep their own defaults. */
  editorSettings?: EditorSettingsBehaviors;
}

/** The command that opens the language popup for a new scratch (src/shortcuts/actions.ts). */
const NEW_SCRATCH = 'scratch:new';

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
  keys,
  editorSettings,
  generation,
  onProjectChanged,
}: {
  backend: ProjectBackend;
  project: ProjectSummary;
  path: string | undefined;
  locations: readonly TrustedLocation[];
  behaviors: ProjectsBehaviors;
  frameKeys?: FrameKeys;
  keys?: SectionKeys;
  editorSettings?: EditorSettingsBehaviors;
  /** Bumped when the connection comes back: everything is read again. */
  generation: number;
  onProjectChanged(): void;
}): ReactElement => {
  const workspace = useWorkspace(backend, project, path, onProjectChanged, generation);
  const [quickOpen, setQuickOpen] = useState(false);
  // A panel's view asked for from a part (a search started, a file's history asked for).
  const [reveal, setReveal] = useState<{ view: PanelView; n: number } | null>(null);
  const ask = (view: PanelView): void => setReveal(r => ({ view, n: (r?.n ?? 0) + 1 }));
  // A view's key pressed: it shows and takes the keyboard, or hides when it has it (as an IDE's tool window keys do).
  const [activate, setActivate] = useState<{ view: PanelView; n: number } | null>(null);
  const toggle = (view: PanelView) => () => setActivate(a => ({ view, n: (a?.n ?? 0) + 1 }));
  useOffer(keys, {
    'projects:files': toggle('files'),
    'projects:commit': toggle('commit'),
    'projects:history': toggle('history'),
    'projects:find': toggle('find'),
    'projects:go-to-file': () => setQuickOpen(true),
  });
  const viewKeys: Record<PanelView, string> = {
    files: 'projects:files',
    commit: 'projects:commit',
    history: 'projects:history',
    find: 'projects:find',
  };
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
        goToFileHint={hintOf(keys, 'projects:go-to-file', TEXT.goToFile)}
        findHint={hintOf(keys, 'projects:find', TEXT.searchLabel)}
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
        activate={activate}
        hintOf={(view, title) => hintOf(keys, viewKeys[view], title)}
        parts={{
          files: <ProjectTree workspace={workspace} />,
          commit: <CommitPanel workspace={workspace} keys={keys} />,
          editor: (
            <EditorPane
              workspace={workspace}
              frameKeys={frameKeys}
              keys={keys}
              editorSettings={editorSettings}
              autosaveDelayMs={behaviors.autosaveDelayMs}
              fileSaver={behaviors.fileSaver}
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
  keys,
  editorSettings,
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
    <Projects
      route={route}
      behaviors={behaviors}
      frameKeys={frameKeys}
      scratches={scratches}
      keys={keys}
      editorSettings={editorSettings}
      backend={backend}
    />
  ) : null;
};

const Projects = ({
  route,
  behaviors,
  frameKeys,
  scratches,
  keys,
  editorSettings,
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
      const connected = next.state === 'ready' || next.state === 'ready-empty' || next.state === 'not-initialised';
      if (connected && previous !== next.state) {
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

  // A project added or removed, a class or a trusted folder changed — here or in the terminal: the lists again.
  useEffect(
    () =>
      backend.subscribe(null, event => {
        if (event.name === 'projects.changed') reload();
      }),
    [backend, reload, demo],
  );

  const project = route.project ? lists?.projects.find(p => p.id === route.project) : undefined;
  const scratch = scratches ? route.scratch : undefined;
  // The scratch just made: it opens with the keyboard in the editor.
  const made = useRef<string | null>(null);

  // The language popup of a new scratch: the language the last one was made in is offered first.
  const store = behaviors.scratchStore;
  const [picker, setPicker] = useState<{ open: boolean; problem: string | null; busy: boolean; chose: boolean }>({
    open: false,
    problem: null,
    busy: false,
    chose: false,
  });
  const [lastLanguage, setLastLanguage] = useState<string | null>(null);
  const openPicker = useCallback(() => {
    setPicker({ open: true, problem: null, busy: false, chose: false });
    store.list().then(
      list => setLastLanguage(list.lastLanguage),
      () => setLastLanguage(null),
    );
  }, [store]);
  // Asked for before the section was here, or while it is.
  useEffect(() => {
    if (!scratches) return;
    if (take(NEW_SCRATCH)) openPicker();
    return onAsk(id => id === NEW_SCRATCH && take(id) && openPicker());
  }, [scratches, openPicker]);
  const create = async (language: string): Promise<void> => {
    setPicker(p => ({ ...p, busy: true, problem: null }));
    const result = await store.create(language);
    if (!result.ok) {
      setPicker(p => ({ ...p, busy: false, problem: scratchRefusal(result.refused) }));
      return;
    }
    made.current = result.value.id;
    // Offered first next time without waiting for the store.
    setLastLanguage(language);
    setPicker({ open: false, problem: null, busy: false, chose: true });
    go(routeHash({ section: 'projects', scratch: result.value.id }));
  };

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
          keys={keys}
          editorSettings={editorSettings}
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
          keys={keys}
          editorSettings={editorSettings}
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
              {lists && (
                <ProjectList
                  projects={lists.projects}
                  locations={lists.locations}
                  folders={lists.folders}
                  add={
                    <AddProject
                      backend={backend}
                      keys={keys}
                      onAdded={id => {
                        reload();
                        go(routeHash({ section: 'projects', project: id }));
                      }}
                    />
                  }
                />
              )}
              {scratches && (
                <ScratchGroup
                  store={behaviors.scratchStore}
                  onNew={openPicker}
                  newHint={hintOf(keys, NEW_SCRATCH, TEXT.newScratchTitle)}
                />
              )}
              {lists && <TrustedFolders locations={lists.locations} offered={lists.folders} />}
            </div>
          )}
        </>
      )}
      {scratches && (
        <LanguagePicker
          open={picker.open}
          onOpenChange={open => setPicker(p => ({ ...p, open, problem: open ? p.problem : null }))}
          title={TEXT.newScratchTitle}
          first={lastLanguage}
          problem={picker.problem}
          busy={picker.busy}
          onChoose={language => void create(language)}
          onChosenClose={picker.chose}
        />
      )}
    </section>
  );
};

/** The section as the shell loads it: the composition root's behaviors, made once. */
const ProjectsSection = ({
  route,
  frameKeys,
  scratches,
  keys,
  editorSettings,
}: {
  route: Route;
  frameKeys?: FrameKeys;
  scratches?: boolean;
  keys?: SectionKeys;
  editorSettings?: EditorSettingsBehaviors;
}): ReactElement => {
  const behaviors = useMemo(() => projectsBehaviors(), []);
  return (
    <ProjectsPage
      route={route}
      behaviors={behaviors}
      frameKeys={frameKeys}
      scratches={scratches}
      keys={keys}
      editorSettings={editorSettings}
    />
  );
};

export default ProjectsSection;
