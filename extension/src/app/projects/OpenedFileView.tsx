/**
 * A file opened from the system (D42), open: the same editor mode as a scratch (./ScratchView.tsx) — the editor module
 * in its iframe, one file, the bar above it, the section's autosave — over the seam `OpenedFiles` instead of the
 * scratch store. No tree, no git, no folder settings and no `.editorconfig`: the file's indentation is detected from
 * its text and the editor's settings, as a scratch's is. The caret goes where the claim said (`--line N[:M]`).
 *
 * Editing follows the edition and the companion: where the edition edits these files (`openFiles: 'edit'`, Pro) and the
 * companion's mode for the file is `edit`, the text saves itself through the root's saver (`openedFileSaver`: from the
 * version it started from; a file that changed on disk meanwhile meets the conflict and its three choices, as a project's
 * file does). Where the edition shows them read only (free) the bar says so in one quiet line and offers «Copy to a
 * scratch» — the scratch is editable and downloadable (D40). A file the companion keeps read only says why in one
 * sentence (its `reason`); one that runs on its own (`executes`) is marked and written like any other. A save the
 * companion refuses because the file can only be read now (`not-editable`: replaced, moved, became a link, read only on
 * disk, …) turns the editor read only until the person opens the file again; the edit stays in the editor and «Copy to
 * a scratch» keeps it — nothing destructive is offered. Waits between saves (`rate-limited`) are the autosave's.
 *
 * The companion's own copies of this file (`openFile.history`, `openFile.historyContent`) are its History, below the
 * editor as a project's is — the bottom panel with one view, opened by the editor bar's history button as for a
 * project's file (./OpenedFileHistory.tsx, built from the History panel's parts). A copy compared with the current file,
 * or two copies, show in this editor (read only, «Back to the file»; what the editor held is written first); restoring
 * (`openFile.restore`) asks with the comparison shown and is active only where the page writes the file — elsewhere it
 * is inactive with the same quiet reason as writing. A restore and its undo show the file again from disk.
 *
 * The strip of the editor's buttons (../editor/EditorStrip.tsx) stands over the editor: the editor's own commands, its
 * two view toggles (a choice for this file over the saved settings), and at its head the file's Save — the very action
 * of ⌘S — greyed with the reason when the file is read only (the line the page says above it) or nothing new waits.
 */
import { errorLine } from './errors';
import { ForgetFileDialog } from './ForgetFileDialog';
import { pointName } from './historyParts';
import { OpenedFileHistory, historyRefusal } from './OpenedFileHistory';
import { Splitter } from './Splitter';
import { TEXT, printable, scratchRefusal } from './text';
import { useEditorFrame } from './useEditorFrame';
import { EditorStrip } from '../editor/EditorStrip';
import { IndentIndicator } from '../editor/IndentIndicator';
import { runStripCommand, viewChoice } from '../editor/strip';
import { EDITOR_TEXT } from '../editor/text';
import { useEditorIndent } from '../editor/useEditorIndent';
import { go, routeHash } from '../route';
import { useOffer } from '../shell/sectionKeys';
import { labelOf, languageOfFile } from '@src/compare/languages';
import { DEFAULT_PROFILE } from '@src/editorSettings/profiles';
import { createAutosave } from '@src/projects/autosave';
import { BOTTOM_HEIGHT, BOTTOM_MIN, bottomMax, clamp } from '@src/projects/layout';
import { isCompanionError } from '@src/projects/types';
import { VIEWER_PAGE } from '@src/shared/pages';
import { isMac, sameChord } from '@src/shared/viewerProtocol';
import { Button } from '@workspace/ui/button';
import { Toggle } from '@workspace/ui/toggle';
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, HistoryIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SectionKeys } from '../shell/sectionKeys';
import type { OpenedFileComparison } from './OpenedFileHistory';
import type { Clipboard } from '@src/compare/clipboard';
import type { OpenFilesEdition } from '@src/edition/edition';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { Autosave, SaveState } from '@src/projects/autosave';
import type { OpenedAt, OpenedFile, OpenedFiles } from '@src/projects/openFiles/files';
import type { OpenedFileSaverFactory } from '@src/projects/openFiles/saver';
import type { ScratchStore } from '@src/projects/scratch/store';
import type { FrameKeys, KeyChord } from '@src/shared/keys';
import type { ReactElement } from 'react';

const SAVE_KEY: KeyChord = { key: 's', mod: true, shift: false };

