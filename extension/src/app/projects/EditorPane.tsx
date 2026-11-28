/**
 * The editor part (§8.4 «Редактор», §8.6, §8.6а): the open file in the editor module (the page in the iframe, the same
 * module as «Compare code») — the file itself, editable in a writable project and saved by itself (Р22); or a diff with
 * HEAD or with a point of the history, or two points compared. A binary, a too-large file and a link out of the
 * project are said, not opened; a secret and a file of a read-only project open read only. A file changed on disk
 * under an unsaved edit stops its saving and offers the three choices (Р23); without an unsaved edit the disk's text is
 * taken by itself — the editor is asked for its text first, so a keystroke whose edit has not reached the page yet still
 * counts. Each write goes through the composition root's saver (`projectSaver`: `file.save` from the version read); a
 * refusal of the companion's write policy is said in the page's words (./errors.ts), and the mark «runs code» that a
 * write names (a hooks folder among them, which a read does not) stays.
 *
 * Keys (D38): while a diff with changes is shown the part offers "next change" and "previous change" (the editor
 * brings the hunk into view, `viewer/reveal-hunk`; past the last one it starts again at the first, as the IDEs' diff
 * viewers do), and while the file / diff switch is there, "switch file and diff".
 *
 * Indentation (D39): each text is opened with what applies to it (../editor/useEditorIndent.ts — detected from its
 * content, its language's values, the settings), and the indent indicator in the bar shows it and changes it for this
 * file; the choice holds across the file and diff views of the same path and is forgotten when another file opens.
 * The project's own settings (its `.editorconfig`, Pro) are asked for with the file's text — both reads at once — so
 * the file opens with them; when the project's settings change (the `files.changed` event names an `.editorconfig`)
 * the open file is resolved again. The profile in force is the project's own, if it names one, else the active one;
 * the indicator's popup chooses the project's own where profiles exist. In the free edition the popup says that a
 * project's `.editorconfig` is part of Pro only for a project that has one in its root, as the Files tree listed it —
 * nothing is read for that (D40).
 */
import { errorLine } from './errors';
import { TEXT, formatSize, formatTime, printable } from './text';
import { useEditorFrame } from './useEditorFrame';
import { IndentIndicator } from '../editor/IndentIndicator';
import { useEditorIndent } from '../editor/useEditorIndent';
import { routeHash } from '../route';
import { hintOf, useOffer } from '../shell/sectionKeys';
import { labelOf, languageOfFile } from '@src/compare/languages';
import { DEFAULT_PROFILE, DEFAULT_PROFILE_NAME, chooseForProject, nameOf } from '@src/editorSettings/profiles';
import { decidingFiles } from '@src/editorSettings/project';
import { createAutosave } from '@src/projects/autosave';
import { toLineHunks } from '@src/projects/hunks';
import { isCompanionError } from '@src/projects/types';
import { VIEWER_PAGE } from '@src/shared/pages';
import { sameChord } from '@src/shared/viewerProtocol';
import { Button } from '@workspace/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { HistoryIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SectionKeys } from '../shell/sectionKeys';
import type { EditorView, Workspace } from './useWorkspace';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { ProjectEditorSettings, ProjectFiles, ProjectSettings } from '@src/editorSettings/project';
import type { Autosave, SaveState } from '@src/projects/autosave';
import type { ProjectSaverFactory } from '@src/projects/projectSaver';
import type { FrameKeys, KeyChord } from '@src/shared/keys';
import type { ReactElement } from 'react';

const SAVE_KEY: KeyChord = { key: 's', mod: true, shift: false };

type Content =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'card'; text: string }
  | { kind: 'file'; readOnly: string | null; runsCode: boolean }
  | { kind: 'diff'; title: string }
  | { kind: 'compare' };

export interface EditorPaneProps {
  workspace: Workspace;
  frameKeys?: FrameKeys;
  /** The user's shortcuts as the section gets them; absent: no keys. */
  keys?: SectionKeys;
  autosaveDelayMs?: number;
  /** Asks for the open file's history (the panel holding it opens); without it the editor offers none. */
  onShowHistory?: () => void;
  /** The editor's settings (D39); absent: the editor keeps its own defaults and there is no indicator. */
  editorSettings?: EditorSettingsBehaviors;
  /** How the open file is saved (seam `SideSaver`, the composition root's `projectSaver`). */
  fileSaver: ProjectSaverFactory;
}

