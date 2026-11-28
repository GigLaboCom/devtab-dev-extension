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
 * The companion's own copies of this file and restoring from them (`openFile.history`, `openFile.historyContent`,
 * `openFile.restore`) are in the seam but not on this page yet: the History panel is a project's (its feeds, its points,
 * its restore against a path) and does not take one file of no project without a rework — left for a later step.
 *
 * The strip of the editor's buttons (../editor/EditorStrip.tsx) stands over the editor: the editor's own commands, its
 * two view toggles (a choice for this file over the saved settings), and at its head the file's Save — the very action
 * of ⌘S — greyed with the reason when the file is read only (the line the page says above it) or nothing new waits.
 */
import { errorLine } from './errors';
import { ForgetFileDialog } from './ForgetFileDialog';
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
import { isCompanionError } from '@src/projects/types';
import { VIEWER_PAGE } from '@src/shared/pages';
import { isMac, sameChord } from '@src/shared/viewerProtocol';
import { Button } from '@workspace/ui/button';
import { CopyIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SectionKeys } from '../shell/sectionKeys';
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
  const [asking, setAsking] = useState(false);
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
  useEffect(() => {
    if (!offered) return;
    if (!known) {
      if (listed) setLoaded({ kind: 'missing' });
      return;
    }
    let live = true;
    files.read(id).then(
      text => {
        if (!live) return;
        setLoaded({ kind: 'open', editable, runsCode: text.protected || file?.executes === true });
        show(text.text, !editable);
        const at = takeAt(id);
        if (at)
          post({ type: 'viewer/reveal-line', line: at.line, ...(at.column !== undefined && { column: at.column }) });
        if (!editable) return;
        const saver = makeSaver(files, id, file!.name, text.hash);
        autosave.current = createAutosave({
          delayMs: autosaveDelayMs,
          baseHash: text.hash,
          savedText: text.text,
          read: () => read('new'),
          save: (written, baseHash) => saver.write(written, baseHash),
          onSaved: written => request(n => ({ type: 'viewer/mark-saved', id: n, side: 'new', text: written })),
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
    return () => {
      live = false;
      void leave();
    };
    // Opened once per file, edition and connection; `file` itself only names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, files, offered, known, listed, editable]);

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

  const open = loaded.kind === 'open' ? { ...loaded, editable: loaded.editable && locked === null } : null;
  useOffer(keys, {
    'editor:indentation': !!open && indent.enabled && (() => setIndentOpen(true)),
  });

  const conflict = saveState.kind === 'conflict' && locked === null;
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
        <section className="kit-projects-editor" aria-label={TEXT.editorTitle}>
          <div className="kit-projects-editor-bar">
            <span className="kit-projects-editor-path">{file ? printable(file.name) : ''}</span>
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
              {open?.editable && (
                <span className="kit-projects-save" data-state={saveState.kind} role="status">
                  {saveText(saveState)}
                </span>
              )}
            </span>
          </div>
          {saveState.kind === 'refused' && locked === null && (
            <p className="kit-projects-refused" role="alert" data-refused="">
              {TEXT.refusedState(errorLine(saveState.error, 'save'))}
            </p>
          )}
          {(conflict || comparing) && (
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
                void runStripCommand(command, 'new', editor, clipboard, (text, tone) => setNote({ text, tone })).catch(
                  (error: unknown) =>
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
      </div>
      <ForgetFileDialog
        file={asking && file ? file : null}
        onCancel={() => setAsking(false)}
        onForget={() => void forget()}
      />
    </>
  );
};