export interface OpenedFileViewProps {
  files: OpenedFiles;
  id: string;
  /** What the page knows of the file (its claim, the list); undefined: not known (yet). */
  file: OpenedFile | undefined;
  /** Whether the list has been read: a file it does not hold then is not there any more. */
  listed: boolean;
  /** The companion is connected and offers files: the text can be read. */
  offered: boolean;
  /** Where the caret goes once the text is in (taken once). */
  takeAt(id: string): OpenedAt | null;
  edition: OpenFilesEdition;
  saver: OpenedFileSaverFactory;
  /** Where «Copy to a scratch» puts the text; absent (no scratches in this edition): no such button. */
  scratchStore?: ScratchStore;
  onForget?(id: string): Promise<void>;
  canForget: boolean;
  frameKeys?: FrameKeys;
  keys?: SectionKeys;
  autosaveDelayMs?: number;
  editorSettings?: EditorSettingsBehaviors;
  /** The editor strip's clipboard (seam `Clipboard`); absent: no strip. */
  clipboard?: Clipboard;
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed'; text: string }
  | { kind: 'open'; editable: boolean; runsCode: boolean };

/** What the editor shows: the file, or a comparison asked for from its history. */
type FileView = { kind: 'file' } | OpenedFileComparison;

/** A comparison shown in the editor: its title, whether a text of it is a secret's, or why it could not be shown. */
interface Compared {
  title: string;
  secret: boolean;
  card: string | null;
}

const viewKey = (view: FileView): string =>
  view.kind === 'point'
    ? `point:${view.point.point}`
    : view.kind === 'points'
      ? `points:${view.a.point}:${view.b.point}`
      : 'file';

const titleOf = (view: OpenedFileComparison): string =>
  view.kind === 'point'
    ? TEXT.comparing(pointName(view.point), TEXT.current)
    : TEXT.comparing(pointName(view.a), pointName(view.b));

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
      return TEXT.refusedShort;
  }
};

const readOnlyLine = (reason: string | null): string =>
  (reason !== null && TEXT.openFiles.readOnly[reason]) || TEXT.openFiles.readOnlyOther;