const saveText = (state: SaveState): string => {
  switch (state.kind) {
    case 'saved':
      return TEXT.savedState;
    case 'pending':
      return TEXT.pendingState;
    case 'saving':
      return TEXT.savingState;
    case 'conflict':
      return TEXT.conflictState;
    case 'offline':
      return TEXT.offlineState;
    case 'refused':
      // Why — a sentence — goes under the bar (`kit-projects-refused`): the bar keeps the short state.
      return TEXT.refusedShort;
  }
};

const languageOf = (path: string): string => languageOfFile(path.slice(path.lastIndexOf('/') + 1)) ?? 'text';

const viewKey = (view: EditorView): string =>
  view.kind === 'point'
    ? `point:${view.point}`
    : view.kind === 'points'
      ? `points:${view.a.point}:${view.b.point}`
      : view.kind;

export const EditorPane = ({
  workspace,
  frameKeys,
  keys,
  autosaveDelayMs,
  onShowHistory,
  editorSettings,
  fileSaver,
}: EditorPaneProps): ReactElement => {
  const { backend, project, path, view, reveal, changed } = workspace;
  const [content, setContent] = useState<Content>({ kind: 'none' });
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved' });
  const [note, setNote] = useState<string | null>(null);
  const autosave = useRef<Autosave | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  // What the diff's right side holds: the file as it is on disk (switching back to the file keeps the text).
  const diskInDiff = useRef<string | null>(null);
  const pendingReveal = useRef(reveal);
  const loading = useRef(false);
  const session = useRef('');
  const frameKeysRef = useRef(frameKeys);
  frameKeysRef.current = frameKeys;

  const handedUp = useMemo(() => [SAVE_KEY, ...(frameKeys?.keys ?? [])], [frameKeys?.keys]);
  const editor = useEditorFrame(handedUp, {
    onKey: chord => {
      if (sameChord(chord, SAVE_KEY)) void autosave.current?.flush('explicit');
      else frameKeysRef.current?.run(chord);
    },
    onShown: shown => {
      if (shown.cause === 'edit' && contentRef.current.kind === 'file') autosave.current?.edited();
    },
    onError: message => workspace.setError(message),
  });
  const { request, post, read } = editor;
  const indent = useEditorIndent(editorSettings, post, 'text', project.id);
  const indentRef = useRef(indent);
  indentRef.current = indent;
  const { profiles } = indent;

  // The project's own settings (seam ProjectEditorSettings, the edition's): one for the open project, made in an effect
  // (and let go in its cleanup), read through the backend's `file.read` and told of `files.changed`.
  const projectFiles = useMemo<ProjectFiles>(
    () => ({
      read: settingsPath =>
        backend.call('file.read', { project: project.id, path: settingsPath }).then(
          file => ({ text: file.text, size: file.size }),
          (error: unknown) => {
            if (isCompanionError(error, 'not-found')) return null;
            // Larger than the API reads at all: over every limit of ours too.
            if (isCompanionError(error, 'too-large')) return { text: '', size: Number.MAX_SAFE_INTEGER };
            throw error;
          },
        ),
      onChanged: listener =>
        backend.subscribe(project.id, event => {
          if (event.name === 'files.changed') listener(event.data.more ? 'all' : event.data.paths);
          else if (event.name === 'server.restarted') listener('all');
        }),
    }),
    [backend, project.id],
  );
  const projectFactory = editorSettings?.projectSettings;
  const projectSettings = useRef<ProjectEditorSettings | null>(null);
  const [projectGeneration, setProjectGeneration] = useState(0);
  useEffect(() => {
    const made = projectFactory?.(projectFiles) ?? null;
    projectSettings.current = made;
    setProjectGeneration(g => g + 1);
    const undo = made?.onChange(() => setProjectGeneration(g => g + 1));
    return () => {
      undo?.();
      made?.dispose();
      if (projectSettings.current === made) projectSettings.current = null;
    };
  }, [projectFactory, projectFiles]);
  /** What the project says about a file; null without project settings. Never rejects. */
  const projectFor = useCallback(
    (target: string): Promise<ProjectSettings | null> =>
      projectSettings.current ? projectSettings.current.forFile(target) : Promise.resolve(null),
    [],
  );

  // The path the indentation was last opened for: the same file in another view keeps the person's choice.
  const indentPath = useRef<string | null>(null);
  /**
   * What a text opened for `target` carries: detected, resolved; the choice kept for the same path. `settings`: what the
   * project says about it (absent: the same file again, what it said before).
   */
  const openIndent = useCallback(
    (texts: { old?: string; new: string }, target: string, settings?: ProjectSettings | null) => {
      const keep = indentPath.current === target;
      indentPath.current = target;
      const project = settings === undefined ? (keep ? indentRef.current.project : null) : settings;
      return indentRef.current.open(texts, languageOf(target), keep, project);
    },
    [],
  );
  // The project's settings changed, or its source did (another edition): the open file is resolved again.
  useEffect(() => {
    if (!projectGeneration || !path) return;
    let live = true;
    void projectFor(path).then(settings => {
      if (live && indentPath.current === path) indentRef.current.setProject(settings);
    });
    return () => {
      live = false;
    };
    // `path` is followed through the opening itself; this answers the project's changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectGeneration, projectFor]);
  const [indentOpen, setIndentOpen] = useState(false);

  const postReveal = useCallback(() => {
    const wanted = pendingReveal.current;
    pendingReveal.current = null;
    if (wanted?.hunk !== undefined) post({ type: 'viewer/reveal-hunk', index: wanted.hunk });
    else if (wanted?.line !== undefined)
      post({
        type: 'viewer/reveal-line',
        line: wanted.line,
        ...(wanted.column !== undefined && { column: wanted.column }),
      });
  }, [post]);

  useEffect(() => {
    pendingReveal.current = reveal;
    if (!loading.current) postReveal();
  }, [reveal, postReveal]);

  /** Leaves the file: what waits is written now. */
  const leave = useCallback(async () => {
    const current = autosave.current;
    autosave.current = null;
    if (!current) return;
    await current.flush('auto');
    current.dispose();
  }, []);

  const showFile = useCallback(
    async (target: string, ticket: () => boolean) => {
      const [file, settings] = await Promise.all([
        backend.call('file.read', { project: project.id, path: target }),
        projectFor(target),
      ]);
      if (!ticket()) return;
      const readOnly =
        project.class !== 'mine'
          ? TEXT.readOnlyView
          : file.secret
            ? TEXT.readOnlySecret
            : !workspace.can('file.save')
              ? TEXT.notOffered
              : null;
      const language = languageOf(target);
      if (diskInDiff.current === file.text && contentRef.current.kind === 'diff') {
        // The diff already holds the file on its right side: the editor shows it alone, with no new text.
        request(id => ({ type: 'viewer/set-mode', id, mode: 'file' }));
        post({ type: 'viewer/set-editable', side: 'old', editable: false, focus: false });
        post({ type: 'viewer/set-editable', side: 'new', editable: readOnly === null, focus: false });
        indentRef.current.setProject(settings);
      } else {
        const editorSettings = openIndent({ new: file.text }, target, settings)?.new;
        request(id => ({
          type: 'viewer/show-file',
          id,
          request: {
            path: target,
            language,
            text: file.text,
            readOnly: readOnly !== null,
            ...(editorSettings && { editor: editorSettings }),
          },
        }));
      }
      diskInDiff.current = null;
      setContent({ kind: 'file', readOnly, runsCode: !!file.protected });
      setSaveState({ kind: 'saved' });
      if (readOnly !== null) return;
      session.current = `${target}:${Date.now().toString(36)}`;
      const saver = fileSaver(backend, project.id, target, file.hash, { session: session.current });
      autosave.current = createAutosave({
        delayMs: autosaveDelayMs,
        baseHash: file.hash,
        savedText: file.text,
        read: () => read('new'),
        save: (text, baseHash, reason) => saver.write(text, baseHash, reason),
        onSaved: (text, _hash, marked) => {
          request(id => ({ type: 'viewer/mark-saved', id, side: 'new', text }));
          // The companion names what marks a file as running code on each write (a hooks folder too, which a read
          // does not): the mark stays once it was given.
          if (marked) setContent(c => (c.kind === 'file' && !c.runsCode ? { ...c, runsCode: true } : c));
          workspace.refresh();
        },
        onState: setSaveState,
      });
    },
    // `workspace.refresh` is stable; the rest is what a file is opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autosaveDelayMs, backend, fileSaver, openIndent, post, project.class, project.id, projectFor, read, request],
  );

  const load = useCallback(
    async (target: string | undefined, wanted: EditorView, ticket: () => boolean) => {
      await leave();
      if (!ticket()) return;
      setNote(null);
      if (!target) return setContent({ kind: 'none' });
      loading.current = true;
      setContent(c => (c.kind === 'none' || c.kind === 'card' ? { kind: 'loading' } : c));
      const language = languageOf(target);
      try {
        if (wanted.kind === 'file') await showFile(target, ticket);
        else if (wanted.kind === 'points') {
          const [[a, b], settings] = await Promise.all([
            Promise.all(
              [wanted.a, wanted.b].map(p => backend.call('history.content', { project: project.id, point: p.point })),
            ),
            projectFor(target),
          ]);
          if (!ticket()) return;
          const editorSettings = openIndent({ old: a!.text, new: b!.text }, target, settings);
          request(id => ({
            type: 'viewer/compare',
            id,
            request: {
              path: target,
              language,
              oldText: a!.text,
              newText: b!.text,
              ...(editorSettings && { editor: editorSettings }),
            },
          }));
          setContent({
            kind: 'diff',
            title: TEXT.comparing(
              `${wanted.a.label} ${formatTime(wanted.a.timeMs)}`,
              `${wanted.b.label} ${formatTime(wanted.b.timeMs)}`,
            ),
          });
        } else {
          const base = wanted.kind === 'diff' ? ('HEAD' as const) : { point: wanted.point };
          const [sides, settings] = await Promise.all([
            backend.call('diff.sides', { project: project.id, path: target, base }),
            projectFor(target),
          ]);
          if (!ticket()) return;
          if (sides.flags.binary) {
            setContent({ kind: 'card', text: TEXT.binary('') });
            return;
          }
          const oldText = sides.old.text ?? '';
          const newText = sides.new.text ?? '';
          diskInDiff.current = sides.new.exists ? newText : null;
          const editorSettings = openIndent({ old: oldText, new: newText }, target, settings);
          request(id => ({
            type: 'viewer/show-diff',
            id,
            payload: {
              path: target,
              language,
              oldText,
              newText,
              hunks: toLineHunks(oldText, sides.hunks),
              ...(editorSettings && { editor: editorSettings }),
            },
          }));
          setContent({
            kind: 'diff',
            title: TEXT.comparing(wanted.kind === 'diff' ? TEXT.head : wanted.label, TEXT.current),
          });
        }
        postReveal();
      } catch (error) {
        if (!ticket()) return;
        const data = isCompanionError(error) ? error.data : undefined;
        const size = typeof data?.size === 'number' ? formatSize(data.size) : '';
        setContent({
          kind: 'card',
          text: isCompanionError(error, 'binary')
            ? TEXT.binary(size)
            : isCompanionError(error, 'too-large')
              ? TEXT.tooLarge(size)
              : isCompanionError(error, 'outside-project')
                ? TEXT.outsideLink
                : errorLine(error, 'read'),
        });
      } finally {
        loading.current = false;
      }
    },
    [backend, leave, openIndent, postReveal, project.id, projectFor, request, showFile],
  );

  const key = viewKey(view);
  useEffect(() => {
    let live = true;
    void load(path, view, () => live);
    return () => {
      live = false;
    };
    // `view` is followed by its key: a new object for the same view does not load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, path, key]);

  // The open file changed on disk: ours (the hash we wrote) is nothing; another's is taken by itself when nothing waits
  // to be saved, and meets a conflict otherwise.
  useEffect(() => {
    if (!changed.n || !path || !changed.paths.includes(path) || contentRef.current.kind !== 'file') return;
    let live = true;
    backend.call('file.read', { project: project.id, path }).then(
      async file => {
        const current = autosave.current;
        if (!live || !current || file.hash === current.baseHash) return;
        // What the editor holds now, asked of it: a keystroke whose edit has not reached the page yet still counts as
        // an unsaved edit, so it meets the conflict instead of being replaced by the disk's text.
        const mine = await read('new').catch(() => null);
        if (!live || autosave.current !== current) return;
        const unsaved = mine === null ? editor.shown?.sides.new.modified === true : mine !== current.savedText;
        if (current.state.kind === 'saved' && !unsaved) {
          const editorSettings = openIndent({ new: file.text }, path)?.new;
          request(id => ({
            type: 'viewer/show-file',
            id,
            request: {
              path,
              language: languageOf(path),
              text: file.text,
              readOnly: false,
              ...(editorSettings && { editor: editorSettings }),
            },
          }));
          current.takeDisk(file.text, file.hash);
          setNote(TEXT.updatedFromDisk);
        } else {
          current.edited();
          void current.flush('auto');
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed.n]);

  // Leaving the page, hiding the tab or the window losing focus writes at once (§8.6а); so does leaving the section.
  useEffect(() => {
    const now = (): void => void autosave.current?.flush('auto');
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') now();
    };
    window.addEventListener('pagehide', now);
    window.addEventListener('blur', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now);
      window.removeEventListener('blur', now);
      document.removeEventListener('visibilitychange', hidden);
      void leave();
    };
  }, [leave]);

  // ---- the conflict's choices (Р23) ------------------------------------------------------------------------------
  // The open file's mark «runs code», kept while the conflict's choices show other views.
  const runsCode = useRef(false);
  if (content.kind === 'file') runsCode.current = content.runsCode;
  const keepMine = async (): Promise<void> => {
    const back = contentRef.current.kind === 'compare';
    const mine = back ? await read('new') : null;
    await autosave.current?.keepMine();
    if (back && path && mine !== null) {
      const editorSettings = openIndent({ new: mine }, path)?.new;
      request(id => ({
        type: 'viewer/show-file',
        id,
        request: {
          path,
          language: languageOf(path),
          text: mine,
          readOnly: false,
          ...(editorSettings && { editor: editorSettings }),
        },
      }));
      setContent({ kind: 'file', readOnly: null, runsCode: runsCode.current });
    }
  };
  const applyExternal = async (): Promise<void> => {
    if (!path) return;
    const file = await backend.call('file.read', { project: project.id, path });
    const editorSettings = openIndent({ new: file.text }, path)?.new;
    request(id => ({
      type: 'viewer/show-file',
      id,
      request: {
        path,
        language: languageOf(path),
        text: file.text,
        readOnly: false,
        ...(editorSettings && { editor: editorSettings }),
      },
    }));
    autosave.current?.takeDisk(file.text, file.hash);
    setContent({ kind: 'file', readOnly: null, runsCode: runsCode.current || !!file.protected });
  };
  const showComparison = async (): Promise<void> => {
    if (!path) return;
    const [mine, file] = await Promise.all([read('new'), backend.call('file.read', { project: project.id, path })]);
    const editorSettings = openIndent({ old: file.text, new: mine }, path);
    request(id => ({
      type: 'viewer/compare',
      id,
      request: {
        path,
        language: languageOf(path),
        oldText: file.text,
        newText: mine,
        ...(editorSettings && { editor: editorSettings }),
      },
    }));
    // «Mine» stays editable: single changes can be carried over by hand before keeping it.
    post({ type: 'viewer/set-editable', side: 'new', editable: true, focus: false });
    setContent({ kind: 'compare' });
  };

  // In the free edition the popup names Pro's project settings only for a project that has them: an `.editorconfig` in
  // its root as the Files tree listed it (nothing is read for this, D40).
  const hasEditorConfig = workspace.root?.some(e => e.name === '.editorconfig' && e.kind === 'file') ?? false;

  const fileOrDiff =
    content.kind === 'file' || (content.kind === 'diff' && (view.kind === 'diff' || view.kind === 'file'));
  const conflict = saveState.kind === 'conflict';

  // The hunk the keys brought into view last; a new comparison starts before the first.
  const hunk = useRef(-1);
  const changes = (content.kind === 'diff' || content.kind === 'compare') && editor.shown ? editor.shown.changes : 0;
  const shownCount = editor.shownCount;
  useEffect(() => {
    hunk.current = -1;
  }, [path, key, shownCount]);
  const step = (by: 1 | -1) => (): void => {
    if (!changes) return;
    hunk.current = hunk.current < 0 && by < 0 ? changes - 1 : (hunk.current + by + changes) % changes;
    post({ type: 'viewer/reveal-hunk', index: hunk.current });
  };
  const switchable = !!path && fileOrDiff;
  const indicated =
    indent.enabled && !!path && (content.kind === 'file' || content.kind === 'diff' || content.kind === 'compare');
  useOffer(keys, {
    'editor:indentation': indicated && (() => setIndentOpen(true)),
    'projects:next-change': changes > 0 && step(1),
    'projects:previous-change': changes > 0 && step(-1),
    'projects:view': switchable && (() => workspace.setView({ kind: view.kind === 'diff' ? 'file' : 'diff' })),
  });

  return (
    <section className="kit-projects-editor" aria-label={TEXT.editorTitle}>
      <div className="kit-projects-editor-bar">
        <span className="kit-projects-editor-path">{printable(path ?? '')}</span>
        {content.kind === 'diff' && <span className="kit-projects-editor-title">{content.title}</span>}
        {content.kind === 'compare' && (
          <span className="kit-projects-editor-title">{TEXT.comparing(TEXT.onDisk, TEXT.mine)}</span>
        )}
        {content.kind === 'file' && content.readOnly && <span className="kit-projects-note">{content.readOnly}</span>}
        {content.kind === 'file' && content.runsCode && (
          <span className="kit-projects-mark" data-mark="runs-code" title={TEXT.runsCode}>
            {TEXT.markRunsCode}
          </span>
        )}
        {note && <span className="kit-projects-note">{note}</span>}
        <span className="kit-projects-editor-tools">
          {indicated && path && (
            <IndentIndicator
              effective={indent.effective.new}
              choice={indent.choice.new}
              languageLabel={labelOf(languageOf(path))}
              onChoose={choice => indent.choose('both', choice)}
              open={indentOpen}
              onOpenChange={setIndentOpen}
              settingsHref={routeHash({ section: 'settings' })}
              {...(indent.profile.id !== DEFAULT_PROFILE && { profileName: indent.profile.name })}
              {...(projectFactory &&
                (projectFactory.included || hasEditorConfig) && {
                  project: {
                    included: projectFactory.included,
                    deciding: decidingFiles(indent.project, indent.effective.new),
                    problem: indent.project?.problem ?? null,
                  },
                })}
              {...(profiles.included &&
                editorSettings?.profiles && {
                  projectProfile: {
                    profiles: [
                      { id: DEFAULT_PROFILE, name: DEFAULT_PROFILE_NAME },
                      ...profiles.profiles.profiles.map(p => ({ id: p.id, name: p.name })),
                    ],
                    chosen: profiles.profiles.projects[project.id] ?? null,
                    activeName: nameOf(profiles.profiles, profiles.profiles.active),
                    onChoose: id => {
                      const store = editorSettings.profiles!;
                      void store.load().then(record => store.save(chooseForProject(record, project.id, id)));
                    },
                  },
                })}
            />
          )}
          {content.kind === 'file' && !content.readOnly && (
            <span className="kit-projects-save" data-state={saveState.kind} role="status">
              {saveText(saveState)}
            </span>
          )}
          {switchable && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view.kind === 'diff' ? 'diff' : 'file'}
              aria-label={TEXT.editorTitle}
              {...hintOf(keys, 'projects:view', TEXT.switchView)}
              onValueChange={value => {
                if (value === 'file' || value === 'diff') workspace.setView({ kind: value });
              }}>
              <ToggleGroupItem value="file">{TEXT.modeFile}</ToggleGroupItem>
              <ToggleGroupItem value="diff">{TEXT.modeDiff}</ToggleGroupItem>
            </ToggleGroup>
          )}
          {content.kind === 'diff' && view.kind !== 'diff' && (
            <Button variant="ghost" size="sm" onClick={() => workspace.setView({ kind: 'file' })}>
              {TEXT.backToFile}
            </Button>
          )}
          {path && onShowHistory && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={TEXT.showHistory}
              title={TEXT.showHistory}
              onClick={onShowHistory}>
              <HistoryIcon aria-hidden="true" />
            </Button>
          )}
        </span>
      </div>
      {saveState.kind === 'refused' && content.kind === 'file' && (
        <p className="kit-projects-refused" role="alert" data-refused="">
          {TEXT.refusedState(errorLine(saveState.error, 'save'))}
        </p>
      )}
      {(conflict || content.kind === 'compare') && (
        <div className="kit-projects-conflict" role="alert">
          <span>{TEXT.conflictNotice}</span>
          <Button size="sm" onClick={() => void keepMine()}>
            {TEXT.keepMine}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void applyExternal()}>
            {TEXT.applyExternal}
          </Button>
          {content.kind !== 'compare' && (
            <Button size="sm" variant="ghost" onClick={() => void showComparison()}>
              {TEXT.showComparison}
            </Button>
          )}
        </div>
      )}
      <div className="kit-projects-editor-view">
        <iframe
          ref={editor.frame}
          className="kit-projects-frame"
          src={`/${VIEWER_PAGE}`}
          title={TEXT.editorTitle}
          data-ready={editor.ready ? '' : undefined}
          data-shown={editor.shownCount}
          data-mode={editor.shown?.mode}
          data-changes={editor.shown?.changes}
          data-modified={editor.shown?.sides.new.modified ? '' : undefined}
        />
        {(content.kind === 'none' || content.kind === 'card' || editor.failed) && (
          <div className="kit-projects-card">
            <p>{editor.failed ?? (content.kind === 'card' ? content.text : TEXT.noFile)}</p>
          </div>
        )}
      </div>
    </section>
  );
};