export const OpenedFileView = ({
  files,
  id,
  file,
  listed,
  offered,
  takeAt,
  edition,
  saver: makeSaver,
  scratchStore,
  onForget,
  canForget,
  frameKeys,
  keys,
  autosaveDelayMs,
  editorSettings,
  clipboard,
}: OpenedFileViewProps): ReactElement => {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved' });
  const [comparing, setComparing] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'success' | 'info' } | null>(null);
  const mac = useMemo(() => isMac(), []);
  // The companion refused a save because the file can only be read now: why (its `reason`), until opened again.
  const [locked, setLocked] = useState<string | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [asking, setAsking] = useState(false);
  // The history: what the editor shows, the file shown again after a restore, the feed read again after a write.
  const [view, setView] = useState<FileView>({ kind: 'file' });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [compared, setCompared] = useState<Compared | null>(null);
  const [reload, setReload] = useState(0);
  const [written, setWritten] = useState(0);
  // The bottom panel with the history: shown, mounted once shown (kept while hidden), its height.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySeen, setHistorySeen] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_HEIGHT);
  const [columnHeight, setColumnHeight] = useState(0);
  const column = useRef<HTMLDivElement>(null);
  // The last leave of the editor (its edit being written): what is read next waits for it.
  const leaving = useRef<Promise<void>>(Promise.resolve());
  const autosave = useRef<Autosave | null>(null);
  const frameKeysRef = useRef(frameKeys);
  frameKeysRef.current = frameKeys;
  const language = file ? (languageOfFile(file.name) ?? 'text') : 'text';
  const editable = !!file && edition === 'edit' && file.mode === 'edit' && files.can('save');

  const handedUp = useMemo(() => [SAVE_KEY, ...(frameKeys?.keys ?? [])], [frameKeys?.keys]);
  // ⌘S and the strip's Save: one action.
  const saveNow = useCallback(() => void autosave.current?.flush('explicit'), []);
  const editor = useEditorFrame(handedUp, {
    onKey: chord => {
      if (sameChord(chord, SAVE_KEY)) saveNow();
      else frameKeysRef.current?.run(chord);
    },
    onShown: shown => {
      if (shown.cause === 'edit') autosave.current?.edited();
    },
    onError: message => setNote({ text: TEXT.failed(message), tone: 'error' }),
  });
  const { request, post, read } = editor;
  const indent = useEditorIndent(editorSettings, post);
  const indentRef = useRef(indent);
  indentRef.current = indent;
  const [indentOpen, setIndentOpen] = useState(false);

  const show = useCallback(
    (text: string, readOnly: boolean) => {
      const settings = indentRef.current.open({ new: text }, language)?.new;
      request(n => ({
        type: 'viewer/show-file',
        id: n,
        request: { path: '', language, text, readOnly, ...(settings && { editor: settings }) },
      }));
    },
    [language, request],
  );

  const leave = useCallback(async () => {
    const current = autosave.current;
    autosave.current = null;
    if (!current) return;
    await current.flush('auto');
    current.dispose();
  }, []);

  const known = !!file;
  const key = viewKey(view);
  useEffect(() => {
    if (!offered) return;
    if (!known) {
      if (listed) setLoaded({ kind: 'missing' });
      return;
    }
    let live = true;
    const wanted = viewRef.current;
    const openFile = (): void => {
      setCompared(null);
      // A file the companion refused to write (`locked`) stays read only when it is shown again.
      const writes = editable && lockedRef.current === null;
      files.read(id).then(
        text => {
          if (!live) return;
          setLoaded({ kind: 'open', editable: writes, runsCode: text.protected || file?.executes === true });
          setSaveState({ kind: 'saved' });
          show(text.text, !writes);
          const at = takeAt(id);
          if (at)
            post({ type: 'viewer/reveal-line', line: at.line, ...(at.column !== undefined && { column: at.column }) });
          if (!writes) return;
          const saver = makeSaver(files, id, file!.name, text.hash);
          autosave.current = createAutosave({
            delayMs: autosaveDelayMs,
            baseHash: text.hash,
            savedText: text.text,
            read: () => read('new'),
            save: (written, baseHash) => saver.write(written, baseHash),
            onSaved: written => {
              request(n => ({ type: 'viewer/mark-saved', id: n, side: 'new', text: written }));
              // The companion kept a copy of what the save replaced: the history reads again.
              setWritten(n => n + 1);
            },
            onState: state => {
              setSaveState(state);
              if (state.kind !== 'refused' || !isCompanionError(state.error, 'not-editable')) return;
              // Read only from now on: nothing more is sent; the edit stays where the person can copy it.
              const reason = state.error.data?.reason;
              setLocked(typeof reason === 'string' ? reason : '');
              post({ type: 'viewer/set-editable', side: 'new', editable: false, focus: false });
              const current = autosave.current;
              autosave.current = null;
              current?.dispose();
            },
          });
        },
        (error: unknown) => live && setLoaded({ kind: 'failed', text: errorLine(error, 'read') }),
      );
    };
    // A comparison from the history: the copy (or the older copy) on the left, read only; nothing saves meanwhile.
    const openComparison = async (comparison: OpenedFileComparison): Promise<void> => {
      const title = titleOf(comparison);
      setComparing(false);
      try {
        const [older, newer] =
          comparison.kind === 'point'
            ? await Promise.all([files.historyContent(id, comparison.point.point), files.read(id)])
            : await Promise.all([
                files.historyContent(id, comparison.a.point),
                files.historyContent(id, comparison.b.point),
              ]);
        if (!live) return;
        const settings = indentRef.current.open({ old: older.text, new: newer.text }, language);
        request(n => ({
          type: 'viewer/compare',
          id: n,
          request: {
            path: '',
            language,
            oldText: older.text,
            newText: newer.text,
            ...(settings && { editor: settings }),
          },
        }));
        setCompared({ title, secret: older.secret || newer.secret, card: null });
      } catch (error) {
        const said = await historyRefusal(files, id, error, 'read');
        if (live) setCompared({ title, secret: false, card: said.text });
      }
    };
    // What the editor held is written before anything is read.
    void leaving.current.then(() => {
      if (!live) return;
      if (wanted.kind === 'file') openFile();
      else void openComparison(wanted);
    });
    return () => {
      live = false;
      leaving.current = leave().catch(() => undefined);
    };
    // Opened once per file, edition, connection and view (and again after a restore); `file` itself only names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, files, offered, known, listed, editable, key, reload]);

  // Leaving the page, hiding the tab or the window losing focus writes at once, as for a project's file.
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
    };
  }, []);

  // ---- the conflict's choices, as for a project's file (Р23) ------------------------------------------------------
  const keepMine = async (): Promise<void> => {
    const mine = comparing ? await read('new') : null;
    await autosave.current?.keepMine();
    if (mine !== null) {
      show(mine, false);
      setComparing(false);
    }
  };
  const applyExternal = async (): Promise<void> => {
    const text = await files.read(id);
    show(text.text, false);
    autosave.current?.takeDisk(text.text, text.hash);
    setComparing(false);
  };
  const showComparison = async (): Promise<void> => {
    const [mine, text] = await Promise.all([read('new'), files.read(id)]);
    const settings = indentRef.current.open({ old: text.text, new: mine }, language);
    request(n => ({
      type: 'viewer/compare',
      id: n,
      request: { path: '', language, oldText: text.text, newText: mine, ...(settings && { editor: settings }) },
    }));
    post({ type: 'viewer/set-editable', side: 'new', editable: true, focus: false });
    setComparing(true);
  };

  const copyToScratch = async (): Promise<void> => {
    if (!scratchStore || !file) return;
    setNote(null);
    const text = await read('new').catch(() => null);
    if (text === null) return;
    const made = await scratchStore.create(language);
    if (!made.ok) return setNote({ text: scratchRefusal(made.refused), tone: 'error' });
    const written = await scratchStore.write(made.value.id, text);
    if (!written.ok) {
      await scratchStore.remove(made.value.id);
      return setNote({ text: scratchRefusal(written.refused), tone: 'error' });
    }
    await scratchStore.rename(made.value.id, file.name);
    go(routeHash({ section: 'projects', scratch: made.value.id }));
  };

  const forget = async (): Promise<void> => {
    setAsking(false);
    if (!onForget) return;
    autosave.current?.dispose();
    autosave.current = null;
    try {
      await onForget(id);
      go(routeHash({ section: 'projects' }));
    } catch (error) {
      setNote({ text: errorLine(error, 'remove'), tone: 'error' });
    }
  };

  // ---- the history (./OpenedFileHistory.tsx) ---------------------------------------------------------------------
  // Offered where the companion lists the copies and gives their text: without the text there is nothing to compare.
  const history = !!file && files.can('history') && files.can('historyContent');
  const showHistory = (shown: boolean): void => {
    setHistoryOpen(shown);
    if (shown) setHistorySeen(true);
  };
  // What the editor holds is written, and the last leave of the editor done: the disk's version is the one read next.
  const settle = useCallback(async (): Promise<void> => {
    await autosave.current?.flush('auto');
    await leaving.current;
  }, []);
  const rewritten = useCallback((): void => {
    setView({ kind: 'file' });
    setReload(n => n + 1);
    setWritten(n => n + 1);
  }, []);
  // The column's height bounds the bottom panel's, as a project's does.
  useLayoutEffect(() => {
    const measure = (): void => setColumnHeight(column.current?.clientHeight ?? 0);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (column.current) observer?.observe(column.current);
    return () => observer?.disconnect();
  }, []);
  const maxBottom = bottomMax(columnHeight);

  const open = loaded.kind === 'open' ? { ...loaded, editable: loaded.editable && locked === null } : null;
  // Restoring writes the file: inactive wherever writing is, with the same quiet reason.
  const restoreBlocked =
    edition === 'read'
      ? TEXT.openFiles.freeLine
      : !file || file.mode !== 'edit' || locked !== null
        ? readOnlyLine(locked ?? file?.reason ?? null)
        : !files.can('save')
          ? TEXT.notOffered
          : null;
  useOffer(keys, {
    'editor:indentation': !!open && indent.enabled && (() => setIndentOpen(true)),
    'projects:history': history && (() => showHistory(!historyOpen)),
  });

  const conflict = saveState.kind === 'conflict' && locked === null && compared === null;
  const freeLine = !!open && edition === 'read';
  // A way out for a text this page will not write: a scratch is editable and downloadable.
  const offerCopy = !!open && !open.editable && !!scratchStore;
  const readOnlySaid = freeLine ? TEXT.openFiles.freeLine : file ? readOnlyLine(locked ?? file.reason) : '';
  const unsaved =
    saveState.kind === 'pending' ||
    saveState.kind === 'offline' ||
    saveState.kind === 'refused' ||
    editor.shown?.sides.new.modified === true;
  const saveOffer = open
    ? {
        label: TEXT.saveNow,
        key: SAVE_KEY,
        unavailable: !open.editable
          ? readOnlySaid
          : view.kind !== 'file'
            ? TEXT.nothingToSave
            : comparing
              ? TEXT.conflictState
              : saveState.kind === 'saving' || saveState.kind === 'conflict'
                ? saveText(saveState)
                : unsaved
                  ? null
                  : TEXT.nothingToSave,
      }
    : null;
  const card =
    editor.failed ??
    compared?.card ??
    (loaded.kind === 'missing'
      ? TEXT.openFiles.missing
      : loaded.kind === 'failed'
        ? loaded.text
        : loaded.kind === 'loading' && !offered
          ? TEXT.loading
          : null);
  return (
    <>
      <header className="kit-projects-bar">
        <a className="kit-projects-bar-back" href={routeHash({ section: 'projects' })}>
          {TEXT.allProjects}
        </a>
        {file && <h1 className="kit-projects-bar-title">{printable(file.name)}</h1>}
        {file && <span className="kit-projects-bar-path">{printable(file.displayPath)}</span>}
        <span className="kit-projects-class" data-class={editable && locked === null ? 'file' : 'view'}>
          {editable && locked === null ? TEXT.openFiles.mark : TEXT.classView}
        </span>
        {open?.runsCode && (
          <span className="kit-projects-class" data-mark="executes" title={TEXT.openFiles.executes}>
            {TEXT.openFiles.markExecutes}
          </span>
        )}
        {(offerCopy || (canForget && file)) && (
          <div className="kit-projects-bar-actions">
            {offerCopy && (
              <Button variant="outline" size="sm" disabled={!editor.ready} onClick={() => void copyToScratch()}>
                <CopyIcon aria-hidden="true" />
                {TEXT.openFiles.copyToScratch}
              </Button>
            )}
            {canForget && file && (
              <Button
                variant="ghost"
                size="sm"
                title={TEXT.openFiles.forgetTitle}
                aria-label={TEXT.openFiles.forgetOf(printable(file.name))}
                onClick={() => setAsking(true)}>
                <XIcon aria-hidden="true" />
                {TEXT.openFiles.forget}
              </Button>
            )}
          </div>
        )}
      </header>
      {freeLine && (
        <p className="kit-projects-note" role="note" data-free-line="">
          {TEXT.openFiles.freeLine}
        </p>
      )}
      {open && !freeLine && !open.editable && file && (
        <p className="kit-projects-note" role="note" data-read-only="">
          {readOnlyLine(locked ?? file.reason)}
        </p>
      )}
      {note && (
        <p className="kit-projects-note" data-tone={note.tone} role="status">
          {note.text}
        </p>
      )}
      <div className="kit-projects-workspace">
        <div ref={column} className="kit-projects-column">
          <section className="kit-projects-editor" aria-label={TEXT.editorTitle}>
            <div className="kit-projects-editor-bar">
              <span className="kit-projects-editor-path">{file ? printable(file.name) : ''}</span>
              {compared && <span className="kit-projects-editor-title">{compared.title}</span>}
              {compared?.secret && (
                <span className="kit-projects-mark" data-mark="secret" title={TEXT.readOnlySecret}>
                  {TEXT.markSecret}
                </span>
              )}
              <span className="kit-projects-editor-tools">
                {open && indent.enabled && (
                  <IndentIndicator
                    effective={indent.effective.new}
                    choice={indent.choice.new}
                    languageLabel={labelOf(language)}
                    onChoose={choice => indent.choose('both', choice)}
                    open={indentOpen}
                    onOpenChange={setIndentOpen}
                    settingsHref={routeHash({ section: 'settings' })}
                    {...(indent.profile.id !== DEFAULT_PROFILE && { profileName: indent.profile.name })}
                  />
                )}
                {open?.editable && view.kind === 'file' && (
                  <span className="kit-projects-save" data-state={saveState.kind} role="status">
                    {saveText(saveState)}
                  </span>
                )}
                {view.kind !== 'file' && (
                  <Button variant="ghost" size="sm" onClick={() => setView({ kind: 'file' })}>
                    {TEXT.backToFile}
                  </Button>
                )}
                {history && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={TEXT.showHistory}
                    title={TEXT.showHistory}
                    onClick={() => showHistory(true)}>
                    <HistoryIcon aria-hidden="true" />
                  </Button>
                )}
              </span>
            </div>
            {saveState.kind === 'refused' && locked === null && view.kind === 'file' && (
              <p className="kit-projects-refused" role="alert" data-refused="">
                {TEXT.refusedState(errorLine(saveState.error, 'save'))}
              </p>
            )}
            {(conflict || (comparing && compared === null)) && (
              <div className="kit-projects-conflict" role="alert">
                <span>{TEXT.conflictNotice}</span>
                <Button size="sm" onClick={() => void keepMine()}>
                  {TEXT.keepMine}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void applyExternal()}>
                  {TEXT.applyExternal}
                </Button>
                {!comparing && (
                  <Button size="sm" variant="ghost" onClick={() => void showComparison()}>
                    {TEXT.showComparison}
                  </Button>
                )}
              </div>
            )}
            {open && clipboard && (
              <EditorStrip
                label={EDITOR_TEXT.stripLabel}
                state={{
                  ready: editor.ready && editor.shownCount > 0,
                  standing: editor.standing.new,
                  layout: editor.shown?.mode ?? 'file',
                  view: {
                    softWrap: indent.effective.new.values.softWrap,
                    whitespace: indent.effective.new.values.whitespace,
                  },
                  save: saveOffer,
                  mac,
                }}
                onCommand={command =>
                  void runStripCommand(command, 'new', editor, clipboard, (text, tone) =>
                    setNote({ text, tone }),
                  ).catch((error: unknown) =>
                    setNote({
                      text: TEXT.failed(error instanceof Error ? error.message : String(error)),
                      tone: 'error',
                    }),
                  )
                }
                onView={(view, on) => indent.chooseView('both', viewChoice(view, on))}
                onSave={saveNow}
              />
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
                data-language={language}
              />
              {card && (
                <div className="kit-projects-card">
                  <p>{card}</p>
                </div>
              )}
            </div>
          </section>
          {history && historyOpen && (
            <Splitter
              axis="y"
              grows={-1}
              value={clamp(bottomHeight, BOTTOM_MIN, maxBottom)}
              min={BOTTOM_MIN}
              max={maxBottom}
              label={TEXT.resizeBottomPanel}
              controls="projects-bottom"
              onResize={size => setBottomHeight(clamp(size, BOTTOM_MIN, maxBottom))}
              onReset={() => setBottomHeight(BOTTOM_HEIGHT)}
            />
          )}
          {history && file && (
            <div
              id="projects-bottom"
              className="kit-projects-bottom"
              data-open={historyOpen}
              style={{ height: historyOpen ? clamp(bottomHeight, BOTTOM_MIN, maxBottom) : undefined }}>
              <div className="kit-projects-bottom-head">
                <div className="kit-projects-switches" role="group" aria-label={TEXT.bottomPanel}>
                  <Toggle
                    id="projects-switch-history"
                    size="sm"
                    className="kit-projects-switch"
                    data-view="history"
                    pressed={historyOpen}
                    aria-controls="projects-view-history"
                    title={TEXT.historyLabel}
                    aria-label={TEXT.historyLabel}
                    onPressedChange={showHistory}>
                    <HistoryIcon aria-hidden="true" />
                    <span className="kit-projects-switch-label">{TEXT.historyLabel}</span>
                  </Toggle>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="kit-projects-panel-hide"
                  aria-label={historyOpen ? TEXT.hideBottomPanel : TEXT.showBottomPanel}
                  title={historyOpen ? TEXT.hideBottomPanel : TEXT.showBottomPanel}
                  aria-expanded={historyOpen}
                  aria-controls="projects-bottom-body"
                  onClick={() => showHistory(!historyOpen)}>
                  {historyOpen ? <ChevronDownIcon aria-hidden="true" /> : <ChevronUpIcon aria-hidden="true" />}
                </Button>
              </div>
              <div id="projects-bottom-body" className="kit-projects-bottom-body" hidden={!historyOpen}>
                <div id="projects-view-history" className="kit-projects-view" data-view="history">
                  {historySeen && (
                    <OpenedFileHistory
                      files={files}
                      file={file}
                      version={written}
                      restoreBlocked={restoreBlocked}
                      writable={!!open?.editable}
                      onCompare={setView}
                      settle={settle}
                      onWritten={rewritten}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <ForgetFileDialog
        file={asking && file ? file : null}
        onCancel={() => setAsking(false)}
        onForget={() => void forget()}
      />
    </>
  );
};
